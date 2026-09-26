/**
 * Punch tracking from MediaPipe pose landmarks. Pure functions only, so the
 * detection and scoring rules can be unit tested without a camera.
 *
 * Coordinates: everything here works in *display space* - x already flipped to
 * match the mirrored video, so a punch that the user throws with their right
 * hand moves right on screen, exactly as in a mirror. Distances are measured in
 * shoulder widths, which keeps detection independent of how far the player is
 * sitting from the camera.
 */
import type { Landmark, Point2 } from './types';

/** The user's own arm. */
export type Arm = 'left' | 'right';
export type PunchType = 'straight' | 'hook' | 'uppercut';

/* MediaPipe pose landmark indices. */
export const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
} as const;

export interface PoseSample {
  t: number;
  /** Normalized image landmarks (x, y in 0..1 of the raw camera frame). */
  landmarks: readonly Landmark[];
  /** Metric landmarks, when the model provided them. */
  world: readonly Landmark[] | null;
  aspect: number;
}

export interface PunchConfig {
  /** Speed, in shoulder widths per second, that counts as a punch. */
  triggerSpeed: number;
  /** Minimum gap between two punches from the same arm. */
  refractoryMs: number;
  /** Speed treated as a full-power punch. */
  fullPowerSpeed: number;
}

export const NORMAL_CONFIG: PunchConfig = {
  triggerSpeed: 4.2,
  refractoryMs: 260,
  fullPowerSpeed: 11,
};

/** For players who cannot move quickly - everything still registers. */
export const GENTLE_CONFIG: PunchConfig = {
  triggerSpeed: 2.1,
  refractoryMs: 320,
  fullPowerSpeed: 6,
};

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

function at(landmarks: readonly Landmark[], index: number): Landmark | null {
  const point = landmarks[index];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return point;
}

