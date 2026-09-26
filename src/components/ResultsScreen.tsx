/**
 * What the session measured, in plain language. Scores describe evenness
 * between the two sides - never how hard the user tried.
 */
import { EXERCISES_BY_ID } from '../lib/exercises';
import { formatSessionDate } from '../lib/history';
import { scoreBand } from '../lib/metrics';
import type { ExerciseResult, SessionRecord, Side } from '../lib/types';
import LandmarkField from './art/LandmarkField';
import SymmetryBars from './SymmetryBars';

export interface ResultsScreenProps {
  record: SessionRecord;
  previous: SessionRecord | null;
  onDone: () => void;
  onHistory: () => void;
}

const SIDE_WORD: Record<Side, string> = { left: 'left', right: 'right' };

function bandSentence(score: number | null): string {
  switch (scoreBand(score)) {
    case 'strong':
      return 'Both sides moved by about the same amount.';
    case 'moderate':
      return 'One side moved noticeably less than the other.';
    case 'low':
      return 'There was a clear difference between the two sides.';
    case 'unknown':
      return 'Not enough movement to compare the two sides.';
  }
}

function ExerciseCard({ result }: { result: ExerciseResult }) {
  const exercise = EXERCISES_BY_ID[result.exerciseId];
  if (!exercise) return null;
  const scale = exercise.displayScale > 0 ? exercise.displayScale : 1;

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-2xl font-bold">{exercise.name}</h3>
        <p className="text-3xl font-bold tabular-nums">
          {result.score === null ? (
            <span className="text-xl font-semibold text-ink-soft">not measured</span>
          ) : (
            <>
              {result.score}
              <span className="text-lg font-semibold text-ink-soft"> / 100</span>
            </>
          )}
        </p>
      </div>

      <p className="mt-2 text-xl">{bandSentence(result.score)}</p>

      {result.status === 'insufficient' && (
        <p className="mt-2 text-lg text-ink-soft">
          Not enough movement was detected on either side to give a fair score. That can happen
          because the movement is still very small, or because the camera could not see it clearly.
        </p>
      )}
      {result.status === 'skipped' && (
        <p className="mt-2 text-lg text-ink-soft">This exercise was skipped.</p>
      )}

      {result.status === 'ok' && (
        <>
          <div className="mt-5">
            <SymmetryBars
              fill={{
                left: Math.min(1, result.movement.left / scale),
                right: Math.min(1, result.movement.right / scale),
              }}
              label="how much each side moved"
            />
          </div>
          {result.weakerSide && scoreBand(result.score) !== 'strong' && (
            <p className="mt-4 text-xl">
              Your <strong>{SIDE_WORD[result.weakerSide]}</strong> side moved less this time.
            </p>
          )}
          <p className="mt-2 text-lg text-ink-soft">
            Based on {result.validReps} of {result.reps.length} repetitions.
          </p>
        </>
      )}

      {result.synkinesis.length > 0 && (
        <div className="mt-5 rounded-2xl border border-warn/40 bg-side-right-soft p-5">
          <h4 className="text-xl font-bold">Worth noticing</h4>
          <ul className="mt-2 space-y-2 text-xl">
            {result.synkinesis.map((finding) => (
              <li key={`${finding.side}-${finding.label}`}>
                Your {SIDE_WORD[finding.side]} {finding.label}.
              </li>
            ))}
          </ul>
          <p className="mt-3 text-lg text-ink-soft">
            Movements linking up like this are common during recovery. Mention it to your therapist -
            smaller, slower movements often help.
          </p>
        </div>
      )}
    </section>
  );
}

export default function ResultsScreen({
  record,
  previous,
  onDone,
  onHistory,
}: ResultsScreenProps) {
  const previousScore = previous?.overallScore ?? null;
  const change =
    record.overallScore !== null && previousScore !== null ? record.overallScore - previousScore : null;

  return (
    <div className="screen">
      <h1 className="h1">Session complete</h1>
      <p className="lead mt-3">
        Well done for practising today. Here is what we measured on{' '}
        {formatSessionDate(record.startedAt)}.
      </p>

      {/* The one moment of the session worth making a little ceremony of. */}
      <section className="relative isolate mt-8 overflow-hidden rounded-3xl bg-night p-8 sm:p-10">
        <div className="absolute inset-y-0 right-0 w-[55%] opacity-60">
          <LandmarkField variant="band" fit="slice" background={false} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-night via-night/85 to-night/45" />

        <div className="relative">
          <p className="kicker text-mint">Overall symmetry</p>
          <p className="mt-3 text-7xl leading-none font-bold tabular-nums text-white">
            {record.overallScore === null ? (
              <span className="text-3xl leading-snug">Not enough movement to score</span>
            ) : (
              <>
                {record.overallScore}
                <span className="text-2xl font-semibold text-white/50"> / 100</span>
              </>
            )}
          </p>
          {previousScore !== null && (
            <p className="mt-4 text-xl text-white/80">
              Last session: {previousScore}
              {change !== null && change !== 0 && (
                <>
                  {' '}
                  ({change > 0 ? 'up' : 'down'} {Math.abs(change)})
                </>
              )}
            </p>
          )}
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-white/55">
            100 means both sides moved by the same amount. The score describes how evenly your face
            moved - not how big or how strong the movement was. Single sessions vary, so the trend
            over weeks matters more than today&rsquo;s number.
          </p>
        </div>
      </section>

      <div className="mt-6 grid gap-6">
        {record.exercises.map((result) => (
          <ExerciseCard key={result.exerciseId} result={result} />
        ))}
      </div>

      <p className="mt-6 text-lg text-ink-soft">Saved to this browser on this computer.</p>

      <div className="mt-6 flex flex-wrap gap-4">
        <button type="button" className="btn-primary" onClick={onDone}>
          Done
        </button>
        <button type="button" className="btn-secondary" onClick={onHistory}>
          See progress over time
        </button>
      </div>
    </div>
  );
}
