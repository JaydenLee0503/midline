/**
 * Loads the MediaPipe Pose Landmarker once for the whole app, the same way
 * useFaceLandmarker does. Only the game needs it, and the game screen is code
 * split, so nobody who never opens the game pays for this model.
 */
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { useCallback, useEffect, useState } from 'react';

export type HandStatus = 'loading' | 'ready' | 'error';

const base = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const WASM_PATH = `${base}mediapipe/wasm`;
const MODEL_PATH = `${base}models/hand_landmarker.task`;

export class MissingHandModelError extends Error {
  constructor() {
    super(
      'The hand model is missing from public/models/. Run "npm run setup" in the project folder, then reload this page.'
    );
    this.name = 'MissingHandModelError';
  }
}

async function assertModelPresent(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(MODEL_PATH, { method: 'HEAD' });
  } catch {
    throw new MissingHandModelError();
  }
  if (!response.ok) throw new MissingHandModelError();
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > 0 && length < 100_000) throw new MissingHandModelError();
}

async function create(delegate: 'GPU' | 'CPU'): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    // Forgiving thresholds: a fist flying at the camera is a hard frame, and
    // losing the hand mid-punch is worse than an occasional loose detection.
    minHandDetectionConfidence: 0.4,
    minHandPresenceConfidence: 0.4,
    minTrackingConfidence: 0.4,
  });
}

let pending: Promise<HandLandmarker> | null = null;

export function loadHandLandmarker(): Promise<HandLandmarker> {
  if (pending) return pending;
  pending = (async () => {
    await assertModelPresent();
    try {
      return await create('GPU');
    } catch (error) {
      console.warn('[midline] GPU delegate unavailable for hands, falling back to CPU', error);
      return create('CPU');
    }
  })();
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

export interface HandHandle {
  landmarker: HandLandmarker | null;
  status: HandStatus;
  error: Error | null;
  retry: () => void;
}

export function useHandLandmarker(): HandHandle {
  const [landmarker, setLandmarker] = useState<HandLandmarker | null>(null);
  const [status, setStatus] = useState<HandStatus>('loading');
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    pending = null;
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);

    void loadHandLandmarker().then(
      (instance) => {
        if (cancelled) return;
        setLandmarker(instance);
        setStatus('ready');
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setStatus('error');
      }
    );

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { landmarker, status, error, retry };
}
