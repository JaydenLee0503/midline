/**
 * Stress reliever: targets appear, you punch them. Pose tracking watches both
 * arms, so straights, hooks and uppercuts all register and each one knocks the
 * shape around differently.
 *
 * Deliberately separate from the rehab session - it never appears mid-exercise,
 * it works seated, and one arm alone is enough to play.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useCamera } from '../hooks/useCamera';
import { useGameLoop } from '../hooks/useGameLoop';
import { useHandLandmarker } from '../hooks/useHandLandmarker';
import { usePoseLandmarker } from '../hooks/usePoseLandmarker';
import { GameAudio } from '../lib/audio';
import { GameController, ROUND_MS } from '../lib/gameController';
import { outlinePath, PUNCH_OBJECTS } from '../lib/objects';
import { GENTLE_CONFIG, NORMAL_CONFIG, type PunchType } from '../lib/punch';
import type { GameRecord, Settings } from '../lib/storage';

export interface GameScreenProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  best: number;
  onFinished: (record: GameRecord) => void;
  onExit: () => void;
}

const TYPE_LABEL: Record<PunchType, string> = {
  straight: 'Straights',
  hook: 'Hooks',
  uppercut: 'Uppercuts',
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-sm font-semibold tracking-wide text-white/50 uppercase">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}

export default function GameScreen({
  settings,
  onSettingsChange,
  best,
  onFinished,
  onExit,
}: GameScreenProps) {
  const [controller] = useState(() => new GameController());
  const audioRef = useRef<GameAudio | null>(null);
  if (audioRef.current === null) audioRef.current = new GameAudio();
  const audio = audioRef.current;

  const snapshot = useSyncExternalStore(controller.store.subscribe, controller.store.getSnapshot);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const handedOff = useRef(false);

  const { videoRef, status: cameraStatus, problem: cameraProblem, retry: retryCamera } = useCamera(true);
  const { landmarker: pose, status: modelStatus, error: modelError, retry: retryModel } = usePoseLandmarker();
  // Hands are an upgrade, not a requirement: if the model will not load the
  // game still runs on the pose model's wrists.
  const { landmarker: hands, status: handStatus } = useHandLandmarker();
  const { error: loopError } = useGameLoop({
    videoRef,
    canvasRef,
    pose,
    hands,
    controller,
    active: true,
  });

  useEffect(() => {
    controller.setAudio(audio);
    return () => audio.close();
  }, [controller, audio]);

  useEffect(() => {
    controller.setConfig(settings.gameGentle ? GENTLE_CONFIG : NORMAL_CONFIG);
  }, [controller, settings.gameGentle]);

  useEffect(() => {
    audio.setMuted(settings.gameMuted);
  }, [audio, settings.gameMuted]);

  useEffect(() => {
    controller.setObject(settings.gameObject);
  }, [controller, settings.gameObject]);

  useEffect(() => {
    if (snapshot.stage !== 'over' || handedOff.current) return;
    const result = controller.getResult();
    if (!result) return;
    handedOff.current = true;
    onFinished({
      at: result.at,
      score: result.score,
      bestCombo: result.bestCombo,
      punches: result.punches,
      hits: result.hits,
      destroyed: result.destroyed,
      missed: result.missed,
    });
  }, [snapshot.stage, controller, onFinished]);

  const ready = cameraStatus === 'ready' && modelStatus === 'ready';

  const start = useCallback(() => {
    handedOff.current = false;
    // Browsers only allow sound to start from a gesture like this click.
    void audio.unlock();
    controller.start(performance.now());
  }, [audio, controller]);

  const result = controller.getResult();
  const accuracy =
    result && result.punches > 0 ? Math.round((result.hits / result.punches) * 100) : 0;
  const isNewBest = result !== null && result.score > best && result.score > 0;
  const timeLeft = Math.ceil(snapshot.timeLeftMs / 1000);
  const timeFraction = snapshot.timeLeftMs / ROUND_MS;
  const playing = snapshot.stage === 'playing' || snapshot.stage === 'countdown';

  return (
    <div className="screen max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="kicker text-brand">Stress reliever</p>
          <h1 className="mt-1 text-3xl font-bold sm:text-4xl">Punch it out</h1>
        </div>
        <div className="flex items-center gap-4">
          {best > 0 && (
            <p className="text-lg text-ink-soft">
              Best <span className="font-bold tabular-nums text-ink">{best.toLocaleString()}</span>
            </p>
          )}
          <button type="button" className="btn-quiet" onClick={onExit}>
            Leave game
          </button>
        </div>
      </div>

      {/* Between rounds the video is only a framing preview, so it gives up
          height to keep the controls above the fold. */}
      <div
        className="relative w-full overflow-hidden border-2 border-line bg-night"
        style={{ aspectRatio: aspect, maxHeight: playing ? undefined : '30vh' }}
      >
        <div className="absolute inset-0 -scale-x-100">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full object-cover"
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (video.videoWidth > 0 && video.videoHeight > 0) {
                setAspect(video.videoWidth / video.videoHeight);
              }
            }}
          />
        </div>
        {/* Outside the mirrored wrapper, so score pop-ups read the right way round. */}
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        {playing && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4">
              <div className="bg-night/75 px-5 py-3">
                <p className="text-xs font-semibold tracking-widest text-white/60 uppercase">Score</p>
                <p className="text-4xl leading-none font-bold tabular-nums text-white">
                  {snapshot.score.toLocaleString()}
                </p>
              </div>

              <div className="w-40 bg-night/75 px-4 py-3 sm:w-56">
                <p className="text-center text-3xl leading-none font-bold tabular-nums text-white">
                  {timeLeft}
                </p>
                <div className="mt-2 h-2 w-full overflow-hidden bg-white/20">
                  <div
                    className="h-full bg-mint"
                    style={{ width: `${Math.max(0, Math.min(100, timeFraction * 100))}%` }}
                  />
                </div>
              </div>

              <div className="min-w-24 text-right">
                {snapshot.combo >= 2 && (
                  <div className="inline-block bg-mint px-4 py-3">
                    <p className="text-xs font-semibold tracking-widest text-night/70 uppercase">
                      Combo
                    </p>
                    <p className="text-3xl leading-none font-bold tabular-nums text-night">
                      {snapshot.combo}
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
              {snapshot.poseDetected && (
                <p className="bg-night/70 px-4 py-1.5 text-base font-semibold text-white/80">
                  {snapshot.handsTracked > 0
                    ? `${snapshot.handsTracked === 2 ? 'Both hands' : 'One hand'} tracked`
                    : 'Tracking wrists'}
                </p>
              )}
            </div>

            {!snapshot.poseDetected && (
              <p
                className="absolute inset-x-0 bottom-0 bg-night/80 px-4 py-3 text-center text-xl font-semibold text-white"
                role="status"
              >
                Step back a little so your head and both shoulders are in view
              </p>
            )}
          </>
        )}

      </div>

      {snapshot.stage === 'idle' && (
        <section className="mt-6 bg-night p-6 sm:p-9">
          <div className="max-w-2xl">
              <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to hit something?</h2>
              <p className="mt-4 text-xl leading-relaxed text-white/75">
                Targets pop up for one minute. Punch them. Straights, hooks and uppercuts all count -
                uppercuts score the most, and every hit knocks the shape about.
              </p>
              <p className="mt-4 text-lg leading-relaxed text-white/55">
                Sitting down is fine, and one arm is enough. Keep the space around you clear, and
                stop if anything hurts.
              </p>

              <fieldset className="mt-8">
                <legend className="text-lg font-semibold text-white/60">
                  What would you like to hit?
                </legend>
                <div className="mt-4 flex flex-wrap gap-3">
                  {PUNCH_OBJECTS.map((object) => {
                    const selected = object.id === settings.gameObject;
                    return (
                      <button
                        key={object.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onSettingsChange({ ...settings, gameObject: object.id })}
                        className={`flex w-28 flex-col items-center gap-2 border-2 p-3 transition-colors ${
                          selected
                            ? 'border-mint bg-white/10'
                            : 'border-white/20 hover:border-white/50'
                        }`}
                      >
                        <svg viewBox="0 0 100 100" className="h-12 w-12" aria-hidden>
                          <path
                            d={outlinePath(object)}
                            fill={object.palette.fill}
                            stroke={object.palette.edge}
                            strokeWidth={4}
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span className="text-base leading-tight font-semibold text-white">
                          {object.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-3 text-base text-white/50">
                  {PUNCH_OBJECTS.find((object) => object.id === settings.gameObject)?.blurb}{' '}
                  Everything dents and keeps its dents, like clay.
                </p>
              </fieldset>

              <div className="mt-7 space-y-3">
                <label className="flex items-center gap-4 text-xl text-white">
                  <input
                    type="checkbox"
                    className="size-7 accent-mint"
                    checked={settings.gameGentle}
                    onChange={(event) =>
                      onSettingsChange({ ...settings, gameGentle: event.target.checked })
                    }
                  />
                  Gentle mode - picks up slower punches
                </label>
                <label className="flex items-center gap-4 text-xl text-white">
                  <input
                    type="checkbox"
                    className="size-7 accent-mint"
                    checked={!settings.gameMuted}
                    onChange={(event) =>
                      onSettingsChange({ ...settings, gameMuted: !event.target.checked })
                    }
                  />
                  Sound effects
                </label>
              </div>

              <p className="mt-6 text-lg text-white/60" role="status">
                {snapshot.handsTracked > 0
                  ? `Tracking ${snapshot.handsTracked === 2 ? 'both hands' : 'one hand'} - every finger.`
                  : handStatus === 'error'
                    ? 'Hand tracking unavailable; using wrist tracking instead.'
                    : handStatus === 'loading'
                      ? 'Loading hand tracking...'
                      : 'Hold your hands up where the camera can see them.'}
              </p>

              {!ready && (
                <p className="mt-3 text-lg text-white/70" role="status">
                  {cameraProblem
                    ? cameraProblem.message
                    : modelStatus === 'error'
                      ? (modelError?.message ?? 'The pose model could not load.')
                      : cameraStatus !== 'ready'
                        ? 'Starting the camera...'
                        : 'Loading body tracking (first time takes a moment)...'}
                </p>
              )}
              {loopError && (
                <p className="mt-4 text-lg text-white/70">
                  Tracking stopped unexpectedly: {loopError.message}. Reloading usually clears it.
                </p>
              )}

              <div className="mt-8 flex flex-wrap gap-4">
                <button type="button" className="btn-bright" onClick={start} disabled={!ready}>
                  Start round
                </button>
                {cameraProblem?.canRetry && (
                  <button type="button" className="btn-on-dark" onClick={retryCamera}>
                    Try the camera again
                  </button>
                )}
                {modelStatus === 'error' && (
                  <button type="button" className="btn-on-dark" onClick={retryModel}>
                    Try again
                  </button>
                )}
            </div>
          </div>
        </section>
      )}

      {snapshot.stage === 'over' && result && (
        <section className="mt-6 bg-night p-6 sm:p-9">
          <div className="max-w-2xl">
              {isNewBest && <p className="kicker text-mint">New best score</p>}
              <p className="mt-2 text-sm font-semibold tracking-widest text-white/50 uppercase">
                Final score
              </p>
              <p className="text-7xl leading-none font-bold tabular-nums text-white">
                {result.score.toLocaleString()}
              </p>

              <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
                <Stat label="Best combo" value={result.bestCombo} />
                <Stat label="Hits" value={result.hits} />
                <Stat label="Punches" value={result.punches} />
                <Stat label="Accuracy" value={`${accuracy}%`} />
              </div>

              <div className="mt-8 border-t border-night-line pt-6">
                <ul className="grid grid-cols-3 gap-6">
                  {(Object.keys(TYPE_LABEL) as PunchType[]).map((type) => (
                    <li key={type}>
                      <p className="text-sm font-semibold tracking-wide text-white/50 uppercase">
                        {TYPE_LABEL[type]}
                      </p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-white">
                        {result.byType[type]}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

            <div className="mt-10 flex flex-wrap gap-4">
              <button type="button" className="btn-bright" onClick={start}>
                Play again
              </button>
              <button type="button" className="btn-on-dark" onClick={onExit}>
                Done
              </button>
            </div>
          </div>
        </section>
      )}

      <p className="mt-5 text-lg text-ink-soft">
        This is a game, not an exercise. Your rehab scores are not affected by anything you do here.
      </p>
    </div>
  );
}
