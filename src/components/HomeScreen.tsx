/**
 * The landing page: painted bands that meet along drawn edges rather than
 * ruled lines, square corners throughout, and very little text per screenful.
 *
 * The medical disclaimer and the privacy note stay - trimmed, not dropped.
 */
import { estimatedSessionMs, EXERCISES } from '../lib/exercises';
import { formatSessionDate } from '../lib/history';
import type { SessionRecord } from '../lib/types';
import LandmarkField from './art/LandmarkField';
import { SceneEdge, SkyScene, WoodBand } from './art/Scene';

export interface HomeScreenProps {
  onStart: () => void;
  onHistory: () => void;
  onGame: () => void;
  sessions: readonly SessionRecord[];
}

const STEPS = [
  { number: '01', title: 'Relax', body: 'Hold a relaxed face for three seconds.' },
  { number: '02', title: 'Move', body: 'Follow each exercise. Slowly, never forced.' },
  { number: '03', title: 'See', body: 'A score for each side, tracked over time.' },
];

export default function HomeScreen({ onStart, onHistory, onGame, sessions }: HomeScreenProps) {
  const minutes = Math.round(estimatedSessionMs() / 60000);
  const last = sessions[sessions.length - 1];

  return (
    <div>
      {/* ---------------------------------------------------------------- */}
      <section className="relative isolate flex min-h-[100svh] items-center overflow-hidden">
        <div className="absolute inset-0">
          <SkyScene />
        </div>
        <div className="absolute inset-y-[8%] right-0 hidden w-[52%] sm:block">
          <LandmarkField variant="hero" theme="sky" fit="meet" background={false} />
        </div>

        <div className="band relative pt-28 pb-56 sm:pt-32 sm:pb-64">
          <p className="kicker text-brand-dark">Facial rehabilitation practice</p>
          <h1 className="display mt-5 max-w-3xl text-balance text-brand">Both sides, measured.</h1>
          <p className="mt-7 max-w-lg text-2xl leading-snug font-semibold text-ink sm:text-3xl">
            Five gentle exercises. Your webcam measures how evenly your face moves.
          </p>

          <div className="mt-10 flex flex-wrap gap-5">
            <button type="button" className="btn-primary" onClick={onStart}>
              Start session
            </button>
            <button type="button" className="btn-secondary" onClick={onHistory}>
              View history
            </button>
          </div>

          <p className="mt-7 text-lg font-bold text-ink">
            About {minutes} minutes &middot; Nothing leaves this computer
            {last ? ` · Last session ${formatSessionDate(last.startedAt)}` : ''}
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section id="how-it-works" className="bg-meadow">
        <div className="band py-20 sm:py-28">
          <h2 className="display-sm max-w-2xl text-balance text-ink">Three steps, once a day.</h2>
          <ol className="mt-14 grid gap-12 sm:grid-cols-3 sm:gap-10">
            {STEPS.map((step) => (
              <li key={step.number} className="border-t-[4px] border-ink pt-5">
                <p className="text-5xl font-extrabold tabular-nums text-brand">{step.number}</p>
                <h3 className="mt-3 text-3xl font-extrabold text-ink">{step.title}</h3>
                <p className="mt-2 text-xl leading-relaxed font-medium text-ink-soft">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <SceneEdge tone="forest" kind="grass" />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section id="exercises" className="relative isolate overflow-hidden bg-night">
        <div className="absolute inset-y-0 right-0 w-[78%] opacity-40 sm:w-[46%]">
          <LandmarkField variant="band" theme="night" fit="slice" background={false} />
        </div>

        <div className="band relative grid gap-12 py-20 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div>
            <p className="kicker text-mint">The programme</p>
            <h2 className="display-sm mt-4 text-balance text-white">
              Five exercises, five repetitions.
            </h2>
            <p className="mt-5 max-w-md text-xl leading-relaxed font-medium text-white/75">
              Move slowly, hold, then relax. The bar on screen shows each side as you go.
            </p>
          </div>

          <ul className="self-center">
            {EXERCISES.map((exercise, index) => (
              <li
                key={exercise.id}
                className="flex items-baseline justify-between gap-6 border-t-[3px] border-night-line py-5 last:border-b-[3px]"
              >
                <span className="text-2xl font-extrabold text-white sm:text-3xl">
                  {exercise.name}
                </span>
                <span className="text-lg font-bold tabular-nums text-mint">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <WoodBand />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section id="game" className="bg-wood">
        <div className="band grid gap-10 py-20 sm:py-24 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16">
          <div>
            <p className="kicker text-wood-deep">Also included</p>
            <h2 className="display-sm mt-4 text-balance text-ink">Had a bad day? Punch it out.</h2>
          </div>
          <div>
            <p className="text-xl leading-relaxed font-medium text-ink">
              A one-minute game. Targets appear, you hit them - straights, hooks and uppercuts all
              count, and everything you hit dents like clay and keeps its dents.
            </p>
            <button type="button" className="btn-primary mt-8" onClick={onGame}>
              Open the game
            </button>
            <p className="mt-4 text-lg font-semibold text-wood-deep">
              Not an exercise. It does not touch your rehab scores.
            </p>
          </div>
        </div>
        <SceneEdge tone="canvas" kind="hill" />
      </section>

      {/* ---------------------------------------------------------------- */}
      <section id="about" className="bg-canvas">
        <div className="band grid gap-12 py-20 sm:grid-cols-2 sm:py-24">
          <div className="border-t-[4px] border-ink pt-6">
            <h2 className="text-3xl font-extrabold text-ink">Not a medical device</h2>
            <p className="mt-3 text-xl leading-relaxed font-medium text-ink-soft">
              Midline tracks practice. It does not diagnose, and its scores are not a clinical
              measurement. Keep following your own clinician&rsquo;s advice.
            </p>
          </div>
          <div className="border-t-[4px] border-ink pt-6">
            <h2 className="text-3xl font-extrabold text-ink">Nothing is uploaded</h2>
            <p className="mt-3 text-xl leading-relaxed font-medium text-ink-soft">
              Your camera image is processed on this computer and never saved. Only scores are
              stored, and you can delete them at any time.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="bg-night">
        <div className="band flex flex-col gap-9 py-20 sm:py-24">
          <h2 className="display-sm max-w-xl text-balance text-white">Ready when you are.</h2>
          <div className="flex flex-wrap gap-5">
            <button type="button" className="btn-bright" onClick={onStart}>
              Start session
            </button>
            <button type="button" className="btn-on-dark" onClick={onHistory}>
              View history
            </button>
          </div>
          <p className="mt-4 border-t-[3px] border-night-line pt-7 text-base font-semibold text-white/55">
            Midline is a practice and progress-tracking tool, not a medical device. All processing
            happens in this browser.
          </p>
        </div>
      </section>
    </div>
  );
}
