/**
 * Loads the MediaPipe Face Landmarker once for the whole app.
 *
 * Both the WASM runtime and the model are served from /public, so nothing is
 * requested from a third party at runtime. Run `npm run setup` if they are
 * missing - we check for the model first so the error says exactly that.
 *
 * We deliberately do not close() the landmarker when a screen unmounts: it is a
 * multi-megabyte WASM instance shared by every screen, and React StrictMode
 * remounts immediately, which would mean loading it twice. The per-frame
 * resources (the rAF loop and the camera stream) are released instead.
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { useCallback, useEffect, useState } from 'react';

export type LandmarkerStatus = 'loading' | 'ready' | 'error';

const base = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

const WASM_PATH = `${base}mediapipe/wasm`;
const MODEL_PATH = `${base}models/face_landmarker.task`;

export class MissingModelError extends Error {
  constructor() {
    super(
      'The face landmark model is missing from public/models/. Run "npm run setup" in the project folder, then reload this page.'
    );
    this.name = 'MissingModelError';
  }
}

async function assertModelPresent(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(MODEL_PATH, { method: 'HEAD' });
  } catch {
    throw new MissingModelError();
  }
  if (!response.ok) throw new MissingModelError();
  const length = Number(response.headers.get('content-length') ?? '0');
  // A dev server that answers with index.html would give a tiny HTML body.
  if (length > 0 && length < 100_000) throw new MissingModelError();
}

async function create(delegate: 'GPU' | 'CPU'): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode: 'VIDEO',
    numFaces: 1,
    // Sided blendshapes drive three of the exercises; the transformation
    // matrix gives us head yaw/pitch/roll so we can ignore turned frames.
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

let pending: Promise<FaceLandmarker> | null = null;

/** The shared loader, exported so it can be exercised outside React. */
export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (pending) return pending;
  pending = (async () => {
    await assertModelPresent();
    try {
      return await create('GPU');
    } catch (error) {
      console.warn('[midline] GPU delegate unavailable, falling back to CPU', error);
      return create('CPU');
    }
  })();
  // Allow a retry after a failure.
  pending.catch(() => {
    pending = null;
  });
  return pending;
}

export interface LandmarkerHandle {
  landmarker: FaceLandmarker | null;
  status: LandmarkerStatus;
  error: Error | null;
  retry: () => void;
}

export function useFaceLandmarker(): LandmarkerHandle {
  const [landmarker, setLandmarker] = useState<FaceLandmarker | null>(null);
  const [status, setStatus] = useState<LandmarkerStatus>('loading');
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

    void loadFaceLandmarker().then(
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
