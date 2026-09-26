/**
 * The guided exercise. Everything shown here comes from one throttled snapshot
 * of the session controller, so this component never re-renders at frame rate.
 */
import type { LiveSnapshot } from '../lib/sessionController';
import type { Phase } from '../lib/sessionMachine';
import ProgressBar from './ProgressBar';
import SymmetryBars from './SymmetryBars';

export interface ExerciseScreenProps {
  snapshot: LiveSnapshot;
  onTogglePause: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

const PHASE_LABEL: Record<Phase, string> = {
  intro: 'Get ready',
  move: 'Move slowly',
  hold: 'Hold',
  relax: 'Relax',
};

const PHASE_TONE: Record<Phase, string> = {
  intro: 'bg-canvas',
  move: 'bg-brand-soft',
  hold: 'bg-brand-soft',
  relax: 'bg-canvas',
};

export default function ExerciseScreen({
  snapshot,
  onTogglePause,
  onSkip,
  onFinish,
}: ExerciseScreenProps) {
  const { exercise, phase, countdown, paused } = snapshot;
  if (!exercise) return null;

  const threshold =
    exercise.displayScale > 0 ? exercise.minMovement / exercise.displayScale : undefined;

  return (
    <div className="mt-6">
      <p className="text-lg font-semibold tracking-wide text-ink-soft uppercase">
        Exercise {snapshot.exerciseIndex + 1} of {snapshot.exerciseCount}
      </p>
      <h2 className="h2 mt-1">{exercise.name}</h2>

      <div className={`mt-5 rounded-3xl border border-line p-6 ${PHASE_TONE[phase]}`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-lg font-semibold text-ink-soft" aria-live="polite">
              {paused ? 'Paused' : PHASE_LABEL[phase]}
            </p>
            <p className="mt-1 text-3xl font-bold sm:text-4xl">
              {phase === 'intro' ? exercise.name : exercise.cue}
            </p>
          </div>
          <p
            className="text-6xl leading-none font-bold tabular-nums text-brand-dark"
            aria-hidden={phase === 'intro' ? undefined : true}
          >
            {paused ? '||' : countdown}
          </p>
        </div>

        {phase === 'intro' && (
          <ul className="mt-5 space-y-2 text-xl">
            {exercise.how.map((step) => (
              <li key={step} className="flex items-baseline gap-3">
                <span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-brand" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        )}

        {phase !== 'intro' && (
          <p className="mt-4 text-xl text-ink-soft">
            Repetition {snapshot.repNumber} of {snapshot.repsInExercise}
          </p>
        )}
      </div>

      <div className="mt-6">
        <SymmetryBars fill={snapshot.fill} threshold={threshold} label="movement now" />
      </div>

      <p className="mt-4 min-h-8 text-xl" role="status">
        {snapshot.lastRep
          ? snapshot.lastRep.symmetry.status === 'ok'
            ? `Repetition ${snapshot.lastRep.rep} recorded.`
            : `Repetition ${snapshot.lastRep.rep} recorded - we did not see much movement that time. That is fine, keep going gently.`
          : ''}
      </p>

      <div className="mt-6">
        <p className="mb-2 text-lg text-ink-soft">
          {snapshot.repsDone} of {snapshot.repsTotal} repetitions done
        </p>
        <ProgressBar
          value={snapshot.repsTotal === 0 ? 0 : snapshot.repsDone / snapshot.repsTotal}
          label="Session progress"
        />
      </div>

      <div className="mt-8 flex flex-wrap gap-4">
        <button type="button" className="btn-secondary" onClick={onTogglePause}>
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button type="button" className="btn-secondary" onClick={onSkip}>
          Skip this exercise
        </button>
        <button type="button" className="btn-quiet" onClick={onFinish}>
          End session now
        </button>
      </div>
    </div>
  );
}
