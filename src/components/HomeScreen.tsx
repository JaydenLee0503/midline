import { estimatedSessionMs, EXERCISES } from '../lib/exercises';
import { formatSessionDate } from '../lib/history';
import type { SessionRecord } from '../lib/types';

export interface HomeScreenProps {
  onStart: () => void;
  onHistory: () => void;
  sessions: readonly SessionRecord[];
}

export default function HomeScreen({ onStart, onHistory, sessions }: HomeScreenProps) {
  const minutes = Math.round(estimatedSessionMs() / 60000);
  const last = sessions[sessions.length - 1];

  return (
    <div className="screen">
      <h1 className="h1">Practise your facial exercises</h1>
      <p className="lead mt-4 max-w-2xl">
        Midline guides you through five gentle exercises and uses your webcam to measure how evenly
        the left and right sides of your face are moving. It keeps a record so you can see your
        progress over the weeks.
      </p>

      <div className="mt-8 flex flex-wrap gap-4">
        <button type="button" className="btn-primary" onClick={onStart}>
          Start session
        </button>
        <button type="button" className="btn-secondary" onClick={onHistory}>
          View history
        </button>
      </div>
      <p className="mt-3 text-lg text-ink-soft">
        About {minutes} minutes.
        {last
          ? ` Your last session was ${formatSessionDate(last.startedAt)}.`
          : ' This will be your first session.'}
      </p>

      <section className="card mt-10">
        <h2 className="h2">How a session works</h2>
        <ol className="mt-4 space-y-3 text-xl">
          <li>
            <strong>1.</strong> Sit facing your camera in even light.
          </li>
          <li>
            <strong>2.</strong> Relax your face for three seconds so we know your starting point.
          </li>
          <li>
            <strong>3.</strong> Follow each exercise: move slowly, hold, then relax. Five
            repetitions each.
          </li>
          <li>
            <strong>4.</strong> Read your results and see how they compare with last time.
          </li>
        </ol>
        <p className="mt-5 text-xl">
          <strong>Slow and gentle is the point.</strong> These exercises are about control, not
          effort. Never push into discomfort.
        </p>
      </section>

      <section className="card mt-6">
        <h2 className="h2">Today&rsquo;s exercises</h2>
        <ul className="mt-4 grid gap-3 text-xl sm:grid-cols-2">
          {EXERCISES.map((exercise) => (
            <li key={exercise.id} className="flex items-baseline gap-3">
              <span aria-hidden className="mt-2 size-2.5 shrink-0 rounded-full bg-brand" />
              <span>
                {exercise.name}
                <span className="text-ink-soft"> - {exercise.reps} reps</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card mt-6 border-brand/40 bg-brand-soft">
        <h2 className="h2">Please read</h2>
        <p className="mt-3 text-xl">
          Midline is a <strong>practice and progress-tracking tool</strong>. It is not a medical
          device, it cannot diagnose anything, and its scores are not a clinical measurement. Keep
          following the advice of your own clinician or therapist, and tell them about anything that
          worries you.
        </p>
        <p className="mt-3 text-xl">
          Your camera image is processed on this computer only. No video or photo is uploaded or
          saved. Only your scores are stored, in this browser, and you can delete them at any time
          from the History page.
        </p>
      </section>
    </div>
  );
}
