/**
 * Painted scenery for the landing page: sky, clouds, layered ridges and grass,
 * all generated SVG so nothing is fetched from anywhere and it stays crisp at
 * any size. Everything here is decorative and hidden from assistive tech.
 *
 * The jitter is deterministic - a tiny hash, not Math.random - so the hills
 * look hand-drawn but never change between renders.
 */

/** Repeatable pseudo-noise in the range -1..1. */
function wiggle(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

/** A jagged ridge line across the box, closed down to the bottom. */
function ridgePath(
  width: number,
  height: number,
  baseline: number,
  peaks: number,
  amplitude: number,
  seed: number
): string {
  const points: string[] = [`M 0 ${height}`, `L 0 ${baseline + wiggle(seed) * amplitude * 0.3}`];
  const span = width / peaks;
  for (let i = 0; i <= peaks; i += 1) {
    // Jitter along the ridge as well as up it, or the range reads as a sawtooth.
    const x = span * i + wiggle(seed + i * 5.3) * span * 0.34;
    const peak = baseline - (0.45 + Math.abs(wiggle(seed + i * 3.7)) * 0.55) * amplitude;
    const valley = baseline + Math.abs(wiggle(seed + i * 7.1)) * amplitude * 0.3;
    if (i > 0) {
      const shoulder = x - span * (0.4 + wiggle(seed + i * 9.7) * 0.15);
      points.push(`L ${shoulder} ${peak}`);
    }
    points.push(`L ${x} ${valley}`);
  }
  points.push(`L ${width} ${height}`, 'Z');
  return points.join(' ');
}

/** One painterly cloud: overlapping circles, grouped so there are no seams. */
function Cloud({ x, y, scale, seed }: { x: number; y: number; scale: number; seed: number }) {
  const puffs = [
    { dx: 0, dy: 0, r: 46 },
    { dx: 44, dy: 10, r: 34 },
    { dx: -42, dy: 12, r: 32 },
    { dx: 22, dy: -20, r: 32 },
    { dx: -20, dy: -16, r: 28 },
    { dx: 76, dy: 20, r: 22 },
    { dx: -74, dy: 20, r: 22 },
  ];
  return (
    <g opacity={0.92} transform={`translate(${x} ${y}) scale(${scale})`}>
      {puffs.map((puff, index) => (
        <circle
          key={index}
          cx={puff.dx + wiggle(seed + index) * 5}
          cy={puff.dy + wiggle(seed + index * 2) * 4}
          r={puff.r}
          fill="#ffffff"
        />
      ))}
    </g>
  );
}

export interface SkySceneProps {
  className?: string;
}

/** The hero backdrop: sky, clouds, three ridges and a meadow floor. */
export function SkyScene({ className = '' }: SkySceneProps) {
  const width = 1200;
  const height = 700;
  return (
    <svg
      className={`h-full w-full ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="scene-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c6ecf8" />
          <stop offset="62%" stopColor="#a4ddef" />
          <stop offset="100%" stopColor="#8fd4ea" />
        </linearGradient>
      </defs>

      <rect width={width} height={height} fill="url(#scene-sky)" />

      <Cloud x={190} y={130} scale={1.1} seed={1} />
      <Cloud x={620} y={78} scale={0.8} seed={2} />
      <Cloud x={980} y={160} scale={1.25} seed={3} />
      <Cloud x={420} y={225} scale={0.6} seed={4} />

      <path d={ridgePath(width, height, 505, 7, 95, 11)} fill="#8ed1c7" />
      <path d={ridgePath(width, height, 572, 5, 110, 23)} fill="#4ea79b" />
      <path d={ridgePath(width, height, 638, 4, 62, 37)} fill="#2f7f75" />
      <rect x="0" y="676" width={width} height={height - 676} fill="#9cc93e" />
      <path d={ridgePath(width, height, 682, 12, 18, 51)} fill="#c8e56d" />
    </svg>
  );
}

export type EdgeTone = 'meadow' | 'forest' | 'wood' | 'canvas';

const EDGE_FILL: Record<EdgeTone, string> = {
  meadow: '#c8e56d',
  forest: '#1e3a32',
  wood: '#dc9a52',
  canvas: '#fdf6e5',
};

export interface EdgeProps {
  tone: EdgeTone;
  /** 'hill' is a soft rolling edge; 'grass' is a row of blades. */
  kind?: 'hill' | 'grass';
  flip?: boolean;
  className?: string;
}

/**
 * A torn edge between two bands, so sections meet along a drawn line rather
 * than a ruler line.
 */
export function SceneEdge({ tone, kind = 'hill', flip = false, className = '' }: EdgeProps) {
  const width = 1200;
  const height = 60;
  const fill = EDGE_FILL[tone];

  let path: string;
  if (kind === 'grass') {
    // Blades of different heights, widths and leans, or the edge reads as a
    // zigzag rather than as grass.
    const blades: string[] = [`M 0 ${height}`, `L 0 ${height * 0.62}`];
    const count = 34;
    const span = width / count;
    for (let i = 0; i < count; i += 1) {
      const x = span * i;
      const lean = wiggle(i * 3.1) * span * 0.34;
      const tall = 0.2 + Math.abs(wiggle(i * 1.7)) * 0.72;
      const tip = height * (0.66 - tall * 0.66);
      const base = height * (0.58 + Math.abs(wiggle(i * 5.9)) * 0.12);
      blades.push(`L ${x + span * 0.5 + lean} ${tip}`, `L ${x + span} ${base}`);
    }
    blades.push(`L ${width} ${height}`, 'Z');
    path = blades.join(' ');
  } else {
    const points: string[] = [`M 0 ${height}`, `L 0 ${height * 0.6}`];
    const count = 7;
    for (let i = 0; i <= count; i += 1) {
      const x = (width * i) / count;
      const y = height * 0.45 + wiggle(i * 2.9) * height * 0.3;
      points.push(`L ${x} ${y}`);
    }
    points.push(`L ${width} ${height}`, 'Z');
    path = points.join(' ');
  }

  return (
    <svg
      className={`block h-[34px] w-full sm:h-[52px] ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      style={flip ? { transform: 'scaleY(-1)' } : undefined}
    >
      <path d={path} fill={fill} />
    </svg>
  );
}

/** A plank band, for the wooden shelf the game section sits on. */
export function WoodBand({ className = '' }: { className?: string }) {
  const width = 1200;
  const height = 48;
  return (
    <svg
      className={`block h-[26px] w-full sm:h-[38px] ${className}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect width={width} height={height} fill="#a9642a" />
      <rect width={width} height={height * 0.62} fill="#dc9a52" />
      {Array.from({ length: 9 }, (_unused, i) => (
        <rect
          key={i}
          x={(width * i) / 9 + 4}
          y={height * 0.18}
          width={width / 9 - 8}
          height={height * 0.1}
          fill="#c07f3c"
          opacity={0.7}
        />
      ))}
    </svg>
  );
}
