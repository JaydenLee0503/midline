import { describe, expect, it } from 'vitest';
import { OBJECTS_BY_ID, PUNCH_OBJECTS, resampleClosed, type ObjectId } from './objects';
import type { Punch, PunchType } from './punch';
import {
  applyPunch,
  createTarget,
  fadeProgress,
  hitOffset,
  isExpired,
  isGone,
  pointInPolygon,
  stepTarget,
  sweepHitsPolygon,
  targetOutline,
  TIER_LIFETIME,
  VERTEX_COUNT,
  type Target,
} from './targets';
import type { Point2 } from './types';

const ASPECT = 16 / 9;

function fixedRandom(): () => number {
  let seed = 0.42;
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function makePunch(type: PunchType, direction: Point2, power = 0.8): Punch {
  return {
    arm: 'right',
    type,
    power,
    speed: 9,
    at: 1000,
    from: { x: 0.2, y: 0.5 },
    to: { x: 0.5, y: 0.5 },
    direction,
  };
}

function makeTarget(objectId: ObjectId = 'ball', tier: Target['tier'] = 'normal'): Target {
  const target = createTarget(objectId, tier, { x: 0.5, y: 0.5 }, 0, fixedRandom());
  target.vel = { x: 0, y: 0 };
  target.spin = 0;
  target.rotation = 0;
  return target;
}

/** Spread of radii around the outline: 0 means perfectly undeformed. */
function radiusSpread(target: Target): number {
  const radii = targetOutline(target, ASPECT).map((point) =>
    Math.hypot((point.x - target.pos.x) * ASPECT, point.y - target.pos.y)
  );
  return Math.max(...radii) - Math.min(...radii);
}

function settle(target: Target, seconds = 2.5): void {
  for (let i = 0; i < Math.round(seconds * 60); i += 1) stepTarget(target, 1 / 60);
}

describe('objects', () => {
  it('resamples every outline to the same ring of vertices', () => {
    for (const object of PUNCH_OBJECTS) {
      const target = makeTarget(object.id);
      expect(target.unit).toHaveLength(VERTEX_COUNT);
      // Scaled so the furthest point sits at exactly 1.
      const longest = Math.max(...target.unit.map((point) => Math.hypot(point.x, point.y)));
      expect(longest).toBeCloseTo(1, 6);
    }
  });

  it('spreads resampled points evenly around the outline', () => {
    const square: Point2[] = [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 },
    ];
    const points = resampleClosed(square, 16);
    expect(points).toHaveLength(16);
    const gaps: number[] = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i] as Point2;
      const b = points[(i + 1) % points.length] as Point2;
      gaps.push(Math.hypot(b.x - a.x, b.y - a.y));
    }
    const longest = Math.max(...gaps);
    const shortest = Math.min(...gaps);
    expect(longest - shortest).toBeLessThan(0.02);
  });

  it('takes hit points from the object and the tier together', () => {
    expect(makeTarget('ball', 'normal').maxHp).toBe(OBJECTS_BY_ID.ball.hp);
    expect(makeTarget('chair', 'normal').maxHp).toBe(3);
    expect(makeTarget('chair', 'tough').maxHp).toBe(5);
    // Gold always goes down in one, whatever it is.
    expect(makeTarget('chair', 'gold').maxHp).toBe(1);
  });
});

