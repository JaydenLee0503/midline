/**
 * All measurement logic lives here as pure functions, so it can be unit tested
 * without a camera, a browser, or MediaPipe.
 *
 * Conventions used throughout:
 *  - "left" and "right" always mean the *user's own* left and right.
 *  - Landmark coordinates arrive normalized to the video frame (0..1), so they
 *    are stretched horizontally by the frame's aspect ratio. Everything below
 *    first converts to an isotropic space (x * aspect, y).
 *  - Distances are divided by inter-ocular distance, so moving closer to or
 *    further from the camera does not change the numbers.
 */
import type {
  ExerciseDef,
  ExerciseResult,
  FaceSample,
  HeadPose,
  Landmark,
  Point2,
  RepMeasurement,
  Side,
  SideConfig,
  SidedSignalSpec,
  Sided,
  SignalDirection,
  SymmetryOutcome,
  SynkinesisFinding,
} from './types';

/* ------------------------------------------------------------------ *
 * Landmark indices (MediaPipe canonical face mesh)
 * ------------------------------------------------------------------ */

/** Centre of the forehead - on the midline and unaffected by expression. */
export const MIDLINE_TOP = 10;
/** Bottom of the chin - also on the midline; gives the midline a long baseline. */
export const MIDLINE_BOTTOM = 152;
/** The two outer eye corners. Their separation is our scale reference. */
export const OUTER_CANTHI: readonly [number, number] = [33, 263];
/** The two mouth corners. */
export const MOUTH_CORNERS: readonly [number, number] = [61, 291];
/** Mid-cheek points on the face outline, one group per side. */
export const CHEEK_GROUPS: [number[], number[]] = [
  [93, 132, 58],
  [323, 361, 288],
];

export const MIN_REP_SAMPLES = 5;

/** How far the head may stray from its calibrated neutral before we stop measuring. */
export const DEFAULT_POSE_LIMITS = { yaw: 13, pitch: 13, roll: 13 };
/**
 * Looser limits used before a baseline exists. A camera below eye level gives
 * every frame a constant pitch offset, so an absolute gate has to be generous;
 * once calibration has recorded the user's neutral pose we compare against that
 * instead, which is both tighter and fairer.
 */
export const CALIBRATION_POSE_LIMITS = { yaw: 22, pitch: 22, roll: 22 };

/* ------------------------------------------------------------------ *
 * Small numeric helpers
 * ------------------------------------------------------------------ */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const v of values) total += v;
  return total / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Exponential moving average. Pass null for `previous` on the first sample. */
export function ema(previous: number | null, next: number, alpha: number): number {
  if (previous === null || !Number.isFinite(previous)) return next;
  const a = clamp(alpha, 0, 1);
  return previous + a * (next - previous);
}

