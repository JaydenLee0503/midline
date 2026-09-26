/**
 * The landing page: full-bleed artwork, very little text, one obvious action.
 * The medical disclaimer and the privacy note stay - they are trimmed to two
 * lines each rather than dropped.
 */
import { estimatedSessionMs, EXERCISES } from '../lib/exercises';
import { formatSessionDate } from '../lib/history';
import type { SessionRecord } from '../lib/types';
import LandmarkField from './art/LandmarkField';

export interface HomeScreenProps {
  onStart: () => void;
  onHistory: () => void;
  sessions: readonly SessionRecord[];
}

const STEPS = [
  { number: '01', title: 'Relax', body: 'Hold a relaxed face for three seconds.' },
  { number: '02', title: 'Move', body: 'Follow each exercise. Slowly, never forced.' },
  { number: '03', title: 'See', body: 'A score for each side, tracked over time.' },
];

export default function HomeScreen({ onStart, onHistory, sessions }: HomeScreenProps) {
  const minutes = Math.round(estimatedSessionMs() / 60000);
  const last = sessions[sessions.length - 1];

  return (
    <div className="bg-canvas">
      {/* ---------------------------------------------------------------- */}
      <section className="relative isolate flex min-h-[100svh] items-center overflow-hidden bg-night">
        {/* A soft wash first, then the whole face mesh sitting in the right half. */}
        <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_72%_45%,#123b42_0%,#0c2228_45%,#060f13_100%)]" />
        <div className="absolute inset-y-[5%] right-0 w-full opacity-70 sm:w-[62%] sm:opacity-100">
          <LandmarkField variant="hero" fit="meet" background={false} />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-night via-night/85 to-transparent sm:via-night/45" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-night to-transparent" />

        <div className="band relative pt-28 pb-24 sm:pt-32">
          <p className="kicker text-mint">Facial rehabilitation practice</p>
          <h1 className="display mt-6 max-w-3xl text-white text-balance">Both sides, measured.</h1>
          <p className="mt-8 max-w-xl text-2xl leading-relaxed text-white/75 sm:text-3xl">
            Five gentle exercises. Your webcam measures how evenly your face moves.
          </p>

          <div className="mt-12 flex flex-wrap gap-4">
            <button type="button" className="btn-bright" onClick={onStart}>
              Start session
            </button>
            <button type="button" className="btn-on-dark" onClick={onHistory}>
              View history
            </button>
          </div>

          <p className="mt-8 text-lg text-white/55">
            About {minutes} minutes &middot; Nothing leaves this computer
            {last ? ` · Last session ${formatSessionDate(last.startedAt)}` : ''}
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section id="how-it-works" className="band py-24 sm:py-32">
        <h2 className="display-sm max-w-2xl text-balance">Three steps, once a day.</h2>
        <ol className="mt-16 grid gap-14 sm:grid-cols-3 sm:gap-10">
          {STEPS.map((step) => (
            <li key={step.number}>
              <p className="text-6xl font-bold tabular-nums text-brand/45">{step.number}</p>
              <h3 className="mt-4 text-3xl font-bold">{step.title}</h3>
              <p className="mt-3 text-xl leading-relaxed text-ink-soft">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section id="exercises" className="relative isolate overflow-hidden bg-night">
        <div className="absolute inset-y-0 right-0 w-[78%] sm:w-[46%]">
          <LandmarkField variant="band" fit="slice" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-night from-35% via-night/80 to-night/25" />

        <div className="band relative grid gap-12 py-24 sm:py-32 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
          <div>
            <p className="kicker text-mint">The programme</p>
            <h2 className="display-sm mt-5 text-white text-balance">
              Five exercises, five repetitions.
            </h2>
            <p className="mt-6 max-w-md text-xl leading-relaxed text-white/65">
              Move slowly, hold, then relax. The bar on screen shows each side as you go.
            </p>
          </div>

          <ul className="self-center">
            {EXERCISES.map((exercise, index) => (
              <li
                key={exercise.id}
                className="flex items-baseline justify-between gap-6 border-t border-night-line py-5 last:border-b"
              >
                <span className="text-2xl font-semibold text-white sm:text-3xl">
                  {exercise.name}
                </span>
                <span className="text-lg tabular-nums text-white/40">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section id="about" className="band py-24 sm:py-28">
        <div className="grid gap-12 border-t border-line pt-14 sm:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold">Not a medical device</h2>
            <p className="mt-4 text-xl leading-relaxed text-ink-soft">
              Midline tracks practice. It does not diagnose, and its scores are not a clinical
              measurement. Keep following your own clinician&rsquo;s advice.
            </p>
          </div>
          <div>
            <h2 className="text-3xl font-bold">Nothing is uploaded</h2>
            <p className="mt-4 text-xl leading-relaxed text-ink-soft">
              Your camera image is processed on this computer and never saved. Only scores are
              stored, and you can delete them at any time.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="bg-night">
        <div className="band flex flex-col gap-10 py-24 sm:py-28">
          <h2 className="display-sm max-w-xl text-white text-balance">Ready when you are.</h2>
          <div className="flex flex-wrap gap-4">
            <button type="button" className="btn-bright" onClick={onStart}>
              Start session
            </button>
            <button type="button" className="btn-on-dark" onClick={onHistory}>
              View history
            </button>
          </div>
          <p className="mt-6 border-t border-night-line pt-8 text-base text-white/45">
            Midline is a practice and progress-tracking tool, not a medical device. All processing
            happens in this browser.
          </p>
        </div>
      </section>
    </div>
  );
}
