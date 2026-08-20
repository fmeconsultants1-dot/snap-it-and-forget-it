/**
 * camera.ts
 * FME Mission 001 — Snap It & Forget It
 *
 * Camera utilities extracted for reuse and testability.
 * Handles getUserMedia, device enumeration, image compression.
 */

export interface CameraConstraints {
  facingMode: 'environment' | 'user';
  width?: number;
  height?: number;
}

export async function openCamera(constraints: CameraConstraints): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera not supported in this browser');
  }

  return navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: constraints.facingMode },
      width: { ideal: constraints.width ?? 1920 },
      height: { ideal: constraints.height ?? 1080 },
    },
    audio: false,
  });
}

export function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  quality: number = 0.92
): { dataUrl: string; base64: string; mimeType: string } {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0);
  const mimeType = 'image/jpeg';
  const dataUrl = canvas.toDataURL(mimeType, quality);
  const base64 = dataUrl.split(',')[1]!;
  return { dataUrl, base64, mimeType };
}

export function stopStream(stream: MediaStream): void {
  stream.getTracks().forEach(track => track.stop());
}

export async function fileToCapture(file: File): Promise<{
  dataUrl: string;
  base64: string;
  mimeType: string;
  fileName: string;
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1]!;
      resolve({
        dataUrl: result,
        base64,
        mimeType: file.type || 'image/jpeg',
        fileName: file.name,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function hasCameraSupport(): boolean {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function isSecureContext(): boolean {
  return window.isSecureContext;
}