describe('applyPunch', () => {
  it('knocks a target along the line of a straight punch', () => {
    const target = makeTarget();
    applyPunch(target, makePunch('straight', { x: 1, y: 0 }), { x: 0.42, y: 0.5 });
    expect(target.vel.x).toBeGreaterThan(0.5);
    expect(Math.abs(target.vel.y)).toBeLessThan(0.2);
  });

  it('launches a target upwards on an uppercut, whichever way the fist travelled', () => {
    const target = makeTarget();
    applyPunch(target, makePunch('uppercut', { x: 0.9, y: 0.4 }), { x: 0.5, y: 0.58 });
    expect(target.vel.y).toBeLessThan(-0.5);
    expect(target.spin).toBeLessThan(-5);
  });

  it('sends a target spinning sideways on a hook', () => {
    const target = makeTarget();
    applyPunch(target, makePunch('hook', { x: -1, y: 0.1 }), { x: 0.6, y: 0.5 });
    expect(target.vel.x).toBeLessThan(-0.5);
    expect(Math.abs(target.spin)).toBeGreaterThan(8);
  });

  it('squashes along the punch and flashes on impact', () => {
    const target = makeTarget();
    applyPunch(target, makePunch('straight', { x: 1, y: 0 }), { x: 0.42, y: 0.5 });
    expect(target.squash).toBeLessThan(1);
    expect(target.flash).toBe(1);
  });

  it('dents the side that was hit and bulges the far side', () => {
    const target = makeTarget();
    applyPunch(target, makePunch('straight', { x: -1, y: 0 }), { x: 0.62, y: 0.5 });
    expect(target.wobbleVel[0]!).toBeLessThan(0);
    expect(target.wobbleVel[VERTEX_COUNT / 2]!).toBeGreaterThan(0);
  });

  it('puts the dent where the fist landed even when the object is spinning', () => {
    const target = makeTarget();
    target.rotation = (Math.PI * 2) / VERTEX_COUNT;
    applyPunch(target, makePunch('straight', { x: -1, y: 0 }), { x: 0.62, y: 0.5 });
    const deepest = target.wobbleVel.indexOf(Math.min(...target.wobbleVel));
    expect(deepest).toBe(VERTEX_COUNT - 1);
  });

  it('takes a hit point and finishes a target off at zero', () => {
    const chair = makeTarget('chair');
    expect(chair.hp).toBe(3);
    applyPunch(chair, makePunch('straight', { x: 1, y: 0 }), { x: 0.42, y: 0.5 });
    expect(chair.state).toBe('alive');
    applyPunch(chair, makePunch('straight', { x: 1, y: 0 }), { x: 0.42, y: 0.5 });
    applyPunch(chair, makePunch('straight', { x: 1, y: 0 }), { x: 0.42, y: 0.5 });
    expect(chair.hp).toBe(0);
    expect(chair.state).toBe('dying');
  });
});

describe('clay', () => {
  it('keeps part of every dent once the wobble has settled', () => {
    const target = makeTarget('ball');
    // Outlines are polygons, so "undeformed" means a negligible spread, not zero.
    expect(radiusSpread(target)).toBeLessThan(target.size * 0.01);

    applyPunch(target, makePunch('straight', { x: 1, y: 0 }, 1), { x: 0.42, y: 0.5 });
    settle(target);

    // The elastic ripple is gone...
    expect(Math.max(...target.wobble.map(Math.abs))).toBeLessThan(0.01);
    // ...but the shape is permanently out of true.
    expect(Math.max(...target.plastic.map(Math.abs))).toBeGreaterThan(0.02);
    expect(radiusSpread(target)).toBeGreaterThan(target.size * 0.05);
  });

  it('deepens with repeated hits in the same place', () => {
    const target = makeTarget('ball');
    const depths: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      applyPunch(target, makePunch('straight', { x: 1, y: 0 }, 1), { x: 0.42, y: 0.5 });
      target.hp = 5; // keep it alive so we can keep working it
      target.state = 'alive';
      settle(target, 0.6);
      depths.push(Math.min(...target.plastic));
    }
    expect(depths[3]!).toBeLessThan(depths[0]!);
  });

  it('never drives a vertex so far that the shape turns inside out', () => {
    const target = makeTarget('ball');
    for (let i = 0; i < 40; i += 1) {
      applyPunch(target, makePunch('straight', { x: 1, y: 0 }, 1), { x: 0.42, y: 0.5 });
      target.hp = 5;
      target.state = 'alive';
      stepTarget(target, 1 / 60);
    }
    for (const value of target.plastic) {
      expect(value).toBeGreaterThan(-0.5);
      expect(value).toBeLessThan(0.35);
    }
  });

  it('is softer on a pillow than on a chair', () => {
    const results: Record<string, number> = {};
    for (const id of ['pillow', 'chair'] as const) {
      const target = makeTarget(id);
      applyPunch(target, makePunch('straight', { x: 1, y: 0 }, 1), {
        x: target.pos.x - 0.1,
        y: target.pos.y,
      });
      settle(target);
      results[id] = Math.max(...target.plastic.map(Math.abs));
    }
    expect(results.pillow!).toBeGreaterThan(results.chair!);
  });
});

