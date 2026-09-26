/**
 * Drives whole rounds through the controller with synthetic pose frames - the
 * same path the camera loop takes, minus MediaPipe and the canvas.
 */
import { describe, expect, it } from 'vitest';
import { COUNTDOWN_MS, GameController, ROUND_MS } from './gameController';
import { readHand, type PoseSample } from './punch';
import type { Landmark, Point2 } from './types';

const ASPECT = 16 / 9;
const FRAME_MS = 33;

/** Raw-camera pose: the user's left side has the larger x. */
function pose(t: number, leftWristDisplay: Point2): PoseSample {
  const landmarks: Landmark[] = new Array<Landmark>(33).fill({ x: 0.5, y: 0.5 });
  landmarks[11] = { x: 0.6, y: 0.4 };
  landmarks[12] = { x: 0.4, y: 0.4 };
  landmarks[13] = { x: 0.62, y: 0.55 };
  landmarks[14] = { x: 0.38, y: 0.55 };
  landmarks[15] = { x: 1 - leftWristDisplay.x, y: leftWristDisplay.y };
  landmarks[16] = { x: 0.37, y: 0.68 };
  return { t, landmarks, world: null, aspect: ASPECT };
}

/** A repeatable stand-in for Math.random. */
function seeded(): () => number {
  let seed = 7;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

const REST: Point2 = { x: 0.42, y: 0.62 };

interface Clock {
  now: number;
}

/** Runs frames with the arm resting, so nothing registers as a punch. */
function idle(controller: GameController, clock: Clock, ms: number): void {
  const until = clock.now + ms;
  while (clock.now < until) {
    clock.now += FRAME_MS;
    controller.update(clock.now, { pose: pose(clock.now, REST), hands: [] });
  }
}

/**
 * Throws one punch out to `at`. A punch fires on the first frame that is fast
 * enough - the game wants to react immediately rather than wait for the arm to
 * finish travelling - so this is a single frame, and the swept path runs from
 * where the fist was resting to where it landed.
 */
function punchAt(controller: GameController, clock: Clock, at: Point2): void {
  clock.now += FRAME_MS;
  controller.update(clock.now, { pose: pose(clock.now, at), hands: [] });
  // Back to the guard, ready for the next one.
  idle(controller, clock, 330);
}

/** Idles until something is on screen to hit. */
function waitForTarget(controller: GameController, clock: Clock): boolean {
  for (let i = 0; i < 40; i += 1) {
    if (controller.getRenderState().targets.some((target) => target.state === 'alive')) return true;
    idle(controller, clock, 100);
  }
  return false;
}

/** Starts a round and runs out the countdown. */
function startRound(): { controller: GameController; clock: Clock } {
  const controller = new GameController(null, seeded());
  // A one-hit object, so a test punch settles the question in one go.
  controller.setObject('ball');
  const clock: Clock = { now: 1000 };
  controller.start(clock.now);
  idle(controller, clock, COUNTDOWN_MS + 200);
  return { controller, clock };
}

/**
 * Moves the first live target somewhere known, and normalises it to a plain
 * one-hit ball, so a test is comparing like with like rather than whatever the
 * spawner happened to roll.
 */
function placeTarget(controller: GameController, at: Point2): boolean {
  const target = controller.getRenderState().targets.find((entry) => entry.state === 'alive');
  if (!target) return false;
  target.pos = { ...at };
  target.vel = { x: 0, y: 0 };
  target.tier = 'normal';
  target.hp = 1;
  target.maxHp = 1;
  target.size = 0.115;
  return true;
}

describe('round flow', () => {
  it('counts down before play starts', () => {
    const controller = new GameController(null, seeded());
    const clock: Clock = { now: 0 };
    controller.start(clock.now);
    expect(controller.store.getSnapshot().stage).toBe('countdown');

    idle(controller, clock, 1000);
    expect(controller.store.getSnapshot().stage).toBe('countdown');
    expect(controller.store.getSnapshot().countdown).toBeLessThanOrEqual(3);

    idle(controller, clock, COUNTDOWN_MS);
    expect(controller.store.getSnapshot().stage).toBe('playing');
  });

  it('spawns targets to hit', () => {
    const { controller, clock } = startRound();
    idle(controller, clock, 1500);
    expect(controller.getRenderState().targets.length).toBeGreaterThan(0);
  });

  it('ends after a minute and reports the round', () => {
    const { controller, clock } = startRound();
    idle(controller, clock, ROUND_MS + 500);
    const snapshot = controller.store.getSnapshot();
    expect(snapshot.stage).toBe('over');
    expect(snapshot.timeLeftMs).toBe(0);

    const result = controller.getResult();
    expect(result).not.toBeNull();
    expect(result!.durationMs).toBe(ROUND_MS);
    expect(Date.parse(result!.at)).not.toBeNaN();
  });
});

describe('punching', () => {
  it('scores a hit and starts a combo', () => {
    const { controller, clock } = startRound();
    expect(waitForTarget(controller, clock)).toBe(true);
    expect(placeTarget(controller, { x: 0.78, y: 0.45 })).toBe(true);

    punchAt(controller, clock, { x: 0.78, y: 0.45 });

    const snapshot = controller.store.getSnapshot();
    expect(snapshot.punches).toBe(1);
    expect(snapshot.hits).toBe(1);
    expect(snapshot.combo).toBe(1);
    expect(snapshot.score).toBeGreaterThan(0);
  });

  it('knocks the target about instead of just deleting it', () => {
    const { controller, clock } = startRound();
    waitForTarget(controller, clock);
    placeTarget(controller, { x: 0.78, y: 0.45 });
    const target = controller.getRenderState().targets[0]!;

    clock.now += FRAME_MS;
    controller.update(clock.now, { pose: pose(clock.now, { x: 0.78, y: 0.45 }), hands: [] });

    expect(Math.hypot(target.vel.x, target.vel.y)).toBeGreaterThan(0.2);
    expect(target.squash).toBeLessThan(1);
    expect(Math.max(...target.wobbleVel.map(Math.abs))).toBeGreaterThan(0);
  });

  it('counts a punch that hits nothing without breaking the streak', () => {
    const { controller, clock } = startRound();
    waitForTarget(controller, clock);
    placeTarget(controller, { x: 0.78, y: 0.28 });
    punchAt(controller, clock, { x: 0.78, y: 0.28 });
    expect(controller.store.getSnapshot().hits).toBe(1);

    // Swing at empty air, well away from anything.
    for (const target of controller.getRenderState().targets) target.pos = { x: 0.2, y: 0.2 };
    punchAt(controller, clock, { x: 0.92, y: 0.86 });

    const snapshot = controller.store.getSnapshot();
    expect(snapshot.punches).toBe(2);
    expect(snapshot.hits).toBe(1);
    expect(snapshot.combo).toBe(1);
  });

  it('builds the score faster as the combo grows', () => {
    const { controller, clock } = startRound();
    let previous = 0;
    const gains: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      if (!waitForTarget(controller, clock)) break;
      placeTarget(controller, { x: 0.78, y: 0.45 });
      punchAt(controller, clock, { x: 0.78, y: 0.45 });
      const score = controller.store.getSnapshot().score;
      gains.push(score - previous);
      previous = score;
    }

    const snapshot = controller.store.getSnapshot();
    expect(snapshot.hits).toBeGreaterThanOrEqual(5);
    expect(snapshot.bestCombo).toBeGreaterThanOrEqual(5);
    // The later hits are worth more than the first, thanks to the multiplier.
    expect(gains[gains.length - 1]!).toBeGreaterThan(gains[0]!);
  });

  it('breaks the streak when a target is left to time out', () => {
    const { controller, clock } = startRound();
    waitForTarget(controller, clock);
    placeTarget(controller, { x: 0.78, y: 0.45 });
    punchAt(controller, clock, { x: 0.78, y: 0.45 });
    expect(controller.store.getSnapshot().combo).toBe(1);

    // Stand there long enough for something to expire.
    idle(controller, clock, 7000);
    const snapshot = controller.store.getSnapshot();
    expect(snapshot.missed).toBeGreaterThan(0);
    expect(snapshot.combo).toBe(0);
  });

  it('ignores punches thrown before the round starts', () => {
    const controller = new GameController(null, seeded());
    const clock: Clock = { now: 0 };
    controller.start(clock.now);
    punchAt(controller, clock, { x: 0.8, y: 0.4 });
    expect(controller.store.getSnapshot().punches).toBe(0);
  });

  it('notices when the player is out of frame', () => {
    const { controller, clock } = startRound();
    idle(controller, clock, 300);
    expect(controller.store.getSnapshot().poseDetected).toBe(true);

    // Several frames, because the snapshot the HUD reads is published on a timer.
    for (let i = 0; i < 6; i += 1) {
      clock.now += FRAME_MS;
      controller.update(clock.now, {
        pose: { t: clock.now, landmarks: [], world: null, aspect: ASPECT },
        hands: [],
      });
    }
    expect(controller.store.getSnapshot().poseDetected).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Hand tracking
 * ------------------------------------------------------------------ */

/** A hand whose knuckles sit exactly on `displayCentre`. */
function handAt(displayCentre: Point2) {
  const raw: Landmark[] = new Array<Landmark>(21).fill({ x: 0.5, y: 0.5 });
  const rawX = 1 - displayCentre.x;
  const y = displayCentre.y;
  raw[0] = { x: rawX, y: y + 0.05 }; // wrist, below the knuckles
  const mcps = [5, 9, 13, 17];
  const tips = [8, 12, 16, 20];
  mcps.forEach((index, i) => {
    raw[index] = { x: rawX - 0.03 + i * 0.02, y };
  });
  tips.forEach((index, i) => {
    const mcp = raw[mcps[i]!]!;
    raw[index] = { x: mcp.x, y: mcp.y - 0.006 }; // curled: a fist
  });
  return readHand(raw, ASPECT)!;
}

describe('hand tracking', () => {
  /** The pose wrist trails the knuckles by this much, as a real hand does. */
  const KNUCKLE_LEAD = 0.08;

  function run(withHands: boolean) {
    const controller = new GameController(null, seeded());
    controller.setObject('ball');
    const clock: Clock = { now: 1000 };
    controller.start(clock.now);

    const step = (wrist: Point2): void => {
      clock.now += FRAME_MS;
      const knuckles = { x: wrist.x + KNUCKLE_LEAD, y: wrist.y };
      controller.update(clock.now, {
        pose: pose(clock.now, wrist),
        hands: withHands ? [handAt(knuckles)] : [],
      });
    };

    const rest = (ms: number): void => {
      const until = clock.now + ms;
      while (clock.now < until) step(REST);
    };

    rest(COUNTDOWN_MS + 1400);
    const live = controller.getRenderState().targets;
    const target = live.find((entry) => entry.state === 'alive');
    if (!target) return null;
    // Retire everything else, so only the placed target can be hit.
    for (const other of live) {
      if (other !== target) {
        other.state = 'dying';
        other.diedAt = clock.now;
      }
    }
    // Small, and sitting exactly where the knuckles will be - not where the
    // pose model puts the wrist.
    target.pos = { x: 0.78, y: 0.45 };
    target.vel = { x: 0, y: 0 };
    target.size = 0.05;
    target.hp = 1;
    target.maxHp = 1;

    step({ x: 0.78 - KNUCKLE_LEAD, y: 0.45 });
    // The HUD snapshot is published on a timer, so let it catch up.
    rest(200);
    return controller.store.getSnapshot();
  }

  it('reports how many hands it can see', () => {
    const snapshot = run(true);
    expect(snapshot!.handsTracked).toBe(1);
    expect(run(false)!.handsTracked).toBe(0);
  });

  it('punches with the knuckles, not the wrist', () => {
    // Same arm movement both times. With the hand model the strike point is
    // the knuckles, which reach the target; the wrist alone falls short.
    expect(run(true)!.hits).toBe(1);
    expect(run(false)!.hits).toBe(0);
  });
});

describe('choosing an object', () => {
  it('spawns whatever the player picked', () => {
    const { controller, clock } = startRound();
    controller.setObject('chair');
    idle(controller, clock, 2500);
    const targets = controller.getRenderState().targets;
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((target) => target.objectId === 'chair')).toBe(true);
    expect(controller.store.getSnapshot().objectId).toBe('chair');
  });

  it('carries the object through to how tough it is', () => {
    const { controller, clock } = startRound();
    controller.setObject('chair');
    idle(controller, clock, 2500);
    // Gold targets always go down in one, whatever they are, so check a normal one.
    const target = controller
      .getRenderState()
      .targets.find((entry) => entry.tier === 'normal');
    expect(target).toBeDefined();
    // A chair takes three, where the stress ball took one.
    expect(target!.maxHp).toBeGreaterThanOrEqual(3);
  });
});
