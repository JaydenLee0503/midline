/**
 * Canvas drawing for the game. Called straight from the animation loop, so it
 * never touches React state.
 *
 * The canvas is NOT inside the mirrored container - the video is flipped with
 * CSS and everything here is drawn in already-flipped display coordinates.
 * That way score pop-ups read the right way round.
 */
import type { Burst, FistView, Popup, RenderState } from './gameController';
import { OBJECTS_BY_ID, type ObjectPalette } from './objects';
import { HAND_BONES } from './punch';
import { fadeProgress, targetAge, targetDetails, targetOutline, type Target } from './targets';
import type { Point2 } from './types';

const GOLD: ObjectPalette = {
  fill: '#ffe9a8',
  deep: '#9a7318',
  edge: '#4a3406',
  glow: 'rgba(255,220,130,0.75)',
};

/** Gold is unmistakable; a tough one is the same object, built heavier. */
function paletteFor(objectId: Target['objectId'], tier: Target['tier']): ObjectPalette {
  const base = OBJECTS_BY_ID[objectId].palette;
  if (tier === 'gold') return GOLD;
  if (tier === 'tough') return { ...base, fill: base.deep, deep: base.edge };
  return base;
}

const ARM_COLOR = {
  left: '#8fb8f0',
  right: '#eab473',
} as const;

export function drawGame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: RenderState
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.save();

  if (state.shake > 0.001) {
    const magnitude = state.shake * height * 0.012;
    ctx.translate(
      (Math.random() - 0.5) * magnitude,
      (Math.random() - 0.5) * magnitude
    );
  }

  for (const target of state.targets) drawTarget(ctx, width, height, target, state.now);
  for (const burst of state.bursts) drawBurst(ctx, width, height, burst, state.now);
  for (const fist of state.fists) drawFist(ctx, width, height, fist);
  for (const popup of state.popups) drawPopup(ctx, width, height, popup, state.now);

  ctx.restore();
}

/* ------------------------------------------------------------------ */

/**
 * Traces the outline exactly as given. This is the same polygon the hit test
 * uses, so what you see is precisely what you can hit - and corners on a crate
 * or the legs of a chair survive, which curve smoothing softened away.
 */
