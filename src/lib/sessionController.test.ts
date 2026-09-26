/**
 * Drives a whole session through the controller with synthetic frames - the
 * same path the camera loop takes, minus MediaPipe.
 */
import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';
import { CALIBRATION_MS, SessionController } from './sessionController';
import { DEFAULT_SIDE_CONFIG, type FaceSample, type HeadPose, type Landmark, type Sided } from './types';

const FRAME_MS = 33;

interface FaceOptions {
  mouth?: Sided<number>;
  cheek?: Sided<number>;
  blendshapes?: Record<string, number>;
  headPose?: HeadPose;
}

const RELAXED: Record<string, number> = {
  browOuterUpLeft: 0,
  browOuterUpRight: 0,
  eyeBlinkLeft: 0.05,
  eyeBlinkRight: 0.05,
  mouthSmileLeft: 0.02,
  mouthSmileRight: 0.02,
};

function makeSample(t: number, options: FaceOptions = {}): FaceSample {
  const aspect = 16 / 9;
  const iod = 0.12;
  const mouth = options.mouth ?? { left: 0.45, right: 0.45 };
  const cheek = options.cheek ?? { left: 0.95, right: 0.95 };
  const centreX = 0.5 * aspect;
  const centreY = 0.45;

  const landmarks: Landmark[] = new Array<Landmark>(478).fill({ x: 0.5, y: 0.5 });
  const put = (index: number, down: number, sideways: number): void => {
    landmarks[index] = { x: (centreX + sideways) / aspect, y: centreY + down };
  };
  put(10, -0.3, 0);
  put(152, 0.3, 0);
  put(33, -0.1, -iod / 2);
  put(263, -0.1, iod / 2);
  put(61, 0.17, mouth.left * iod);
  put(291, 0.17, -mouth.right * iod);
  for (const index of [93, 132, 58]) put(index, 0.05, -cheek.right * iod);
  for (const index of [323, 361, 288]) put(index, 0.05, cheek.left * iod);

  return {
    t,
    landmarks,
    blendshapes: { ...RELAXED, ...options.blendshapes },
    headPose: options.headPose ?? { yaw: 0, pitch: 0, roll: 0 },
    aspect,
  };
}

/** The face used during every exercise: each side moves a known amount. */
const MOVED: FaceOptions = {
  mouth: { left: 0.35, right: 0.4 },
  cheek: { left: 1.0, right: 0.975 },
  blendshapes: {
    browOuterUpLeft: 0.4,
    browOuterUpRight: 0.2,
    eyeBlinkLeft: 0.6,
    eyeBlinkRight: 0.6,
    mouthSmileLeft: 0.5,
    mouthSmileRight: 0.25,
  },
};

function feed(
  controller: SessionController,
  clock: { now: number },
  durationMs: number,
  options: FaceOptions | null
): void {
  const until = clock.now + durationMs;
  while (clock.now < until) {
    clock.now += FRAME_MS;
    controller.pushFrame(clock.now, options ? makeSample(clock.now, options) : null);
  }
}

function calibrated(): { controller: SessionController; clock: { now: number } } {
  const controller = new SessionController();
  const clock = { now: 0 };
  controller.beginCalibration();
  feed(controller, clock, CALIBRATION_MS + 500, {});
  return { controller, clock };
}

describe('calibration', () => {
  it('needs a few seconds of a usable face before it has a baseline', () => {
    const controller = new SessionController();
    const clock = { now: 0 };
    controller.beginCalibration();

    feed(controller, clock, 1000, {});
    expect(controller.store.getSnapshot().stage).toBe('calibrating');
    expect(controller.store.getSnapshot().calibrationProgress).toBeGreaterThan(0.2);

    feed(controller, clock, 2500, {});
    expect(controller.store.getSnapshot().stage).toBe('calibrated');
    expect(controller.store.getSnapshot().baselineReady).toBe(true);
  });

  it('makes no progress while there is no face', () => {
    const controller = new SessionController();
    const clock = { now: 0 };
    controller.beginCalibration();
    feed(controller, clock, 4000, null);
    expect(controller.store.getSnapshot().stage).toBe('calibrating');
    expect(controller.store.getSnapshot().calibrationProgress).toBe(0);
    expect(controller.store.getSnapshot().faceDetected).toBe(false);
  });

  it('unwinds progress if the user looks away part way through', () => {
    const controller = new SessionController();
    const clock = { now: 0 };
    controller.beginCalibration();
    feed(controller, clock, 2000, {});
    const held = controller.store.getSnapshot().calibrationProgress;
    feed(controller, clock, 2000, { headPose: { yaw: 40, pitch: 0, roll: 0 } });
    expect(controller.store.getSnapshot().calibrationProgress).toBeLessThan(held);
    expect(controller.store.getSnapshot().alignment).toBe('turned');
  });
});

