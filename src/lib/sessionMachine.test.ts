import { describe, expect, it } from 'vitest';
import {
  advance,
  createRunState,
  MAX_TICK_MS,
  phaseCountdown,
  phaseNeedsFace,
  runProgress,
  skipExercise,
  type RunEvent,
  type RunState,
} from './sessionMachine';
import type { ExerciseDef } from './types';

function exercise(id: string, reps: number): ExerciseDef {
  return {
    id,
    name: id,
    cue: id,
    how: [],
    reps,
    timing: { introMs: 1000, moveMs: 1000, holdMs: 1000, relaxMs: 1000 },
    signal: { kind: 'blendshape', left: `${id}Left`, right: `${id}Right` },
    direction: 'increase',
    minMovement: 0.1,
    displayScale: 1,
    synkinesis: { companion: 'none', threshold: 1, label: '' },
  };
}

const programme = [exercise('one', 2), exercise('two', 1)];

/** Runs the clock in 100 ms steps and collects everything that happened. */
function run(steps: number, state = createRunState(), deltaMs = 100) {
  const events: RunEvent[] = [];
  let current: RunState = state;
  for (let i = 0; i < steps; i += 1) {
    const result = advance(current, deltaMs, programme);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

describe('advance', () => {
  it('walks intro, then move / hold / relax for each rep', () => {
    const { events } = run(80);
    const phases = events
      .filter((event) => event.type === 'phaseEnter')
      .map((event) => (event.type === 'phaseEnter' ? event.phase : ''));
    expect(phases.slice(0, 7)).toEqual([
      'move',
      'hold',
      'relax',
      'move',
      'hold',
      'relax',
      'intro',
    ]);
  });

  it('reports the end of every hold with its rep number', () => {
    const { events } = run(120);
    const holds = events
      .filter((event) => event.type === 'holdEnd')
      .map((event) => (event.type === 'holdEnd' ? `${event.exerciseIndex}:${event.repIndex}` : ''));
    expect(holds).toEqual(['0:0', '0:1', '1:0']);
  });

  it('finishes the session after the last rep of the last exercise', () => {
    const { state, events } = run(200);
    expect(state.finished).toBe(true);
    expect(events.filter((event) => event.type === 'sessionEnd')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'exerciseEnd')).toHaveLength(2);
  });

  it('does nothing once finished', () => {
    const { state } = run(200);
    const after = advance(state, 1000, programme);
    expect(after.events).toEqual([]);
    expect(after.state).toBe(state);
  });

  it('waits where the countdown needs a usable frame', () => {
    // Zero deltas are what the controller passes while the face is turned away.
    const { state, events } = run(50, createRunState(), 0);
    expect(events).toEqual([]);
    expect(state.phase).toBe('intro');
    expect(state.elapsedMs).toBe(0);
  });

  it('cannot be fast-forwarded by a backgrounded tab', () => {
    const { state, events } = advance(createRunState(), 60_000, programme);
    expect(state.elapsedMs).toBeLessThanOrEqual(MAX_TICK_MS);
    // A single huge tick crosses at most one phase boundary, not the session.
    expect(events.filter((event) => event.type === 'sessionEnd')).toHaveLength(0);
  });

  it('counts the phase down in whole seconds', () => {
    const start = createRunState();
    expect(phaseCountdown(start, programme)).toBe(1);
    expect(phaseCountdown({ ...start, elapsedMs: 400 }, programme)).toBe(1);
    expect(phaseCountdown({ ...start, elapsedMs: 1000 }, programme)).toBe(0);
  });

  it('only gates the phases that are being measured', () => {
    expect(phaseNeedsFace('move')).toBe(true);
    expect(phaseNeedsFace('hold')).toBe(true);
    expect(phaseNeedsFace('intro')).toBe(false);
    expect(phaseNeedsFace('relax')).toBe(false);
  });
});

describe('skipExercise', () => {
  it('moves to the next exercise and reports the one abandoned', () => {
    const { state, events } = skipExercise(createRunState(), programme);
    expect(events[0]).toEqual({ type: 'exerciseEnd', exerciseIndex: 0 });
    expect(state.exerciseIndex).toBe(1);
    expect(state.phase).toBe('intro');
  });

  it('ends the session when the last exercise is skipped', () => {
    const onLast: RunState = { ...createRunState(), exerciseIndex: 1 };
    const { state, events } = skipExercise(onLast, programme);
    expect(state.finished).toBe(true);
    expect(events.some((event) => event.type === 'sessionEnd')).toBe(true);
  });
});

describe('runProgress', () => {
  it('counts a rep as done once its relax phase starts', () => {
    expect(runProgress(createRunState(), programme)).toEqual({
      repsDone: 0,
      repsTotal: 3,
      fraction: 0,
    });
    const midRelax: RunState = { ...createRunState(), phase: 'relax', repIndex: 0 };
    expect(runProgress(midRelax, programme).repsDone).toBe(1);
  });

  it('carries completed exercises forward and ends at 100 per cent', () => {
    const secondExercise: RunState = { ...createRunState(), exerciseIndex: 1, phase: 'move' };
    expect(runProgress(secondExercise, programme).repsDone).toBe(2);
    const done: RunState = { ...createRunState(), finished: true, exerciseIndex: 1 };
    expect(runProgress(done, programme)).toEqual({ repsDone: 3, repsTotal: 3, fraction: 1 });
  });
});
