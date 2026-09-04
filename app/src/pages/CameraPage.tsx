/**
 * CameraPage.tsx - FME Mission 001 - Snap It & Forget It
 *
 * VIEWPORT FIX (2026-09-04):
 * On Samsung/Android, the browser chrome (toolbar) can expand/collapse
 * and reduce the visible viewport without changing window.innerHeight.
 * Positioning controls at bottom:20px inside a fixed/100dvh container
 * means controls can be hidden behind the browser toolbar.
 *
 * Fix: use window.visualViewport to track the VISIBLE viewport height
 * and offsetTop. Controls are positioned as fixed elements whose bottom
 * offset is calculated from the actual visible area, not the layout viewport.
 *
 * Formula:
 *   controlsBottom = (window.innerHeight - visualViewport.offsetTop - visualViewport.height)
 *                  + safeAreaBottom + margin
 *
 * Fallback (no visualViewport): 90px from bottom — visible even with
 * large browser chrome. Better high than off-screen.
 *
 * Diagnostic readout shows live viewport values during stabilization.
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { docStore } from '../lib/docStore';
import type { CapturedDoc } from '../lib/docStore';

function useVisualViewportBottom() {
  const [bottom, setBottom] = useState(() => {
    // Fallback: 90px from layout bottom — safely above any browser chrome
    if (typeof window === 'undefined') return 90;
    const vv = (window as any).visualViewport;
    if (!vv) return 90;
    const obstruction = window.innerHeight - vv.offsetTop - vv.height;
    return Math.max(obstruction + 20, 20);
  });

  const [diag, setDiag] = useState({ innerH: 0, vvH: 0, vvTop: 0, bottom: 90 });

  useEffect(() => {
    const vv = (window as any).visualViewport;
    if (!vv) {
      setBottom(90);
      setDiag({ innerH: window.innerHeight, vvH: 0, vvTop: 0, bottom: 90 });
      return;
    }

    function update() {
      const obstruction = window.innerHeight - vv.offsetTop - vv.height;
      // Add 20px margin above any browser chrome, minimum 20px
      const b = Math.max(obstruction + 20, 20);
      setBottom(b);
      setDiag({
        innerH: Math.round(window.innerHeight),
        vvH:    Math.round(vv.height),
        vvTop:  Math.round(vv.offsetTop),
        bottom: Math.round(b),
      });
    }

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return { bottom, diag };
}

export default function CameraPage() {
  const navigate   = useNavigate();
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);

  const [captured,     setCaptured]     = useState<CapturedDoc[]>([]);
  const [cameraError,  setCameraError]  = useState<string | null>(null);
  const [cameraReady,  setCameraReady]  = useState(false);
  const [facingMode,   setFacingMode]   = useState<'environment' | 'user'>('environment');
  const [captureToast, setCaptureToast] = useState<string | null>(null);
  const [showDiag,     setShowDiag]     = useState(true);

  const { bottom: controlsBottom, diag } = useVisualViewportBottom();

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
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, [facingMode, startCamera]);

  const handleVideoReady = useCallback(() => {
    const v = videoRef.current;
    if (v && v.videoWidth > 0 && v.videoHeight > 0) setCameraReady(true);
  }, []);

  const capture = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (w === 0 || h === 0) {
      setCaptureToast('Camera not ready yet — try again in a moment.');
      setTimeout(() => setCaptureToast(null), 2000);
      return;
    }
    canvas.width  = w;
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
    <div style={{ position:'fixed', inset:0, background:'#000', overflow:'hidden' }}>

      {/* Video — covers entire screen */}
      <video
        ref={videoRef}
        playsInline muted autoPlay
        onLoadedMetadata={handleVideoReady}
        onCanPlay={handleVideoReady}
        style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', zIndex:1 }}
      />
      <canvas ref={canvasRef} style={{ display:'none' }} />

      {/* Capture toast */}
      {captureToast && (
        <div style={{
          position:'fixed', top:'50%', left:'50%',
          transform:'translate(-50%,-50%)',
          background:'rgba(0,0,0,0.85)', color:'#fff',
          padding:'12px 20px', borderRadius:12, fontSize:14,
          textAlign:'center', zIndex:50, maxWidth:280,
        }}>
          {captureToast}
        </div>
      )}

      {/* Starting camera indicator */}
      {!cameraReady && (
        <div style={{
          position:'fixed', top:'40%', left:'50%',
          transform:'translate(-50%,-50%)',
          color:'rgba(255,255,255,0.8)', fontSize:15,
          zIndex:10, textAlign:'center', pointerEvents:'none',
        }}>
          Starting camera…
        </div>
      )}

      {/* Doc counter — top left */}
      {captured.length > 0 && (
        <div style={{
          position:'fixed',
          top: 'calc(16px + env(safe-area-inset-top, 0px))',
          left: 16,
          background:'rgba(0,0,0,0.65)', color:'#e8a020',
          fontSize:14, fontWeight:700,
          padding:'4px 14px', borderRadius:20, zIndex:30,
        }}>
          {captured.length} {captured.length === 1 ? 'doc' : 'docs'}
        </div>
      )}

      {/* Done button — top right */}
      {captured.length > 0 && (
        <button onClick={handleDone} style={{
          position:'fixed',
          top: 'calc(16px + env(safe-area-inset-top, 0px))',
          right: 16,
          background:'#e8a020', color:'#000',
          fontSize:14, fontWeight:700,
          padding:'6px 18px', borderRadius:20,
          border:'none', cursor:'pointer', zIndex:30,
        }}>
          Done →
        </button>
      )}

      {/* Thumbnail strip — sits above controls, fixed */}
      {captured.length > 0 && (
        <div style={{
          position:'fixed',
          bottom: controlsBottom + 100,   // above the control bar
          left: 0, right: 0,
          display:'flex', gap:8, padding:'0 16px',
          overflowX:'auto', scrollbarWidth:'none',
          zIndex:30,
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

      {/* ================================================================
          CONTROL BAR — ALWAYS FIXED, ALWAYS VISIBLE
          Position is driven by visualViewport, not the video container.
          controlsBottom = obstruction from browser chrome + margin.
          Fallback = 90px when visualViewport unavailable.
          ================================================================ */}
      <div style={{
        position: 'fixed',          // independent of video/container
        left: 0,
        right: 0,
        bottom: controlsBottom,     // visualViewport-aware
        zIndex: 40,                 // above video, above overlays
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 40,
        // No height dependence on camera readiness
      }}>

        {/* Flip */}
        <button onClick={flipCamera} aria-label="Flip camera" style={{
          width:52, height:52, borderRadius:'50%',
          background:'rgba(0,0,0,0.6)',
          border:'1.5px solid rgba(255,255,255,0.5)',
          color:'#fff', fontSize:22,
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0,
          WebkitTapHighlightColor:'transparent',
        }}>
          🔄
        </button>

        {/* SHUTTER — always rendered and positioned.
            Dimmed before ready, active after. Never hidden. */}
        <button
          onClick={capture}
          aria-label="Capture document"
          style={{
            width: 80,
            height: 80,
            borderRadius: '50%',
            border: '4px solid rgba(255,255,255,0.95)',
            background: cameraReady ? '#e8a020' : 'rgba(232,160,32,0.3)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.25s',
            zIndex: 41,
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            // No opacity change — keep it visible even when dimmed
          }}
        />

        {/* Gallery */}
        <label aria-label="Choose from gallery" style={{
          width:52, height:52, borderRadius:'50%',
          background:'rgba(0,0,0,0.6)',
          border:'1.5px solid rgba(255,255,255,0.5)',
          color:'#fff', fontSize:22,
          display:'flex', alignItems:'center', justifyContent:'center',
          cursor:'pointer', flexShrink:0,
          WebkitTapHighlightColor:'transparent',
        }}>
          🖼️
          <input type="file" accept="image/*" multiple style={{ display:'none' }}
            onChange={e => handleGalleryPick(e, false)} />
        </label>
      </div>

      {/* ================================================================
          VIEWPORT DIAGNOSTICS — stabilization only, removable later.
          Shows live visualViewport values on the device.
          Tap to hide.
          ================================================================ */}
      {showDiag && (
        <div
          onClick={() => setShowDiag(false)}
          style={{
            position: 'fixed',
            top: 'calc(60px + env(safe-area-inset-top, 0px))',
            left: 8,
            background: 'rgba(0,0,0,0.75)',
            color: '#e8a020',
            fontSize: 11,
            fontFamily: 'monospace',
            padding: '6px 10px',
            borderRadius: 8,
            zIndex: 50,
            lineHeight: 1.6,
            userSelect: 'none',
          }}
        >
          <div>innerH: {diag.innerH}px</div>
          <div>vvH: {diag.vvH || 'N/A'}</div>
          <div>vvTop: {diag.vvTop}</div>
          <div>ctrlBot: {diag.bottom}px</div>
          <div style={{ color:'rgba(255,255,255,0.4)', fontSize:9 }}>tap to hide</div>
        </div>
      )}

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
