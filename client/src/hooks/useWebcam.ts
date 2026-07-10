import { useRef, useState, useCallback, useEffect } from 'react';

interface WebcamState {
  isActive: boolean;
  error: string | null;
  fps: number;
}

/**
 * Manages webcam access and provides refs for the video and canvas elements.
 * Does NOT handle periodic frame capture — that is handled by the detection loop.
 */
export function useWebcam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameCountRef = useRef(0);
  const fpsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [state, setState] = useState<WebcamState>({
    isActive: false,
    error: null,
    fps: 0,
  });

  const startCamera = useCallback(async () => {
    setState((s) => ({ ...s, error: null }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: false,
      });

      streamRef.current = stream;
      setState({ isActive: true, error: null, fps: 0 });
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.name === 'NotAllowedError'
            ? 'Camera access denied. Please allow camera permissions and refresh.'
            : err.name === 'NotFoundError'
            ? 'No camera found on this device.'
            : err.message
          : 'Unknown camera error';
      setState({ isActive: false, error: message, fps: 0 });
    }
  }, []);

  // Bind media stream to video element when active
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (state.isActive && streamRef.current) {
      video.srcObject = streamRef.current;
      video.play().catch((err) => {
        console.error('Error playing webcam video:', err);
      });
    } else {
      video.srcObject = null;
    }
  }, [state.isActive]);

  // FPS counter
  useEffect(() => {
    if (!state.isActive) return;

    frameCountRef.current = 0;
    fpsIntervalRef.current = setInterval(() => {
      setState((s) => ({ ...s, fps: frameCountRef.current }));
      frameCountRef.current = 0;
    }, 1000);

    return () => {
      if (fpsIntervalRef.current) clearInterval(fpsIntervalRef.current);
    };
  }, [state.isActive]);

  const stopCamera = useCallback(() => {
    if (fpsIntervalRef.current) clearInterval(fpsIntervalRef.current);
    fpsIntervalRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setState({ isActive: false, error: null, fps: 0 });
  }, []);

  /**
   * Capture the current video frame as a JPEG Blob.
   * Returns null if the video is not ready.
   */
  const captureFrame = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || !state.isActive) {
        resolve(null);
        return;
      }
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        resolve(null);
        return;
      }

      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (blob) {
            frameCountRef.current++;
          }
          resolve(blob);
        },
        'image/jpeg',
        0.80
      );
    });
  }, [state.isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return {
    videoRef,
    canvasRef,
    isActive: state.isActive,
    error: state.error,
    fps: state.fps,
    startCamera,
    stopCamera,
    captureFrame,
  };
}
