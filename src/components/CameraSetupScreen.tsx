/**
 * Camera + model readiness, shown under the live video before calibration.
 */
import type { CameraProblem, CameraStatus } from '../hooks/useCamera';
import type { LandmarkerStatus } from '../hooks/useFaceLandmarker';
import type { PoseProblem } from '../lib/metrics';
import { alignmentHint } from './VideoStage';

type CheckState = 'waiting' | 'ok' | 'problem';

export interface CameraSetupScreenProps {
  cameraStatus: CameraStatus;
  cameraProblem: CameraProblem | null;
  onRetryCamera: () => void;
  modelStatus: LandmarkerStatus;
  modelError: Error | null;
  onRetryModel: () => void;
  detectionError: Error | null;
  faceDetected: boolean;
  alignment: PoseProblem | null;
  onBegin: () => void;
  onCancel: () => void;
}

function Check({ state, children }: { state: CheckState; children: React.ReactNode }) {
  const mark = state === 'ok' ? '✓' : state === 'problem' ? '!' : '·';
  const tone =
    state === 'ok' ? 'bg-good text-white' : state === 'problem' ? 'bg-warn text-white' : 'bg-line';
  return (
    <li className="flex items-center gap-4 text-xl">
      <span
        aria-hidden
        className={`flex size-9 shrink-0 items-center justify-center text-xl font-bold ${tone}`}
      >
        {mark}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function CameraSetupScreen(props: CameraSetupScreenProps) {
  const {
    cameraStatus,
    cameraProblem,
    onRetryCamera,
    modelStatus,
    modelError,
    onRetryModel,
    detectionError,
    faceDetected,
    alignment,
    onBegin,
    onCancel,
  } = props;

  const cameraState: CheckState =
    cameraStatus === 'ready' ? 'ok' : cameraProblem ? 'problem' : 'waiting';
  const modelState: CheckState =
    modelStatus === 'ready' ? 'ok' : modelStatus === 'error' ? 'problem' : 'waiting';
  const faceState: CheckState = faceDetected ? 'ok' : 'waiting';

  const ready = cameraState === 'ok' && modelState === 'ok' && faceState === 'ok';
  const hint = alignmentHint(alignment);

  return (
    <div className="mt-6">
      <h2 className="h2">Let&rsquo;s get you set up</h2>
      <ul className="mt-4 space-y-3">
        <Check state={cameraState}>
          {cameraStatus === 'ready' ? 'Camera is on' : 'Waiting for the camera'}
        </Check>
        <Check state={modelState}>
          {modelStatus === 'ready'
            ? 'Face measurement is loaded'
            : modelStatus === 'error'
              ? 'Face measurement could not load'
              : 'Loading face measurement (first time takes a moment)'}
        </Check>
        <Check state={faceState}>
          {faceDetected ? 'We can see your face' : 'Looking for your face'}
        </Check>
      </ul>

      {!faceDetected && cameraStatus === 'ready' && modelStatus === 'ready' && (
        <p className="mt-5 text-xl text-ink-soft">
          Sit so your whole face fits in the picture, with the light in front of you rather than
          behind you.
        </p>
      )}
      {faceDetected && hint && <p className="mt-5 text-xl text-ink-soft">{hint}</p>}

      {cameraProblem && (
        <section className="card mt-6 border-warn/50 bg-side-right-soft">
          <h3 className="text-2xl font-bold">{cameraProblem.title}</h3>
          <p className="mt-2 text-xl">{cameraProblem.message}</p>
          {cameraProblem.canRetry && (
            <button type="button" className="btn-secondary mt-5" onClick={onRetryCamera}>
              Try the camera again
            </button>
          )}
        </section>
      )}

      {modelStatus === 'error' && (
        <section className="card mt-6 border-warn/50 bg-side-right-soft">
          <h3 className="text-2xl font-bold">Face measurement could not load</h3>
          <p className="mt-2 text-xl">
            {modelError?.message ?? 'The face landmark model could not be loaded.'}
          </p>
          <button type="button" className="btn-secondary mt-5" onClick={onRetryModel}>
            Try again
          </button>
        </section>
      )}

      {detectionError && (
        <section className="card mt-6 border-warn/50 bg-side-right-soft">
          <h3 className="text-2xl font-bold">Measurement stopped unexpectedly</h3>
          <p className="mt-2 text-xl">{detectionError.message}</p>
          <p className="mt-2 text-lg text-ink-soft">Reloading the page usually clears this.</p>
        </section>
      )}

      <div className="mt-8 flex flex-wrap gap-4">
        <button type="button" className="btn-primary" onClick={onBegin} disabled={!ready}>
          I&rsquo;m ready
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Back
        </button>
      </div>
    </div>
  );
}
