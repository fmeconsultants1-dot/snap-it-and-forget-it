/**
 * CameraPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * CAMERA FIX (2026-09-04):
 * Root cause of blank captures on Android:
 *   capture() was firing before videoWidth/videoHeight > 0.
 *   Canvas received a 0x0 frame -> blank base64 -> Gemini saw nothing.
 *
 * Fix:
 *   - capture() guards: if videoWidth===0, show "Camera not ready" toast and return.
 *   - videoRef gets onLoadedMetadata + onCanPlay listeners to track readiness.
 *   - [cameraReady] state disables shutter until stream has real dimensions.
 *   - Stream diagnostics logged to console for debugging.
 *   - Gallery upload remains as secondary option, always available.
 *   - Permission denied -> clear recovery message + gallery fallback.
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { docStore } from '../lib/docStore';
import type { CapturedDoc } from '../lib/docStore';

export default function CameraPage() {
  const navigate    = useNavigate();
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const [captured,     setCaptured]     = useState<CapturedDoc[]>([]);
  const [cameraError,  setCameraError]  = useState<string | null>(null);
  const [cameraReady,  setCameraReady]  = useState(false);
  const [facingMode,   setFacingMode]   = useState<'environment' | 'user'>('environment');
  const [captureToast, setCaptureToast] = useState<string | null>(null);

  // ── Start camera stream ──────────────────────────────────────────────────
  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    setCameraReady(false);
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera API not available in this browser. Use gallery upload instead.');
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width:  { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      // Log diagnostics
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      console.log('[Camera] track:', track?.label);
      console.log('[Camera] settings:', settings);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // play() may throw on some browsers — ignore, canplay handles it
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      console.error('[Camera] getUserMedia error:', err.name, err.message);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('camera_denied');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError('No camera found on this device.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraError('Camera is in use by another app. Close other apps and try again.');
      } else {
        setCameraError(err.message ?? 'Camera unavailable. Use gallery upload.');
      }
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [facingMode, startCamera]);

  // ── Video readiness events ───────────────────────────────────────────────
  const handleVideoReady = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    console.log('[Camera] video ready — dimensions:', v.videoWidth, 'x', v.videoHeight);
    if (v.videoWidth > 0 && v.videoHeight > 0) {
      setCameraReady(true);
    }
  }, []);

  // ── Capture ──────────────────────────────────────────────────────────────
  const capture = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const w = video.videoWidth;
    const h = video.videoHeight;
    console.log('[Camera] capture — videoWidth:', w, 'videoHeight:', h);

    if (w === 0 || h === 0) {
      setCaptureToast('Camera not ready yet — try again in a moment.');
      setTimeout(() => setCaptureToast(null), 2500);
      return;
    }

    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);

    const mimeType = 'image/jpeg';
    const dataUrl  = canvas.toDataURL(mimeType, 0.92);
    const base64   = dataUrl.split(',')[1]!;

    console.log('[Camera] captured base64 length:', base64.length);

    const seq = captured.length + 1;
    setCaptured(prev => [
      ...prev,
      { dataUrl, base64, mimeType, fileName: `document-${seq}.jpg` },
    ]);
  }, [captured.length]);

  // ── Gallery picker (secondary) ───────────────────────────────────────────
  const handleGalleryPick = useCallback(async (e: React.ChangeEvent<HTMLInputElement>, andNavigate = false) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const docs: CapturedDoc[] = [];
    for (const file of files) {
      const base64 = await fileToBase64(file);
      docs.push({
        dataUrl:  `data:${file.type};base64,${base64}`,
        base64,
        mimeType: file.type || 'image/jpeg',
        fileName: file.name,
      });
    }
    if (andNavigate) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      docStore.set(docs);
      navigate('/processing');
    } else {
      setCaptured(prev => [...prev, ...docs]);
    }
  }, [navigate]);

  // ── Done ─────────────────────────────────────────────────────────────────
  const handleDone = () => {
    if (captured.length === 0) return;
    streamRef.current?.getTracks().forEach(t => t.stop());
    docStore.set(captured);
    navigate('/processing');
  };

  const flipCamera = () => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');

  // ── Permission denied screen ─────────────────────────────────────────────
  if (cameraError === 'camera_denied') {
    return (
      <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', gap: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>📷</div>
        <p style={{ color: 'var(--cream)', fontSize: 17, fontWeight: 700 }}>Camera access blocked</p>
        <p style={{ color: 'var(--cream-dim)', fontSize: 14, maxWidth: 280 }}>
          To use the camera, enable camera permission for this site in your browser settings, then tap Try Again.
        </p>
        <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => startCamera(facingMode)}>
          Try Again
        </button>
        <label className="btn-secondary" style={{ marginTop: 8, cursor: 'pointer' }}>
          Choose from Gallery Instead
          <input type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={e => handleGalleryPick(e, true)} />
        </label>
        <button className="btn-secondary" onClick={() => navigate('/')}>Back to Home</button>
      </div>
    );
  }

  // ── Other camera error ───────────────────────────────────────────────────
  if (cameraError) {
    return (
      <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', gap: 16, textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>📷</div>
        <p style={{ color: 'var(--cream-dim)', fontSize: 15 }}>{cameraError}</p>
        <button className="btn-primary" onClick={() => startCamera(facingMode)}>Try Again</button>
        <label className="btn-secondary" style={{ cursor: 'pointer' }}>
          Choose from Gallery
          <input type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={e => handleGalleryPick(e, true)} />
        </label>
        <button className="btn-secondary" onClick={() => navigate('/')}>Back to Home</button>
      </div>
    );
  }

  // ── Live camera screen ───────────────────────────────────────────────────
  return (
    <div className="camera-container">
      <video
        ref={videoRef}
        className="camera-video"
        playsInline
        muted
        autoPlay
        onLoadedMetadata={handleVideoReady}
        onCanPlay={handleVideoReady}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Capture toast */}
      {captureToast && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          background: 'rgba(0,0,0,0.85)', color: '#fff',
          padding: '12px 20px', borderRadius: 12, fontSize: 14,
          textAlign: 'center', zIndex: 10, maxWidth: 280,
        }}>
          {captureToast}
        </div>
      )}

      {/* Waiting for camera */}
      {!cameraReady && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          color: 'rgba(255,255,255,0.7)', fontSize: 14,
        }}>
          Starting camera…
        </div>
      )}

      {/* Document counter */}
      {captured.length > 0 && (
        <div className="camera-counter">
          {captured.length} {captured.length === 1 ? 'doc' : 'docs'} captured
        </div>
      )}

      {/* Done button */}
      {captured.length > 0 && (
        <button className="camera-done-btn" onClick={handleDone}>Done →</button>
      )}

      {/* Thumbnails strip */}
      {captured.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 130, left: 0, right: 0,
          display: 'flex', gap: 8, padding: '0 16px',
          overflowX: 'auto', scrollbarWidth: 'none',
        }}>
          {captured.map((doc, i) => (
            <img key={i} src={doc.dataUrl} alt={`doc ${i+1}`}
              style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border: '2px solid var(--gold)' }} />
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="camera-controls">
        {/* Flip */}
        <button onClick={flipCamera} style={{
          background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: '50%', width: 44, height: 44,
          color: 'white', fontSize: 20, cursor: 'pointer',
        }}>🔄</button>

        {/* Shutter — disabled until stream is ready */}
        <button
          className="camera-shutter"
          onClick={capture}
          disabled={!cameraReady}
          aria-label="Capture document"
          style={{ opacity: cameraReady ? 1 : 0.4 }}
        />

        {/* Gallery */}
        <label style={{
          background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.3)',
          borderRadius: '50%', width: 44, height: 44,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, cursor: 'pointer',
        }}>
          🖼️
          <input type="file" accept="image/*" multiple style={{ display: 'none' }}
            onChange={e => handleGalleryPick(e, false)} />
        </label>
      </div>
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(',')[1]!);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