describe('stepTarget', () => {
  it('settles the elastic wobble', () => {
    const target = makeTarget();
    applyPunch(target, makePunch('straight', { x: 1, y: 0 }, 1), { x: 0.42, y: 0.5 });
    expect(Math.max(...target.wobbleVel.map(Math.abs))).toBeGreaterThan(0);
    settle(target);
    expect(Math.max(...target.wobble.map(Math.abs))).toBeLessThan(0.01);
    expect(target.squash).toBeCloseTo(1, 2);
  });

  it('lets a finished target fall away', () => {
    const target = makeTarget();
    target.state = 'dying';
    target.diedAt = 0;
    for (let i = 0; i < 30; i += 1) stepTarget(target, 1 / 60);
    expect(target.vel.y).toBeGreaterThan(0);
    expect(target.pos.y).toBeGreaterThan(0.5);
  });

  it('keeps a live target inside the frame however hard it is hit', () => {
    const target = makeTarget();
    target.vel = { x: 5, y: -4 };
    for (let i = 0; i < 240; i += 1) {
      stepTarget(target, 1 / 60);
      expect(target.pos.x).toBeGreaterThanOrEqual(0);
      expect(target.pos.x).toBeLessThanOrEqual(1);
      expect(target.pos.y).toBeGreaterThanOrEqual(0);
      expect(target.pos.y).toBeLessThanOrEqual(1);
    }
  });
});

describe('lifetime', () => {
  it('expires a live target once its time is up', () => {
    const target = makeTarget();
    expect(isExpired(target, 1000)).toBe(false);
    expect(isExpired(target, TIER_LIFETIME.normal + 1)).toBe(true);
  });

  it('gives gold targets the shortest window', () => {
    expect(TIER_LIFETIME.gold).toBeLessThan(TIER_LIFETIME.normal);
  });

  it('fades a finished target out and then drops it', () => {
    const target = makeTarget();
    target.state = 'dying';
    target.diedAt = 1000;
    expect(fadeProgress(target, 1000)).toBe(0);
    expect(fadeProgress(target, 1310)).toBeGreaterThan(0.4);
    expect(isGone(target, 1300)).toBe(false);
    expect(isGone(target, 2000)).toBe(true);
  });
});

describe('collision against the outline', () => {
  const square: Point2[] = [
    { x: 0.4, y: 0.4 },
    { x: 0.6, y: 0.4 },
    { x: 0.6, y: 0.6 },
    { x: 0.4, y: 0.6 },
  ];

  it('knows what is inside a shape', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0.3, y: 0.5 }, square)).toBe(false);
  });

  it('catches a fast punch passing clean through between frames', () => {
    const hit = sweepHitsPolygon({ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, square);
    expect(hit).not.toBeNull();
    // It connects with the near face, not the far side.
    expect(hit!.x).toBeCloseTo(0.4, 6);
  });

  it('misses when the path passes wide', () => {
    expect(sweepHitsPolygon({ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, square)).toBeNull();
  });

  it('counts a fist that started inside the shape', () => {
    const hit = sweepHitsPolygon({ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.5 }, square);
    expect(hit).toEqual({ x: 0.5, y: 0.5 });
  });

  it('follows the real shape, so a gap in a chair is a gap', () => {
    const chair = makeTarget('chair');
    const outline = targetOutline(chair, ASPECT);
    // Straight between the two front legs, below the seat.
    const betweenLegs = { x: chair.pos.x, y: chair.pos.y + chair.size * 0.75 };
    expect(pointInPolygon(betweenLegs, outline)).toBe(false);
    // The seat itself is solid.
    expect(pointInPolygon({ x: chair.pos.x, y: chair.pos.y - chair.size * 0.2 }, outline)).toBe(true);
  });

  it('rates a centre hit as central and a rim hit as not', () => {
    const target = makeTarget('ball');
    const outline = targetOutline(target, ASPECT);
    expect(hitOffset(target, outline, target.pos, ASPECT)).toBeCloseTo(0, 6);
    const rim = outline[0] as Point2;
    expect(hitOffset(target, outline, rim, ASPECT)).toBeGreaterThan(0.9);
  });
});
