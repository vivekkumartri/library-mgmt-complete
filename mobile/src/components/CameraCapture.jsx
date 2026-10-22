import { useRef, useState, useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';

/**
 * In-page camera capture (spec section 4): open camera → live preview →
 * capture → preview the still → retake or confirm → hand the confirmed
 * image back as a Blob via onCapture. This replaces a bare
 * `<input type="file" capture>`, which opens the OS camera app with no
 * retake/preview step inside the app itself.
 *
 * Falls back to a plain file input (still camera-capable via the
 * `capture` attribute on mobile) when getUserMedia isn't available —
 * unsupported browser, no camera, or the user denies permission — so the
 * feature degrades instead of breaking the flow.
 *
 * Inside the native Capacitor shell (Android/iOS), getUserMedia inside a
 * WebView is unreliable across devices/OS versions, so this uses the
 * device's own native camera UI (@capacitor/camera) instead — it already
 * provides its own retake/confirm step, so there's no live/preview mode
 * to manage here; the result is just handed straight to onCapture.
 */
async function captureNativePhoto() {
  const photo = await Camera.getPhoto({
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    quality: 90,
  });
  const res = await fetch(photo.webPath);
  return res.blob();
}

export default function CameraCapture({ onCapture, label = 'Photo' }) {
  const isNative = Capacitor.isNativePlatform();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const [mode, setMode] = useState('idle'); // idle | live | preview
  const [previewUrl, setPreviewUrl] = useState(null);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [error, setError] = useState('');
  const [useFallback, setUseFallback] = useState(false);
  const [facingMode, setFacingMode] = useState('user'); // user = front, environment = back

  async function openNativeCamera() {
    setError('');
    try {
      const blob = await captureNativePhoto();
      onCapture(blob);
    } catch (err) {
      // User cancelled the native camera sheet, or permission was denied —
      // either way there's nothing to show; only surface a real failure.
      if (err?.message && !/cancelled/i.test(err.message)) {
        setError('Could not access the camera. Use "Upload instead" below.');
        setUseFallback(true);
      }
    }
  }

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => stopStream, [stopStream]);

  async function openCamera(facing = facingMode) {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setUseFallback(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
      streamRef.current = stream;
      setMode('live');
      // Video element isn't mounted until mode flips — attach on next tick.
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 0);
    } catch (err) {
      setUseFallback(true);
      setError('Could not access the camera (permission denied or unavailable). Use "Upload instead" below.');
    }
  }

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setCapturedBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      stopStream();
      setMode('preview');
    }, 'image/jpeg', 0.9);
  }

  async function switchCamera() {
    const next = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(next);
    stopStream();
    await openCamera(next);
  }

  function retake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
    openCamera();
  }

  function confirm() {
    if (capturedBlob) onCapture(capturedBlob);
    setMode('idle');
  }

  function cancel() {
    stopStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedBlob(null);
    setMode('idle');
  }

  function onFileChosen(e) {
    const file = e.target.files?.[0];
    if (file) onCapture(file);
  }

  if (useFallback) {
    return (
      <div>
        {error && <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 8 }}>{error}</p>}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={onFileChosen}
        />
        <button type="button" className="btn btn-outline" onClick={() => fileInputRef.current?.click()}>
          Upload {label.toLowerCase()}
        </button>
      </div>
    );
  }

  if (mode === 'idle') {
    return (
      <button type="button" className="btn btn-outline" onClick={isNative ? openNativeCamera : openCamera}>
        Open camera — capture {label.toLowerCase()}
      </button>
    );
  }

  if (mode === 'live') {
    return (
      <div>
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', maxHeight: 320, borderRadius: 'var(--radius-md)', background: '#000' }}
        />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={capture}>
            Capture
          </button>
          <button type="button" className="btn btn-outline" onClick={switchCamera}>
            {facingMode === 'user' ? '🔄 Back camera' : '🔄 Front camera'}
          </button>
          <button type="button" className="btn btn-outline" onClick={cancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              stopStream();
              setUseFallback(true);
            }}
          >
            Upload instead
          </button>
        </div>
      </div>
    );
  }

  // mode === 'preview'
  return (
    <div>
      <img src={previewUrl} alt={`${label} preview`} style={{ width: '100%', maxHeight: 320, objectFit: 'contain', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-sunken)' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="btn btn-primary" onClick={confirm}>
          Use this photo
        </button>
        <button type="button" className="btn btn-outline" onClick={retake}>
          Retake
        </button>
        <button type="button" className="btn btn-outline" onClick={cancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
