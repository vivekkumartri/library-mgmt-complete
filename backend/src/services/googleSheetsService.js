const { google } = require('googleapis');
const env = require('../config/env');
const { SHEETS } = require('../config/sheetsSchema');
const { AppError } = require('../utils/AppError');

/**
 * Thin wrapper around the Sheets v4 API. Every other part of the app talks
 * to Google Sheets ONLY through this service (or through the repository
 * layer built on top of it) — never directly. That is what lets us swap
 * Google Sheets for a real database later without touching business logic.
 */
// How long a sheet's rows are trusted before we re-fetch from the Sheets
// API. Short enough that stale data is never visible for long, long enough
// to collapse the bursts of near-simultaneous reads a single page load
// triggers (e.g. Billing loads billing rows + N student lookups at once).
const READ_CACHE_TTL_MS = Number(process.env.SHEETS_READ_CACHE_TTL_MS || 4000);

class GoogleSheetsService {
  constructor() {
    this._sheets = null;
    this._headerCache = new Map(); // sheetName -> [columns]
    this._readCache = new Map(); // sheetName -> { rows, rowNumbers, expiresAt }
    this._inflight = new Map(); // sheetName -> Promise (dedupe concurrent reads)
  }

  /** Drops any cached rows for a sheet. Called after every write so readers never see stale data. */
  _invalidate(sheetName) {
    this._readCache.delete(sheetName);
  }

