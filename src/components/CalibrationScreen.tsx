/**
 * Three seconds of a relaxed face, averaged into this session's baseline.
 * Everything measured later is a change from this starting point.
 */
import ProgressBar from './ProgressBar';

export interface CalibrationScreenProps {
  /** 0..1 */
  progress: number;
  ready: boolean;
  note: string | null;
  faceDetected: boolean;
  onContinue: () => void;
  onRedo: () => void;
  onCancel: () => void;
}

export default function CalibrationScreen({
  progress,
  ready,
  note,
  faceDetected,
  onContinue,
  onRedo,
  onCancel,
}: CalibrationScreenProps) {
  if (ready) {
    return (
      <div className="mt-6">
        <h2 className="h2">Starting point saved</h2>
        <p className="lead mt-3">
          That is your relaxed face for today. Now we will go through the five exercises, five
          repetitions each. Move slowly and stay comfortable.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <button type="button" className="btn-primary" onClick={onContinue}>
            Start the exercises
          </button>
          <button type="button" className="btn-secondary" onClick={onRedo}>
            Measure again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h2 className="h2">Let your face relax</h2>
      <p className="lead mt-3">
        Look at the camera with a completely relaxed face - no smile, eyes open, mouth closed. Hold
        that for three seconds.
      </p>

      <div className="mt-6">
        <ProgressBar value={progress} label="Calibration progress" />
      </div>

      <p className="mt-3 text-xl text-ink-soft" role="status">
        {!faceDetected
          ? 'Waiting until we can see your face.'
          : progress > 0
            ? 'Holding steady - nearly there.'
            : 'Relax and look straight ahead.'}
      </p>

      {note && <p className="mt-4 text-xl text-warn">{note}</p>}

      <button type="button" className="btn-quiet mt-6" onClick={onCancel}>
        Stop and go back
      </button>
    </div>
  );
}
