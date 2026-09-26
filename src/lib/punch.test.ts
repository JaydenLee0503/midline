import { describe, expect, it } from 'vitest';
import {
  armFrame,
  classifyPunch,
  comboMultiplier,
  createArmState,
  GENTLE_CONFIG,
  jointAngle,
  matchHandsToArms,
  NORMAL_CONFIG,
  punchLabel,
  readHand,
  refineWithHand,
  scoreHit,
  trackArm,
  type Punch,
  type PoseSample,
} from './punch';
import type { Landmark, Point2 } from './types';

/* A frontal upper body. Raw camera coordinates, so the user's left side has
   the larger x - the same convention the rest of the app uses. */
const ASPECT = 16 / 9;

interface PoseParts {
  leftWrist: Point2;
  rightWrist?: Point2;
  leftElbow?: Point2;
  rightElbow?: Point2;
}

function makePose(t: number, parts: PoseParts): PoseSample {
  const landmarks: Landmark[] = new Array<Landmark>(33).fill({ x: 0.5, y: 0.5 });
  landmarks[11] = { x: 0.6, y: 0.4 }; // user's left shoulder
  landmarks[12] = { x: 0.4, y: 0.4 }; // user's right shoulder
  landmarks[13] = parts.leftElbow ?? { x: 0.62, y: 0.55 };
  landmarks[14] = parts.rightElbow ?? { x: 0.38, y: 0.55 };
  landmarks[15] = parts.leftWrist;
  landmarks[16] = parts.rightWrist ?? { x: 0.37, y: 0.68 };
  return { t, landmarks, world: null, aspect: ASPECT };
}

/** Feeds a sequence of wrist positions and returns any punch that came out. */
function feed(positions: { t: number; wrist: Point2 }[], config = NORMAL_CONFIG) {
  let state = createArmState();
  const punches: Punch[] = [];
  for (const step of positions) {
    const sample = makePose(step.t, { leftWrist: step.wrist });
    const result = trackArm(state, 'left', armFrame(sample, 'left'), step.t, config);
    state = result.state;
    if (result.punch) punches.push(result.punch);
  }
  return { state, punches };
}

describe('armFrame', () => {
  const sample = makePose(0, { leftWrist: { x: 0.68, y: 0.62 } });

  it('flips x so the fist appears where the mirrored video shows it', () => {
    const frame = armFrame(sample, 'left')!;
    expect(frame.screen.x).toBeCloseTo(1 - 0.68, 6);
    expect(frame.screen.y).toBeCloseTo(0.62, 6);
  });

  it('measures reach in shoulder widths, so distance from the camera drops out', () => {
    const near = armFrame(sample, 'left')!;
    // The same pose, filmed from twice as far away: everything halves about the centre.
    const shrink = (point: Landmark): Landmark => ({
      x: 0.5 + (point.x - 0.5) / 2,
      y: 0.5 + (point.y - 0.5) / 2,
    });
    const far: PoseSample = {
      ...sample,
      landmarks: sample.landmarks.map(shrink),
    };
    const frame = armFrame(far, 'left')!;
    expect(frame.reach).toBeCloseTo(near.reach, 6);
  });

  it('returns null when the shoulders are not visible', () => {
    const blank: PoseSample = { t: 0, landmarks: [], world: null, aspect: ASPECT };
    expect(armFrame(blank, 'left')).toBeNull();
  });
});

describe('jointAngle', () => {
  it('reads a straight arm as 180 degrees and a right angle as 90', () => {
    expect(jointAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 })).toBeCloseTo(180, 4);
    expect(jointAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })).toBeCloseTo(90, 4);
  });
});

describe('classifyPunch', () => {
  it('calls an upward travel with a bent elbow an uppercut', () => {
    expect(classifyPunch({ x: 0.5, y: -6 }, 1, 110)).toBe('uppercut');
  });

  it('calls a sideways sweep with a bent elbow a hook', () => {
    expect(classifyPunch({ x: -6, y: 0.4 }, 1, 100)).toBe('hook');
  });

  it('calls an extending arm a straight, even when it barely moves on screen', () => {
    // A jab comes towards the camera: little screen travel, lots of extension.
    expect(classifyPunch({ x: 0.3, y: 0.2 }, 7, 170)).toBe('straight');
  });
});

