/**
 * Webcam access with friendly, specific handling of the ways it can fail.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'starting' | 'ready' | 'blocked';

export type CameraProblemKind =
  | 'denied'
  | 'notfound'
  | 'busy'
  | 'insecure'
  | 'unsupported'
  | 'unknown';

export interface CameraProblem {
  kind: CameraProblemKind;
  title: string;
  message: string;
  canRetry: boolean;
}

function describe(error: unknown): CameraProblem {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        kind: 'denied',
        title: 'Camera permission is blocked',
        message:
          'Your browser is not letting this page use the camera. Click the camera icon in the address bar, choose Allow, then try again.',
        canRetry: true,
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        kind: 'notfound',
        title: 'No camera found',
        message:
          'We could not find a webcam. Plug one in or check that it is enabled, then try again.',
        canRetry: true,
      };
    case 'NotReadableError':
    case 'AbortError':
      return {
        kind: 'busy',
        title: 'The camera is busy',
        message:
          'Another app or browser tab seems to be using the camera. Close it and try again.',
        canRetry: true,
      };
    default:
      return {
        kind: 'unknown',
        title: 'The camera could not start',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Something went wrong while starting the camera.',
        canRetry: true,
      };
  }
}

export interface CameraHandle {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  problem: CameraProblem | null;
  retry: () => void;
}

export function useCamera(enabled: boolean): CameraHandle {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    setStatus('starting');
    setProblem(null);

    const stop = (): void => {
      const stream = streamRef.current;
      streamRef.current = null;
      if (stream) for (const track of stream.getTracks()) track.stop();
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };

    const fail = (next: CameraProblem): void => {
      if (cancelled) return;
      setProblem(next);
      setStatus('blocked');
    };

    void (async () => {
      if (!window.isSecureContext) {
        fail({
          kind: 'insecure',
          title: 'This page needs a secure connection',
          message:
            'Browsers only give camera access to https:// pages or to http://localhost. If you opened this with a LAN IP address, use http://localhost:5173 instead.',
          canRetry: false,
        });
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        fail({
          kind: 'unsupported',
          title: 'This browser cannot use the camera',
          message: 'Try a recent version of Chrome, Edge, Firefox or Safari.',
          canRetry: false,
        });
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;

        for (const track of stream.getVideoTracks()) {
          track.addEventListener('ended', () =>
            fail({
              kind: 'notfound',
              title: 'The camera stopped',
              message: 'The camera was disconnected or turned off. Try again when it is back.',
              canRetry: true,
            })
          );
        }

        const video = videoRef.current;
        if (!video) {
          fail(describe(new Error('The video element disappeared before the camera started.')));
          return;
        }
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // Autoplay can reject while the tab is hidden; the loop copes because
          // it waits for videoWidth before detecting.
        }
        if (!cancelled) setStatus('ready');
      } catch (error) {
        fail(describe(error));
      }
    })();

    return () => {
      cancelled = true;
      stop();
      setStatus('idle');
    };
  }, [enabled, attempt]);

  return { videoRef, status, problem, retry };
}