  _client() {
    if (!env.googleConfigured) {
      throw new AppError(
        'GOOGLE_NOT_CONFIGURED',
        'Google Sheets is not configured on this server. Set GOOGLE_CLIENT_EMAIL, ' +
          'GOOGLE_PRIVATE_KEY and GOOGLE_SPREADSHEET_ID.',
        503
      );
    }
    if (this._sheets) return this._sheets;
    const auth = new google.auth.JWT({
      email: env.google.clientEmail,
      key: env.google.privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this._sheets = google.sheets({ version: 'v4', auth });
    return this._sheets;
  }

  headers(sheetName) {
    const cols = SHEETS[sheetName];
    if (!cols) throw new AppError('UNKNOWN_SHEET', `Unknown sheet: ${sheetName}`, 500);
    return cols;
  }

  async _withRetry(fn, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = err?.code || err?.response?.status;
        // Retry on rate limit / transient errors only.
        if (status === 429 || status === 500 || status === 503) {
          await new Promise((r) => setTimeout(r, 300 * Math.pow(2, i)));
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  rowToObject(sheetName, row) {
    const cols = this.headers(sheetName);
    const obj = {};
    cols.forEach((c, i) => {
      obj[c] = row[i] ?? '';
    });
    return obj;
  }

  objectToRow(sheetName, obj) {
    const cols = this.headers(sheetName);
    return cols.map((c) => (obj[c] === undefined || obj[c] === null ? '' : String(obj[c])));
  }

  /**
   * Returns { rows: [{...}], rowNumbers: [n] } — rowNumbers are 1-based sheet
   * rows (header = 1). Reads are cached for READ_CACHE_TTL_MS and concurrent
   * calls for the same sheet share one in-flight request, so a page that
   * fires off several reads for the same sheet within a few milliseconds
   * costs the Sheets API one call, not several. Pass { fresh: true } to
   * bypass the cache (e.g. right after a write elsewhere invalidated it and
   * the caller needs the guaranteed-latest data in the same tick).
   */
  async getAll(sheetName, { fresh = false } = {}) {
    const cached = this._readCache.get(sheetName);
    if (!fresh && cached && cached.expiresAt > Date.now()) {
      return { rows: cached.rows, rowNumbers: cached.rowNumbers };
    }
    if (!fresh && this._inflight.has(sheetName)) {
      return this._inflight.get(sheetName);
    }
    const promise = this._fetchAll(sheetName);
    this._inflight.set(sheetName, promise);
    try {
      return await promise;
    } finally {
      this._inflight.delete(sheetName);
    }
  }

  async _fetchAll(sheetName) {
    try {
      const sheets = this._client();
      const cols = this.headers(sheetName);
      const range = `${sheetName}!A2:${this._colLetter(cols.length)}`;
      const res = await this._withRetry(() =>
        sheets.spreadsheets.values.get({ spreadsheetId: env.google.spreadsheetId, range })
      );
      const values = res.data.values || [];
      const rows = values.map((r) => this.rowToObject(sheetName, r));
      const rowNumbers = values.map((_, i) => i + 2);
      this._readCache.set(sheetName, { rows, rowNumbers, expiresAt: Date.now() + READ_CACHE_TTL_MS });
      return { rows, rowNumbers };
    } catch (err) {
      throw this._wrapError(err, `read ${sheetName}`);
    }
  }

  /**
   * Reads several sheets in a single Sheets API call via batchGet, instead
   * of one getAll() per sheet. Any sheet already cached (and not `fresh`) is
   * served from cache and excluded from the batch request entirely — so a
   * dashboard reading 5 sheets right after another request just primed 2 of
   * them only pays for the other 3, in one HTTP round trip.
   * Returns { [sheetName]: { rows, rowNumbers } }.
   */
  async getMany(sheetNames, { fresh = false } = {}) {
    const result = {};
    const toFetch = [];
    for (const name of sheetNames) {
      const cached = this._readCache.get(name);
      if (!fresh && cached && cached.expiresAt > Date.now()) {
        result[name] = { rows: cached.rows, rowNumbers: cached.rowNumbers };
      } else {
        toFetch.push(name);
      }
    }
    if (toFetch.length === 0) return result;
    if (toFetch.length === 1) {
      result[toFetch[0]] = await this.getAll(toFetch[0], { fresh });
      return result;
    }
    try {
      const sheets = this._client();
      const ranges = toFetch.map((name) => {
        const cols = this.headers(name);
        return `${name}!A2:${this._colLetter(cols.length)}`;
      });
      const res = await this._withRetry(() =>
        sheets.spreadsheets.values.batchGet({ spreadsheetId: env.google.spreadsheetId, ranges })
      );
      const valueRanges = res.data.valueRanges || [];
      toFetch.forEach((name, i) => {
        const values = valueRanges[i]?.values || [];
        const rows = values.map((r) => this.rowToObject(name, r));
        const rowNumbers = values.map((_, idx) => idx + 2);
        this._readCache.set(name, { rows, rowNumbers, expiresAt: Date.now() + READ_CACHE_TTL_MS });
        result[name] = { rows, rowNumbers };
      });
      return result;
    } catch (err) {
      throw this._wrapError(err, `batch-read ${toFetch.join(', ')}`);
    }
  }

  async findById(sheetName, idColumn, idValue, opts) {
    const { rows, rowNumbers } = await this.getAll(sheetName, opts);
    const idx = rows.findIndex((r) => r[idColumn] === idValue);
    if (idx === -1) return null;
    return { row: rows[idx], rowNumber: rowNumbers[idx] };
  }

  async append(sheetName, obj) {
    try {
      const sheets = this._client();
      const values = [this.objectToRow(sheetName, obj)];
      await this._withRetry(() =>
        sheets.spreadsheets.values.append({
          spreadsheetId: env.google.spreadsheetId,
          range: `${sheetName}!A:A`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values },
        })
      );
      this._invalidate(sheetName);
      return obj;
    } catch (err) {
      throw this._wrapError(err, `write to ${sheetName}`);
    }
  }

  async updateById(sheetName, idColumn, idValue, patch) {
    // findById would otherwise happily read a cached copy that predates a
    // write this same request already made elsewhere; force a fresh read so
    // we never merge a patch on top of stale data.
    const found = await this.findById(sheetName, idColumn, idValue, { fresh: true });
    if (!found) throw new AppError('NOT_FOUND', `${sheetName} record ${idValue} not found`, 404);
    const merged = { ...found.row, ...patch };
    try {
      const sheets = this._client();
      const cols = this.headers(sheetName);
      const range = `${sheetName}!A${found.rowNumber}:${this._colLetter(cols.length)}${found.rowNumber}`;
      await this._withRetry(() =>
        sheets.spreadsheets.values.update({
          spreadsheetId: env.google.spreadsheetId,
          range,
          valueInputOption: 'RAW',
          requestBody: { values: [this.objectToRow(sheetName, merged)] },
        })
      );
      this._invalidate(sheetName);
      return merged;
    } catch (err) {
      throw this._wrapError(err, `update ${sheetName}`);
    }
  }

  /**
   * Permanently removes one row by id. Reuses overwriteSheet's clear-then-
   * rewrite approach (rather than a batchUpdate deleteDimension, which
   * needs the sheet's numeric gid) so it stays consistent with the same
   * fresh-read-then-replace pattern the rest of this file already uses.
   * Only for genuine hard deletes — most of the app prefers a status flag
   * (e.g. seats marked 'removed', students 'deactivated') so historical
   * records referencing the row stay resolvable; use this only where the
   * caller has already confirmed nothing else references the row.
   */
  async deleteById(sheetName, idColumn, idValue) {
    const { rows } = await this.getAll(sheetName, { fresh: true });
    const remaining = rows.filter((r) => r[idColumn] !== idValue);
    if (remaining.length === rows.length) {
      throw new AppError('NOT_FOUND', `${sheetName} record ${idValue} not found`, 404);
    }
    return this.overwriteSheet(sheetName, remaining);
  }

  /**
   * Fully replaces a sheet's data rows (everything below the header) with
   * `rows`. Used by restore, not by normal app writes — a restore needs to
   * remove rows too (a sheet that had 40 rows at backup time and 60 now
   * must end up with exactly 40), which append/updateById can't do. Clears
   * the whole data range first so a restore with fewer rows than currently
   * present never leaves stale trailing rows behind.
   */
  async overwriteSheet(sheetName, rows) {
    try {
      const sheets = this._client();
      const cols = this.headers(sheetName);
      const clearRange = `${sheetName}!A2:${this._colLetter(cols.length)}`;
      await this._withRetry(() =>
        sheets.spreadsheets.values.clear({ spreadsheetId: env.google.spreadsheetId, range: clearRange })
      );
      if (rows.length > 0) {
        const values = rows.map((r) => this.objectToRow(sheetName, r));
        const writeRange = `${sheetName}!A2:${this._colLetter(cols.length)}${rows.length + 1}`;
        await this._withRetry(() =>
          sheets.spreadsheets.values.update({
            spreadsheetId: env.google.spreadsheetId,
            range: writeRange,
            valueInputOption: 'RAW',
            requestBody: { values },
          })
        );
      }
      this._invalidate(sheetName);
      return { count: rows.length };
    } catch (err) {
      throw this._wrapError(err, `overwrite ${sheetName}`);
    }
  }

  _colLetter(n) {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - m) / 26);
    }
    return s;
  }

  _wrapError(err, action) {
    // An AppError already carries a specific code/status (e.g. the
    // GOOGLE_NOT_CONFIGURED thrown by _client() before any API call is even
    // attempted) — re-wrapping it here would flatten that into a generic
    // "unable to read/write" 502 and hide the actual, more actionable cause.
    if (err instanceof AppError) return err;
    const status = err?.code || err?.response?.status;
    if (status === 401 || status === 403) {
      return new AppError('GOOGLE_AUTH_FAILED', `Google authentication failed while trying to ${action}.`, 502);
    }
    if (status === 429) {
      return new AppError('GOOGLE_RATE_LIMIT', `Google Sheets rate limit hit while trying to ${action}. Please retry shortly.`, 429);
    }
    if (err?.code === 'ENOTFOUND' || err?.code === 'ETIMEDOUT') {
      return new AppError('GOOGLE_NETWORK_ERROR', `Network error while trying to ${action}.`, 502);
    }
    return new AppError('GOOGLE_SHEETS_ERROR', `Unable to ${action}. Please try again.`, 502, { cause: err?.message });
  }
}

module.exports = new GoogleSheetsService();