describe('trackArm', () => {
  it('ignores an arm that is just drifting', () => {
    const { punches } = feed([
      { t: 0, wrist: { x: 0.62, y: 0.62 } },
      { t: 33, wrist: { x: 0.622, y: 0.621 } },
      { t: 66, wrist: { x: 0.624, y: 0.622 } },
    ]);
    expect(punches).toEqual([]);
  });

  it('fires once the fist travels away from the shoulder quickly', () => {
    const { punches } = feed([
      { t: 0, wrist: { x: 0.62, y: 0.58 } },
      { t: 33, wrist: { x: 0.68, y: 0.56 } },
      { t: 66, wrist: { x: 0.76, y: 0.54 } },
    ]);
    expect(punches).toHaveLength(1);
    expect(punches[0]!.arm).toBe('left');
    expect(punches[0]!.power).toBeGreaterThan(0);
    expect(punches[0]!.speed).toBeGreaterThan(NORMAL_CONFIG.triggerSpeed);
  });

  it('does not fire when the fist is being pulled back in', () => {
    const { punches } = feed([
      { t: 0, wrist: { x: 0.85, y: 0.5 } },
      { t: 33, wrist: { x: 0.75, y: 0.52 } },
      { t: 66, wrist: { x: 0.64, y: 0.55 } },
    ]);
    expect(punches).toEqual([]);
  });

  it('will not fire twice from the same arm inside the refractory window', () => {
    const { punches } = feed([
      { t: 0, wrist: { x: 0.62, y: 0.58 } },
      { t: 33, wrist: { x: 0.68, y: 0.56 } },
      { t: 66, wrist: { x: 0.76, y: 0.54 } },
      { t: 99, wrist: { x: 0.84, y: 0.52 } },
      { t: 132, wrist: { x: 0.9, y: 0.5 } },
    ]);
    expect(punches).toHaveLength(1);
  });

  it('gentle mode registers a punch that normal mode would miss', () => {
    const slow = [
      { t: 0, wrist: { x: 0.62, y: 0.58 } },
      { t: 40, wrist: { x: 0.645, y: 0.572 } },
      { t: 80, wrist: { x: 0.672, y: 0.564 } },
    ];
    expect(feed(slow, NORMAL_CONFIG).punches).toEqual([]);
    expect(feed(slow, GENTLE_CONFIG).punches).toHaveLength(1);
  });

  it('forgets its history when the arm goes out of view', () => {
    const state = createArmState();
    const result = trackArm(state, 'left', null, 100, NORMAL_CONFIG);
    expect(result.punch).toBeNull();
    expect(result.state.history).toEqual([]);
  });
});

/* A synthetic hand: wrist, four knuckles in a row, and fingertips placed
   either curled back onto the knuckles or extended away from them. */
function makeHand(open: boolean, centre: Point2 = { x: 0.5, y: 0.5 }): Landmark[] {
  const points: Landmark[] = new Array<Landmark>(21).fill({ x: centre.x, y: centre.y });
  points[0] = { x: centre.x, y: centre.y + 0.04 }; // wrist, below the knuckles
  const mcps = [5, 9, 13, 17];
  const tips = [8, 12, 16, 20];
  mcps.forEach((index, i) => {
    points[index] = { x: centre.x - 0.03 + i * 0.02, y: centre.y };
  });
  tips.forEach((index, i) => {
    const mcp = points[mcps[i]!]!;
    points[index] = { x: mcp.x, y: mcp.y - (open ? 0.035 : 0.006) };
  });
  return points;
}

describe('readHand', () => {
  it('uses the knuckles as the strike point, not the wrist', () => {
    const hand = readHand(makeHand(true), ASPECT)!;
    expect(hand).not.toBeNull();
    // The knuckle centroid sits above the wrist, where a punch actually lands.
    expect(hand.strike.y).toBeLessThan(hand.wrist.y);
    expect(hand.points).toHaveLength(21);
  });

  it('tells an open hand from a closed fist', () => {
    expect(readHand(makeHand(true), ASPECT)!.openness).toBeGreaterThan(0.6);
    expect(readHand(makeHand(false), ASPECT)!.openness).toBeLessThan(0.2);
  });

  it('flips x, so the hand appears where the mirrored video shows it', () => {
    const hand = readHand(makeHand(true, { x: 0.8, y: 0.5 }), ASPECT)!;
    expect(hand.wrist.x).toBeCloseTo(0.2, 6);
  });

  it('returns null for a partial hand', () => {
    expect(readHand([{ x: 0.5, y: 0.5 }], ASPECT)).toBeNull();
  });
});

