import { describe, expect, it } from 'vitest';
import { buildChartRows, OVERALL_KEY, trend } from './history';
import type { SessionRecord } from './types';

function session(startedAt: string, overall: number | null, pucker: number | null): SessionRecord {
  return {
    id: startedAt,
    startedAt,
    endedAt: startedAt,
    overallScore: overall,
    exercises: [
      {
        exerciseId: 'pucker',
        status: pucker === null ? 'insufficient' : 'ok',
        score: pucker,
        movement: { left: 0, right: 0 },
        weakerSide: null,
        reps: [],
        validReps: 0,
        synkinesis: [],
      },
    ],
    sideConfig: { swapBlendshapes: false, swapLandmarks: false },
    schemaVersion: 1,
  };
}

const sessions = [
  session('2026-02-03T09:00:00.000Z', 60, 55),
  session('2026-02-01T09:00:00.000Z', 52, null),
  session('2026-02-05T09:00:00.000Z', 71, 80),
];

describe('buildChartRows', () => {
  it('returns one row per session, oldest first', () => {
    const rows = buildChartRows(sessions, OVERALL_KEY);
    expect(rows.map((row) => row.score)).toEqual([52, 60, 71]);
  });

  it('keeps a null for an exercise that could not be scored, so the line breaks', () => {
    expect(buildChartRows(sessions, 'pucker').map((row) => row.score)).toEqual([null, 55, 80]);
  });

  it('returns nulls for an exercise that was never recorded', () => {
    expect(buildChartRows(sessions, 'cheek-puff').every((row) => row.score === null)).toBe(true);
  });

  it('ignores sessions with an unreadable date', () => {
    expect(buildChartRows([session('not a date', 50, 50)], OVERALL_KEY)).toEqual([]);
  });
});

describe('trend', () => {
  it('compares the last two scored sessions', () => {
    expect(trend(buildChartRows(sessions, OVERALL_KEY))).toBe(11);
  });

  it('skips over unscored sessions rather than treating them as zero', () => {
    expect(trend(buildChartRows(sessions, 'pucker'))).toBe(25);
  });

  it('needs two scores before it says anything', () => {
    expect(trend(buildChartRows([sessions[0]!], OVERALL_KEY))).toBeNull();
    expect(trend([])).toBeNull();
  });
});
