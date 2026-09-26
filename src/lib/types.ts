/** Shared shapes. Kept free of MediaPipe imports so metrics stay easy to test. */

export type Side = 'left' | 'right';

export interface Sided<T> {
  left: T;
  right: T;
}

export interface Point2 {
  x: number;
  y: number;
}

/** A normalized MediaPipe landmark (x, y in 0..1 of the image; z roughly x-scaled). */
export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

/** Approximate head rotation in degrees. */
export interface HeadPose {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * One analysed video frame. `aspect` is videoWidth / videoHeight and is needed
 * because normalized landmark coordinates are stretched by the frame's shape.
 */
export interface FaceSample {
  t: number;
  landmarks: Landmark[];
  blendshapes: Record<string, number>;
  headPose: HeadPose | null;
  aspect: number;
}

/**
 * Which raw values belong to which side of the *user's own* face.
 *
 * Both default to false and can be flipped from the debug panel. See
 * docs in README: blendshape naming follows the ARKit convention (the
 * tracked person's own left), and in an unmirrored camera frame the user's
 * left side has the larger x. Either assumption breaks if a webcam or its
 * driver already mirrors the feed, so both are adjustable.
 */
export interface SideConfig {
  swapBlendshapes: boolean;
  swapLandmarks: boolean;
}

export const DEFAULT_SIDE_CONFIG: SideConfig = {
  swapBlendshapes: false,
  swapLandmarks: false,
};

export type SymmetryStatus = 'ok' | 'insufficient';

export interface SymmetryOutcome {
  status: SymmetryStatus;
  /** 0-100, or null when there was not enough movement to judge. */
  score: number | null;
  ratio: number | null;
  strongerSide: Side | null;
  weakerSide: Side | null;
}

/** One repetition's measurement, averaged over its hold phase. */
export interface RepMeasurement {
  rep: number;
  movement: Sided<number>;
  raw: Sided<number>;
  /** Companion movement used for synkinesis checks (eye or mouth). */
  companion: Sided<number>;
  samples: number;
  symmetry: SymmetryOutcome;
}

export interface SynkinesisFinding {
  side: Side;
  /** Short sentence shown to the user. */
  label: string;
  magnitude: number;
}

export interface ExerciseResult {
  exerciseId: string;
  status: SymmetryStatus | 'skipped';
  score: number | null;
  movement: Sided<number>;
  weakerSide: Side | null;
  reps: RepMeasurement[];
  validReps: number;
  synkinesis: SynkinesisFinding[];
}

export interface SessionRecord {
  id: string;
  /** ISO timestamps. */
  startedAt: string;
  endedAt: string;
  overallScore: number | null;
  exercises: ExerciseResult[];
  sideConfig: SideConfig;
  schemaVersion: number;
}

/* ------------------------------------------------------------------ *
 * Exercise definitions (data only - see src/lib/exercises.ts)
 * ------------------------------------------------------------------ */

export type SignalDirection = 'increase' | 'decrease';

/**
 * How to read one exercise's movement separately for each side.
 *
 * `blendshape` uses MediaPipe's sided blendshape scores (0..1).
 * `midlineDistance` measures each group of landmarks' mean lateral distance
 * from the facial midline, in units of inter-ocular distance - used where no
 * sided blendshape exists (pucker, cheek puff).
 */
export type SidedSignalSpec =
  | { kind: 'blendshape'; left: string; right: string }
  | { kind: 'midlineDistance'; groups: [number[], number[]] };

/** Unwanted co-movement to watch for while an exercise is held. */
export interface SynkinesisSpec {
  /** Which other region to watch on the same side. */
  companion: 'eye' | 'mouth' | 'none';
  threshold: number;
  /** Completed as "Your left <label>" in the results. */
  label: string;
}

export interface ExerciseTiming {
  introMs: number;
  moveMs: number;
  holdMs: number;
  relaxMs: number;
}

export interface ExerciseDef {
  id: string;
  name: string;
  /** Two or three words, shown large during the movement. */
  cue: string;
  how: string[];
  reps: number;
  timing: ExerciseTiming;
  signal: SidedSignalSpec;
  direction: SignalDirection;
  /** Below this much movement on both sides we report "not enough movement". */
  minMovement: number;
  /** Signal value treated as a full bar in the live display. */
  displayScale: number;
  /** Landmarks to highlight on the video overlay. Defaults to the landmarks
   *  the signal itself uses, which is already right for midlineDistance. */
  focusPoints?: number[];
  synkinesis: SynkinesisSpec;
}
