/**
 * CameraPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * LAYOUT FIX (2026-09-04):
 * Camera controls were being pushed below the Android viewport because
 * .camera-video { flex: 1 } caused the video to consume all available
 * height, pushing controls off-screen on devices where the video's
 * intrinsic size or browser chrome consumed the full viewport.
 *
 * Fix: video is position:absolute filling the container.
 * Controls are position:absolute at the bottom, z-index above video.
 * Controls are ALWAYS in the visible viewport regardless of video size.
 * Shutter remains visible (dimmed) even before cameraReady === true.
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

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    setCameraReady(false);
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera API not available. Use gallery upload instead.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError('camera_denied');
      } else if (err.name === 'NotFoundError') {
        setCameraError('No camera found on this device.');
      } else if (err.name === 'NotReadableError') {
        setCameraError('Camera is in use by another app. Close other apps and try again.');
      } else {
        setCameraError(err.message ?? 'Camera unavailable. Use gallery upload.');
      }
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; };
  }, [facingMode, startCamera]);

  const handleVideoReady = useCallback(() => {
    const v = videoRef.current;
    if (v && v.videoWidth > 0 && v.videoHeight > 0) setCameraReady(true);
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      setCaptureToast('Camera not ready yet — try again in a moment.');
      setTimeout(() => setCaptureToast(null), 2000);
      return;
    }
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const mimeType = 'image/jpeg';
    const dataUrl  = canvas.toDataURL(mimeType, 0.92);
    const base64   = dataUrl.split(',')[1]!;
    const seq = captured.length + 1;
    setCaptured(prev => [...prev, { dataUrl, base64, mimeType, fileName: `document-${seq}.jpg` }]);
  }, [captured.length]);

  const handleGalleryPick = useCallback(async (
    e: React.ChangeEvent<HTMLInputElement>,
    andNavigate = false
  ) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const docs: CapturedDoc[] = [];
    for (const file of files) {
      const base64 = await fileToBase64(file);
      docs.push({ dataUrl: `data:${file.type};base64,${base64}`, base64, mimeType: file.type || 'image/jpeg', fileName: file.name });
    }
    if (andNavigate) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      docStore.set(docs);
      navigate('/processing');
    } else {
      setCaptured(prev => [...prev, ...docs]);
    }
  }, [navigate]);

  const handleDone = () => {
    if (!captured.length) return;
    streamRef.current?.getTracks().forEach(t => t.stop());
    docStore.set(captured);
    navigate('/processing');
  };

  const flipCamera = () => setFacingMode(p => p === 'environment' ? 'user' : 'environment');

  /* ---- Permission denied ---- */
  if (cameraError === 'camera_denied') {
    return (
      <div className="screen" style={{ justifyContent:'center', alignItems:'center', gap:16, textAlign:'center' }}>
        <div style={{ fontSize:48 }}>📷</div>
        <p style={{ color:'var(--cream)', fontSize:17, fontWeight:700 }}>Camera access blocked</p>
        <p style={{ color:'var(--cream-dim)', fontSize:14, maxWidth:280 }}>
          Enable camera permission for this site in your browser settings, then tap Try Again.
        </p>
        <button className="btn-primary" onClick={() => startCamera(facingMode)}>Try Again</button>
        <label className="btn-secondary" style={{ cursor:'pointer' }}>
          Choose from Gallery Instead
          <input type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e => handleGalleryPick(e, true)} />
        </label>
        <button className="btn-secondary" onClick={() => navigate('/')}>Back to Home</button>
      </div>
    );
  }

  /* ---- Other camera error ---- */
  if (cameraError) {
    return (
      <div className="screen" style={{ justifyContent:'center', alignItems:'center', gap:16, textAlign:'center' }}>
        <div style={{ fontSize:48 }}>📷</div>
        <p style={{ color:'var(--cream-dim)', fontSize:15 }}>{cameraError}</p>
        <button className="btn-primary" onClick={() => startCamera(facingMode)}>Try Again</button>
        <label className="btn-secondary" style={{ cursor:'pointer' }}>
          Choose from Gallery
          <input type="file" accept="image/*" multiple style={{ display:'none' }} onChange={e => handleGalleryPick(e, true)} />
        </label>
        <button className="btn-secondary" onClick={() => navigate('/')}>Back to Home</button>
      </div>
    );
  }

  /* ---- Live camera ---- */
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      height: '100dvh',
      background: '#000',
      overflow: 'hidden',
    }}>
      {/* Video fills container absolutely — never pushes controls */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onLoadedMetadata={handleVideoReady}
        onCanPlay={handleVideoReady}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 1,
        }}
      />
      <canvas ref={canvasRef} style={{ display:'none' }} />

      {/* Capture toast — centered over video */}
      {captureToast && (
        <div style={{
          position:'absolute', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)',
          background:'rgba(0,0,0,0.85)', color:'#fff',
          padding:'12px 20px', borderRadius:12, fontSize:14,
          textAlign:'center', zIndex:30, maxWidth:280,
        }}>
          {captureToast}
        </div>
      )}

      {/* Starting camera indicator */}
      {!cameraReady && !cameraError && (
        <div style={{
          position:'absolute', top:'45%', left:'50%',
          transform:'translate(-50%,-50%)',
          color:'rgba(255,255,255,0.7)', fontSize:14,
          zIndex:10, textAlign:'center',
        }}>
          Starting camera…
        </div>
      )}

      {/* Doc counter — top left */}
      {captured.length > 0 && (
        <div style={{
          position:'absolute',
          top:'calc(16px + env(safe-area-inset-top, 0px))',
          left:16,
          background:'rgba(0,0,0,0.65)',
          color:'#e8a020',
          fontSize:14, fontWeight:700,
          padding:'4px 14px', borderRadius:20,
          zIndex:20,
        }}>
          {captured.length} {captured.length === 1 ? 'doc' : 'docs'}
        </div>
      )}

      {/* Done button — top right */}
      {captured.length > 0 && (
        <button
          onClick={handleDone}
          style={{
            position:'absolute',
            top:'calc(16px + env(safe-area-inset-top, 0px))',
            right:16,
            background:'#e8a020',
            color:'#000',
            fontSize:14, fontWeight:700,
            padding:'6px 18px', borderRadius:20,
            border:'none', cursor:'pointer',
            zIndex:20,
          }}
        >
          Done →
        </button>
      )}

      {/* Thumbnail strip — above controls */}
      {captured.length > 0 && (
        <div style={{
          position:'absolute',
          bottom:'calc(130px + env(safe-area-inset-bottom, 0px))',
          left:0, right:0,
          display:'flex', gap:8, padding:'0 16px',
          overflowX:'auto', scrollbarWidth:'none',
          zIndex:20,
        }}>
          {captured.map((doc, i) => (
            <img key={i} src={doc.dataUrl} alt={`doc ${i+1}`} style={{
              width:56, height:56, borderRadius:8,
              objectFit:'cover', flexShrink:0,
              border:'2px solid #e8a020',
            }} />
          ))}
        </div>
      )}

      {/* ---- CONTROLS — always visible, absolutely positioned at bottom ---- */}
      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
        zIndex: 20,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 40,
      }}>
        {/* Flip camera */}
        <button
          onClick={flipCamera}
          style={{
            width:52, height:52, borderRadius:'50%',
            background:'rgba(0,0,0,0.55)',
            border:'1.5px solid rgba(255,255,255,0.4)',
            color:'#fff', fontSize:22,
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', flexShrink:0,
          }}
          aria-label="Flip camera"
        >
          🔄
        </button>

        {/* SHUTTER — always rendered, dimmed until ready */}
        <button
          onClick={capture}
          aria-label="Capture document"
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            /* Outer ring */
            border: '4px solid rgba(255,255,255,0.9)',
            /* Gold fill center */
            background: cameraReady ? '#e8a020' : 'rgba(232,160,32,0.35)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.2s',
            /* Ensure it is always on top and tappable */
            zIndex: 25,
            position: 'relative',
            /* Large tap target */
            touchAction: 'manipulation',
          }}
        />

        {/* Gallery */}
        <label
          style={{
            width:52, height:52, borderRadius:'50%',
            background:'rgba(0,0,0,0.55)',
            border:'1.5px solid rgba(255,255,255,0.4)',
            color:'#fff', fontSize:22,
            display:'flex', alignItems:'center', justifyContent:'center',
            cursor:'pointer', flexShrink:0,
          }}
          aria-label="Choose from gallery"
        >
          🖼️
          <input
            type="file" accept="image/*" multiple
            style={{ display:'none' }}
            onChange={e => handleGalleryPick(e, false)}
          />
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
