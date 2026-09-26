/**
 * The landing page artwork: a face-mesh constellation mirrored about a glowing
 * midline. Drawn as SVG rather than shipped as a photograph - it keeps the
 * "nothing is requested from anywhere else" promise, stays crisp at any size,
 * and the subject is literally what the app measures.
 *
 * The two halves carry the same blue/amber the app uses for left and right, so
 * the landing page already teaches the colour language.
 */

type Point = [number, number];
type Cubic = [Point, Point, Point, Point];

function cubicAt([p0, p1, p2, p3]: Cubic, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function sample(curve: Cubic, count: number): Point[] {
  return Array.from({ length: count }, (_unused, index) =>
    cubicAt(curve, count === 1 ? 0.5 : index / (count - 1))
  );
}

function toPath([p0, p1, p2, p3]: Cubic): string {
  return `M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]}, ${p2[0]} ${p2[1]}, ${p3[0]} ${p3[1]}`;
}

/* One half of a face, in a 1000x1000 box with the midline at x = 500.
   Drawn by hand to read as a landmark mesh without being a portrait. */
const HALF: { curve: Cubic; dots: number }[] = [
  // Face oval, forehead down to the jaw.
  { curve: [[500, 110], [690, 115], [828, 245], [842, 415]], dots: 13 },
  { curve: [[842, 415], [852, 585], [706, 800], [500, 892]], dots: 13 },
  // Brow.
  { curve: [[548, 332], [618, 294], [706, 298], [766, 344]], dots: 9 },
  // Eye, upper then lower lid.
  { curve: [[590, 406], [628, 368], [704, 368], [746, 408]], dots: 8 },
  { curve: [[746, 408], [704, 444], [628, 444], [590, 406]], dots: 8 },
  // Cheek contour - the line the cheek-puff exercise watches.
  { curve: [[566, 512], [656, 528], [726, 566], [768, 638]], dots: 8 },
  // Lips, upper then lower.
  { curve: [[500, 688], [556, 664], [612, 676], [656, 702]], dots: 7 },
  { curve: [[656, 702], [612, 738], [556, 746], [500, 726]], dots: 7 },
  // Nose: just the nostril curl. A mirrored bridge line meets its own twin in
  // a spike, and the glowing midline already reads as the bridge.
  { curve: [[524, 590], [556, 588], [572, 606], [548, 624]], dots: 5 },
];

function mirrorCurve(curve: Cubic): Cubic {
  return curve.map(([x, y]) => [1000 - x, y]) as Cubic;
}

interface Half {
  paths: string[];
  dots: { point: Point; radius: number }[];
}

function buildHalf(mirrored: boolean): Half {
  const paths: string[] = [];
  const dots: { point: Point; radius: number }[] = [];
  HALF.forEach((entry, curveIndex) => {
    const curve = mirrored ? mirrorCurve(entry.curve) : entry.curve;
    paths.push(toPath(curve));
    sample(curve, entry.dots).forEach((point, index) => {
      // Gentle size variation so the field reads as depth, not as a grid.
      const radius = 3.1 + ((curveIndex * 5 + index * 3) % 4) * 0.55;
      dots.push({ point, radius });
    });
  });
  return { paths, dots };
}

const LEFT = buildHalf(true);
const RIGHT = buildHalf(false);

export type FieldVariant = 'hero' | 'band';

export interface LandmarkFieldProps {
  variant?: FieldVariant;
  /** 'meet' shows the whole face; 'slice' crops it to fill the box. */
  fit?: 'meet' | 'slice';
  /** Off when the section already paints its own background. */
  background?: boolean;
  className?: string;
}

/**
 * Sits behind content as a full-bleed background. Decorative only, so it is
 * hidden from assistive technology.
 */
export default function LandmarkField({
  variant = 'hero',
  fit = 'slice',
  background = true,
  className = '',
}: LandmarkFieldProps) {
  const id = variant;
  const meshOpacity = variant === 'hero' ? 1 : 0.6;

  return (
    <svg
      className={`h-full w-full ${className}`}
      viewBox="0 0 1000 1000"
      preserveAspectRatio={`xMidYMid ${fit}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor="#123b42" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#0c2228" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#060f13" stopOpacity="1" />
        </radialGradient>
        <linearGradient id={`${id}-midline`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7fd9d0" stopOpacity="0" />
          <stop offset="28%" stopColor="#9ff0e4" stopOpacity="0.85" />
          <stop offset="72%" stopColor="#9ff0e4" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#7fd9d0" stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>

      {background && <rect width="1000" height="1000" fill={`url(#${id}-glow)`} />}

      {/* The midline: the idea the whole app is built on. */}
      <rect
        x="490"
        y="0"
        width="20"
        height="1000"
        fill={`url(#${id}-midline)`}
        filter={`url(#${id}-soft)`}
        opacity="0.38"
      />
      <rect x="499" y="0" width="2" height="1000" fill={`url(#${id}-midline)`} />

      <g opacity={meshOpacity}>
        {/* Left of the picture is the user's left, matching the mirrored video. */}
        <g stroke="#7aa9e8" fill="none" strokeWidth="1.1" opacity="0.4" strokeLinecap="round">
          {LEFT.paths.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <g fill="#8fb8f0">
          {LEFT.dots.map(({ point, radius }) => (
            <circle key={`${point[0]}-${point[1]}`} cx={point[0]} cy={point[1]} r={radius} opacity="0.92" />
          ))}
        </g>

        <g stroke="#e0a45c" fill="none" strokeWidth="1.1" opacity="0.4" strokeLinecap="round">
          {RIGHT.paths.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <g fill="#eab473">
          {RIGHT.dots.map(({ point, radius }) => (
            <circle key={`${point[0]}-${point[1]}`} cx={point[0]} cy={point[1]} r={radius} opacity="0.92" />
          ))}
        </g>
      </g>
    </svg>
  );
}
