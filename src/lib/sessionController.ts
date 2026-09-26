/**
 * Drives a practice session: calibration, the rep clock, per-rep measurement
 * and the final result. It is deliberately outside React - the detection loop
 * calls pushFrame() up to 30 times a second, and the controller publishes a
 * snapshot to its store roughly 10 times a second for the UI to render.
 */
import { EXERCISES } from './exercises';
import {
  buildBaseline,
  clamp,
  ema,
  faceGeometry,
  liveReading,
  measureRep,
  overallScore,
  poseProblem,
  sidedBlendshape,
  sidedMidlineDistance,
  sidedMouthCorners,
  summariseExercise,
  CALIBRATION_POSE_LIMITS,
  CHEEK_GROUPS,
  DEFAULT_POSE_LIMITS,
  MOUTH_CORNERS,
  type Baseline,
  type FaceGeometry,
  type PoseProblem,
} from './metrics';
import {
  advance,
  createRunState,
  phaseCountdown,
  phaseNeedsFace,
  phaseRemainingMs,
  runProgress,
  skipExercise,
  type Phase,
  type RunEvent,
  type RunState,
} from './sessionMachine';
import { createStore, type Store } from './store';
import { newSessionId, SCHEMA_VERSION } from './storage';
import {
  DEFAULT_SIDE_CONFIG,
  type ExerciseDef,
  type ExerciseResult,
  type FaceSample,
  type HeadPose,
  type RepMeasurement,
  type SessionRecord,
  type SideConfig,
  type Sided,
  type SymmetryOutcome,
} from './types';

export type Stage = 'idle' | 'calibrating' | 'calibrated' | 'exercising' | 'finished';

export const CALIBRATION_MS = 3000;
/** How quickly calibration progress unwinds while the face is not usable. */
const CALIBRATION_DECAY = 0.6;
const PUBLISH_INTERVAL_MS = 100;
/** Smoothing for the live bars: enough to settle jitter, not enough to lag. */
const LIVE_ALPHA = 0.3;

export interface DebugPair {
  label: string;
  left: number;
  right: number;
}

export interface DebugValues {
  aspect: number;
  interOcular: number;
  pose: HeadPose | null;
  pairs: DebugPair[];
  unsided: { label: string; value: number }[];
}

export interface LiveSnapshot {
  stage: Stage;
  paused: boolean;
  faceDetected: boolean;
  alignment: PoseProblem | null;
  fps: number;

  calibrationProgress: number;
  baselineReady: boolean;
  calibrationNote: string | null;

  exercise: ExerciseDef | null;
  exerciseIndex: number;
  exerciseCount: number;
  phase: Phase;
  countdown: number;
  phaseRemainingMs: number;
  repNumber: number;
  repsInExercise: number;
  repsDone: number;
  repsTotal: number;

  fill: Sided<number>;
  movement: Sided<number>;
  raw: Sided<number>;
  lastRep: { rep: number; symmetry: SymmetryOutcome } | null;

  debug: DebugValues;
}

const ZERO: Sided<number> = { left: 0, right: 0 };

const EMPTY_DEBUG: DebugValues = {
  aspect: 0,
  interOcular: 0,
  pose: null,
  pairs: [],
  unsided: [],
};

function idleSnapshot(exercises: readonly ExerciseDef[]): LiveSnapshot {
  return {
    stage: 'idle',
    paused: false,
    faceDetected: false,
    alignment: null,
    fps: 0,
    calibrationProgress: 0,
    baselineReady: false,
    calibrationNote: null,
    exercise: exercises[0] ?? null,
    exerciseIndex: 0,
    exerciseCount: exercises.length,
    phase: 'intro',
    countdown: 0,
    phaseRemainingMs: 0,
    repNumber: 1,
    repsInExercise: exercises[0]?.reps ?? 0,
    repsDone: 0,
    repsTotal: exercises.reduce((total, exercise) => total + exercise.reps, 0),
    fill: ZERO,
    movement: ZERO,
    raw: ZERO,
    lastRep: null,
    debug: EMPTY_DEBUG,
  };
}

export class SessionController {
  readonly store: Store<LiveSnapshot>;

  private readonly exercises: readonly ExerciseDef[];
  private sideConfig: SideConfig = DEFAULT_SIDE_CONFIG;
  private debugEnabled = false;

