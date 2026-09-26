/**
 * Live left-vs-right movement, growing outwards from the midline so it reads
 * like the face in the video above it.
 */
import type { Sided } from '../lib/types';

export interface SymmetryBarsProps {
  /** 0..1 per side. */
  fill: Sided<number>;
  /** Where "enough movement to measure" sits, as 0..1. Drawn as a small tick. */
  threshold?: number;
  label?: string;
}

function percent(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export default function SymmetryBars({ fill, threshold, label }: SymmetryBarsProps) {
  const left = percent(fill.left);
  const right = percent(fill.right);
  const tick = threshold === undefined ? null : Math.min(96, Math.max(2, threshold * 100));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-lg font-semibold">
        <span className="text-side-left">Your left</span>
        {label && <span className="text-ink-soft">{label}</span>}
        <span className="text-side-right">Your right</span>
      </div>

      <div
        className="flex h-14 w-full items-stretch overflow-hidden bg-canvas ring-2 ring-line"
        role="img"
        aria-label={`Left side movement ${left} percent, right side movement ${right} percent`}
      >
        <div className="relative flex w-1/2 justify-end">
          {tick !== null && (
            <span
              className="absolute top-1 bottom-1 w-0.5 bg-line"
              style={{ right: `${tick}%` }}
              aria-hidden
            />
          )}
          <div
            className="h-full bg-side-left transition-[width] duration-100 ease-out"
            style={{ width: `${left}%` }}
          />
        </div>

        <div className="w-1 bg-ink/70" aria-hidden />

        <div className="relative flex w-1/2 justify-start">
          {tick !== null && (
            <span
              className="absolute top-1 bottom-1 w-0.5 bg-line"
              style={{ left: `${tick}%` }}
              aria-hidden
            />
          )}
          <div
            className="h-full bg-side-right transition-[width] duration-100 ease-out"
            style={{ width: `${right}%` }}
          />
        </div>
      </div>

      <div className="mt-1 flex justify-between text-base tabular-nums text-ink-soft">
        <span>{left}%</span>
        <span>{right}%</span>
      </div>
    </div>
  );
}