function blobPath(ctx: CanvasRenderingContext2D, points: readonly Point2[]): void {
  const count = points.length;
  if (count < 3) return;
  ctx.beginPath();
  const first = points[0] as Point2;
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < count; i += 1) {
    const point = points[i] as Point2;
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

function drawTarget(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  target: Target,
  now: number
): void {
  const aspect = width / height;
  const outline = targetOutline(target, aspect).map((point) => ({
    x: point.x * width,
    y: point.y * height,
  }));
  const centreX = target.pos.x * width;
  const centreY = target.pos.y * height;
  const radius = Math.max(4, target.size * height);
  const colors = paletteFor(target.objectId, target.tier);

  const fade = fadeProgress(target, now);
  const age = targetAge(target, now);
  // A slow, gentle pulse as time runs out. Never a flash.
  const urgency = target.state === 'alive' && age > 0.68 ? 0.75 + 0.25 * Math.sin(now / 130) : 1;

  ctx.save();
  ctx.globalAlpha = (1 - fade) * urgency;

  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = radius * (target.tier === 'gold' ? 0.9 : 0.5);

  const gradient = ctx.createRadialGradient(
    centreX - radius * 0.3,
    centreY - radius * 0.35,
    radius * 0.1,
    centreX,
    centreY,
    radius * 1.1
  );
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.3, colors.fill);
  gradient.addColorStop(1, colors.deep);

  blobPath(ctx, outline);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.shadowBlur = 0;
  // A dark rim keeps the shape readable over any background the camera sees.
  ctx.lineWidth = Math.max(2, radius * (target.tier === 'tough' ? 0.1 : 0.07));
  ctx.strokeStyle = 'rgba(6,15,19,0.85)';
  ctx.stroke();

  // Straps, slats and the like, so a bag reads as a bag.
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = colors.edge;
  ctx.globalAlpha = (1 - fade) * urgency * 0.55;
  ctx.lineWidth = Math.max(1.5, radius * 0.06);
  for (const line of targetDetails(target, aspect)) {
    if (line.length < 2) continue;
    ctx.beginPath();
    line.forEach((point, index) => {
      const x = point.x * width;
      const y = point.y * height;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.restore();

  if (target.flash > 0.01) {
    ctx.globalAlpha = (1 - fade) * target.flash * 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.globalAlpha = (1 - fade) * urgency;
  }

  // Blocks show the damage they have taken.
  const damage = target.maxHp - target.hp;
  if (damage > 0 && target.maxHp > 1) {
    ctx.strokeStyle = 'rgba(12,20,24,0.75)';
    ctx.lineWidth = Math.max(1.5, radius * 0.05);
    for (let i = 0; i < damage; i += 1) {
      const angle = (target.id * 1.7 + i * 2.4) % (Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(centreX + Math.cos(angle) * radius * 0.15, centreY + Math.sin(angle) * radius * 0.15);
      ctx.lineTo(
        centreX + Math.cos(angle + 0.35) * radius * 0.72,
        centreY + Math.sin(angle + 0.35) * radius * 0.72
      );
      ctx.stroke();
    }
  }

  ctx.restore();
}

function drawBurst(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  burst: Burst,
  now: number
): void {
  const life = (now - burst.t0) / 520;
  if (life < 0 || life > 1) return;
  const x = burst.pos.x * width;
  const y = burst.pos.y * height;
  const base = height * 0.07 * (0.7 + burst.power * 0.8);
  const colors = paletteFor(burst.objectId, burst.tier);

  ctx.save();
  ctx.globalAlpha = 1 - life;

  // Shockwave ring.
  ctx.beginPath();
  ctx.arc(x, y, base * (0.4 + life * 2.4), 0, Math.PI * 2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, base * 0.16 * (1 - life));
  ctx.stroke();

  // Sparks.
  const count = burst.destroyed ? 14 : 8;
  ctx.fillStyle = colors.fill;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + burst.t0;
    const distance = base * (0.5 + life * (burst.destroyed ? 3.4 : 2.1));
    const size = Math.max(1, base * 0.16 * (1 - life));
    ctx.beginPath();
    ctx.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * The arm, and - when the hand model has it - every joint of the hand. Seeing
 * your own fingers move on screen is the quickest way to confirm tracking is
 * actually working.
 */
function drawFist(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fist: FistView
): void {
  const color = ARM_COLOR[fist.arm];
  const strike = { x: fist.wrist.x * width, y: fist.wrist.y * height };
  const elbow = { x: fist.elbow.x * width, y: fist.elbow.y * height };
  const shoulder = { x: fist.shoulder.x * width, y: fist.shoulder.y * height };
  const radius = height * 0.04 * (1 + fist.heat * 0.5);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Upper arm and forearm.
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.3 + fist.heat * 0.35;
  ctx.lineWidth = Math.max(3, height * 0.012);
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(elbow.x, elbow.y);
  ctx.lineTo(strike.x, strike.y);
  ctx.stroke();

  if (fist.hand) {
    const joints = fist.hand.map((point) => ({ x: point.x * width, y: point.y * height }));

    ctx.globalAlpha = 0.75 + fist.heat * 0.25;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, height * 0.007);
    for (const [a, b] of HAND_BONES) {
      const from = joints[a];
      const to = joints[b];
      if (!from || !to) continue;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    for (const joint of joints) {
      ctx.beginPath();
      ctx.arc(joint.x, joint.y, Math.max(1.6, height * 0.0055), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // The knuckles: solid when the hand is closed, a ring when it is open.
  const closed = 1 - Math.min(1, fist.openness);
  ctx.globalAlpha = 1;
  ctx.shadowColor = color;
  ctx.shadowBlur = radius * (0.6 + fist.heat * 1.8);
  ctx.beginPath();
  ctx.arc(strike.x, strike.y, radius * (0.55 + closed * 0.45), 0, Math.PI * 2);
  if (fist.hand && fist.openness > 0.6) {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, radius * 0.22);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(strike.x, strike.y, radius * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
  }

  ctx.restore();
}

function drawPopup(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  popup: Popup,
  now: number
): void {
  const life = (now - popup.t0) / 1100;
  if (life < 0 || life > 1) return;
  const rise = height * 0.12 * life;
  const x = popup.pos.x * width;
  const y = popup.pos.y * height - rise;
  const scale = popup.big ? 1.25 : 1;
  const pop = 1 + Math.max(0, 0.35 - life) * 1.2;

  ctx.save();
  ctx.globalAlpha = Math.min(1, (1 - life) * 2.2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const size = height * 0.055 * scale * pop;
  ctx.font = `700 ${size}px ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.lineWidth = size * 0.22;
  ctx.strokeStyle = 'rgba(6,15,19,0.85)';
  ctx.strokeText(popup.text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(popup.text, x, y);

  if (popup.sub) {
    const subSize = height * 0.028 * scale;
    ctx.font = `700 ${subSize}px ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif`;
    ctx.lineWidth = subSize * 0.3;
    ctx.strokeText(popup.sub, x, y + size * 0.72);
    ctx.fillStyle = '#8ee6da';
    ctx.fillText(popup.sub, x, y + size * 0.72);
  }

  ctx.restore();
}

/** The big 3 / 2 / 1 / GO overlay. */
export function drawCountdown(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  value: number,
  phase: number
): void {
  const text = value <= 0 ? 'GO' : String(value);
  const scale = 1 + (1 - phase) * 0.35;
  ctx.save();
  ctx.globalAlpha = Math.min(1, phase * 3);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const size = height * 0.3 * scale;
  ctx.font = `800 ${size}px ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.lineWidth = size * 0.12;
  ctx.strokeStyle = 'rgba(6,15,19,0.8)';
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, width / 2, height / 2);
  ctx.restore();
}
