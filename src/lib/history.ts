/** Pure shaping of stored sessions into rows for the progress chart. */
import { EXERCISES } from './exercises';
import type { SessionRecord } from './types';

export const OVERALL_KEY = 'overall';

export interface ChartRow {
  /** Epoch ms, used for the time axis. */
  t: number;
  label: string;
  score: number | null;
}

export interface SeriesChoice {
  key: string;
  name: string;
}

export function seriesChoices(): SeriesChoice[] {
  return [
    { key: OVERALL_KEY, name: 'Overall' },
    ...EXERCISES.map((exercise) => ({ key: exercise.id, name: exercise.name })),
  ];
}

function scoreFor(session: SessionRecord, key: string): number | null {
  if (key === OVERALL_KEY) return session.overallScore ?? null;
  const match = session.exercises.find((exercise) => exercise.exerciseId === key);
  return match?.score ?? null;
}

export function formatSessionDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 'Unknown date';
  return new Date(time).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatSessionTime(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  return new Date(time).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * One row per session, oldest first. Sessions where the chosen exercise could
 * not be scored keep a null so the line breaks instead of inventing a value.
 */
export function buildChartRows(sessions: readonly SessionRecord[], key: string): ChartRow[] {
  return sessions
    .map((session) => ({
      t: Date.parse(session.startedAt),
      label: formatSessionDate(session.startedAt),
      score: scoreFor(session, key),
    }))
    .filter((row) => !Number.isNaN(row.t))
    .sort((a, b) => a.t - b.t);
}

/** Difference between the most recent scored session and the one before it. */
export function trend(rows: readonly ChartRow[]): number | null {
  const scored = rows.filter((row) => row.score !== null);
  if (scored.length < 2) return null;
  const last = scored[scored.length - 1]?.score;
  const previous = scored[scored.length - 2]?.score;
  if (last === undefined || previous === undefined || last === null || previous === null) return null;
  return last - previous;
}
