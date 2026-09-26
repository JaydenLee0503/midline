/**
 * The things you can choose to punch. Each one is a closed outline in unit
 * space, centred on the origin and roughly inside a box of +/-0.5, which the
 * target code resamples to an even ring of vertices and then deforms.
 *
 * `plasticity` is how much of each dent stays put: 0 would be a rubber ball
 * that springs back perfectly, higher values behave like clay and slowly keep
 * the shape you beat into them.
 */
import type { Point2 } from './types';

export type ObjectId = 'ball' | 'bag' | 'chair' | 'crate' | 'pillow';

export interface ObjectPalette {
  fill: string;
  deep: string;
  edge: string;
  glow: string;
}

export interface PunchObject {
  id: ObjectId;
  name: string;
  /** One line shown under the name in the picker. */
  blurb: string;
  outline: Point2[];
  /** Interior lines drawn on top, for straps, slats and so on. */
  details: Point2[][];
  /** Size in display-height units - the radius of its bounding circle. */
  size: number;
  /** Punches needed at the normal tier. */
  hp: number;
  /** 0 = springs back perfectly, 0.5 = takes a deep set like clay. */
  plasticity: number;
  palette: ObjectPalette;
}

/* ------------------------------------------------------------------ *
 * Outline helpers
 * ------------------------------------------------------------------ */

function arc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  steps: number
): Point2[] {
  const points: Point2[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = from + ((to - from) * i) / steps;
    points.push({ x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry });
  }
  return points;
}

function circleOutline(radius: number, steps = 96): Point2[] {
  return arc(0, 0, radius, radius, 0, Math.PI * 2, steps).slice(0, -1);
}

function roundedRect(width: number, height: number, corner: number, steps = 10): Point2[] {
  const x = width / 2;
  const y = height / 2;
  const r = Math.min(corner, x, y);
  return [
    ...arc(x - r, y - r, r, r, 0, Math.PI / 2, steps),
    ...arc(-(x - r), y - r, r, r, Math.PI / 2, Math.PI, steps),
    ...arc(-(x - r), -(y - r), r, r, Math.PI, Math.PI * 1.5, steps),
    ...arc(x - r, -(y - r), r, r, Math.PI * 1.5, Math.PI * 2, steps),
  ];
}

/**
 * Spreads `count` vertices evenly around a closed outline by arc length, so
 * every object deforms with the same resolution however it was drawn.
 */
export function resampleClosed(points: readonly Point2[], count: number): Point2[] {
  const sides = points.length;
  if (sides < 3 || count < 3) return points.map((point) => ({ ...point }));

  // Cumulative distance around the loop, so any point on it can be found.
  const lengths: number[] = [];
  const cumulative: number[] = [0];
  for (let i = 0; i < sides; i += 1) {
    const a = points[i] as Point2;
    const b = points[(i + 1) % sides] as Point2;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length);
    cumulative.push((cumulative[i] as number) + length);
  }
  const total = cumulative[sides] as number;
  if (total < 1e-9) return points.map((point) => ({ ...point }));

  const result: Point2[] = [];
  let segment = 0;
  for (let i = 0; i < count; i += 1) {
    const distance = (i * total) / count;
    while (segment < sides - 1 && (cumulative[segment + 1] as number) < distance) segment += 1;
    const length = lengths[segment] as number;
    const t = length > 1e-12 ? (distance - (cumulative[segment] as number)) / length : 0;
    const a = points[segment] as Point2;
    const b = points[(segment + 1) % sides] as Point2;
    result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return result;
}

/** Mean distance from the centre, used to judge how central a hit was. */
export function meanRadius(points: readonly Point2[]): number {
  if (points.length === 0) return 0;
  let total = 0;
  for (const point of points) total += Math.hypot(point.x, point.y);
  return total / points.length;
}

/* ------------------------------------------------------------------ *
 * The objects
 * ------------------------------------------------------------------ */

/** A heavy bag: domed top and bottom, straight sides, strapped at the top. */
const BAG_OUTLINE: Point2[] = [
  ...arc(0, -0.3, 0.24, 0.2, Math.PI, Math.PI * 2, 12), // domed top
  { x: 0.24, y: -0.05 },
  { x: 0.25, y: 0.16 },
  ...arc(0, 0.3, 0.25, 0.2, 0, Math.PI, 12), // domed bottom
  { x: -0.25, y: 0.16 },
  { x: -0.24, y: -0.05 },
];