  private stage: Stage = 'idle';
  private paused = false;

  private lastNow: number | null = null;
  private lastPublish = 0;
  private fps = 0;

  private calibrationSamples: FaceSample[] = [];
  private calibrationMs = 0;
  private calibrationNote: string | null = null;
  private baseline: Baseline | null = null;

  private run: RunState = createRunState();
  private holdSamples: FaceSample[] = [];
  private repsForExercise: RepMeasurement[] = [];
  private results: ExerciseResult[] = [];
  private lastRep: { rep: number; symmetry: SymmetryOutcome } | null = null;

  private smoothFill: Sided<number | null> = { left: null, right: null };
  private smoothMovement: Sided<number | null> = { left: null, right: null };
  private latestRaw: Sided<number> = ZERO;
  private latestDebug: DebugValues = EMPTY_DEBUG;
  private faceDetected = false;
  private alignment: PoseProblem | null = null;
  private lastGeometry: FaceGeometry | null = null;

  private startedAt: string | null = null;
  private record: SessionRecord | null = null;

  constructor(exercises: readonly ExerciseDef[] = EXERCISES) {
    this.exercises = exercises;
    this.store = createStore(idleSnapshot(exercises));
  }

  /* ---------------- commands from the UI ---------------- */

  setSideConfig(config: SideConfig): void {
    this.sideConfig = config;
  }

  getSideConfig(): SideConfig {
    return this.sideConfig;
  }

