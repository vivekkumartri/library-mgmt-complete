import { useRef, useState, useEffect, useCallback } from 'react';
import api, { apiErrorMessage } from '../services/api';

/**
 * Touch/mouse/stylus signature pad (spec section 5). Draws on a canvas at
 * device pixel ratio for crisp lines and exports as a PNG blob.
 *
 * Two modes: pass `studentId` to upload immediately through
 * /students/:id/signature (used from an existing student's profile), or
 * pass `onCapture(blob)` to just hand the drawn PNG back without any
 * network call (used by the Add Student wizard, before the student
 * record — and therefore an id to upload against — exists yet).
 */
export default function SignaturePad({ studentId, onCapture, onSaved, onCancel }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const lastPoint = useRef(null);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#21261F';
  }, []);

  useEffect(() => {
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    return () => window.removeEventListener('resize', setupCanvas);
  }, [setupCanvas]);

  function pointFromEvent(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    drawing.current = true;
    lastPoint.current = pointFromEvent(e);
  }

  function move(e) {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const point = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPoint.current = point;
    setHasDrawn(true);
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    setError('');
  }

  async function save() {
    if (!hasDrawn) {
      setError('Please draw a signature first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const blob = await new Promise((resolve) => canvasRef.current.toBlob(resolve, 'image/png'));
      if (onCapture) {
        onCapture(blob);
        onSaved?.();
        return;
      }
      const fd = new FormData();
      fd.append('signature', blob, 'signature.png');
      await api.post(`/students/${studentId}/signature`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-ink-soft)', marginBottom: 8 }}>
        Draw the signature below using your finger, mouse, or stylus.
      </p>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 200,
          background: 'var(--color-surface-sunken)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          touchAction: 'none',
        }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 8 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-outline" onClick={clear} disabled={busy}>
          Clear / Redraw
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save signature'}
        </button>
        {onCancel && (
          <button className="btn btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
