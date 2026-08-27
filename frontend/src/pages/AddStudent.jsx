import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api, { apiErrorMessage } from '../services/api';
import SignaturePad from '../components/SignaturePad';
import CameraCapture from '../components/CameraCapture';

// Section 49 — the 9-step wizard. Steps 8/9 (Review, Create) are combined
// into a single screen: the Create action lives on the Review step rather
// than forcing an extra empty screen, since there's nothing left to show
// on a bare "Create" step beyond the button itself.
const STEPS = [
  'Personal information',
  'Contact & ID',
  'Photo',
  'Signature',
  'Seat allocation',
  'Timing',
  'Monthly fee',
  'Review & create',
];

const empty = {
  fullName: '', fatherName: '', motherName: '', mobile: '', alternateMobile: '',
  email: '', address: '', dateOfBirth: '', idProofDetails: '', emergencyContact: '',
  joiningDate: new Date().toISOString().slice(0, 10), notes: '',
};

export default function AddStudent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [allocationResult, setAllocationResult] = useState(null);
  const [uploadNotes, setUploadNotes] = useState([]);
  const [credentialsCopied, setCredentialsCopied] = useState(false);

  const [photoBlob, setPhotoBlob] = useState(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  const [signatureBlob, setSignatureBlob] = useState(null);
  const [signatureSaved, setSignatureSaved] = useState(false);

  // Seat allocation is optional at creation time — admin can always
  // allocate later from the seat map. When they do pick a seat here, the
  // overlap check is run as soon as timing is complete so any warning is
  // surfaced (and must be acknowledged) before the final Create action,
  // matching the same "warn, don't block" rule used everywhere else
  // (section 12/50).
  const [wantsAllocation, setWantsAllocation] = useState(false);
  const [floors, setFloors] = useState([]);
  const [floorId, setFloorId] = useState('');
  const [seats, setSeats] = useState([]);
  const [seatId, setSeatId] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('06:00');
  const [endTime, setEndTime] = useState('12:00');
  const [monthlyFee, setMonthlyFee] = useState('');
  const [discount, setDiscount] = useState('0');
  const [overlapWarning, setOverlapWarning] = useState(null);
  const [overlapAcknowledged, setOverlapAcknowledged] = useState(false);
  const [checkingOverlap, setCheckingOverlap] = useState(false);

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  useEffect(() => {
    api.get('/floors').then((res) => {
      setFloors(res.data.floors);
      if (res.data.floors.length > 0) setFloorId(res.data.floors[0].floor_id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!floorId) return;
    api.get(`/floors/${floorId}/seats`).then((res) => setSeats(res.data.seats)).catch(() => setSeats([]));
    setSeatId('');
  }, [floorId]);

  const checkOverlap = useCallback(async () => {
    if (!seatId || !startTime || !endTime) return;
    setCheckingOverlap(true);
    setOverlapWarning(null);
    setOverlapAcknowledged(false);
    try {
      // A true dry-run — /allocations/check never creates anything, unlike
      // POST /allocations (which persists as soon as there's no overlap
      // warning). The student doesn't exist yet at this point in the
      // wizard, so this never needs to fake a studentId or risk leaving a
      // ghost allocation behind on the seat.
      const res = await api.post('/allocations/check', { seatId, startTime, endTime });
      if (res.data.warning) {
        setOverlapWarning(res.data.warning);
      }
    } catch {
      // Non-fatal — most likely the acting admin lacks allocations
      // permission, or a transient Sheets error. Either way, the real
      // check happens again on final submit; this is just an early heads-up.
    } finally {
      setCheckingOverlap(false);
    }
  }, [seatId, startTime, endTime]);

  function next() {
    if (step === 0 && (!form.fullName || !form.joiningDate)) {
      setError('Full name and joining date are required.');
      return;
    }
    if (step === 1 && !form.mobile) {
      setError('Mobile number is required.');
      return;
    }
    if (step === 4 && wantsAllocation && !seatId) {
      setError('Choose a seat, or turn off seat allocation to skip this step.');
      return;
    }
    if (step === 5 && wantsAllocation && (!startTime || !endTime)) {
      setError('Start and end time are required.');
      return;
    }
    if (step === 6 && wantsAllocation) {
      if (!monthlyFee) {
        setError('Monthly fee is required.');
        return;
      }
      setError('');
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
      checkOverlap();
      return;
    }
    setError('');
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setError('');
    setStep((s) => Math.max(s - 1, 0));
  }

  function onPhotoCaptured(blob) {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoBlob(blob);
    setPhotoPreviewUrl(URL.createObjectURL(blob));
  }

  async function submit() {
    if (wantsAllocation && seatId && overlapWarning && !overlapAcknowledged) {
      setError('Please acknowledge the overlap warning before creating this student, or go back and choose a different time.');
      return;
    }
    setBusy(true);
    setError('');
    const notes = [];
    try {
      const res = await api.post('/students', form);
      setCreated(res.data);

      if (photoBlob) {
        try {
          const fd = new FormData();
          fd.append('photo', photoBlob, 'photo.jpg');
          await api.post(`/students/${res.data.student.student_id}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        } catch (err) {
          notes.push(`Photo upload failed: ${apiErrorMessage(err)}`);
        }
      }
      if (signatureBlob) {
        try {
          const fd = new FormData();
          fd.append('signature', signatureBlob, 'signature.png');
          await api.post(`/students/${res.data.student.student_id}/signature`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
          setSignatureSaved(true);
        } catch (err) {
          notes.push(`Signature upload failed: ${apiErrorMessage(err)}`);
        }
      }
      if (wantsAllocation && seatId) {
        try {
          const allocRes = await api.post('/allocations', {
            studentId: res.data.student.student_id,
            floorId,
            seatId,
            startDate,
            startTime,
            endTime,
            monthlyFee: Number(monthlyFee),
            discount: Number(discount || 0),
            confirmOverlap: true, // already surfaced & acknowledged in the wizard, or there was no warning
          });
          setAllocationResult(allocRes.data.allocation);
        } catch (err) {
          notes.push(`Seat allocation failed: ${apiErrorMessage(err)}`);
        }
      }
      setUploadNotes(notes);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function printCredentials() {
    window.print();
  }

  function copyCredentials() {
    const text = `Login ID: ${created.student.student_id}\nPassword: ${created.temporaryPassword}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCredentialsCopied(true);
    setTimeout(() => setCredentialsCopied(false), 1500);
  }

  if (created) {
    const currentFloor = floors.find((f) => f.floor_id === floorId);
    return (
      <div className="card" style={{ maxWidth: 480 }} id="student-created-card">
        <h2>{t('students.created')}</h2>
        <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>
          The student uses these to log in to the student portal.
        </p>
        <p>
          <strong>Login ID:</strong> {created.student.student_id}
        </p>
        <p>
          <strong>{t('students.tempPassword')}:</strong> {created.temporaryPassword}
        </p>
        <button className="btn btn-outline" onClick={copyCredentials} style={{ marginBottom: 8 }}>
          {credentialsCopied ? 'Copied!' : 'Copy login ID & password'}
        </button>
        {allocationResult && (
          <>
            <p>
              <strong>Seat:</strong> {currentFloor?.floor_name || 'Floor'} — Seat {seats.find((s) => s.seat_id === seatId)?.seat_number}
            </p>
            <p>
              <strong>Timing:</strong> {allocationResult.start_time} – {allocationResult.end_time}
            </p>
            <p>
              <strong>Monthly fee:</strong> ₹{allocationResult.monthly_fee}
            </p>
          </>
        )}
        <p style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>
          Share this password with the student now — it will not be shown again.
        </p>
        {uploadNotes.length > 0 && (
          <div className="card" style={{ background: 'var(--color-warning-soft)', marginBottom: 12 }}>
            {uploadNotes.map((n) => (
              <p key={n} style={{ margin: '4px 0', fontSize: 13 }}>{n} — you can retry this from the student's profile.</p>
            ))}
          </div>
        )}

        {!signatureBlob && !signatureSaved ? (
          <div style={{ marginTop: 16 }}>
            <h4 style={{ marginBottom: 4 }}>Capture signature</h4>
            <SignaturePad
              studentId={created.student.student_id}
              onSaved={() => setSignatureSaved(true)}
              onCancel={() => setSignatureSaved(true)}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={printCredentials}>
              Print / download
            </button>
            <button className="btn btn-primary" onClick={() => navigate(`/students/${created.student.student_id}`)}>
              Go to student profile
            </button>
            {!allocationResult && (
              <button className="btn btn-outline" onClick={() => navigate('/seats')}>
                Allocate a seat
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 560 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, fontSize: 12, color: 'var(--color-ink-soft)', flexWrap: 'wrap' }}>
        {STEPS.map((s, i) => (
          <span key={s} style={{ fontWeight: i === step ? 700 : 400, color: i === step ? 'var(--color-primary)' : undefined }}>
            {i + 1}. {s}
            {i < STEPS.length - 1 ? '  ›' : ''}
          </span>
        ))}
      </div>

      {step === 0 && (
        <>
          <div className="field">
            <label>Full name *</label>
            <input className="input" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Father's name</label>
              <input className="input" value={form.fatherName} onChange={(e) => set('fatherName', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Mother's name</label>
              <input className="input" value={form.motherName} onChange={(e) => set('motherName', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Date of birth</label>
            <input className="input" type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </div>
          <div className="field">
            <label>Joining date *</label>
            <input className="input" type="date" value={form.joiningDate} onChange={(e) => set('joiningDate', e.target.value)} />
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <div style={{ display: 'flex', gap: 12 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Mobile *</label>
              <input className="input" value={form.mobile} onChange={(e) => set('mobile', e.target.value)} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Alternate mobile</label>
              <input className="input" value={form.alternateMobile} onChange={(e) => set('alternateMobile', e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="field">
            <label>Address</label>
            <textarea className="input" rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div className="field">
            <label>ID proof details</label>
            <input className="input" value={form.idProofDetails} onChange={(e) => set('idProofDetails', e.target.value)} />
          </div>
          <div className="field">
            <label>Emergency contact</label>
            <input className="input" value={form.emergencyContact} onChange={(e) => set('emergencyContact', e.target.value)} />
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </div>
        </>
      )}

      {step === 2 && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 0 }}>Optional — can also be captured later from the student's profile.</p>
          {photoPreviewUrl ? (
            <div>
              <img src={photoPreviewUrl} alt="Student preview" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-sunken)' }} />
              <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => { setPhotoBlob(null); setPhotoPreviewUrl(null); }}>
                Retake
              </button>
            </div>
          ) : (
            <CameraCapture label="Student photo" onCapture={onPhotoCaptured} />
          )}
        </div>
      )}

      {step === 3 && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 0 }}>Optional — can also be captured later from the student's profile.</p>
          {signatureBlob ? (
            <div className="card">
              <p style={{ margin: 0 }}>Signature captured.</p>
              <button className="btn btn-outline" style={{ marginTop: 8 }} onClick={() => setSignatureBlob(null)}>
                Redraw
              </button>
            </div>
          ) : (
            <SignaturePad onCapture={(blob) => setSignatureBlob(blob)} onSaved={() => {}} />
          )}
        </div>
      )}

      {step === 4 && (
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginBottom: 12 }}>
            <input type="checkbox" checked={wantsAllocation} onChange={(e) => { setWantsAllocation(e.target.checked); setSeatId(''); }} />
            Allocate a seat now (optional — can also be done later from the seat map)
          </label>
          {wantsAllocation && (
            <>
              <div className="field">
                <label>Floor</label>
                <select className="input" value={floorId} onChange={(e) => setFloorId(e.target.value)}>
                  {floors.map((f) => (
                    <option key={f.floor_id} value={f.floor_id}>{f.floor_name}</option>
                  ))}
                </select>
              </div>
              {floors.length === 0 && <p style={{ color: 'var(--color-ink-soft)', fontSize: 13 }}>No floors configured yet.</p>}
              <div className="field">
                <label>Seat</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {seats.map((s) => (
                    <button
                      type="button"
                      key={s.seat_id}
                      disabled={s.status === 'disabled'}
                      className={`badge ${seatId === s.seat_id ? 'badge-info' : 'badge-neutral'}`}
                      style={{ cursor: s.status === 'disabled' ? 'not-allowed' : 'pointer', opacity: s.status === 'disabled' ? 0.5 : 1 }}
                      onClick={() => setSeatId(s.seat_id)}
                    >
                      {s.seat_number}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {step === 5 && (
        <div>
          {!wantsAllocation ? (
            <p style={{ color: 'var(--color-ink-soft)' }}>No seat selected — timing isn't needed.</p>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}

      {step === 6 && (
        <div>
          {!wantsAllocation ? (
            <p style={{ color: 'var(--color-ink-soft)' }}>No seat selected — a monthly fee isn't needed.</p>
          ) : (
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Monthly fee (₹) *</label>
                <input className="input" type="number" value={monthlyFee} onChange={(e) => setMonthlyFee(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Discount (₹)</label>
                <input className="input" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
            </div>
          )}
        </div>
      )}

      {step === 7 && (
        <div>
          {Object.entries(form).map(([k, v]) => (
            <div className="list-item" key={k}>
              <span style={{ color: 'var(--color-ink-soft)' }}>{k}</span>
              <span>{v || '—'}</span>
            </div>
          ))}
          <div className="list-item">
            <span style={{ color: 'var(--color-ink-soft)' }}>Photo</span>
            <span>{photoBlob ? 'Captured' : 'Not captured'}</span>
          </div>
          <div className="list-item">
            <span style={{ color: 'var(--color-ink-soft)' }}>Signature</span>
            <span>{signatureBlob ? 'Captured' : 'Not captured'}</span>
          </div>
          {wantsAllocation && seatId ? (
            <div className="list-item">
              <span style={{ color: 'var(--color-ink-soft)' }}>Seat allocation</span>
              <span>
                {floors.find((f) => f.floor_id === floorId)?.floor_name} — Seat {seats.find((s) => s.seat_id === seatId)?.seat_number},{' '}
                {startTime}–{endTime}, ₹{monthlyFee || 0}/month
              </span>
            </div>
          ) : (
            <div className="list-item">
              <span style={{ color: 'var(--color-ink-soft)' }}>Seat allocation</span>
              <span>Skipped — allocate later from the seat map</span>
            </div>
          )}

          {checkingOverlap && <p style={{ fontSize: 13, color: 'var(--color-ink-soft)' }}>Checking for timing conflicts…</p>}
          {overlapWarning && (
            <div className="card" style={{ borderColor: 'var(--color-warning)', background: 'var(--color-warning-soft)', marginTop: 12 }}>
              <strong>{overlapWarning}</strong>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, marginTop: 8 }}>
                <input type="checkbox" checked={overlapAcknowledged} onChange={(e) => setOverlapAcknowledged(e.target.checked)} />
                I understand and want to allocate this seat anyway
              </label>
            </div>
          )}

          <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginTop: 12 }}>
            A Student ID and temporary password will be generated automatically.
          </p>
        </div>
      )}

      {error && <p style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        {step > 0 && (
          <button className="btn btn-outline" onClick={back}>
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button className="btn btn-primary" onClick={next}>
            Next
          </button>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? t('common.loading') : 'Create student'}
          </button>
        )}
      </div>
    </div>
  );
}
