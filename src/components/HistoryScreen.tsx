/**
 * Progress over time. One line, one measure, a fixed 0-100 scale: the session
 * list underneath doubles as the table view of the same numbers.
 */
import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { exerciseName } from '../lib/exercises';
import {
  buildChartRows,
  formatSessionDate,
  formatSessionTime,
  OVERALL_KEY,
  seriesChoices,
  trend,
} from '../lib/history';
import type { SessionRecord } from '../lib/types';

export interface HistoryScreenProps {
  sessions: readonly SessionRecord[];
  onBack: () => void;
  onStart: () => void;
  onClearAll: () => void;
  onDeleteSession: (id: string) => void;
}

const SERIES_COLOR = 'var(--color-chart)';
const GRID_COLOR = 'var(--color-grid)';
const AXIS_COLOR = 'var(--color-ink-soft)';
const INK_SOFT = 'var(--color-ink-soft)';

function shortDate(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface TooltipPayload {
  active?: boolean;
  payload?: { payload: { t: number; score: number | null } }[];
}

function ChartTooltip({ active, payload }: TooltipPayload) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="border border-line bg-surface px-4 py-2 text-lg shadow-md">
      <p className="font-semibold">{formatSessionDate(new Date(row.t).toISOString())}</p>
      <p className="tabular-nums text-ink-soft">
        {row.score === null ? 'not measured' : `${row.score} / 100`}
      </p>
    </div>
  );
}

export default function HistoryScreen({
  sessions,
  onBack,
  onStart,
  onClearAll,
  onDeleteSession,
}: HistoryScreenProps) {
  const [seriesKey, setSeriesKey] = useState(OVERALL_KEY);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const choices = seriesChoices();
  const rows = useMemo(() => buildChartRows(sessions, seriesKey), [sessions, seriesKey]);
  const scored = rows.filter((row) => row.score !== null);
  const change = trend(rows);
  const latest = scored[scored.length - 1];
  const seriesName = choices.find((choice) => choice.key === seriesKey)?.name ?? 'Overall';
  const ordered = useMemo(
    () => [...sessions].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)),
    [sessions]
  );

  if (sessions.length === 0) {
    return (
      <div className="screen">
        <h1 className="h1">Your progress</h1>
        <p className="lead mt-4">
          Once you have finished a session, your scores will appear here as a chart so you can see
          how things change from week to week.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <button type="button" className="btn-primary" onClick={onStart}>
            Start a session
          </button>
          <button type="button" className="btn-secondary" onClick={onBack}>
            Back to start
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <h1 className="h1">Your progress</h1>
      <p className="lead mt-3">
        {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'} recorded on this computer.
      </p>

      <div className="mt-8 flex flex-wrap gap-3" role="group" aria-label="Choose what to chart">
        {choices.map((choice) => {
          const selected = choice.key === seriesKey;
          return (
            <button
              key={choice.key}
              type="button"
              onClick={() => setSeriesKey(choice.key)}
              aria-pressed={selected}
              className={`min-h-12 border-2 px-5 text-lg font-semibold transition-colors ${
                selected
                  ? 'border-brand bg-brand text-white'
                  : 'border-line bg-surface text-ink hover:border-brand'
              }`}
            >
              {choice.name}
            </button>
          );
        })}
      </div>

      <section className="card mt-6">
        <h2 className="h2">{seriesName} symmetry score</h2>
        <p className="mt-1 text-lg text-ink-soft">
          Higher means the two sides moved more evenly. Sessions we could not score leave a gap.
        </p>

        {scored.length === 0 ? (
          <p className="mt-6 text-xl">
            No scores yet for {seriesName.toLowerCase()} - there was not enough movement detected to
            measure it.
          </p>
        ) : (
          <div className="mt-6 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 24, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={GRID_COLOR} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={['dataMin', 'dataMax']}
                  tickFormatter={shortDate}
                  tick={{ fill: INK_SOFT, fontSize: 15 }}
                  stroke={AXIS_COLOR}
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tick={{ fill: INK_SOFT, fontSize: 15 }}
                  stroke={AXIS_COLOR}
                  width={40}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="linear"
                  dataKey="score"
                  stroke={SERIES_COLOR}
                  strokeWidth={2}
                  dot={{ r: 4, fill: SERIES_COLOR, stroke: 'var(--color-surface)', strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {latest && latest.score !== null && (
                  <ReferenceDot
                    x={latest.t}
                    y={latest.score}
                    r={5}
                    fill={SERIES_COLOR}
                    stroke="var(--color-surface)"
                    strokeWidth={2}
                    label={{
                      value: `${latest.score}`,
                      position: 'top',
                      fill: 'var(--color-ink)',
                      fontSize: 17,
                      fontWeight: 700,
                    }}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {change !== null && (
          <p className="mt-4 text-xl">
            {change === 0
              ? 'The same as your session before.'
              : `${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)} ${
                  Math.abs(change) === 1 ? 'point' : 'points'
                } since your session before.`}{' '}
            <span className="text-ink-soft">Day-to-day changes are normal.</span>
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="h2">Every session</h2>
        <ul className="mt-4 space-y-4">
          {ordered.map((session) => (
            <li key={session.id} className="card">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-xl font-bold">{formatSessionDate(session.startedAt)}</p>
                  <p className="text-lg text-ink-soft">{formatSessionTime(session.startedAt)}</p>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {session.overallScore === null ? (
                    <span className="text-lg font-semibold text-ink-soft">not scored</span>
                  ) : (
                    <>
                      {session.overallScore}
                      <span className="text-base font-semibold text-ink-soft"> / 100</span>
                    </>
                  )}
                </p>
              </div>

              <table className="mt-4 w-full border-collapse text-left text-lg">
                <tbody>
                  {session.exercises.map((result) => (
                    <tr key={result.exerciseId} className="border-t border-line/70">
                      <td className="py-2">{exerciseName(result.exerciseId)}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">
                        {result.score === null ? (
                          <span className="font-normal text-ink-soft">not measured</span>
                        ) : (
                          result.score
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <button
                type="button"
                className="btn-quiet mt-3 px-0"
                onClick={() => onDeleteSession(session.id)}
              >
                Remove this session
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-10 flex flex-wrap gap-4">
        <button type="button" className="btn-primary" onClick={onStart}>
          Start a session
        </button>
        <button type="button" className="btn-secondary" onClick={onBack}>
          Back to start
        </button>
      </div>

      <section className="card mt-8">
        <h2 className="text-2xl font-bold">Delete your data</h2>
        <p className="mt-2 text-xl">
          Your sessions are stored only in this browser. Deleting them cannot be undone.
        </p>
        {confirmingClear ? (
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <p className="text-xl font-semibold">Delete all {sessions.length} sessions?</p>
            <button
              type="button"
              className="btn min-h-14 bg-alert px-6 text-lg text-white hover:bg-alert/90"
              onClick={() => {
                setConfirmingClear(false);
                onClearAll();
              }}
            >
              Yes, delete everything
            </button>
            <button
              type="button"
              className="btn-secondary min-h-14 text-lg"
              onClick={() => setConfirmingClear(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-secondary mt-5"
            onClick={() => setConfirmingClear(true)}
          >
            Delete all sessions
          </button>
        )}
      </section>
    </div>
  );
}