describe('refineWithHand', () => {
  it('moves the strike point onto the knuckles and says where it came from', () => {
    const sample = makePose(0, { leftWrist: { x: 0.68, y: 0.62 } });
    const posed = armFrame(sample, 'left')!;
    expect(posed.source).toBe('pose');

    const hand = readHand(makeHand(false, { x: 0.7, y: 0.6 }), ASPECT)!;
    const refined = refineWithHand(posed, hand);

    expect(refined.source).toBe('hand');
    expect(refined.screen).toEqual(hand.strike);
    // Reach and elbow angle still come from the body, which reads them better.
    expect(refined.reach).toBe(posed.reach);
    expect(refined.elbowAngle).toBe(posed.elbowAngle);
  });

  it('keeps the local position consistent with the new strike point', () => {
    const sample = makePose(0, { leftWrist: { x: 0.68, y: 0.62 } });
    const posed = armFrame(sample, 'left')!;
    const hand = readHand(makeHand(false, { x: 1 - posed.screen.x, y: posed.screen.y }), ASPECT)!;
    const refined = refineWithHand(posed, hand);
    // Same place as the pose wrist (bar the knuckle offset), so `local` barely moves.
    expect(Math.abs(refined.local.x - posed.local.x)).toBeLessThan(0.5);
  });
});

describe('matchHandsToArms', () => {
  it('assigns each hand to the arm it is nearest, never by the model naming', () => {
    const sample = makePose(0, {
      leftWrist: { x: 0.8, y: 0.6 },
      rightWrist: { x: 0.2, y: 0.6 },
    });
    const frames = { left: armFrame(sample, 'left'), right: armFrame(sample, 'right') };

    // In display space the user's left wrist sits at x = 0.2 and their right at 0.8.
    const nearLeft = readHand(makeHand(false, { x: 0.8, y: 0.6 }), ASPECT)!;
    const nearRight = readHand(makeHand(false, { x: 0.2, y: 0.6 }), ASPECT)!;

    const matched = matchHandsToArms([nearLeft, nearRight], frames);
    expect(matched.left).toBe(nearLeft);
    expect(matched.right).toBe(nearRight);
  });

  it('ignores a hand that is nowhere near either wrist', () => {
    const sample = makePose(0, { leftWrist: { x: 0.8, y: 0.6 } });
    const frames = { left: armFrame(sample, 'left'), right: armFrame(sample, 'right') };
    const stray = readHand(makeHand(false, { x: 0.05, y: 0.05 }), ASPECT)!;
    const matched = matchHandsToArms([stray], frames);
    expect(matched.left).toBeNull();
  });
});

describe('scoring', () => {
  const punch = (type: Punch['type'], power: number): Punch => ({
    arm: 'left',
    type,
    power,
    speed: 8,
    at: 0,
    from: { x: 0, y: 0 },
    to: { x: 0.1, y: 0 },
    direction: { x: 1, y: 0 },
  });

  it('grows the multiplier every third hit and caps it', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(2)).toBe(1);
    expect(comboMultiplier(3)).toBe(1.5);
    expect(comboMultiplier(6)).toBe(2);
    expect(comboMultiplier(100)).toBe(4);
  });

  it('pays more for the awkward punches', () => {
    const straight = scoreHit('normal', punch('straight', 0), 0, 1).total;
    const hook = scoreHit('normal', punch('hook', 0), 0, 1).total;
    const uppercut = scoreHit('normal', punch('uppercut', 0), 0, 1).total;
    expect(hook).toBeGreaterThan(straight);
    expect(uppercut).toBeGreaterThan(hook);
  });

  it('doubles a full-power punch and adds half again for a centre hit', () => {
    expect(scoreHit('normal', punch('straight', 0), 0, 1).total).toBe(50);
    expect(scoreHit('normal', punch('straight', 1), 0, 1).total).toBe(100);
    expect(scoreHit('normal', punch('straight', 1), 0, 0).total).toBe(150);
  });

  it('marks a hit near the middle as perfect', () => {
    expect(scoreHit('normal', punch('straight', 0), 0, 0.2).perfect).toBe(true);
    expect(scoreHit('normal', punch('straight', 0), 0, 0.9).perfect).toBe(false);
  });

  it('is worth more on the rarer tiers', () => {
    const base = (tier: 'normal' | 'tough' | 'gold'): number =>
      scoreHit(tier, punch('straight', 0), 0, 1).total;
    expect(base('tough')).toBeGreaterThan(base('normal'));
    expect(base('gold')).toBeGreaterThan(base('tough'));
  });

  it('labels punches for the pop-up', () => {
    expect(punchLabel('uppercut')).toBe('UPPERCUT');
  });
});
