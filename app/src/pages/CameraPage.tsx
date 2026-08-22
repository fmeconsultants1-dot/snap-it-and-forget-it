/**
 * CameraPage.tsx
 * FME Mission 001 — Snap It & Forget It
 *
 * Multi-document camera flow.
 * Evidence from screenshots: scan queue shows Document 1-4, all Done.
 * Camera opens, user captures 1-10 docs, taps Done, goes to processing.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { docStore } from '../lib/docStore';
import type { CapturedDoc } from '../lib/docStore';

export default function CameraPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [captured, setCaptured] = useState<CapturedDoc[]>([]);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  const startCamera = useCallback(async (mode: 'environment' | 'user') => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraError(null);
    } catch (err: any) {
      setCameraError(
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access and try again.'
          : err.message ?? 'Camera unavailable'
      );
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [facingMode, startCamera]);

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    const mimeType = 'image/jpeg';
    const dataUrl = canvas.toDataURL(mimeType, 0.92);
    const base64 = dataUrl.split(',')[1]!;
    const seq = captured.length + 1;
    setCaptured(prev => [
      ...prev,
      { dataUrl, base64, mimeType, fileName: `document-${seq}.jpg` }
    ]);
  }, [captured.length]);

  const handleDone = () => {
    if (captured.length === 0) return;
    streamRef.current?.getTracks().forEach(t => t.stop());
    docStore.set(captured);
    navigate('/processing', { state: { documents: captured } });
  };

  const flipCamera = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
  };

  if (cameraError) {
    return (
      <div className="screen" style={{ justifyContent: 'center', alignItems: 'center', gap: 16 }}>
        <div style={{ fontSize: 48 }}>📷</div>
        <p style={{ textAlign: 'center', color: 'var(--white-dim)', fontSize: 15 }}>{cameraError}</p>
        {/* Fallback: file input */}
        <label className="btn-primary" style={{ cursor: 'pointer', marginTop: 24 }}>
          Choose from Gallery
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              const docs: CapturedDoc[] = [];
              for (const file of files) {
                const base64 = await fileToBase64(file);
                docs.push({
                  dataUrl: `data:${file.type};base64,${base64}`,
                  base64,
                  mimeType: file.type,
                  fileName: file.name,
                });
              }
              if (docs.length > 0) {
                docStore.set(docs);
                navigate('/processing', { state: { documents: docs } });
              }
            }}
          />
        </label>
        <button className="btn-secondary" onClick={() => startCamera(facingMode)}>
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="camera-container">
      <video
        ref={videoRef}
        className="camera-video"
        playsInline
        muted
        autoPlay
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Document counter */}
      {captured.length > 0 && (
        <div className="camera-counter">
          {captured.length} {captured.length === 1 ? 'doc' : 'docs'}
        </div>
      )}

      {/* Done button */}
      {captured.length > 0 && (
        <button className="camera-done-btn" onClick={handleDone}>
          Done →
        </button>
      )}

      {/* Controls */}
      <div className="camera-controls">
        {/* Flip camera */}
        <button
          onClick={flipCamera}
          style={{
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: '50%',
            width: 44,
            height: 44,
            color: 'white',
            fontSize: 20,
            cursor: 'pointer',
          }}
        >
          🔄
        </button>

        {/* Shutter */}
        <button className="camera-shutter" onClick={capture} aria-label="Capture document" />

        {/* Gallery fallback */}
        <label
          style={{
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: '50%',
            width: 44,
            height: 44,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            cursor: 'pointer',
          }}
        >
          🖼️
          <input
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              for (const file of files) {
                const base64 = await fileToBase64(file);
                setCaptured(prev => [
                  ...prev,
                  {
                    dataUrl: `data:${file.type};base64,${base64}`,
                    base64,
                    mimeType: file.type,
                    fileName: file.name,
                  }
                ]);
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]!);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
