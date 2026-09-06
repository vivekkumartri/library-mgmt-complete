import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage } from '../services/api';
import { Loading, ErrorState } from '../components/AsyncState';
import { useAuth } from '../context/AuthContext';

const WEEKDAYS = [
  ['0', 'Sun'], ['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'],
];

/** Settings stores structured config as JSON strings under a single key; these helpers keep parsing in one place. */
function parseJsonSetting(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export default function Settings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [settings, setSettings] = useState({});
  const [floors, setFloors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showFloorForm, setShowFloorForm] = useState(false);
  const [editingFloor, setEditingFloor] = useState(null);

  // Structured late-fee config (section 18) — fixed/percentage + grace
  // period + due day, instead of the single free-text field this used to
  // be. Kept in local state and serialized to settings.default_late_fee_config on save.
  const [lateFeeType, setLateFeeType] = useState('fixed');
  const [lateFeeValue, setLateFeeValue] = useState('0');
  const [gracePeriodDays, setGracePeriodDays] = useState('0');
  const [defaultDueDay, setDefaultDueDay] = useState('5');

  // Holidays (section 36) — weekly closed days + a list of one-off special
  // holidays, each with a date and description.
  const [weeklyHolidays, setWeeklyHolidays] = useState([]);
  const [specialHolidays, setSpecialHolidays] = useState([]);
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [newHolidayDesc, setNewHolidayDesc] = useState('');

  // How many days of Attendance history to keep before the daily cleanup
  // job flushes it — "dynamic" in that it's read fresh from this setting
  // on every purge run rather than hardcoded, so changing it here takes
  // effect immediately with no redeploy.
  const [attendanceRetentionDays, setAttendanceRetentionDays] = useState('365');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, f] = await Promise.all([api.get('/settings'), api.get('/floors')]);
      setSettings(s.data.settings);
      setFloors(f.data.floors);
      const lateFeeConfig = parseJsonSetting(s.data.settings.default_late_fee_config, { type: 'fixed', value: 0, gracePeriodDays: 0 });
      setLateFeeType(lateFeeConfig.type || 'fixed');
      setLateFeeValue(String(lateFeeConfig.value ?? 0));
      setGracePeriodDays(String(lateFeeConfig.gracePeriodDays ?? 0));
      setDefaultDueDay(String(s.data.settings.default_due_day || '5'));
      setWeeklyHolidays(parseJsonSetting(s.data.settings.weekly_holidays, []));
      setSpecialHolidays(parseJsonSetting(s.data.settings.special_holidays, []));
      setAttendanceRetentionDays(String(s.data.settings.attendance_retention_days || '365'));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Unlike load(), this doesn't flip the page-wide `loading` flag — used to
  // refresh the floors list in the background (e.g. after a grid resize)
  // without unmounting whatever's currently open, like the edit drawer.
  const refreshFloors = useCallback(async () => {
    try {
      const f = await api.get('/floors');
      setFloors(f.data.floors);
    } catch {
      // Silent — the resize itself already reported success/failure; this
      // is just a best-effort background refresh of the floor list.
    }
  }, []);

  function set(key, value) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  function toggleWeeklyHoliday(day) {
    setWeeklyHolidays((days) => (days.includes(day) ? days.filter((d) => d !== day) : [...days, day]));
  }

  function addSpecialHoliday() {
    if (!newHolidayDate) return;
    setSpecialHolidays((list) => [...list, { date: newHolidayDate, description: newHolidayDesc }]);
    setNewHolidayDate('');
    setNewHolidayDesc('');
  }

  function removeSpecialHoliday(index) {
    setSpecialHolidays((list) => list.filter((_, i) => i !== index));
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const payload = {
        ...settings,
        default_late_fee_config: JSON.stringify({
          type: lateFeeType,
          value: Number(lateFeeValue || 0),
          gracePeriodDays: Number(gracePeriodDays || 0),
        }),
        default_due_day: defaultDueDay,
        weekly_holidays: JSON.stringify(weeklyHolidays),
        special_holidays: JSON.stringify(specialHolidays),
        attendance_retention_days: attendanceRetentionDays,
      };
      delete payload.default_late_fee; // superseded by default_late_fee_config
      await api.put('/settings', payload);
      setSettings(payload);
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('logo', file);
    try {
      await api.post('/settings/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <h2>{t('settingsPage.title')}</h2>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('settingsPage.librarySettings')}</h3>
        <div className="field">
          <label>{t('settingsPage.libraryName')}</label>
          <input className="input" value={settings.library_name || ''} onChange={(e) => set('library_name', e.target.value)} />
        </div>
        <div className="field">
          <label>Logo</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {settings.library_logo_drive_file_id && <span className="badge badge-success">Logo uploaded</span>}
            <input type="file" accept="image/*" onChange={uploadLogo} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-ink-soft)', marginTop: 4 }}>Appears on generated payment receipts.</p>
        </div>
        <div className="field">
          <label>{t('settingsPage.address')}</label>
          <textarea className="input" rows={2} value={settings.library_address || ''} onChange={(e) => set('library_address', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>{t('settingsPage.phone')}</label>
            <input className="input" value={settings.library_phone || ''} onChange={(e) => set('library_phone', e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>{t('settingsPage.email')}</label>
            <input className="input" value={settings.library_email || ''} onChange={(e) => set('library_email', e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>{t('settingsPage.openingTime')}</label>
            <input className="input" type="time" value={settings.opening_time || ''} onChange={(e) => set('opening_time', e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>{t('settingsPage.closingTime')}</label>
            <input className="input" type="time" value={settings.closing_time || ''} onChange={(e) => set('closing_time', e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary" disabled={saving} onClick={saveSettings}>
          {saving ? 'Saving…' : t('settingsPage.saveSettings')}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('settingsPage.lateFeeConfig')}</h3>
        <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 0 }}>
          Applies to billing records unless a student's own allocation overrides it (set when allocating a seat).
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Type</label>
            <select className="input" value={lateFeeType} onChange={(e) => setLateFeeType(e.target.value)}>
              <option value="fixed">Fixed amount (₹)</option>
              <option value="percentage">Percentage of net fee (%)</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>{lateFeeType === 'percentage' ? 'Value (%)' : 'Value (₹)'}</label>
            <input className="input" type="number" value={lateFeeValue} onChange={(e) => setLateFeeValue(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Grace period (days after due date)</label>
            <input className="input" type="number" value={gracePeriodDays} onChange={(e) => setGracePeriodDays(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Default due day of month</label>
            <input className="input" type="number" min="1" max="28" value={defaultDueDay} onChange={(e) => setDefaultDueDay(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary" disabled={saving} onClick={saveSettings}>
          {saving ? 'Saving…' : t('settingsPage.saveSettings')}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('settingsPage.holidays')}</h3>
        <div className="field">
          <label>{t('settingsPage.weeklyHolidays')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {WEEKDAYS.map(([value, label]) => (
              <label key={value} className="badge badge-neutral" style={{ cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={weeklyHolidays.includes(value)}
                  onChange={() => toggleWeeklyHoliday(value)}
                  style={{ marginRight: 4 }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="field">
          <label>{t('settingsPage.specialHolidays')}</label>
          {specialHolidays.length === 0 && <p style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>None added yet.</p>}
          {specialHolidays.map((h, i) => (
            <div className="list-item" key={`${h.date}-${i}`}>
              <span>
                {h.date} — {h.description || 'Holiday'}
              </span>
              <button className="btn btn-outline" onClick={() => removeSpecialHoliday(i)}>
                Remove
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Date</label>
            <input className="input" type="date" value={newHolidayDate} onChange={(e) => setNewHolidayDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 2 }}>
            <label>Description</label>
            <input className="input" value={newHolidayDesc} onChange={(e) => setNewHolidayDesc(e.target.value)} placeholder="e.g. Diwali" />
          </div>
          <button className="btn btn-outline" onClick={addSpecialHoliday} style={{ marginBottom: 4 }}>
            Add
          </button>
        </div>
        <button className="btn btn-primary" disabled={saving} onClick={saveSettings} style={{ marginTop: 12 }}>
          {saving ? 'Saving…' : t('settingsPage.saveSettings')}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Attendance retention</h3>
        <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 0 }}>
          Attendance is a daily log, so it grows forever if nothing trims it. A background job runs
          once a day and permanently removes attendance records older than this many days — change
          it any time, it takes effect on the next run with no redeploy needed.
        </p>
        <div className="field" style={{ maxWidth: 200 }}>
          <label>Keep attendance for (days)</label>
          <input
            className="input"
            type="number"
            min="1"
            value={attendanceRetentionDays}
            onChange={(e) => setAttendanceRetentionDays(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" disabled={saving} onClick={saveSettings}>
            {saving ? 'Saving…' : t('settingsPage.saveSettings')}
          </button>
          {user?.role === 'super_admin' && <AttendancePurgeButton />}
        </div>
      </div>

      <div className="topbar">
        <h3 style={{ margin: 0 }}>{t('settingsPage.floors')}</h3>
        <button className="btn btn-primary" onClick={() => setShowFloorForm(true)}>
          {t('settingsPage.addFloor')}
        </button>
      </div>
      <div className="card">
        {floors.length === 0 && <p style={{ color: 'var(--color-ink-soft)' }}>No floors yet.</p>}
        {floors.map((f) => (
          <div className="list-item" key={f.floor_id}>
            <div>
              <strong>{f.floor_name}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                {f.rows} × {f.columns} = {f.rows * f.columns} seats · {f.opening_time || '—'}–{f.closing_time || '—'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="badge badge-neutral">{f.status}</span>
              <button className="btn btn-outline" onClick={() => setEditingFloor(f)}>
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {showFloorForm && (
        <FloorFormDrawer onClose={() => setShowFloorForm(false)} onDone={() => { setShowFloorForm(false); load(); }} />
      )}

      {editingFloor && (
        <EditFloorDrawer
          floor={editingFloor}
          onClose={() => setEditingFloor(null)}
          onDone={() => { setEditingFloor(null); load(); }}
          onResized={refreshFloors}
        />
      )}

      {user?.role === 'super_admin' && <BackupsPanel />}
    </div>
  );
}

function AttendancePurgeButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  async function run() {
    if (!window.confirm('Permanently remove attendance records older than the retention window? This cannot be undone.')) return;
    setBusy(true);
    setResult('');
    try {
      const res = await api.post('/attendance/purge');
      setResult(
        res.data.purgedCount > 0
          ? `Removed ${res.data.purgedCount} record(s) older than ${res.data.cutoffDate}.`
          : 'Nothing to remove — no records are older than the retention window.'
      );
    } catch (err) {
      setResult(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button className="btn btn-outline" disabled={busy} onClick={run}>
        {busy ? 'Running…' : 'Run cleanup now'}
      </button>
      {result && <span style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>{result}</span>}
    </div>
  );
}

/**
 * Backups & Restore — the API (`GET /api/backup/list`, `POST
 * /api/backup/restore`) has existed since Session 3, but until now the
 * only way to reach it was `scripts/restoreFromBackup.js` or a raw API
 * call. Restoring overwrites live sheets wholesale, so this always goes
 * through a confirm step: pick a backup, optionally narrow to specific
 * sheets, then explicitly confirm before the destructive call fires.
 */
function BackupsPanel() {
  const [backups, setBackups] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(null); // { date, time } | null

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [listRes, statusRes] = await Promise.all([
        api.get('/backup/list'),
        api.get('/backup/status'),
      ]);
      setBackups(listRes.data.backups);
      setStatus(statusRes.data.lastRun);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runBackupNow() {
    setRunning(true);
    try {
      await api.post('/backup/run');
      await load();
    } catch (err) {
      alert(apiErrorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div className="topbar">
        <h3 style={{ margin: 0 }}>Backups & restore</h3>
        <button className="btn btn-outline" disabled={running} onClick={runBackupNow}>
          {running ? 'Running…' : 'Run backup now'}
        </button>
      </div>
      <div className="card">
        {status && (
          <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 0 }}>
            Last run: {new Date(status.startedAt).toLocaleString()} —{' '}
            {status.ok ? <span className="badge badge-success">OK</span> : <span className="badge badge-danger">Failed</span>}
            {!status.ok && status.error ? ` (${status.error})` : ''}
          </p>
        )}
        {loading && <Loading />}
        {!loading && error && <ErrorState message={error} onRetry={load} />}
        {!loading && !error && backups.length === 0 && (
          <p style={{ color: 'var(--color-ink-soft)' }}>No backups found in Drive yet.</p>
        )}
        {!loading && !error && backups.length > 0 && (
          <div>
            {backups
              .slice()
              .reverse()
              .map((b) => (
                <div className="list-item" key={`${b.date}/${b.time}`}>
                  <div>
                    <strong>{b.date}</strong>
                    <div style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>{b.time}</div>
                  </div>
                  <button className="btn btn-danger-outline" onClick={() => setConfirming(b)}>
                    Restore…
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      {confirming && (
        <RestoreConfirmDrawer
          backup={confirming}
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            load();
          }}
        />
      )}
    </div>
  );
}

const RESTORABLE_SHEETS = [
  'Settings', 'Admins', 'Roles', 'Permissions', 'Floors', 'Seats', 'Students',
  'Student_Documents', 'Student_Vacations', 'Seat_Allocations', 'Fee_Plans',
  'Monthly_Billing', 'Payments', 'Expenses', 'Attendance', 'Notices',
  'Receipts', 'Audit_Log',
];

function RestoreConfirmDrawer({ backup, onClose, onDone }) {
  const [mode, setMode] = useState('all'); // 'all' | 'subset' | 'record'
  const [selected, setSelected] = useState([]);
  const [recordSheet, setRecordSheet] = useState(RESTORABLE_SHEETS[0]);
  const [recordId, setRecordId] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [recordResult, setRecordResult] = useState(null);

  function toggleSheet(name) {
    setSelected((s) => (s.includes(name) ? s.filter((n) => n !== name) : [...s, name]));
  }

  async function submit() {
    if (mode === 'subset' && selected.length === 0) {
      setError('Choose at least one sheet, or restore all sheets instead.');
      return;
    }
    if (mode === 'record' && !recordId.trim()) {
      setError('Enter the record ID to restore.');
      return;
    }
    if (!ack) {
      setError('Please confirm you understand this overwrites live data.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'record') {
        const res = await api.post('/backup/restore-record', {
          date: backup.date,
          time: backup.time,
          sheet: recordSheet,
          recordId: recordId.trim(),
          confirm: true,
        });
        setRecordResult(res.data.restore);
      } else {
        const res = await api.post('/backup/restore', {
          date: backup.date,
          time: backup.time,
          sheets: mode === 'subset' ? selected : undefined,
          confirm: true,
        });
        setResult(res.data.restore);
      }
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const done = result || recordResult;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Restore backup — {backup.date} {backup.time}</h3>

        {!done && (
          <>
            <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
              Restoring whole sheets overwrites them in the live spreadsheet
              with this backup's data — each targeted sheet is replaced
              wholesale, not merged, so anything added or changed since this
              backup was taken will be lost on those sheets. Restoring a
              single record only touches that one row; every other row in
              the sheet is left exactly as it is now.
            </p>

            <div className="field">
              <label>
                <input type="radio" name="restore-mode" checked={mode === 'all'} onChange={() => setMode('all')} /> Restore all sheets
              </label>
            </div>
            <div className="field">
              <label>
                <input type="radio" name="restore-mode" checked={mode === 'subset'} onChange={() => setMode('subset')} /> Restore specific sheets only
              </label>
            </div>
            <div className="field">
              <label>
                <input type="radio" name="restore-mode" checked={mode === 'record'} onChange={() => setMode('record')} /> Restore a single record
              </label>
            </div>

            {mode === 'subset' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {RESTORABLE_SHEETS.map((name) => (
                  <label key={name} className="badge badge-neutral" style={{ cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selected.includes(name)}
                      onChange={() => toggleSheet(name)}
                      style={{ marginRight: 4 }}
                    />
                    {name}
                  </label>
                ))}
              </div>
            )}

            {mode === 'record' && (
              <>
                <div className="field">
                  <label htmlFor="restore-record-sheet">Sheet</label>
                  <select
                    id="restore-record-sheet"
                    className="input"
                    value={recordSheet}
                    onChange={(e) => setRecordSheet(e.target.value)}
                  >
                    {RESTORABLE_SHEETS.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="restore-record-id">Record ID</label>
                  <input
                    id="restore-record-id"
                    className="input"
                    value={recordId}
                    onChange={(e) => setRecordId(e.target.value)}
                    placeholder="e.g. LIB-2026-0042"
                  />
                </div>
              </>
            )}

            <div className="field">
              <label>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand this overwrites
                live data and cannot be undone.
              </label>
            </div>

            {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-danger" disabled={busy || !ack} onClick={submit}>
                {busy ? 'Restoring…' : 'Restore now'}
              </button>
              <button className="btn btn-outline" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {result && (
          <>
            <p style={{ color: 'var(--color-success, green)', fontSize: 14 }}>
              Restored {result.restoredSheets.length} sheet(s): {result.restoredSheets.join(', ') || '—'}.
            </p>
            {result.skippedSheets.length > 0 && (
              <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
                Skipped (no CSV found in this backup): {result.skippedSheets.join(', ')}.
              </p>
            )}
            <button className="btn btn-primary" onClick={onDone}>
              Done
            </button>
          </>
        )}

        {recordResult && (
          <>
            <p style={{ color: 'var(--color-success, green)', fontSize: 14 }}>
              {recordResult.action === 'updated'
                ? `Updated ${recordResult.sheet} record ${recordResult.recordId} back to its backed-up values.`
                : `Re-created ${recordResult.sheet} record ${recordResult.recordId} — it was missing from the live sheet.`}
            </p>
            <button className="btn btn-primary" onClick={onDone}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Lets an admin pick a row, then set how many seats/columns that specific
 * row has — rows don't have to be the same width. Renders as a list with
 * one number input per row plus add/remove-row controls.
 */
function RowConfigEditor({ rowConfig, onChange }) {
  function setRowColumns(index, value) {
    const next = [...rowConfig];
    next[index] = value;
    onChange(next);
  }
  function addRow() {
    onChange([...rowConfig, rowConfig[rowConfig.length - 1] || 10]);
  }
  function removeRow(index) {
    onChange(rowConfig.filter((_, i) => i !== index));
  }
  const total = rowConfig.reduce((sum, c) => sum + (Number(c) || 0), 0);

  return (
    <div className="field">
      <label>Rows &amp; seats per row</label>
      {rowConfig.map((count, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--color-ink-soft)', width: 60 }}>Row {i + 1}</span>
          <input
            className="input"
            type="number"
            min="1"
            value={count}
            onChange={(e) => setRowColumns(i, e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-outline"
            disabled={rowConfig.length <= 1}
            onClick={() => removeRow(i)}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-outline" onClick={addRow}>
        + Add row
      </button>
      <p style={{ fontSize: 12, color: 'var(--color-ink-soft)' }}>Total: {total} seats.</p>
    </div>
  );
}

function FloorFormDrawer({ onClose, onDone }) {
  const [floorName, setFloorName] = useState('');
  const [floorNumber, setFloorNumber] = useState('1');
  const [rowConfig, setRowConfig] = useState([10]);
  const [openingTime, setOpeningTime] = useState('06:00');
  const [closingTime, setClosingTime] = useState('22:00');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const numericRowConfig = rowConfig.map(Number);
    if (!floorName || numericRowConfig.some((c) => !c || c < 1)) {
      setError('Floor name is required, and every row needs at least 1 seat.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post('/floors', {
        floorName, floorNumber, rowConfig: numericRowConfig, openingTime, closingTime,
      });
      onDone();
    } catch (err) {
      setError(err?.response?.data?.error?.message || 'Unable to create floor.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Add floor</h3>
        <div className="field">
          <label>Floor name</label>
          <input className="input" value={floorName} onChange={(e) => setFloorName(e.target.value)} placeholder="Floor 1" />
        </div>
        <div className="field">
          <label>Floor number</label>
          <input className="input" value={floorNumber} onChange={(e) => setFloorNumber(e.target.value)} />
        </div>
        <RowConfigEditor rowConfig={rowConfig} onChange={setRowConfig} />
        <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
          Seats are numbered sequentially row by row as you defined above.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Opening time</label>
            <input className="input" type="time" value={openingTime} onChange={(e) => setOpeningTime(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Closing time</label>
            <input className="input" type="time" value={closingTime} onChange={(e) => setClosingTime(e.target.value)} />
          </div>
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Create floor
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Edits a floor's name, hours, notes and active/inactive status, and — via
 * a separate "Resize grid" action — its rows/columns. Resizing is split
 * from the plain field save because it has real side effects on Seats
 * (creating new seats, or removing empty ones at the end of the grid); it
 * hits a dedicated backend endpoint that refuses to shrink past a seat
 * that's currently allocated.
 */
function EditFloorDrawer({ floor, onClose, onDone, onResized }) {
  const [floorName, setFloorName] = useState(floor.floor_name);
  const [openingTime, setOpeningTime] = useState(floor.opening_time || '');
  const [closingTime, setClosingTime] = useState(floor.closing_time || '');
  const [status, setStatus] = useState(floor.status || 'active');
  const [notes, setNotes] = useState(floor.notes || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const initialRowConfig = (() => {
    try {
      const parsed = JSON.parse(floor.row_config_json || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      // fall through to the uniform-grid fallback below
    }
    return Array(Number(floor.rows) || 1).fill(Number(floor.columns) || 1);
  })();
  const [rowConfig, setRowConfig] = useState(initialRowConfig);
  const [resizeError, setResizeError] = useState('');
  const [resizeNotice, setResizeNotice] = useState('');
  const [resizing, setResizing] = useState(false);

  async function submit() {
    if (!floorName) {
      setError('Floor name is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.patch(`/floors/${floor.floor_id}`, {
        floor_name: floorName,
        opening_time: openingTime,
        closing_time: closingTime,
        status,
        notes,
      });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, 'Unable to update floor.'));
    } finally {
      setBusy(false);
    }
  }

  async function resize() {
    const numericRowConfig = rowConfig.map(Number);
    if (numericRowConfig.some((c) => !c || c < 1)) {
      setResizeError('Every row needs at least 1 seat.');
      return;
    }
    const newTotal = numericRowConfig.reduce((sum, c) => sum + c, 0);
    const currentTotal = initialRowConfig.reduce((sum, c) => sum + Number(c), 0);
    if (JSON.stringify(numericRowConfig) === JSON.stringify(initialRowConfig.map(Number))) {
      setResizeError('That is the same layout as now — nothing to change.');
      return;
    }
    if (newTotal < currentTotal) {
      const shrink = window.confirm(
        `This will shrink the grid from ${currentTotal} seats to ${newTotal}. Any removed seat with an active or scheduled allocation will block the resize. Continue?`
      );
      if (!shrink) return;
    }
    setResizing(true);
    setResizeError('');
    setResizeNotice('');
    try {
      const res = await api.patch(`/floors/${floor.floor_id}/resize`, { rowConfig: numericRowConfig });
      setResizeNotice(
        res.data.seatsAdded > 0 ? `Added ${res.data.seatsAdded} seat(s).` : `Removed ${res.data.seatsRemoved} seat(s).`
      );
      // Refresh the floors list in the background (grid totals, etc.) but
      // keep the drawer open so the admin actually sees the notice above —
      // unlike onDone(), this does not close the drawer.
      onResized?.();
    } catch (err) {
      setResizeError(apiErrorMessage(err, 'Unable to resize the grid.'));
    } finally {
      setResizing(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>Edit floor</h3>
        <div className="field">
          <label>Floor name</label>
          <input className="input" value={floorName} onChange={(e) => setFloorName(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Opening time</label>
            <input className="input" type="time" value={openingTime} onChange={(e) => setOpeningTime(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Closing time</label>
            <input className="input" type="time" value={closingTime} onChange={(e) => setClosingTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Status</label>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="field">
          <label>Notes</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            Save changes
          </button>
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
        </div>

        <hr style={{ margin: '20px 0' }} />

        <h4 style={{ marginBottom: 4 }}>Resize seat grid</h4>
        <p style={{ fontSize: 12, color: 'var(--color-ink-soft)', marginTop: 0 }}>
          Currently {initialRowConfig.reduce((sum, c) => sum + Number(c), 0)} seats across {initialRowConfig.length} row(s).
          Pick a row and change its seat count independently of the others — growing a row adds seats at its end, shrinking
          removes seats from its end and is blocked if any of them are currently allocated.
        </p>
        <RowConfigEditor rowConfig={rowConfig} onChange={setRowConfig} />
        {resizeError && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{resizeError}</p>}
        {resizeNotice && <p style={{ color: 'var(--color-success)', fontSize: 13 }}>{resizeNotice}</p>}
        <button className="btn btn-outline" disabled={resizing} onClick={resize}>
          {resizing ? 'Resizing…' : 'Resize grid'}
        </button>
      </div>
    </div>
  );
}
