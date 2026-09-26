/**
 * The things you hit, and how they give.
 *
 * Every target is a ring of vertices around a chosen object's outline, and each
 * vertex carries two displacements:
 *
 *   wobble  - elastic. Springs back, and is what makes a fresh hit ripple.
 *   plastic - permanent. A fraction of every dent stays, so the object slowly
 *             keeps the shape you beat into it, the way clay does.
 *
 * On top of that the body takes knockback, spin and a squash along the line of
 * the punch, so an uppercut, a hook and a straight all read differently.
 */
import { meanRadius, OBJECTS_BY_ID, resampleClosed, type ObjectId, type PunchObject } from './objects';
import type { Punch } from './punch';
import type { Point2 } from './types';

export const VERTEX_COUNT = 56;

export type TargetState = 'alive' | 'dying';
/** Appearance and value modifiers on top of the chosen object. */
export type TargetTier = 'normal' | 'tough' | 'gold';

export interface Target {
  id: number;
  objectId: ObjectId;
  tier: TargetTier;
  /** Unit outline, resampled and scaled so its furthest point sits at 1. */
  unit: Point2[];
  pos: Point2;
  vel: Point2;
  /** Bounding radius in display-height units. */
  size: number;
  rotation: number;
  spin: number;
  hp: number;
  maxHp: number;
  bornAt: number;
  lifetime: number;
  /** Elastic, springs back to the plastic shape. */
  wobble: number[];
  wobbleVel: number[];
  /** Permanent set. This is the clay. */
  plastic: number[];
  plasticity: number;
  squash: number;
  squashAngle: number;
  flash: number;
  state: TargetState;
  diedAt: number;
}

const WOBBLE_K = 250;
const WOBBLE_DAMPING = 8.5;
const DRAG_ALIVE = 2.6;
const DRAG_DYING = 0.9;
const GRAVITY = 1.15;
const SPIN_DRAG = 1.8;
const FADE_MS = 620;
/** How far a vertex may be driven in or out for good. */
const PLASTIC_MIN = -0.46;
const PLASTIC_MAX = 0.3;

export const TIER_LIFETIME: Record<TargetTier, number> = {
  normal: 4400,
  tough: 5600,
  gold: 2700,
};

/** Extra punches a tier adds on top of the object's own toughness. */
export const TIER_EXTRA_HP: Record<TargetTier, number> = {
  normal: 0,
  tough: 2,
  gold: -99, // gold always goes in one
};

let nextId = 1;

export function createTarget(
  objectId: ObjectId,
  tier: TargetTier,
  pos: Point2,
  now: number,
  random: () => number = Math.random
): Target {
  const object: PunchObject = OBJECTS_BY_ID[objectId];
  const sampled = resampleClosed(object.outline, VERTEX_COUNT);
  const longest = Math.max(...sampled.map((point) => Math.hypot(point.x, point.y)), 1e-6);
  const unit = sampled.map((point) => ({ x: point.x / longest, y: point.y / longest }));

  const hp = tier === 'gold' ? 1 : object.hp + TIER_EXTRA_HP[tier];

  return {
    id: nextId++,
    objectId,
    tier,
    unit,
    pos: { ...pos },
    vel: { x: (random() - 0.5) * 0.04, y: (random() - 0.5) * 0.03 },
    size: object.size * (tier === 'gold' ? 0.78 : 1) * (0.92 + random() * 0.16),
    // Upright things stay roughly upright until something hits them.
    rotation: (random() - 0.5) * 0.3,
    spin: (random() - 0.5) * 0.3,
    hp: Math.max(1, hp),
    maxHp: Math.max(1, hp),
    bornAt: now,
    lifetime: TIER_LIFETIME[tier],
    wobble: new Array<number>(VERTEX_COUNT).fill(0),
    wobbleVel: new Array<number>(VERTEX_COUNT).fill(0),
    plastic: new Array<number>(VERTEX_COUNT).fill(0),
    plasticity: object.plasticity,
    squash: 1,
    squashAngle: 0,
    flash: 0,
    state: 'alive',
    diedAt: 0,
  };
}

export function targetAge(target: Target, now: number): number {
  return Math.min(1, (now - target.bornAt) / target.lifetime);
}

export function isExpired(target: Target, now: number): boolean {
  return target.state === 'alive' && now - target.bornAt >= target.lifetime;
}

export function isGone(target: Target, now: number): boolean {
  return target.state === 'dying' && now - target.diedAt >= FADE_MS;
}