/**
 * A chair, drawn as one chunky silhouette: back, seat, and two front legs with
 * the gap between them. Recognisable at a glance, which matters more here than
 * being architecturally correct.
 */
const CHAIR_OUTLINE: Point2[] = [
  { x: -0.25, y: -0.5 },
  { x: 0.25, y: -0.5 },
  { x: 0.25, y: -0.06 },
  { x: 0.42, y: -0.06 },
  { x: 0.42, y: 0.1 },
  { x: 0.34, y: 0.1 },
  { x: 0.34, y: 0.5 },
  { x: 0.15, y: 0.5 },
  { x: 0.15, y: 0.1 },
  { x: -0.15, y: 0.1 },
  { x: -0.15, y: 0.5 },
  { x: -0.34, y: 0.5 },
  { x: -0.34, y: 0.1 },
  { x: -0.42, y: 0.1 },
  { x: -0.42, y: -0.06 },
  { x: -0.25, y: -0.06 },
];

export const PUNCH_OBJECTS: PunchObject[] = [
  {
    id: 'ball',
    name: 'Stress ball',
    blurb: 'Soft. Squashes a lot.',
    outline: circleOutline(0.42),
    details: [],
    size: 0.115,
    hp: 1,
    plasticity: 0.34,
    palette: { fill: '#8ee6da', deep: '#0f6a63', edge: '#062b2a', glow: 'rgba(142,230,218,0.55)' },
  },
  {
    id: 'bag',
    name: 'Punching bag',
    blurb: 'Takes a few. Swings back.',
    outline: BAG_OUTLINE,
    details: [
      [
        { x: -0.24, y: -0.12 },
        { x: 0.24, y: -0.12 },
      ],
      [
        { x: -0.25, y: 0.12 },
        { x: 0.25, y: 0.12 },
      ],
    ],
    size: 0.15,
    hp: 2,
    plasticity: 0.24,
    palette: { fill: '#e2685f', deep: '#7a1f1c', edge: '#2c0a09', glow: 'rgba(226,104,95,0.5)' },
  },
  {
    id: 'chair',
    name: 'Chair',
    blurb: 'Stubborn. Very satisfying.',
    outline: CHAIR_OUTLINE,
    details: [
      [
        { x: -0.26, y: -0.28 },
        { x: 0.26, y: -0.28 },
      ],
    ],
    size: 0.145,
    hp: 3,
    plasticity: 0.14,
    palette: { fill: '#c98f4e', deep: '#6a4418', edge: '#2a1907', glow: 'rgba(201,143,78,0.45)' },
  },
  {
    id: 'crate',
    name: 'Crate',
    blurb: 'Boxy. Dents beautifully.',
    outline: roundedRect(0.78, 0.74, 0.03),
    details: [
      [
        { x: -0.39, y: -0.12 },
        { x: 0.39, y: -0.12 },
      ],
      [
        { x: -0.39, y: 0.14 },
        { x: 0.39, y: 0.14 },
      ],
    ],
    size: 0.13,
    hp: 2,
    plasticity: 0.2,
    palette: { fill: '#d6a86a', deep: '#7c5220', edge: '#2e1d08', glow: 'rgba(214,168,106,0.45)' },
  },
  {
    id: 'pillow',
    name: 'Pillow',
    blurb: 'The softest thing here.',
    outline: roundedRect(0.82, 0.6, 0.22, 12),
    details: [],
    size: 0.135,
    hp: 1,
    plasticity: 0.46,
    palette: { fill: '#b9c6ef', deep: '#4a5a91', edge: '#141d38', glow: 'rgba(185,198,239,0.5)' },
  },
];

export const OBJECTS_BY_ID: Record<ObjectId, PunchObject> = Object.fromEntries(
  PUNCH_OBJECTS.map((object) => [object.id, object])
) as Record<ObjectId, PunchObject>;

export const DEFAULT_OBJECT: ObjectId = 'bag';

/** An SVG path for the picker previews, drawn in a 100x100 box. */
export function outlinePath(object: PunchObject, scale = 92): string {
  const points = object.outline;
  if (points.length === 0) return '';
  const map = (point: Point2): string =>
    `${(50 + point.x * scale).toFixed(2)} ${(50 + point.y * scale).toFixed(2)}`;
  return `M ${map(points[0] as Point2)} ${points
    .slice(1)
    .map((point) => `L ${map(point)}`)
    .join(' ')} Z`;
}