export function otherSide(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

function meanSided(values: readonly Sided<number>[]): Sided<number> | null {
  if (values.length === 0) return null;
  const left = mean(values.map((v) => v.left));
  const right = mean(values.map((v) => v.right));
  return left === null || right === null ? null : { left, right };
}

function medianSided(values: readonly Sided<number>[]): Sided<number> {
  return {
    left: median(values.map((v) => v.left)) ?? 0,
    right: median(values.map((v) => v.right)) ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 * Face geometry
 * ------------------------------------------------------------------ */

/** A point expressed in face-local units: `u` down the face, `v` sideways. */
export interface FaceLocalPoint {
  /** Along the midline, positive towards the chin, in inter-ocular units. */
  u: number;
  /** Away from the midline, positive towards the user's LEFT. */
  v: number;
}

export interface FaceGeometry {
  origin: Point2;
  /** Unit vector from forehead to chin. */
  down: Point2;
  /** Unit vector perpendicular to `down`, pointing to the user's left. */
  lateral: Point2;
  /** Inter-ocular distance in isotropic units. */
  scale: number;
  aspect: number;
}

function landmarkAt(landmarks: readonly Landmark[], index: number): Landmark | null {
  const point = landmarks[index];
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return point;
}

function iso(point: Landmark, aspect: number): Point2 {
  return { x: point.x * aspect, y: point.y };
}

function dot(a: Point2, b: Point2): number {
  return a.x * b.x + a.y * b.y;
}

function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Builds the face-local coordinate frame for one set of landmarks.
 * Returns null when the landmarks we depend on are missing or degenerate.
 */
export function faceGeometry(
  landmarks: readonly Landmark[],
  aspect: number,
  config: SideConfig
): FaceGeometry | null {
  const top = landmarkAt(landmarks, MIDLINE_TOP);
  const bottom = landmarkAt(landmarks, MIDLINE_BOTTOM);
  const eyeA = landmarkAt(landmarks, OUTER_CANTHI[0]);
  const eyeB = landmarkAt(landmarks, OUTER_CANTHI[1]);
  if (!top || !bottom || !eyeA || !eyeB) return null;
  if (!Number.isFinite(aspect) || aspect <= 0) return null;

  const origin = iso(top, aspect);
  const chin = iso(bottom, aspect);
  const length = distance(origin, chin);
  if (length < 1e-6) return null;
  const down: Point2 = { x: (chin.x - origin.x) / length, y: (chin.y - origin.y) / length };

  const scale = distance(iso(eyeA, aspect), iso(eyeB, aspect));
  if (scale < 1e-6) return null;

  // Rotating `down` by -90 degrees gives +x for an upright face, which is the
  // user's left in an unmirrored camera frame (we look at them face to face).
  const sign = config.swapLandmarks ? -1 : 1;
  const lateral: Point2 = { x: down.y * sign, y: -down.x * sign };

  return { origin, down, lateral, scale, aspect };
}

/** Expresses a landmark in the face-local frame. */
export function toFaceLocal(point: Landmark, geometry: FaceGeometry): FaceLocalPoint {
  const offset: Point2 = {
    x: point.x * geometry.aspect - geometry.origin.x,
    y: point.y - geometry.origin.y,
  };
  return {
    u: dot(offset, geometry.down) / geometry.scale,
    v: dot(offset, geometry.lateral) / geometry.scale,
  };
}

function groupCentre(
  landmarks: readonly Landmark[],
  indices: readonly number[],
  geometry: FaceGeometry
): FaceLocalPoint | null {
  const points: FaceLocalPoint[] = [];
  for (const index of indices) {
    const point = landmarkAt(landmarks, index);
    if (point) points.push(toFaceLocal(point, geometry));
  }
  if (points.length === 0) return null;
  return {
    u: mean(points.map((p) => p.u)) ?? 0,
    v: mean(points.map((p) => p.v)) ?? 0,
  };
}

/**
 * Splits two landmark groups into sides by which side of the midline they sit
 * on, and returns each one's distance from the midline. Deciding by position
 * rather than by index means we never depend on remembering which canonical
 * index is which.
 */
export function sidedMidlineDistance(
  landmarks: readonly Landmark[],
  groups: readonly [readonly number[], readonly number[]],
  geometry: FaceGeometry
): Sided<number> | null {
  const a = groupCentre(landmarks, groups[0], geometry);
  const b = groupCentre(landmarks, groups[1], geometry);
  if (!a || !b) return null;
  const [leftPoint, rightPoint] = a.v >= b.v ? [a, b] : [b, a];
  return { left: Math.abs(leftPoint.v), right: Math.abs(rightPoint.v) };
}

/** The two mouth corners in face-local coordinates, split by side. */
export function sidedMouthCorners(
  landmarks: readonly Landmark[],
  geometry: FaceGeometry
): Sided<FaceLocalPoint> | null {
  const a = landmarkAt(landmarks, MOUTH_CORNERS[0]);
  const b = landmarkAt(landmarks, MOUTH_CORNERS[1]);
  if (!a || !b) return null;
  const localA = toFaceLocal(a, geometry);
  const localB = toFaceLocal(b, geometry);
  return localA.v >= localB.v ? { left: localA, right: localB } : { left: localB, right: localA };
}

/* ------------------------------------------------------------------ *
 * Head pose
 * ------------------------------------------------------------------ */

/**
 * Approximate yaw / pitch / roll in degrees from MediaPipe's facial
 * transformation matrix (16 values, column major). The exact sign convention
 * does not matter here: we only use magnitudes, to ignore frames where the
 * head is turned or tilted.
 */
export function headPoseFromMatrix(data: readonly number[] | Float32Array | undefined): HeadPose | null {
  if (!data || data.length < 16) return null;
  const at = (row: number, col: number): number => data[col * 4 + row] as number;
  for (let i = 0; i < 16; i += 1) {
    if (!Number.isFinite(data[i] as number)) return null;
  }

  const r00 = at(0, 0);
  const r10 = at(1, 0);
  const r20 = at(2, 0);
  const r21 = at(2, 1);
  const r22 = at(2, 2);
  const r11 = at(1, 1);
  const r12 = at(1, 2);

  const sy = Math.hypot(r00, r10);
  const degrees = 180 / Math.PI;
  if (sy > 1e-6) {
    return {
      pitch: Math.atan2(r21, r22) * degrees,
      yaw: Math.atan2(-r20, sy) * degrees,
      roll: Math.atan2(r10, r00) * degrees,
    };
  }
  return {
    pitch: Math.atan2(-r12, r11) * degrees,
    yaw: Math.atan2(-r20, sy) * degrees,
    roll: 0,
  };
}

export type PoseProblem = 'turned' | 'tilted' | 'nodding';

/**
 * Which alignment problem (if any) should stop us measuring this frame.
 * A missing pose is treated as acceptable - we would rather measure than nag.
 */
export function poseProblem(
  pose: HeadPose | null,
  limits: { yaw: number; pitch: number; roll: number } = DEFAULT_POSE_LIMITS,
  /** The user's calibrated neutral pose; omit to measure against dead ahead. */
  reference: HeadPose | null = null
): PoseProblem | null {
  if (!pose) return null;
  const yaw = pose.yaw - (reference?.yaw ?? 0);
  const pitch = pose.pitch - (reference?.pitch ?? 0);
  const roll = pose.roll - (reference?.roll ?? 0);
  if (Math.abs(yaw) > limits.yaw) return 'turned';
  if (Math.abs(pitch) > limits.pitch) return 'nodding';
  if (Math.abs(roll) > limits.roll) return 'tilted';
  return null;
}

export function isHeadAligned(
  pose: HeadPose | null,
  limits: { yaw: number; pitch: number; roll: number } = DEFAULT_POSE_LIMITS,
  reference: HeadPose | null = null
): boolean {
  return poseProblem(pose, limits, reference) === null;
}

/* ------------------------------------------------------------------ *
 * Reading one exercise's signal
 * ------------------------------------------------------------------ */

/** Looks up a pair of sided blendshapes, honouring the side mapping toggle. */
export function sidedBlendshape(
  blendshapes: Readonly<Record<string, number>>,
  leftName: string,
  rightName: string,
  config: SideConfig
): Sided<number> {
  const forLeft = config.swapBlendshapes ? rightName : leftName;
  const forRight = config.swapBlendshapes ? leftName : rightName;
  return {
    left: blendshapes[forLeft] ?? 0,
    right: blendshapes[forRight] ?? 0,
  };
}

/** Reads an exercise's raw per-side value from one frame. */
export function measureSides(
  spec: SidedSignalSpec,
  sample: FaceSample,
  geometry: FaceGeometry,
  config: SideConfig
): Sided<number> | null {
  if (spec.kind === 'blendshape') {
    return sidedBlendshape(sample.blendshapes, spec.left, spec.right, config);
  }
  return sidedMidlineDistance(sample.landmarks, spec.groups, geometry);
}

/**
 * Movement is always the distance travelled away from the neutral baseline, in
 * the direction the exercise expects. Movement the other way counts as zero
 * rather than as negative movement.
 */
export function movementFromBaseline(
  raw: Sided<number>,
  baseline: Sided<number>,
  direction: SignalDirection
): Sided<number> {
  const delta = (current: number, neutral: number): number =>
    Math.max(0, direction === 'increase' ? current - neutral : neutral - current);
  return {
    left: delta(raw.left, baseline.left),
    right: delta(raw.right, baseline.right),
  };
}

const INSUFFICIENT: SymmetryOutcome = {
  status: 'insufficient',
  score: null,
  ratio: null,
  strongerSide: null,
  weakerSide: null,
};

/**
 * Symmetry as smaller side / larger side on a 0-100 scale.
 * When neither side moved meaningfully there is nothing to compare, so we say
 * so instead of reporting the flattering score that tiny noisy numbers give.
 */
export function symmetryFrom(movement: Sided<number>, minMovement: number): SymmetryOutcome {
  const larger = Math.max(movement.left, movement.right);
  const smaller = Math.min(movement.left, movement.right);
  if (!Number.isFinite(larger) || larger <= 0 || larger < minMovement) return INSUFFICIENT;

  const ratio = clamp(smaller / larger, 0, 1);
  const strongerSide: Side | null =
    movement.left === movement.right ? null : movement.left > movement.right ? 'left' : 'right';
  return {
    status: 'ok',
    score: Math.round(ratio * 100),
    ratio,
    strongerSide,
    weakerSide: strongerSide ? otherSide(strongerSide) : null,
  };
}

/* ------------------------------------------------------------------ *
 * Baseline (calibration)
 * ------------------------------------------------------------------ */

export interface Baseline {
  /** Mean score of every blendshape seen while relaxed. */
  blendshapes: Record<string, number>;
  /** Mean raw sided signal per exercise id, in that exercise's own units. */
  signals: Record<string, Sided<number>>;
  /** Mean relaxed mouth-corner position per side, for synkinesis checks. */
  mouthCorners: Sided<FaceLocalPoint>;
  /** The head pose the user naturally holds, used as the alignment reference. */
  headPose: HeadPose | null;
  samples: number;
}

/**
 * Averages a run of relaxed frames into the baseline for this session.
 * Frames whose geometry cannot be built are skipped; null means none were usable.
 */
export function buildBaseline(
  samples: readonly FaceSample[],
  exercises: readonly ExerciseDef[],
  config: SideConfig
): Baseline | null {
  const blendshapeTotals = new Map<string, { total: number; count: number }>();
  const signalSamples = new Map<string, Sided<number>[]>();
  const corners: Sided<FaceLocalPoint>[] = [];
  const poses: HeadPose[] = [];
  let used = 0;

  for (const sample of samples) {
    const geometry = faceGeometry(sample.landmarks, sample.aspect, config);
    if (!geometry) continue;
    used += 1;

    for (const [name, score] of Object.entries(sample.blendshapes)) {
      const entry = blendshapeTotals.get(name) ?? { total: 0, count: 0 };
      entry.total += score;
      entry.count += 1;
      blendshapeTotals.set(name, entry);
    }

    for (const exercise of exercises) {
      const raw = measureSides(exercise.signal, sample, geometry, config);
      if (!raw) continue;
      const list = signalSamples.get(exercise.id) ?? [];
      list.push(raw);
      signalSamples.set(exercise.id, list);
    }

    const mouth = sidedMouthCorners(sample.landmarks, geometry);
    if (mouth) corners.push(mouth);
    if (sample.headPose) poses.push(sample.headPose);
  }

  if (used === 0) return null;

  const blendshapes: Record<string, number> = {};
  for (const [name, { total, count }] of blendshapeTotals) blendshapes[name] = total / count;

  const signals: Record<string, Sided<number>> = {};
  for (const [id, list] of signalSamples) {
    const averaged = meanSided(list);
    if (averaged) signals[id] = averaged;
  }

  const mouthCorners: Sided<FaceLocalPoint> = {
    left: {
      u: mean(corners.map((c) => c.left.u)) ?? 0,
      v: mean(corners.map((c) => c.left.v)) ?? 0,
    },
    right: {
      u: mean(corners.map((c) => c.right.u)) ?? 0,
      v: mean(corners.map((c) => c.right.v)) ?? 0,
    },
  };

  const headPose: HeadPose | null =
    poses.length === 0
      ? null
      : {
          yaw: mean(poses.map((pose) => pose.yaw)) ?? 0,
          pitch: mean(poses.map((pose) => pose.pitch)) ?? 0,
          roll: mean(poses.map((pose) => pose.roll)) ?? 0,
        };

  return { blendshapes, signals, mouthCorners, headPose, samples: used };
}

/* ------------------------------------------------------------------ *
 * Synkinesis companions
 * ------------------------------------------------------------------ */

/** Blink rise above the relaxed baseline, per side. */
export function eyeActivation(
  sample: FaceSample,
  baseline: Baseline,
  config: SideConfig
): Sided<number> {
  const now = sidedBlendshape(sample.blendshapes, 'eyeBlinkLeft', 'eyeBlinkRight', config);
  const rest = sidedBlendshape(baseline.blendshapes, 'eyeBlinkLeft', 'eyeBlinkRight', config);
  return {
    left: Math.max(0, now.left - rest.left),
    right: Math.max(0, now.right - rest.right),
  };
}

/** How far each mouth corner has moved from its relaxed position. */
export function mouthCornerShift(
  sample: FaceSample,
  geometry: FaceGeometry,
  baseline: Baseline
): Sided<number> {
  const corners = sidedMouthCorners(sample.landmarks, geometry);
  if (!corners) return { left: 0, right: 0 };
  const shift = (now: FaceLocalPoint, rest: FaceLocalPoint): number =>
    Math.hypot(now.u - rest.u, now.v - rest.v);
  return {
    left: shift(corners.left, baseline.mouthCorners.left),
    right: shift(corners.right, baseline.mouthCorners.right),
  };
}

function companionValue(
  exercise: ExerciseDef,
  sample: FaceSample,
  geometry: FaceGeometry,
  baseline: Baseline,
  config: SideConfig
): Sided<number> {
  switch (exercise.synkinesis.companion) {
    case 'eye':
      return eyeActivation(sample, baseline, config);
    case 'mouth':
      return mouthCornerShift(sample, geometry, baseline);
    case 'none':
      return { left: 0, right: 0 };
  }
}

/* ------------------------------------------------------------------ *
 * Reps and results
 * ------------------------------------------------------------------ */

const ZERO: Sided<number> = { left: 0, right: 0 };

/**
 * Measures one repetition from the frames captured during its hold phase.
 * Everything is averaged over the hold, so a single jittery frame cannot
 * decide a score.
 */
export function measureRep(
  repNumber: number,
  holdSamples: readonly FaceSample[],
  exercise: ExerciseDef,
  baseline: Baseline,
  config: SideConfig
): RepMeasurement {
  const raws: Sided<number>[] = [];
  const companions: Sided<number>[] = [];

  for (const sample of holdSamples) {
    const geometry = faceGeometry(sample.landmarks, sample.aspect, config);
    if (!geometry) continue;
    const raw = measureSides(exercise.signal, sample, geometry, config);
    if (!raw) continue;
    raws.push(raw);
    companions.push(companionValue(exercise, sample, geometry, baseline, config));
  }

  const neutral = baseline.signals[exercise.id];
  const raw = meanSided(raws);
  const companion = meanSided(companions) ?? ZERO;

  if (!neutral || !raw || raws.length < MIN_REP_SAMPLES) {
    return {
      rep: repNumber,
      raw: raw ?? ZERO,
      movement: ZERO,
      companion,
      samples: raws.length,
      symmetry: INSUFFICIENT,
    };
  }

  const movement = movementFromBaseline(raw, neutral, exercise.direction);
  return {
    rep: repNumber,
    raw,
    movement,
    companion,
    samples: raws.length,
    symmetry: symmetryFrom(movement, exercise.minMovement),
  };
}

/** Flags a side whose companion region moved more than the exercise allows. */
export function findSynkinesis(
  exercise: ExerciseDef,
  reps: readonly RepMeasurement[]
): SynkinesisFinding[] {
  if (exercise.synkinesis.companion === 'none') return [];
  // Only meaningful for reps where the intended movement actually happened.
  const usable = reps.filter((rep) => rep.symmetry.status === 'ok');
  if (usable.length === 0) return [];

  const findings: SynkinesisFinding[] = [];
  for (const side of ['left', 'right'] as const) {
    const magnitude = median(usable.map((rep) => rep.companion[side])) ?? 0;
    if (magnitude > exercise.synkinesis.threshold) {
      findings.push({ side, label: exercise.synkinesis.label, magnitude });
    }
  }
  return findings;
}

/**
 * Combines an exercise's reps into one result. The median rep is used rather
 * than the mean so one bad rep (a cough, a look away) cannot dominate.
 */
export function summariseExercise(
  exercise: ExerciseDef,
  reps: readonly RepMeasurement[]
): ExerciseResult {
  const valid = reps.filter((rep) => rep.symmetry.status === 'ok');
  const scores = valid
    .map((rep) => rep.symmetry.score)
    .filter((score): score is number => score !== null);
  const score = scores.length > 0 ? Math.round(median(scores) ?? 0) : null;
  const movement = medianSided((valid.length > 0 ? valid : reps).map((rep) => rep.movement));

  let weakerSide: Side | null = null;
  if (score !== null && movement.left !== movement.right) {
    weakerSide = movement.left < movement.right ? 'left' : 'right';
  }

  return {
    exerciseId: exercise.id,
    status: reps.length === 0 ? 'skipped' : score !== null ? 'ok' : 'insufficient',
    score,
    movement,
    weakerSide,
    reps: [...reps],
    validReps: valid.length,
    synkinesis: findSynkinesis(exercise, reps),
  };
}

/** Mean of the exercises we could actually score. */
export function overallScore(results: readonly ExerciseResult[]): number | null {
  const scores = results
    .map((result) => result.score)
    .filter((score): score is number => score !== null);
  if (scores.length === 0) return null;
  return Math.round(mean(scores) ?? 0);
}

/* ------------------------------------------------------------------ *
 * Live display helpers
 * ------------------------------------------------------------------ */

export interface LiveReading {
  raw: Sided<number>;
  movement: Sided<number>;
  /** 0..1 per side, for the on-screen bars. */
  fill: Sided<number>;
}

/** Per-frame reading used to drive the live left-vs-right bars. */
export function liveReading(
  sample: FaceSample,
  exercise: ExerciseDef,
  baseline: Baseline | null,
  config: SideConfig
): LiveReading | null {
  const geometry = faceGeometry(sample.landmarks, sample.aspect, config);
  if (!geometry) return null;
  const raw = measureSides(exercise.signal, sample, geometry, config);
  if (!raw) return null;
  const neutral = baseline?.signals[exercise.id];
  const movement = neutral ? movementFromBaseline(raw, neutral, exercise.direction) : ZERO;
  const scale = exercise.displayScale > 0 ? exercise.displayScale : 1;
  return {
    raw,
    movement,
    fill: {
      left: clamp(movement.left / scale, 0, 1),
      right: clamp(movement.right / scale, 0, 1),
    },
  };
}

/** Score band used for wording and colour. Never colour alone. */
export function scoreBand(score: number | null): 'unknown' | 'low' | 'moderate' | 'strong' {
  if (score === null) return 'unknown';
  if (score >= 80) return 'strong';
  if (score >= 55) return 'moderate';
  return 'low';
}