export function fadeProgress(target: Target, now: number): number {
  if (target.state !== 'dying') return 0;
  return Math.min(1, (now - target.diedAt) / FADE_MS);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Drives a punch into a target. `impact` is in the same display space as the
 * target's position.
 */
export function applyPunch(target: Target, punch: Punch, impact: Point2): void {
  const power = clamp(punch.power, 0, 1);

  let direction: Point2 = { ...punch.direction };
  let spin = (Math.random() - 0.5) * 4;
  if (punch.type === 'uppercut') {
    const lift = { x: direction.x * 0.45, y: Math.min(-0.75, direction.y) };
    const length = Math.hypot(lift.x, lift.y) || 1;
    direction = { x: lift.x / length, y: lift.y / length };
    spin = -7 - power * 7;
  } else if (punch.type === 'hook') {
    const side = direction.x >= 0 ? 1 : -1;
    direction = { x: side * 0.94, y: direction.y * 0.35 };
    spin = side * (9 + power * 9);
  }
  if (!Number.isFinite(direction.x) || !Number.isFinite(direction.y)) {
    direction = { x: 0, y: -1 };
  }

  const impulse = 0.3 + power * 0.95;
  target.vel.x += direction.x * impulse;
  target.vel.y += direction.y * impulse;
  target.spin += spin;

  target.squash = Math.max(0.45, 1 - 0.4 * (0.35 + power));
  target.squashAngle = Math.atan2(direction.y, direction.x);
  target.flash = 1;

  // Vertices live in the target's own frame, so take its rotation back off the
  // world impact angle or the dent lands somewhere the fist never went.
  const impactAngle =
    Math.atan2(impact.y - target.pos.y, impact.x - target.pos.x) - target.rotation;
  const depth = 0.4 + power * 0.8;

  for (let i = 0; i < VERTEX_COUNT; i += 1) {
    const angle = Math.atan2((target.unit[i] as Point2).y, (target.unit[i] as Point2).x);
    const delta = Math.cos(angle - impactAngle);

    // Elastic: the whole ring ripples, deepest where the fist landed.
    target.wobbleVel[i] = (target.wobbleVel[i] ?? 0) - depth * delta * 6;

    // Plastic: a local dent that stays, with a little bulge pushed out the
    // far side, as though the material had nowhere else to go.
    const near = Math.max(0, delta) ** 2.5;
    const far = Math.max(0, -delta) ** 2.5;
    const set = target.plasticity * depth * (far * 0.22 - near * 0.55);
    target.plastic[i] = clamp((target.plastic[i] ?? 0) + set, PLASTIC_MIN, PLASTIC_MAX);
  }

  target.hp -= 1;
  if (target.hp <= 0 && target.state === 'alive') {
    target.state = 'dying';
    target.diedAt = punch.at;
    target.vel.x += direction.x * 0.5;
    target.vel.y += direction.y * 0.5;
  }
}

export function stepTarget(target: Target, dt: number): void {
  const step = Math.min(dt, 0.05);
  const dying = target.state === 'dying';

  target.pos.x += target.vel.x * step;
  target.pos.y += target.vel.y * step;

  const drag = dying ? DRAG_DYING : DRAG_ALIVE;
  const decay = Math.exp(-drag * step);
  target.vel.x *= decay;
  target.vel.y *= decay;
  if (dying) target.vel.y += GRAVITY * step;

  target.rotation += target.spin * step;
  target.spin *= Math.exp(-SPIN_DRAG * step);

  for (let i = 0; i < VERTEX_COUNT; i += 1) {
    const offset = target.wobble[i] ?? 0;
    const velocity = target.wobbleVel[i] ?? 0;
    const next = velocity + (-WOBBLE_K * offset - WOBBLE_DAMPING * velocity) * step;
    target.wobbleVel[i] = next;
    target.wobble[i] = offset + next * step;
  }

  target.squash += (1 - target.squash) * Math.min(1, step * 7);
  target.flash = Math.max(0, target.flash - step * 3.4);

  if (!dying) keepInBounds(target);
}

function keepInBounds(target: Target): void {
  const margin = target.size * 0.75;
  const min = margin;
  const maxX = 1 - margin;
  const maxY = 1 - margin;
  if (target.pos.x < min) {
    target.pos.x = min;
    target.vel.x = Math.abs(target.vel.x) * 0.55;
  } else if (target.pos.x > maxX) {
    target.pos.x = maxX;
    target.vel.x = -Math.abs(target.vel.x) * 0.55;
  }
  if (target.pos.y < min) {
    target.pos.y = min;
    target.vel.y = Math.abs(target.vel.y) * 0.55;
  } else if (target.pos.y > maxY) {
    target.pos.y = maxY;
    target.vel.y = -Math.abs(target.vel.y) * 0.55;
  }
}

/**
 * The deformed outline in display space. `aspect` keeps the shape from
 * stretching on a wide frame.
 */
export function targetOutline(target: Target, aspect: number): Point2[] {
  const points: Point2[] = [];
  const cosR = Math.cos(target.rotation);
  const sinR = Math.sin(target.rotation);
  const cosS = Math.cos(target.squashAngle);
  const sinS = Math.sin(target.squashAngle);
  const along = target.squash;
  const across = 1 + (1 - target.squash) * 0.7;
  const safeAspect = Math.max(aspect, 0.0001);

  for (let i = 0; i < VERTEX_COUNT; i += 1) {
    const unit = target.unit[i] as Point2;
    const scale = 1 + (target.plastic[i] ?? 0) + (target.wobble[i] ?? 0);
    let x = unit.x * scale * target.size;
    let y = unit.y * scale * target.size;

    // Spin the object.
    const rx = x * cosR - y * sinR;
    const ry = x * sinR + y * cosR;

    // Squash along the line of the last punch.
    const localX = rx * cosS + ry * sinS;
    const localY = -rx * sinS + ry * cosS;
    x = localX * along * cosS - localY * across * sinS;
    y = localX * along * sinS + localY * across * cosS;

    points.push({ x: target.pos.x + x / safeAspect, y: target.pos.y + y });
  }
  return points;
}

/** Interior detail lines, moved and spun with the body. */
export function targetDetails(target: Target, aspect: number): Point2[][] {
  const object = OBJECTS_BY_ID[target.objectId];
  if (object.details.length === 0) return [];
  const longest = Math.max(...object.outline.map((point) => Math.hypot(point.x, point.y)), 1e-6);
  const cosR = Math.cos(target.rotation);
  const sinR = Math.sin(target.rotation);
  const safeAspect = Math.max(aspect, 0.0001);

  return object.details.map((line) =>
    line.map((point) => {
      const x = (point.x / longest) * target.size;
      const y = (point.y / longest) * target.size;
      const rx = x * cosR - y * sinR;
      const ry = x * sinR + y * cosR;
      return { x: target.pos.x + rx / safeAspect, y: target.pos.y + ry };
    })
  );
}

/* ------------------------------------------------------------------ *
 * Collision against the real outline
 * ------------------------------------------------------------------ */

export function pointInPolygon(point: Point2, polygon: readonly Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i] as Point2;
    const b = polygon[j] as Point2;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Where two segments cross, as a fraction along a1->a2, or null. */
function segmentCross(a1: Point2, a2: Point2, b1: Point2, b2: Point2): number | null {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / denominator;
  const u = ((b1.x - a1.x) * ry - (b1.y - a1.y) * rx) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return t;
}

/**
 * Tests the fist's swept path against the object's actual outline, so a punch
 * connects where it looks like it connects - and the hit box follows the shape
 * as it gets beaten out of true.
 */
export function sweepHitsPolygon(
  from: Point2,
  to: Point2,
  polygon: readonly Point2[]
): Point2 | null {
  if (polygon.length < 3) return null;
  if (pointInPolygon(from, polygon)) return { ...from };

  let best: number | null = null;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i] as Point2;
    const b = polygon[(i + 1) % polygon.length] as Point2;
    const t = segmentCross(from, to, a, b);
    if (t !== null && (best === null || t < best)) best = t;
  }
  if (best === null) {
    return pointInPolygon(to, polygon) ? { ...to } : null;
  }
  return { x: from.x + (to.x - from.x) * best, y: from.y + (to.y - from.y) * best };
}

/** 0 at the centre of mass, 1 out at the rim. */
export function hitOffset(target: Target, polygon: readonly Point2[], point: Point2, aspect: number): number {
  const centred = polygon.map((p) => ({ x: (p.x - target.pos.x) * aspect, y: p.y - target.pos.y }));
  const average = meanRadius(centred);
  if (average < 1e-9) return 1;
  const distance = Math.hypot((point.x - target.pos.x) * aspect, point.y - target.pos.y);
  return Math.min(1, distance / average);
}