  /** The debug panel is the only consumer of the raw per-side values, so we
   *  only pay for building them when it is open. */
  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
    if (!enabled) this.latestDebug = EMPTY_DEBUG;
  }

  beginCalibration(): void {
    this.stage = 'calibrating';
    this.paused = false;
    this.calibrationSamples = [];
    this.calibrationMs = 0;
    this.calibrationNote = null;
    this.baseline = null;
    this.run = createRunState();
    this.holdSamples = [];
    this.repsForExercise = [];
    this.results = [];
    this.lastRep = null;
    this.record = null;
    this.startedAt = new Date().toISOString();
    this.publish(true);
  }

  startExercises(): void {
    if (!this.baseline) return;
    this.stage = 'exercising';
    this.run = createRunState();
    this.holdSamples = [];
    this.repsForExercise = [];
    this.results = [];
    this.resetSmoothing();
    this.publish(true);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.publish(true);
  }

  skipCurrentExercise(): void {
    if (this.stage !== 'exercising') return;
    this.finishExerciseFromReps();
    const { state, events } = skipExercise(this.run, this.exercises);
    this.run = state;
    // The exerciseEnd this emits is already handled above.
    this.handleEvents(events.filter((event) => event.type !== 'exerciseEnd'));
    this.publish(true);
  }

  /** Ends the session early, keeping whatever has been measured so far. */
  finishEarly(): void {
    if (this.stage !== 'exercising') return;
    this.finishExerciseFromReps();
    this.completeSession();
    this.publish(true);
  }

  reset(): void {
    this.stage = 'idle';
    this.paused = false;
    this.baseline = null;
    this.record = null;
    this.calibrationMs = 0;
    this.calibrationSamples = [];
    this.results = [];
    this.repsForExercise = [];
    this.lastRep = null;
    this.run = createRunState();
    this.resetSmoothing();
    this.store.set(idleSnapshot(this.exercises));
  }

  getRecord(): SessionRecord | null {
    return this.record;
  }

  /* ---------------- called by the detection loop ---------------- */

  /**
   * One video frame. `sample` is null when no face was found. Safe to call at
   * full frame rate; only cheap work happens per frame.
   */
  pushFrame(now: number, sample: FaceSample | null): void {
    const delta = this.lastNow === null ? 0 : clamp(now - this.lastNow, 0, 1000);
    this.lastNow = now;
    if (delta > 0) this.fps = ema(this.fps || null, 1000 / delta, 0.1);

    const geometry = sample ? faceGeometry(sample.landmarks, sample.aspect, this.sideConfig) : null;
    this.lastGeometry = geometry;
    this.faceDetected = Boolean(sample && geometry);
    // Before calibration we can only compare against dead ahead, and loosely.
    // Afterwards we compare against the neutral pose this user actually holds.
    const neutralPose = this.baseline?.headPose ?? null;
    this.alignment = sample
      ? poseProblem(
          sample.headPose,
          neutralPose ? DEFAULT_POSE_LIMITS : CALIBRATION_POSE_LIMITS,
          neutralPose
        )
      : null;
    const usable = Boolean(sample && geometry) && this.alignment === null;

    if (sample && geometry && this.debugEnabled) this.updateDebug(sample, geometry);

    if (this.stage === 'calibrating') {
      this.tickCalibration(sample, usable, delta);
    } else if (this.stage === 'exercising') {
      this.tickExercise(sample, usable, delta);
    }

    this.publish(false);
  }

  /** Tells the overlay whether to draw the "aligned" or "adjust" styling. */
  isUsable(): boolean {
    return this.faceDetected && this.alignment === null;
  }

  /** The frame we just measured, so the overlay draws exactly what we measured. */
  getLastGeometry(): FaceGeometry | null {
    return this.lastGeometry;
  }

  /* ---------------- internals ---------------- */

  private tickCalibration(sample: FaceSample | null, usable: boolean, delta: number): void {
    if (this.paused) return;
    if (usable && sample) {
      this.calibrationSamples.push(sample);
      this.calibrationMs += delta;
      if (this.calibrationMs >= CALIBRATION_MS) {
        const baseline = buildBaseline(this.calibrationSamples, this.exercises, this.sideConfig);
        if (baseline) {
          this.baseline = baseline;
          this.stage = 'calibrated';
          this.calibrationNote = null;
          this.publish(true);
        } else {
          this.calibrationMs = 0;
          this.calibrationSamples = [];
          this.calibrationNote = 'We could not read a steady baseline. Let us try that again.';
        }
      }
    } else {
      // Unwind gently rather than snapping back to zero.
      this.calibrationMs = Math.max(0, this.calibrationMs - delta * CALIBRATION_DECAY);
    }
  }

  private tickExercise(sample: FaceSample | null, usable: boolean, delta: number): void {
    const exercise = this.exercises[this.run.exerciseIndex];
    if (!exercise || !this.baseline) return;

    if (sample && usable) {
      const reading = liveReading(sample, exercise, this.baseline, this.sideConfig);
      if (reading) {
        this.latestRaw = reading.raw;
        this.smoothFill = {
          left: ema(this.smoothFill.left, reading.fill.left, LIVE_ALPHA),
          right: ema(this.smoothFill.right, reading.fill.right, LIVE_ALPHA),
        };
        this.smoothMovement = {
          left: ema(this.smoothMovement.left, reading.movement.left, LIVE_ALPHA),
          right: ema(this.smoothMovement.right, reading.movement.right, LIVE_ALPHA),
        };
      }
      if (this.run.phase === 'hold' && !this.paused) this.holdSamples.push(sample);
    }

    if (this.paused) return;
    // Phases that need a measurement wait for the user instead of timing out.
    const effectiveDelta = phaseNeedsFace(this.run.phase) && !usable ? 0 : delta;
    const { state, events } = advance(this.run, effectiveDelta, this.exercises);
    this.run = state;
    this.handleEvents(events);
  }

  private handleEvents(events: readonly RunEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'phaseEnter':
          if (event.phase === 'move') {
            this.holdSamples = [];
            this.resetSmoothing();
          }
          break;
        case 'holdEnd': {
          const exercise = this.exercises[event.exerciseIndex];
          if (exercise && this.baseline) {
            const measurement = measureRep(
              event.repIndex + 1,
              this.holdSamples,
              exercise,
              this.baseline,
              this.sideConfig
            );
            this.repsForExercise.push(measurement);
            this.lastRep = { rep: measurement.rep, symmetry: measurement.symmetry };
          }
          this.holdSamples = [];
          break;
        }
        case 'exerciseEnd':
          this.finishExerciseFromReps(event.exerciseIndex);
          break;
        case 'sessionEnd':
          this.completeSession();
          break;
      }
    }
  }

  private finishExerciseFromReps(index = this.run.exerciseIndex): void {
    const exercise = this.exercises[index];
    if (!exercise) return;
    if (this.results.some((result) => result.exerciseId === exercise.id)) return;
    this.results.push(summariseExercise(exercise, this.repsForExercise));
    this.repsForExercise = [];
    this.lastRep = null;
  }

  private completeSession(): void {
    // Anything never reached still gets a row, so results list all five.
    for (const exercise of this.exercises) {
      if (!this.results.some((result) => result.exerciseId === exercise.id)) {
        this.results.push(summariseExercise(exercise, []));
      }
    }
    const ordered = this.exercises
      .map((exercise) => this.results.find((result) => result.exerciseId === exercise.id))
      .filter((result): result is ExerciseResult => result !== undefined);

    this.record = {
      id: newSessionId(),
      startedAt: this.startedAt ?? new Date().toISOString(),
      endedAt: new Date().toISOString(),
      overallScore: overallScore(ordered),
      exercises: ordered,
      sideConfig: { ...this.sideConfig },
      schemaVersion: SCHEMA_VERSION,
    };
    this.stage = 'finished';
  }

  private resetSmoothing(): void {
    this.smoothFill = { left: null, right: null };
    this.smoothMovement = { left: null, right: null };
    this.latestRaw = ZERO;
  }

  /**
   * Raw per-side values for the debug panel. This is how you check that
   * "left" really is the user's left: raise one eyebrow and watch which row
   * moves.
   */
  private updateDebug(sample: FaceSample, geometry: FaceGeometry): void {
    const bs = sample.blendshapes;
    const pair = (label: string, left: string, right: string): DebugPair => {
      const value = sidedBlendshape(bs, left, right, this.sideConfig);
      return { label, left: value.left, right: value.right };
    };
    const corners =
      sidedMidlineDistance(sample.landmarks, [[MOUTH_CORNERS[0]], [MOUTH_CORNERS[1]]], geometry) ??
      ZERO;
    const cheeks = sidedMidlineDistance(sample.landmarks, CHEEK_GROUPS, geometry) ?? ZERO;
    const mouth = sidedMouthCorners(sample.landmarks, geometry);

    this.latestDebug = {
      aspect: sample.aspect,
      interOcular: geometry.scale,
      pose: sample.headPose,
      pairs: [
        pair('browOuterUp (blendshape)', 'browOuterUpLeft', 'browOuterUpRight'),
        pair('eyeBlink (blendshape)', 'eyeBlinkLeft', 'eyeBlinkRight'),
        pair('mouthSmile (blendshape)', 'mouthSmileLeft', 'mouthSmileRight'),
        { label: 'mouth corner to midline (landmark)', left: corners.left, right: corners.right },
        { label: 'cheek to midline (landmark)', left: cheeks.left, right: cheeks.right },
        {
          label: 'mouth corner height (landmark)',
          left: mouth?.left.u ?? 0,
          right: mouth?.right.u ?? 0,
        },
      ],
      unsided: [
        { label: 'cheekPuff', value: bs.cheekPuff ?? 0 },
        { label: 'mouthPucker', value: bs.mouthPucker ?? 0 },
        { label: 'jawOpen', value: bs.jawOpen ?? 0 },
      ],
    };
  }

  private publish(force: boolean): void {
    const now = this.lastNow ?? 0;
    if (!force && now - this.lastPublish < PUBLISH_INTERVAL_MS) return;
    this.lastPublish = now;

    const exercise = this.exercises[this.run.exerciseIndex] ?? null;
    const progress = runProgress(this.run, this.exercises);

    this.store.set({
      stage: this.stage,
      paused: this.paused,
      faceDetected: this.faceDetected,
      alignment: this.alignment,
      fps: Math.round(this.fps),

      calibrationProgress: clamp(this.calibrationMs / CALIBRATION_MS, 0, 1),
      baselineReady: this.baseline !== null,
      calibrationNote: this.calibrationNote,

      exercise,
      exerciseIndex: this.run.exerciseIndex,
      exerciseCount: this.exercises.length,
      phase: this.run.phase,
      countdown: phaseCountdown(this.run, this.exercises),
      phaseRemainingMs: phaseRemainingMs(this.run, this.exercises),
      repNumber: Math.min(this.run.repIndex + 1, exercise?.reps ?? 1),
      repsInExercise: exercise?.reps ?? 0,
      repsDone: progress.repsDone,
      repsTotal: progress.repsTotal,

      fill: { left: this.smoothFill.left ?? 0, right: this.smoothFill.right ?? 0 },
      movement: { left: this.smoothMovement.left ?? 0, right: this.smoothMovement.right ?? 0 },
      raw: this.latestRaw,
      lastRep: this.lastRep,

      debug: this.latestDebug,
    });
  }
}