/** Raw camera x runs the other way from the mirrored video the player sees. */
function toDisplay(point: Landmark): Point2 {
  return { x: 1 - point.x, y: point.y };
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distance3(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

/** Angle at `b` in degrees; 180 means a fully straight arm. */
export function jointAngle(a: Landmark, b: Landmark, c: Landmark): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
  const n1 = Math.hypot(v1.x, v1.y, v1.z);
  const n2 = Math.hypot(v2.x, v2.y, v2.z);
  if (n1 < 1e-6 || n2 < 1e-6) return 180;
  const cos = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (n1 * n2);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

export interface ArmFrame {
  /** The striking point in display space, 0..1 across the frame. */
  screen: Point2;
  elbowScreen: Point2;
  shoulderScreen: Point2;
  /** Shoulder width in isotropic units - the scale everything is measured in. */
  scale: number;
  aspect: number;
  /** Where `screen` came from. Hand landmarks are far more precise. */
  source: 'pose' | 'hand';
  /** Wrist relative to the shoulder, in shoulder widths (aspect corrected). */
  local: Point2;
  /** Shoulder-to-wrist distance in shoulder widths; grows as the arm extends. */
  reach: number;
  /** Degrees at the elbow: ~180 when the arm is straight. */
  elbowAngle: number;
}

/**
 * Reads one arm's geometry from a pose frame. Returns null when the landmarks
 * needed are missing or the player is not squarely enough in view to measure.
 */
export function armFrame(sample: PoseSample, arm: Arm): ArmFrame | null {
  const shoulderIndex = arm === 'left' ? POSE.leftShoulder : POSE.rightShoulder;
  const elbowIndex = arm === 'left' ? POSE.leftElbow : POSE.rightElbow;
  const wristIndex = arm === 'left' ? POSE.leftWrist : POSE.rightWrist;

  const shoulder = at(sample.landmarks, shoulderIndex);
  const elbow = at(sample.landmarks, elbowIndex);
  const wrist = at(sample.landmarks, wristIndex);
  const otherShoulder = at(
    sample.landmarks,
    arm === 'left' ? POSE.rightShoulder : POSE.leftShoulder
  );
  if (!shoulder || !elbow || !wrist || !otherShoulder) return null;
  if (!Number.isFinite(sample.aspect) || sample.aspect <= 0) return null;

  // Shoulder width in isotropic units is our scale reference.
  const iso = (point: Landmark): Point2 => ({ x: point.x * sample.aspect, y: point.y });
  const shoulderWidth = distance(iso(shoulder), iso(otherShoulder));
  if (shoulderWidth < 1e-4) return null;

  const screen = toDisplay(wrist);
  const shoulderScreen = toDisplay(shoulder);
  const local = {
    // Display orientation, so a punch across the body reads the way it looks.
    x: ((1 - wrist.x) * sample.aspect - (1 - shoulder.x) * sample.aspect) / shoulderWidth,
    y: (wrist.y - shoulder.y) / shoulderWidth,
  };

  // World landmarks give a reach that survives an arm pointing at the camera.
  const worldShoulder = sample.world ? at(sample.world, shoulderIndex) : null;
  const worldElbow = sample.world ? at(sample.world, elbowIndex) : null;
  const worldWrist = sample.world ? at(sample.world, wristIndex) : null;
  const worldOther = sample.world ? at(sample.world, arm === 'left' ? POSE.rightShoulder : POSE.leftShoulder) : null;

  let reach: number;
  let elbowAngle: number;
  if (worldShoulder && worldElbow && worldWrist && worldOther) {
    const worldWidth = distance3(worldShoulder, worldOther);
    reach = worldWidth > 1e-6 ? distance3(worldShoulder, worldWrist) / worldWidth : 0;
    elbowAngle = jointAngle(worldShoulder, worldElbow, worldWrist);
  } else {
    reach = Math.hypot(local.x, local.y);
    elbowAngle = jointAngle(shoulder, elbow, wrist);
  }

  return {
    screen,
    elbowScreen: toDisplay(elbow),
    shoulderScreen,
    scale: shoulderWidth,
    aspect: sample.aspect,
    source: 'pose',
    local,
    reach,
    elbowAngle,
  };
}

/* ------------------------------------------------------------------ *
 * Hands
 *
 * The pose model puts a single point at the wrist; the hand model gives all 21
 * joints. Using the knuckles as the strike point is both steadier and closer to
 * where a punch actually lands, and the fingers tell us whether the hand is
 * even closed.
 * ------------------------------------------------------------------ */

export const HAND = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexTip: 8,
  middleMcp: 9,
  middleTip: 12,
  ringMcp: 13,
  ringTip: 16,
  pinkyMcp: 17,
  pinkyTip: 20,
} as const;

/** The bones to draw, as landmark index pairs. */
export const HAND_BONES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export interface HandReading {
  /** Knuckle centroid in display space: the striking surface. */
  strike: Point2;
  wrist: Point2;
  /** All 21 joints in display space, for drawing. */
  points: Point2[];
  /** 0 is a tight fist, 1 is a flat open hand. */
  openness: number;
  /** Palm length in isotropic units; grows as the hand nears the camera. */
  palm: number;
}

/** Reads one hand. Returns null if the landmarks are unusable. */
export function readHand(landmarks: readonly Landmark[], aspect: number): HandReading | null {
  if (landmarks.length < 21 || !Number.isFinite(aspect) || aspect <= 0) return null;
  const points: Point2[] = [];
  for (let i = 0; i < 21; i += 1) {
    const point = at(landmarks, i);
    if (!point) return null;
    points.push(toDisplay(point));
  }

  const iso = (point: Point2): Point2 => ({ x: point.x * aspect, y: point.y });
  const knuckles = [HAND.indexMcp, HAND.middleMcp, HAND.ringMcp, HAND.pinkyMcp].map(
    (index) => points[index] as Point2
  );
  const strike = {
    x: knuckles.reduce((total, point) => total + point.x, 0) / knuckles.length,
    y: knuckles.reduce((total, point) => total + point.y, 0) / knuckles.length,
  };

  const wrist = points[HAND.wrist] as Point2;
  const palm = distance(iso(wrist), iso(points[HAND.middleMcp] as Point2));
  if (palm < 1e-6) return null;

  // A curled finger brings its tip back towards its own knuckle.
  const pairs: [number, number][] = [
    [HAND.indexTip, HAND.indexMcp],
    [HAND.middleTip, HAND.middleMcp],
    [HAND.ringTip, HAND.ringMcp],
    [HAND.pinkyTip, HAND.pinkyMcp],
  ];
  const spread =
    pairs.reduce(
      (total, [tip, mcp]) =>
        total + distance(iso(points[tip] as Point2), iso(points[mcp] as Point2)),
      0
    ) /
    pairs.length /
    palm;
  const openness = Math.max(0, Math.min(1, (spread - 0.3) / 0.5));

  return { strike, wrist, points, openness, palm };
}

/**
 * Swaps the pose model's single wrist point for the hand model's knuckles.
 * Reach and elbow angle stay as they were: those come from the body, and the
 * pose model's world landmarks read them better than the hand can.
 */
export function refineWithHand(frame: ArmFrame, hand: HandReading): ArmFrame {
  return {
    ...frame,
    screen: hand.strike,
    source: 'hand',
    local: {
      x: ((hand.strike.x - frame.shoulderScreen.x) * frame.aspect) / frame.scale,
      y: (hand.strike.y - frame.shoulderScreen.y) / frame.scale,
    },
  };
}

/** Matches detected hands to arms by which pose wrist each is nearest. */
export function matchHandsToArms(
  hands: readonly HandReading[],
  frames: { left: ArmFrame | null; right: ArmFrame | null }
): { left: HandReading | null; right: HandReading | null } {
  const result: { left: HandReading | null; right: HandReading | null } = {
    left: null,
    right: null,
  };
  let bestLeft = Infinity;
  let bestRight = Infinity;

  // Decided by position, never by the model's own left/right naming, which is
  // reported as though you were looking in a mirror.
  for (const hand of hands) {
    const toLeft = frames.left ? distance(hand.wrist, frames.left.screen) : Infinity;
    const toRight = frames.right ? distance(hand.wrist, frames.right.screen) : Infinity;
    if (toLeft <= toRight && toLeft < bestLeft && toLeft < 0.25) {
      bestLeft = toLeft;
      result.left = hand;
    } else if (toRight < toLeft && toRight < bestRight && toRight < 0.25) {
      bestRight = toRight;
      result.right = hand;
    }
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * Punch detection
 * ------------------------------------------------------------------ */

export interface Punch {
  arm: Arm;
  type: PunchType;
  /** 0..1, from how fast the arm was travelling. */
  power: number;
  speed: number;
  at: number;
  /** The swept path of the fist, so fast punches cannot pass through a target. */
  from: Point2;
  to: Point2;
  /** Unit vector of travel, in display space. */
  direction: Point2;
}

interface HistoryEntry {
  t: number;
  local: Point2;
  screen: Point2;
  reach: number;
}

export interface ArmTrackState {
  history: HistoryEntry[];
  /** No new punch from this arm until this time. */
  readyAt: number;
}

export function createArmState(): ArmTrackState {
  return { history: [], readyAt: 0 };
}

export interface ArmTrackers {
  left: ArmTrackState;
  right: ArmTrackState;
}

export function createTrackers(): ArmTrackers {
  return { left: createArmState(), right: createArmState() };
}

/** Frames older than this are dropped; ~3 frames at 30fps. */
const HISTORY_MS = 120;

/**
 * Decides which punch a movement was. A straight punch mostly extends the arm
 * (which barely moves on screen when it comes towards the camera), a hook
 * travels sideways with the elbow still bent, and an uppercut travels upwards.
 */
export function classifyPunch(
  velocity: Point2,
  extensionRate: number,
  elbowAngle: number
): PunchType {
  const lateral = Math.abs(velocity.x);
  const rising = -velocity.y;

  if (rising > lateral * 0.9 && rising > extensionRate * 0.55 && elbowAngle < 150) {
    return 'uppercut';
  }
  if (lateral > extensionRate * 0.8 && lateral > Math.abs(velocity.y) && elbowAngle < 155) {
    return 'hook';
  }
  return 'straight';
}

/**
 * Feeds one pose frame to one arm. Returns the punch if this frame is where a
 * punch started. Pure: the caller keeps the returned state.
 */
export function trackArm(
  state: ArmTrackState,
  arm: Arm,
  frame: ArmFrame | null,
  now: number,
  config: PunchConfig
): { state: ArmTrackState; punch: Punch | null } {
  if (!frame) return { state: { ...state, history: [] }, punch: null };

  const history = [...state.history, { t: now, local: frame.local, screen: frame.screen, reach: frame.reach }]
    .filter((entry) => now - entry.t <= HISTORY_MS);

  const oldest = history[0];
  const dt = oldest ? (now - oldest.t) / 1000 : 0;
  if (!oldest || dt < 0.016) return { state: { ...state, history }, punch: null };

  const velocity: Point2 = {
    x: (frame.local.x - oldest.local.x) / dt,
    y: (frame.local.y - oldest.local.y) / dt,
  };
  const speed = Math.hypot(velocity.x, velocity.y);
  const extensionRate = (frame.reach - oldest.reach) / dt;

  // A punch goes out, not back: either it travels fast or the arm is extending.
  const effort = Math.max(speed, extensionRate * 1.35);
  const outward = extensionRate > -0.25;

  if (now < state.readyAt || effort < config.triggerSpeed || !outward) {
    return { state: { ...state, history }, punch: null };
  }

  const direction =
    speed > 1e-4
      ? { x: velocity.x / speed, y: velocity.y / speed }
      : { x: 0, y: 0 };
  const power = Math.max(
    0,
    Math.min(1, (effort - config.triggerSpeed) / Math.max(1e-6, config.fullPowerSpeed - config.triggerSpeed))
  );

  const punch: Punch = {
    arm,
    type: classifyPunch(velocity, extensionRate, frame.elbowAngle),
    power,
    speed: effort,
    at: now,
    from: oldest.screen,
    to: frame.screen,
    direction,
  };

  return {
    state: { history, readyAt: now + config.refractoryMs },
    punch,
  };
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

/** Value modifier on top of whichever object the player chose to punch. */
export type TargetTier = 'normal' | 'tough' | 'gold';

export const BASE_POINTS: Record<TargetTier, number> = {
  normal: 50,
  tough: 80,
  gold: 200,
};

/** Variety pays: the awkward punches are worth more than a straight one. */
export const TYPE_BONUS: Record<PunchType, number> = {
  straight: 1,
  hook: 1.25,
  uppercut: 1.5,
};

/** Hits inside this fraction of the radius count as dead centre. */
export const PERFECT_OFFSET = 0.35;

/** Grows every third hit, capped so a long streak cannot run away with it. */
export function comboMultiplier(combo: number): number {
  return Math.min(4, 1 + Math.floor(Math.max(0, combo) / 3) * 0.5);
}

export interface ScoreBreakdown {
  base: number;
  power: number;
  type: number;
  combo: number;
  perfect: boolean;
  total: number;
}

export function scoreHit(
  tier: TargetTier,
  punch: Punch,
  combo: number,
  offset: number
): ScoreBreakdown {
  const base = BASE_POINTS[tier];
  const power = 1 + punch.power;
  const type = TYPE_BONUS[punch.type];
  const multiplier = comboMultiplier(combo);
  const perfect = offset <= PERFECT_OFFSET;
  const total = Math.round(base * power * type * multiplier * (perfect ? 1.5 : 1));
  return { base, power, type, combo: multiplier, perfect, total };
}

/** Wording for the on-screen pop-up. Never about trying harder. */
export function punchLabel(type: PunchType): string {
  switch (type) {
    case 'straight':
      return 'STRAIGHT';
    case 'hook':
      return 'HOOK';
    case 'uppercut':
      return 'UPPERCUT';
  }
}
