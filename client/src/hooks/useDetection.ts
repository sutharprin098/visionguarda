import { useRef, useState, useCallback } from 'react';
import { detectImage } from '../utils/api';
import type { DetectResponse } from '../types';

interface DetectionState {
  lastResult: DetectResponse | null;
  isProcessing: boolean;
  error: string | null;
  totalDetections: number;
  latencyMs: number;
  inferFps: number;
  droppedFrames: number;
}

/**
 * Real-time detection hook with continuous async inference loop.
 * 
 * Usage:
 *   1. Call startLoop(captureFrameFn) to begin continuous detection
 *   2. Call stopLoop() to stop
 *   3. The loop automatically captures a frame, sends it, updates state, repeats
 *
 * Rules:
 *   - Only one inference request at a time
 *   - Always processes the LATEST frame (old frames are dropped)
 *   - Never freezes — errors are logged and the loop continues
 *   - Automatically calculates inference FPS
 */
export function useDetection() {
  const isRunningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const loopIdRef = useRef(0); // to detect stale loops
  const inferCountRef = useRef(0);
  const droppedRef = useRef(0);

  const [state, setState] = useState<DetectionState>({
    lastResult: null,
    isProcessing: false,
    error: null,
    totalDetections: 0,
    latencyMs: 0,
    inferFps: 0,
    droppedFrames: 0,
  });

  /**
   * Single inference request: capture frame → send → return result.
   */
  const runSingleInference = useCallback(
    async (captureFrame: () => Promise<Blob | null>): Promise<DetectResponse | null> => {
      const blob = await captureFrame();
      if (!blob) {
        droppedRef.current++;
        return null;
      }

      try {
        const result = await detectImage(blob);
        return result;
      } catch (err: any) {
        // Don't throw — just log and return null so loop continues
        const msg = err?.response?.data?.error ?? err?.message ?? 'Detection failed';
        setState((s) => ({ ...s, error: msg }));
        console.warn('[Detection] Inference error:', msg);
        return null;
      }
    },
    []
  );

  /**
   * Start the continuous async detection loop.
   * @param captureFrame - async function that captures the latest webcam frame
   */
  const startLoop = useCallback(
    (captureFrame: () => Promise<Blob | null>) => {
      if (isRunningRef.current) return; // already running
      isRunningRef.current = true;
      loopIdRef.current++;
      inferCountRef.current = 0;
      droppedRef.current = 0;

      const myLoopId = loopIdRef.current;

      setState((s) => ({ ...s, isProcessing: false, error: null }));

      console.log('[Detection] Starting continuous inference loop');

      const loop = async () => {
        // FPS tracking
        let fpsTimestamps: number[] = [];

        while (isRunningRef.current && loopIdRef.current === myLoopId) {
          setState((s) => ({ ...s, isProcessing: true }));

          const t0 = performance.now();
          const result = await runSingleInference(captureFrame);
          const elapsed = performance.now() - t0;

          if (!isRunningRef.current || loopIdRef.current !== myLoopId) break;

          if (result) {
            inferCountRef.current++;

            // Calculate inference FPS
            const now = performance.now();
            fpsTimestamps.push(now);
            fpsTimestamps = fpsTimestamps.filter((t) => now - t < 2000);
            const inferFps =
              fpsTimestamps.length > 1
                ? ((fpsTimestamps.length - 1) / ((fpsTimestamps[fpsTimestamps.length - 1] - fpsTimestamps[0]) / 1000))
                : 0;

            setState((s) => ({
              ...s,
              lastResult: result,
              isProcessing: false,
              error: null,
              totalDetections: s.totalDetections + result.people,
              latencyMs: Math.round(elapsed),
              inferFps: Math.round(inferFps * 10) / 10,
              droppedFrames: droppedRef.current,
            }));
          } else {
            setState((s) => ({
              ...s,
              isProcessing: false,
              droppedFrames: droppedRef.current,
            }));
          }

          // Minimal delay to avoid CPU thrashing — the inference itself throttles naturally
          // Use requestAnimationFrame timing to stay in sync with browser rendering
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        console.log(`[Detection] Loop ${myLoopId} ended. Frames processed: ${inferCountRef.current}`);
      };

      loop();
    },
    [runSingleInference]
  );

  /**
   * Stop the continuous detection loop.
   */
  const stopLoop = useCallback(() => {
    console.log('[Detection] Stopping inference loop');
    isRunningRef.current = false;
    loopIdRef.current++;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setState((s) => ({ ...s, isProcessing: false }));
  }, []);

  /**
   * Submit a single frame manually (for manual capture button).
   */
  const submitFrame = useCallback(
    async (blob: Blob) => {
      setState((s) => ({ ...s, isProcessing: true, error: null }));
      try {
        const result = await detectImage(blob);
        setState((s) => ({
          ...s,
          lastResult: result,
          isProcessing: false,
          error: null,
          totalDetections: s.totalDetections + result.people,
          latencyMs: result.processingTime,
          inferFps: result.fps,
        }));
      } catch (err: any) {
        const msg = err?.response?.data?.error ?? err?.message ?? 'Detection failed';
        setState((s) => ({ ...s, isProcessing: false, error: msg }));
      }
    },
    []
  );

  const reset = useCallback(() => {
    stopLoop();
    setState({
      lastResult: null,
      isProcessing: false,
      error: null,
      totalDetections: 0,
      latencyMs: 0,
      inferFps: 0,
      droppedFrames: 0,
    });
  }, [stopLoop]);

  return {
    startLoop,
    stopLoop,
    submitFrame,
    reset,
    lastResult: state.lastResult,
    isProcessing: state.isProcessing,
    error: state.error,
    totalDetections: state.totalDetections,
    latencyMs: state.latencyMs,
    inferFps: state.inferFps,
    droppedFrames: state.droppedFrames,
    isRunning: isRunningRef.current,
  };
}
