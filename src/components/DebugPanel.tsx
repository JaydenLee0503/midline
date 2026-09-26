/**
 * Raw per-side numbers, so the left/right mapping can be checked against a real
 * face rather than assumed. See the README section "Checking left and right".
 */
import type { DebugValues } from '../lib/sessionController';
import type { SideConfig } from '../lib/types';

export interface DebugPanelProps {
  debug: DebugValues;
  fps: number;
  sideConfig: SideConfig;
  onSideConfigChange: (config: SideConfig) => void;
  onClose: () => void;
}

function num(value: number, digits = 3): string {
  return value.toFixed(digits);
}

export default function DebugPanel({
  debug,
  fps,
  sideConfig,
  onSideConfigChange,
  onClose,
}: DebugPanelProps) {
  const pose = debug.pose;

  return (
    <section className="card mt-6 bg-canvas" aria-label="Debug values">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold">Debug values</h3>
          <p className="mt-1 max-w-xl text-base text-ink-soft">
            Raise <strong>only your left eyebrow</strong> and watch the browOuterUp row: the
            &ldquo;left&rdquo; number should rise. If the other one rises instead, turn on the
            matching swap below. Do the same with one cheek for the landmark rows.
          </p>
        </div>
        <button type="button" className="btn-quiet" onClick={onClose}>
          Hide
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-6">
        <label className="flex items-center gap-3 text-lg">
          <input
            type="checkbox"
            className="size-6 accent-brand"
            checked={sideConfig.swapBlendshapes}
            onChange={(event) =>
              onSideConfigChange({ ...sideConfig, swapBlendshapes: event.target.checked })
            }
          />
          Swap blendshape sides
        </label>
        <label className="flex items-center gap-3 text-lg">
          <input
            type="checkbox"
            className="size-6 accent-brand"
            checked={sideConfig.swapLandmarks}
            onChange={(event) =>
              onSideConfigChange({ ...sideConfig, swapLandmarks: event.target.checked })
            }
          />
          Swap landmark sides
        </label>
      </div>

      <table className="mt-5 w-full border-collapse text-left text-base tabular-nums">
        <thead>
          <tr className="border-b-2 border-line">
            <th className="py-2 pr-3 font-semibold">Signal</th>
            <th className="py-2 pr-3 font-semibold text-left">left</th>
            <th className="py-2 font-semibold text-right">right</th>
          </tr>
        </thead>
        <tbody>
          {debug.pairs.map((pair) => (
            <tr key={pair.label} className="border-b border-line/70">
              <td className="py-2 pr-3">{pair.label}</td>
              <td className="py-2 pr-3 font-semibold text-left">{num(pair.left)}</td>
              <td className="py-2 font-semibold text-right">{num(pair.right)}</td>
            </tr>
          ))}
          {debug.unsided.map((entry) => (
            <tr key={entry.label} className="border-b border-line/70">
              <td className="py-2 pr-3">{entry.label} (not sided)</td>
              <td className="py-2 pr-3" colSpan={2}>
                {num(entry.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-base text-ink-soft sm:grid-cols-4">
        <div>
          <dt className="font-semibold text-ink">yaw</dt>
          <dd>{pose ? `${num(pose.yaw, 1)}°` : '-'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">pitch</dt>
          <dd>{pose ? `${num(pose.pitch, 1)}°` : '-'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">roll</dt>
          <dd>{pose ? `${num(pose.roll, 1)}°` : '-'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">detection</dt>
          <dd>{fps} fps</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">inter-ocular</dt>
          <dd>{num(debug.interOcular)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">frame aspect</dt>
          <dd>{num(debug.aspect, 2)}</dd>
        </div>
      </dl>
    </section>
  );
}
