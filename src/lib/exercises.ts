/**
 * The exercise programme, defined as data. Adding an exercise means adding an
 * entry here - no changes to the session engine or the screens.
 *
 * On the numbers: `minMovement` and the synkinesis `threshold` are starting
 * points, chosen to be forgiving. They are in each signal's own units
 * (blendshape scores are 0..1; midline distances are fractions of inter-ocular
 * distance). Turn on the debug panel during a session to see the raw values for
 * a given face and camera, and tune here.
 */
import { CHEEK_GROUPS, MOUTH_CORNERS } from './metrics';
import { BROW_POINTS, EYE_POINTS, LIP_POINTS } from './overlay';
import type { ExerciseDef, ExerciseTiming } from './types';

/** Slow and unhurried: rehab values control, not effort. */
export const DEFAULT_TIMING: ExerciseTiming = {
  introMs: 6000,
  moveMs: 2000,
  holdMs: 3000,
  relaxMs: 2500,
};

export const EXERCISES: ExerciseDef[] = [
  {
    id: 'brow-raise',
    name: 'Eyebrow raise',
    cue: 'Raise your eyebrows',
    how: [
      'Look straight at the camera.',
      'Lift both eyebrows gently, as if mildly surprised.',
      'Hold, then let them settle back down.',
    ],
    reps: 5,
    timing: DEFAULT_TIMING,
    signal: { kind: 'blendshape', left: 'browOuterUpLeft', right: 'browOuterUpRight' },
    direction: 'increase',
    minMovement: 0.08,
    displayScale: 0.5,
    focusPoints: [...BROW_POINTS],
    synkinesis: { companion: 'none', threshold: 1, label: '' },
  },
  {
    id: 'eye-closure',
    name: 'Gentle eye closure',
    cue: 'Close your eyes gently',
    how: [
      'Let your face relax first.',
      'Close both eyes softly - no squeezing.',
      'Hold, then open slowly.',
    ],
    reps: 5,
    timing: DEFAULT_TIMING,
    signal: { kind: 'blendshape', left: 'eyeBlinkLeft', right: 'eyeBlinkRight' },
    direction: 'increase',
    minMovement: 0.2,
    displayScale: 0.85,
    focusPoints: [...EYE_POINTS],
    synkinesis: {
      companion: 'mouth',
      threshold: 0.035,
      label: 'mouth corner moved while your eyes were closing',
    },
  },
  {
    id: 'smile-closed',
    name: 'Closed-lip smile',
    cue: 'Smile, lips together',
    how: [
      'Keep your lips lightly together.',
      'Smile gently towards your ears.',
      'Hold, then relax your mouth.',
    ],
    reps: 5,
    timing: DEFAULT_TIMING,
    signal: { kind: 'blendshape', left: 'mouthSmileLeft', right: 'mouthSmileRight' },
    direction: 'increase',
    minMovement: 0.07,
    displayScale: 0.6,
    focusPoints: [...LIP_POINTS],
    synkinesis: {
      companion: 'eye',
      threshold: 0.18,
      label: 'eye narrowed while you were smiling',
    },
  },
  {
    id: 'pucker',
    name: 'Pucker',
    cue: 'Pucker your lips',
    how: [
      'Bring your lips forward into a small "oo" shape.',
      'Keep it gentle and even.',
      'Hold, then relax.',
    ],
    reps: 5,
    timing: DEFAULT_TIMING,
    // No sided pucker blendshape exists, so we measure how far each mouth
    // corner pulls in towards the midline.
    signal: { kind: 'midlineDistance', groups: [[MOUTH_CORNERS[0]], [MOUTH_CORNERS[1]]] },
    direction: 'decrease',
    minMovement: 0.03,
    displayScale: 0.12,
    synkinesis: {
      companion: 'eye',
      threshold: 0.18,
      label: 'eye narrowed while you were puckering',
    },
  },
  {
    id: 'cheek-puff',
    name: 'Cheek puff',
    cue: 'Puff out your cheeks',
    how: [
      'Take a comfortable breath and close your lips.',
      'Puff both cheeks out gently - no straining.',
      'Hold, then let the air out slowly.',
    ],
    reps: 5,
    timing: DEFAULT_TIMING,
    // cheekPuff is also unsided, so we measure how far each cheek's outline
    // bulges away from the midline.
    signal: { kind: 'midlineDistance', groups: CHEEK_GROUPS },
    direction: 'increase',
    minMovement: 0.012,
    displayScale: 0.05,
    synkinesis: { companion: 'none', threshold: 1, label: '' },
  },
];

export const EXERCISES_BY_ID: Record<string, ExerciseDef> = Object.fromEntries(
  EXERCISES.map((exercise) => [exercise.id, exercise])
);

export function exerciseName(id: string): string {
  return EXERCISES_BY_ID[id]?.name ?? id;
}

/** How long a full session takes, in ms - used for the "about N minutes" hint. */
export function estimatedSessionMs(exercises: readonly ExerciseDef[] = EXERCISES): number {
  return exercises.reduce((total, exercise) => {
    const { introMs, moveMs, holdMs, relaxMs } = exercise.timing;
    return total + introMs + exercise.reps * (moveMs + holdMs + relaxMs);
  }, 0);
}

/** Which landmarks to highlight on the video while an exercise is running. */
export function focusPoints(exercise: ExerciseDef): readonly number[] {
  if (exercise.focusPoints) return exercise.focusPoints;
  if (exercise.signal.kind === 'midlineDistance') return exercise.signal.groups.flat();
  return [];
}