describe('a complete session', () => {
  const { controller, clock } = calibrated();
  controller.startExercises();
  // The same moved face throughout: each exercise reads only its own signal.
  for (let i = 0; i < 8000 && controller.store.getSnapshot().stage === 'exercising'; i += 1) {
    clock.now += FRAME_MS;
    controller.pushFrame(clock.now, makeSample(clock.now, MOVED));
  }
  const record = controller.getRecord();

  it('finishes and produces a record', () => {
    expect(controller.store.getSnapshot().stage).toBe('finished');
    expect(record).not.toBeNull();
    expect(record!.exercises).toHaveLength(EXERCISES.length);
    expect(Date.parse(record!.startedAt)).not.toBeNaN();
    expect(record!.sideConfig).toEqual(DEFAULT_SIDE_CONFIG);
  });

  it('scores every exercise from the movement it saw', () => {
    const scores = Object.fromEntries(
      record!.exercises.map((result) => [result.exerciseId, result.score])
    );
    expect(scores).toEqual({
      'brow-raise': 50, // 0.40 vs 0.20
      'eye-closure': 100, // 0.55 vs 0.55
      'smile-closed': 48, // 0.48 vs 0.23
      pucker: 50, // 0.10 vs 0.05 inward
      'cheek-puff': 50, // 0.050 vs 0.025 outward
    });
    expect(record!.overallScore).toBe(60);
  });

  it('records every repetition of every exercise', () => {
    for (const result of record!.exercises) {
      expect(result.reps).toHaveLength(5);
      expect(result.validReps).toBe(5);
      expect(result.status).toBe('ok');
    }
  });

  it('names the weaker side where the two sides differed', () => {
    const byId = Object.fromEntries(record!.exercises.map((r) => [r.exerciseId, r]));
    expect(byId['brow-raise']!.weakerSide).toBe('right');
    expect(byId['pucker']!.weakerSide).toBe('right');
    expect(byId['eye-closure']!.weakerSide).toBeNull();
  });

  it('flags the co-movements the exercises watch for', () => {
    const byId = Object.fromEntries(record!.exercises.map((r) => [r.exerciseId, r]));
    // Eyes were closing throughout, which is exactly what smile and pucker watch.
    expect(byId['smile-closed']!.synkinesis.map((f) => f.side).sort()).toEqual(['left', 'right']);
    expect(byId['pucker']!.synkinesis).toHaveLength(2);
    // The mouth was moving during eye closure, on both sides.
    expect(byId['eye-closure']!.synkinesis).toHaveLength(2);
    // Brow raise does not watch anything.
    expect(byId['brow-raise']!.synkinesis).toEqual([]);
  });
});

describe('a session where the face never moves', () => {
  it('reports "not enough movement" rather than perfect symmetry', () => {
    const { controller, clock } = calibrated();
    controller.startExercises();
    for (let i = 0; i < 8000 && controller.store.getSnapshot().stage === 'exercising'; i += 1) {
      clock.now += FRAME_MS;
      controller.pushFrame(clock.now, makeSample(clock.now, {}));
    }
    const record = controller.getRecord()!;
    expect(record.overallScore).toBeNull();
    expect(record.exercises.every((result) => result.status === 'insufficient')).toBe(true);
  });
});

describe('interruptions', () => {
  it('waits rather than running the countdown down while the head is turned', () => {
    const { controller, clock } = calibrated();
    controller.startExercises();
    feed(controller, clock, 6500, MOVED); // through the intro, into the first rep
    const before = controller.store.getSnapshot();
    expect(before.phase).not.toBe('intro');

    feed(controller, clock, 5000, { ...MOVED, headPose: { yaw: 35, pitch: 0, roll: 0 } });
    const after = controller.store.getSnapshot();
    expect(after.alignment).toBe('turned');
    expect(after.repsDone).toBe(before.repsDone);
    expect(after.phase).toBe(before.phase);
  });

  it('pauses and resumes', () => {
    const { controller, clock } = calibrated();
    controller.startExercises();
    feed(controller, clock, 7000, MOVED);
    controller.setPaused(true);
    const paused = controller.store.getSnapshot();
    feed(controller, clock, 5000, MOVED);
    expect(controller.store.getSnapshot().phase).toBe(paused.phase);
    controller.setPaused(false);
    feed(controller, clock, 6000, MOVED); // long enough to finish the repetition
    expect(controller.store.getSnapshot().repsDone).toBeGreaterThan(paused.repsDone);
  });

  it('keeps what it measured when an exercise is skipped', () => {
    const { controller, clock } = calibrated();
    controller.startExercises();
    feed(controller, clock, 14_000, MOVED); // a couple of reps in
    controller.skipCurrentExercise();
    const snapshot = controller.store.getSnapshot();
    expect(snapshot.exerciseIndex).toBe(1);
    expect(snapshot.exercise?.id).toBe(EXERCISES[1]!.id);
  });

  it('keeps what it measured when the session is ended early', () => {
    const { controller, clock } = calibrated();
    controller.startExercises();
    feed(controller, clock, 20_000, MOVED);
    controller.finishEarly();
    const record = controller.getRecord()!;
    expect(record.exercises).toHaveLength(EXERCISES.length);
    expect(record.exercises[0]!.status).toBe('ok');
    // Exercises that were never reached are marked as skipped, not as zero.
    expect(record.exercises[4]!.status).toBe('skipped');
    expect(record.exercises[4]!.score).toBeNull();
  });
});
