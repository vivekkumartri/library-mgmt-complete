import { useState } from 'react';
import api, { apiErrorMessage } from '../services/api';

/**
 * Dedicated "student leaving" flow (spec section 51/56): actual leaving
 * date + reason + notes, with an explicit confirm step rather than a bare
 * `window.confirm`/`window.prompt`. Ending an allocation here never
 * deletes anything — the backend marks it `ended`, preserves the seat's
 * allocation history, and moves the student to Past Students once they
 * have no other active/scheduled allocation.
 */
export default function EndAllocationDrawer({ allocation, studentName, onClose, onDone }) {
  const [actualEndDate, setActualEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/allocations/${allocation.allocation_id}/end`, { actualEndDate, reason, notes });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h3>End allocation{studentName ? ` — ${studentName}` : ''}</h3>
        <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
          {allocation.start_time}–{allocation.end_time}, since {allocation.start_date}. Ending this preserves the full
          allocation, payment, and attendance history — it does not delete anything. If the student has no other active
          allocation, they'll move to Past Students.
        </p>

        {!confirming ? (
          <>
            <div className="field">
              <label>Actual leaving date *</label>
              <input className="input" type="date" value={actualEndDate} onChange={(e) => setActualEndDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Reason</label>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Course completed, relocating" />
            </div>
            <div className="field">
              <label>Notes</label>
              <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-danger" disabled={!actualEndDate} onClick={() => setConfirming(true)}>
                End allocation
              </button>
              <button className="btn btn-outline" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="card" style={{ background: 'var(--color-warning-soft)', marginBottom: 12 }}>
              <p style={{ margin: 0 }}>
                Confirm ending this allocation as of <strong>{actualEndDate}</strong>? This frees up the seat for that time slot.
              </p>
            </div>
            {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn btn-danger" disabled={busy} onClick={submit}>
                {busy ? 'Ending…' : 'Yes, end allocation'}
              </button>
              <button className="btn btn-outline" onClick={() => setConfirming(false)} disabled={busy}>
                Go back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
