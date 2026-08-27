import { useState } from 'react';
import api, { apiErrorMessage } from '../services/api';
import StudentSearchPicker from './StudentSearchPicker';

export default function AllocateForm({ seat, floor, onClose, onDone }) {
  const [student, setStudent] = useState(null);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('06:00');
  const [endTime, setEndTime] = useState('12:00');
  const [monthlyFee, setMonthlyFee] = useState('');
  const [discount, setDiscount] = useState('0');
  const [useCustomLateFee, setUseCustomLateFee] = useState(false);
  const [lateFeeType, setLateFeeType] = useState('fixed');
  const [lateFeeValue, setLateFeeValue] = useState('0');
  const [lateFeeGraceDays, setLateFeeGraceDays] = useState('0');
  const [notes, setNotes] = useState('');
  const [warning, setWarning] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(confirmOverlap = false) {
    if (!student) {
      setError('Please select a student first.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const payload = {
        studentId: student.student_id,
        floorId: floor.floor_id,
        seatId: seat.seat_id,
        startDate,
        startTime,
        endTime,
        monthlyFee: Number(monthlyFee),
        discount: Number(discount || 0),
        lateFeeConfig: useCustomLateFee
          ? { type: lateFeeType, value: Number(lateFeeValue || 0), gracePeriodDays: Number(lateFeeGraceDays || 0) }
          : null,
        notes,
        confirmOverlap,
      };
      const res = await api.post('/allocations', payload);
      if (res.data.requiresConfirmation) {
        setWarning(res.data.warning);
        return;
      }
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h3>
        Allocate seat {seat.seat_number} — {floor?.floor_name}
      </h3>

      {!student ? (
        <StudentSearchPicker onSelect={setStudent} />
      ) : (
        <div className="card" style={{ marginBottom: 12 }}>
          <strong>{student.full_name}</strong> ({student.student_id})
          <button className="btn btn-outline" style={{ marginLeft: 12 }} onClick={() => setStudent(null)}>
            Change
          </button>
        </div>
      )}

      <div className="field">
        <label>Start date</label>
        <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Start time</label>
          <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>End time</label>
          <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Monthly fee (₹)</label>
          <input className="input" type="number" value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Discount (₹)</label>
          <input className="input" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
          <input type="checkbox" checked={useCustomLateFee} onChange={(e) => setUseCustomLateFee(e.target.checked)} />
          Override the library's default late fee for this student
        </label>
      </div>
      {useCustomLateFee && (
        <div style={{ display: 'flex', gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Late fee type</label>
            <select className="input" value={lateFeeType} onChange={(e) => setLateFeeType(e.target.value)}>
              <option value="fixed">Fixed (₹)</option>
              <option value="percentage">Percentage (%)</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Value</label>
            <input className="input" type="number" value={lateFeeValue} onChange={(e) => setLateFeeValue(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Grace days</label>
            <input className="input" type="number" value={lateFeeGraceDays} onChange={(e) => setLateFeeGraceDays(e.target.value)} />
          </div>
        </div>
      )}
      <div className="field">
        <label>Notes</label>
        <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>

      {warning && (
        <div className="card" style={{ borderColor: 'var(--color-warning)', background: 'var(--color-warning-soft)', marginBottom: 12 }}>
          <strong>{warning}</strong>
          <p style={{ margin: '8px 0 0' }}>You can still confirm this allocation, or go back and choose a different time.</p>
        </div>
      )}

      {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {!warning ? (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => submit(false)}>
              Save allocation
            </button>
            <button className="btn btn-outline" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => submit(true)}>
              Confirm anyway
            </button>
            <button className="btn btn-outline" onClick={() => setWarning(null)}>
              Go back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
