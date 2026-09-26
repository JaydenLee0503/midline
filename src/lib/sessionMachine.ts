/**
 * The rep/phase clock, as a pure function of elapsed time. Keeping it pure
 * means the whole session flow is unit testable, and the React layer only has
 * to render whatever state it is handed.
 */
import { clamp } from './metrics';
import type { ExerciseDef } from './types';

export type Phase = 'intro' | 'move' | 'hold' | 'relax';

export interface RunState {
  exerciseIndex: number;
  /** 0-based index of the rep in progress. */
  repIndex: number;
  phase: Phase;
  /** Time spent in the current phase. */
  elapsedMs: number;
  finished: boolean;
}

export type RunEvent =
  | { type: 'phaseEnter'; phase: Phase; exerciseIndex: number; repIndex: number }
  | { type: 'holdEnd'; exerciseIndex: number; repIndex: number }
  | { type: 'exerciseEnd'; exerciseIndex: number }
  | { type: 'sessionEnd' };

/** A single tick never advances more than this, so a backgrounded tab cannot
 *  fast-forward through a whole exercise. */
export const MAX_TICK_MS = 400;

export function createRunState(): RunState {
  return { exerciseIndex: 0, repIndex: 0, phase: 'intro', elapsedMs: 0, finished: false };
}

export function phaseDuration(exercise: ExerciseDef, phase: Phase): number {
  switch (phase) {
    case 'intro':
      return exercise.timing.introMs;
    case 'move':
      return exercise.timing.moveMs;
    case 'hold':
      return exercise.timing.holdMs;
    case 'relax':
      return exercise.timing.relaxMs;
  }
}

/** Whether this phase needs usable measurements to progress. */
export function phaseNeedsFace(phase: Phase): boolean {
  return phase === 'move' || phase === 'hold';
}

export function phaseRemainingMs(state: RunState, exercises: readonly ExerciseDef[]): number {
  const exercise = exercises[state.exerciseIndex];
  if (!exercise || state.finished) return 0;
  return Math.max(0, phaseDuration(exercise, state.phase) - state.elapsedMs);
}

/** Whole seconds left in the phase, for the on-screen countdown. */
export function phaseCountdown(state: RunState, exercises: readonly ExerciseDef[]): number {
  return Math.ceil(phaseRemainingMs(state, exercises) / 1000);
}

function enter(
  phase: Phase,
  exerciseIndex: number,
  repIndex: number,
  events: RunEvent[]
): RunState {
  events.push({ type: 'phaseEnter', phase, exerciseIndex, repIndex });
  return { exerciseIndex, repIndex, phase, elapsedMs: 0, finished: false };
}

function finish(events: RunEvent[], state: RunState): RunState {
  events.push({ type: 'sessionEnd' });
  return { ...state, phase: 'relax', elapsedMs: 0, finished: true };
}

/** Moves from the end of one phase to the start of the next. */
function step(state: RunState, exercises: readonly ExerciseDef[], events: RunEvent[]): RunState {
  const exercise = exercises[state.exerciseIndex];
  if (!exercise) return finish(events, state);

  switch (state.phase) {
    case 'intro':
      return enter('move', state.exerciseIndex, 0, events);
    case 'move':
      return enter('hold', state.exerciseIndex, state.repIndex, events);
    case 'hold':
      events.push({
        type: 'holdEnd',
        exerciseIndex: state.exerciseIndex,
        repIndex: state.repIndex,
      });
      return enter('relax', state.exerciseIndex, state.repIndex, events);
    case 'relax': {
      const nextRep = state.repIndex + 1;
      if (nextRep < exercise.reps) {
        return enter('move', state.exerciseIndex, nextRep, events);
      }
      events.push({ type: 'exerciseEnd', exerciseIndex: state.exerciseIndex });
      const nextExercise = state.exerciseIndex + 1;
      if (nextExercise >= exercises.length) return finish(events, state);
      return enter('intro', nextExercise, 0, events);
    }
  }
}

/**
 * Advances the clock. `deltaMs` should be 0 when the phase needs a usable
 * measurement and the current frame is not usable - the countdown then waits
 * for the user instead of running out while they reposition.
 */
export function advance(
  state: RunState,
  deltaMs: number,
  exercises: readonly ExerciseDef[]
): { state: RunState; events: RunEvent[] } {
  const events: RunEvent[] = [];
  if (state.finished || exercises.length === 0) return { state, events };

  let next: RunState = { ...state, elapsedMs: state.elapsedMs + clamp(deltaMs, 0, MAX_TICK_MS) };

  // Bounded loop: a long tick can legitimately cross more than one phase.
  for (let guard = 0; guard < 16; guard += 1) {
    const exercise = exercises[next.exerciseIndex];
    if (!exercise) return { state: finish(events, next), events };
    const duration = phaseDuration(exercise, next.phase);
    if (next.elapsedMs < duration) break;
    const carry = next.elapsedMs - duration;
    next = step(next, exercises, events);
    if (next.finished) return { state: next, events };
    next = { ...next, elapsedMs: Math.min(carry, MAX_TICK_MS) };
  }

  return { state: next, events };
}

/** Abandons the current exercise and starts the next one (or ends the session). */
export function skipExercise(
  state: RunState,
  exercises: readonly ExerciseDef[]
): { state: RunState; events: RunEvent[] } {
  const events: RunEvent[] = [];
  if (state.finished) return { state, events };
  events.push({ type: 'exerciseEnd', exerciseIndex: state.exerciseIndex });
  const nextExercise = state.exerciseIndex + 1;
  if (nextExercise >= exercises.length) return { state: finish(events, state), events };
  return { state: enter('intro', nextExercise, 0, events), events };
}

export interface RunProgress {
  repsDone: number;
  repsTotal: number;
  fraction: number;
}

export function runProgress(state: RunState, exercises: readonly ExerciseDef[]): RunProgress {
  const repsTotal = exercises.reduce((total, exercise) => total + exercise.reps, 0);
  let repsDone = 0;
  for (let i = 0; i < state.exerciseIndex && i < exercises.length; i += 1) {
    repsDone += exercises[i]?.reps ?? 0;
  }
  if (!state.finished) {
    repsDone += state.phase === 'relax' ? state.repIndex + 1 : state.repIndex;
  } else {
    repsDone = repsTotal;
  }
  const clamped = Math.min(repsDone, repsTotal);
  return {
    repsDone: clamped,
    repsTotal,
    fraction: repsTotal === 0 ? 0 : clamped / repsTotal,
  };
}
