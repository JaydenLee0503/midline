/**
 * Canvas overlay drawing. Called straight from the detection loop, so it never
 * touches React state.
 *
 * The canvas sits on top of the video inside a mirrored container, so we draw
 * in raw landmark coordinates and let CSS do the flip. That also means no text
 * is drawn here - it would come out backwards. Side labels are HTML.
 */
import type { FaceGeometry } from './metrics';
import { toFaceLocal } from './metrics';
import type { Landmark } from './types';

const LEFT_BROW = [336, 296, 334, 293, 300, 285, 295, 282, 283, 276];
const RIGHT_BROW = [107, 66, 105, 63, 70, 55, 65, 52, 53, 46];
const LEFT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const OUTER_LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
];

/** The landmarks we draw all the time: brows, eyes, lips. */
export const CONTOUR_LANDMARKS: readonly number[] = [
  ...LEFT_BROW,
  ...RIGHT_BROW,
  ...LEFT_EYE,
  ...RIGHT_EYE,
  ...OUTER_LIPS,
];

export const BROW_POINTS: readonly number[] = [...LEFT_BROW, ...RIGHT_BROW];
export const EYE_POINTS: readonly number[] = [...LEFT_EYE, ...RIGHT_EYE];
export const LIP_POINTS: readonly number[] = OUTER_LIPS;

const COLORS = {
  aligned: 'rgba(14, 106, 112, 0.85)',
  adjust: 'rgba(150, 84, 10, 0.9)',
  dot: 'rgba(255, 255, 255, 0.75)',
  dotEdge: 'rgba(21, 35, 44, 0.55)',
  left: 'rgba(60, 122, 196, 0.95)',
  right: 'rgba(197, 121, 26, 0.95)',
};

export interface OverlayInput {
  landmarks: readonly Landmark[] | null;
  geometry: FaceGeometry | null;
  /** False when the face is turned/tilted - the midline turns amber. */
  usable: boolean;
  /** Landmarks this exercise measures; drawn larger, in the side colour. */
  highlight: readonly number[];
}

export function clearOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.clearRect(0, 0, width, height);
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: OverlayInput
): void {
  ctx.clearRect(0, 0, width, height);
  const { landmarks } = input;
  if (!landmarks || landmarks.length === 0) return;

  const scale = Math.max(1, Math.min(width, height) / 480);
  drawMidline(ctx, width, height, input, scale);

  // Plain contour dots first, highlights on top.
  const highlight = new Set(input.highlight);
  ctx.lineWidth = Math.max(1, scale);
  for (const index of CONTOUR_LANDMARKS) {
    if (highlight.has(index)) continue;
    const point = landmarks[index];
    if (!point) continue;
    dot(ctx, point.x * width, point.y * height, 1.6 * scale, COLORS.dot, COLORS.dotEdge);
  }

  for (const index of highlight) {
    const point = landmarks[index];
    if (!point) continue;
    const side = sideOf(point, input.geometry);
    const color = side === 'right' ? COLORS.right : COLORS.left;
    dot(ctx, point.x * width, point.y * height, 3.4 * scale, color, 'rgba(255,255,255,0.9)');
  }
}

function sideOf(point: Landmark, geometry: FaceGeometry | null): 'left' | 'right' {
  if (!geometry) return 'left';
  return toFaceLocal(point, geometry).v >= 0 ? 'left' : 'right';
}

function drawMidline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: OverlayInput,
  scale: number
): void {
  const landmarks = input.landmarks;
  if (!landmarks) return;
  const top = landmarks[10];
  const bottom = landmarks[152];
  if (!top || !bottom) return;

  const a = { x: top.x * width, y: top.y * height };
  const b = { x: bottom.x * width, y: bottom.y * height };
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1) return;
  const dx = (b.x - a.x) / length;
  const dy = (b.y - a.y) / length;
  const extend = height * 0.5;

  ctx.save();
  ctx.strokeStyle = input.usable ? COLORS.aligned : COLORS.adjust;
  ctx.lineWidth = 2 * scale;
  ctx.setLineDash([10 * scale, 8 * scale]);
  ctx.beginPath();
  ctx.moveTo(a.x - dx * extend, a.y - dy * extend);
  ctx.lineTo(b.x + dx * extend, b.y + dy * extend);
  ctx.stroke();
  ctx.restore();
}

function dot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  stroke: string
): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.stroke();
}
