/**
 * Loads the MediaPipe Pose Landmarker once for the whole app, the same way
 * useFaceLandmarker does. Only the game needs it, and the game screen is code
 * split, so nobody who never opens the game pays for this model.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { useCallback, useEffect, useState } from 'react';

export type PoseStatus = 'loading' | 'ready' | 'error';

const base = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const WASM_PATH = `${base}mediapipe/wasm`;
const MODEL_PATH = `${base}models/pose_landmarker_lite.task`;

export class MissingPoseModelError extends Error {
  constructor() {
    super(
      'The pose model is missing from public/models/. Run "npm run setup" in the project folder, then reload this page.'
    );
    this.name = 'MissingPoseModelError';
  }
}

async function assertModelPresent(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(MODEL_PATH, { method: 'HEAD' });
  } catch {
    throw new MissingPoseModelError();
  }
  if (!response.ok) throw new MissingPoseModelError();
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > 0 && length < 100_000) throw new MissingPoseModelError();
}

async function create(delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    // Metric landmarks give a reach measurement that survives an arm pointing
    // straight at the camera, which is exactly what a jab looks like.
    outputSegmentationMasks: false,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

let pending: Promise<PoseLandmarker> | null = null;

export function loadPoseLandmarker(): Promise<PoseLandmarker> {
  if (pending) return pending;
  pending = (async () => {
    await assertModelPresent();
    try {
      return await create('GPU');
    } catch (error) {
      console.warn('[midline] GPU delegate unavailable for pose, falling back to CPU', error);
      return create('CPU');
    }
  })();
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

export interface PoseHandle {
  landmarker: PoseLandmarker | null;
  status: PoseStatus;
  error: Error | null;
  retry: () => void;
}

export function usePoseLandmarker(): PoseHandle {
  const [landmarker, setLandmarker] = useState<PoseLandmarker | null>(null);
  const [status, setStatus] = useState<PoseStatus>('loading');
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

    void loadPoseLandmarker().then(
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
