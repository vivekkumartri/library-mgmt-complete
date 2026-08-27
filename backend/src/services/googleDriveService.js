const { google } = require('googleapis');
const { Readable } = require('stream');
const env = require('../config/env');
const { AppError } = require('../utils/AppError');

/**
 * Manages the Drive folder tree automatically so admins never touch Drive
 * paths directly:
 *
 *   Library Management/
 *     Students/<student_id>/Photo/
 *     Students/<student_id>/Signature/
 *     Students/<student_id>/Documents/
 *     Receipts/<year>/<month>/
 *     Reports/
 *
 * Folder ids are cached in-memory per process; for a multi-instance deploy
 * this cache is best-effort only (a duplicate folder is harmless — it is
 * still found and reused because we always search-then-create).
 */
class GoogleDriveService {
  constructor() {
    this._drive = null;
    this._folderCache = new Map(); // "parentId::name" -> folderId
  }

  _client() {
    if (!env.googleConfigured) {
      throw new AppError('GOOGLE_NOT_CONFIGURED', 'Google Drive is not configured on this server.', 503);
    }
    if (this._drive) return this._drive;
    const auth = new google.auth.JWT({
      email: env.google.clientEmail,
      key: env.google.privateKey,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    this._drive = google.drive({ version: 'v3', auth });
    return this._drive;
  }

  async _findOrCreateFolder(name, parentId) {
    const cacheKey = `${parentId}::${name}`;
    if (this._folderCache.has(cacheKey)) return this._folderCache.get(cacheKey);
    const drive = this._client();
    const q = [
      `name = '${name.replace(/'/g, "\\'")}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      `'${parentId}' in parents`,
      'trashed = false',
    ].join(' and ');
    const found = await drive.files.list({ q, fields: 'files(id, name)' });
    let folderId;
    if (found.data.files && found.data.files.length > 0) {
      folderId = found.data.files[0].id;
    } else {
      const created = await drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
        fields: 'id',
      });
      folderId = created.data.id;
    }
    this._folderCache.set(cacheKey, folderId);
    return folderId;
  }

  /**
   * Like _findOrCreateFolder, but never creates anything — returns null if
   * the folder isn't there. Used by resolvePath so a restore against a
   * typo'd date never silently creates an empty folder and "succeeds"
   * against nothing.
   */
  async _findFolder(name, parentId) {
    const cacheKey = `${parentId}::${name}`;
    if (this._folderCache.has(cacheKey)) return this._folderCache.get(cacheKey);
    const drive = this._client();
    const q = [
      `name = '${name.replace(/'/g, "\\'")}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      `'${parentId}' in parents`,
      'trashed = false',
    ].join(' and ');
    const found = await drive.files.list({ q, fields: 'files(id, name)' });
    if (!found.data.files || found.data.files.length === 0) return null;
    const folderId = found.data.files[0].id;
    this._folderCache.set(cacheKey, folderId);
    return folderId;
  }

  /** Read-only counterpart to ensurePath — returns null instead of creating missing segments. */
  async resolvePath(segments) {
    let parent = env.google.driveRootFolderId;
    if (!parent) {
      throw new AppError('GOOGLE_NOT_CONFIGURED', 'GOOGLE_DRIVE_ROOT_FOLDER_ID is not set.', 503);
    }
    for (const seg of segments) {
      parent = await this._findFolder(seg, parent);
      if (!parent) return null;
    }
    return parent;
  }

  /** Lists non-trashed files/folders directly inside a folder id. */
  async listFiles(folderId) {
    try {
      const drive = this._client();
      const res = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'files(id, name, mimeType)',
        pageSize: 1000,
      });
      return res.data.files || [];
    } catch (err) {
      throw this._wrapError(err, 'list files in Google Drive folder');
    }
  }

  async ensurePath(segments) {
    let parent = env.google.driveRootFolderId;
    if (!parent) {
      throw new AppError('GOOGLE_NOT_CONFIGURED', 'GOOGLE_DRIVE_ROOT_FOLDER_ID is not set.', 503);
    }
    for (const seg of segments) {
      parent = await this._findOrCreateFolder(seg, parent);
    }
    return parent;
  }

  /**
   * Uploads a buffer to the given logical path (array of folder names under
   * the app's Drive root) and returns { fileId, webViewLink }.
   */
  async uploadBuffer({ pathSegments, fileName, mimeType, buffer }) {
    try {
      const folderId = await this.ensurePath(pathSegments);
      const drive = this._client();
      const res = await drive.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { mimeType, body: Readable.from(buffer) },
        fields: 'id, webViewLink',
      });
      return { fileId: res.data.id, webViewLink: res.data.webViewLink };
    } catch (err) {
      throw this._wrapError(err, 'upload file to Google Drive');
    }
  }

  async getFileBuffer(fileId) {
    try {
      const drive = this._client();
      const res = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      return Buffer.from(res.data);
    } catch (err) {
      throw this._wrapError(err, 'download file from Google Drive');
    }
  }

  _wrapError(err, action) {
    // Same reasoning as googleSheetsService._wrapError: don't flatten an
    // already-specific AppError (e.g. GOOGLE_NOT_CONFIGURED) into a generic one.
    if (err instanceof AppError) return err;
    const status = err?.code || err?.response?.status;
    if (status === 401 || status === 403) {
      return new AppError('GOOGLE_AUTH_FAILED', `Google authentication failed while trying to ${action}.`, 502);
    }
    if (status === 404) {
      return new AppError('GOOGLE_DRIVE_MISSING_FOLDER', `Could not find the expected Google Drive folder while trying to ${action}.`, 502);
    }
    return new AppError('GOOGLE_DRIVE_ERROR', `Unable to ${action}. Please try again.`, 502, { cause: err?.message });
  }
}

module.exports = new GoogleDriveService();
