/**
 * Runs a round of the punching game: spawning, punch handling, scoring and the
 * visual effect state. Like SessionController it lives outside React - the
 * animation loop drives it every frame and it publishes a throttled snapshot
 * for the HUD to render.
 */
import type { GameAudio } from './audio';
import { DEFAULT_OBJECT, type ObjectId } from './objects';
import {
  armFrame,
  createTrackers,
  matchHandsToArms,
  NORMAL_CONFIG,
  punchLabel,
  refineWithHand,
  scoreHit,
  trackArm,
  type Arm,
  type ArmFrame,
  type ArmTrackers,
  type HandReading,
  type PoseSample,
  type Punch,
  type PunchConfig,
  type PunchType,
  type TargetTier,
} from './punch';
import { createStore, type Store } from './store';
import {
  applyPunch,
  createTarget,
  hitOffset,
  isExpired,
  isGone,
  stepTarget,
  sweepHitsPolygon,
  targetOutline,
  type Target,
} from './targets';
import type { Point2 } from './types';

export type GameStage = 'idle' | 'countdown' | 'playing' | 'over';

/**
 * One analysed video frame. The pose model runs less often than the hand model
 * - the body frame barely changes between frames, while the fists move fast -
 * so `pose` is null on the frames where only the hands were re-read.
 */
export interface TrackingFrame {
  pose: PoseSample | null;
  hands: readonly HandReading[];
}

export const ROUND_MS = 60_000;
export const COUNTDOWN_MS = 3200;
const PUBLISH_MS = 80;

export interface GameSnapshot {
  stage: GameStage;
  score: number;
  combo: number;
  bestCombo: number;
  timeLeftMs: number;
  /** 3, 2, 1, then 0 meaning "go". */
  countdown: number;
  poseDetected: boolean;
  /** How many hands the hand model is currently tracking, 0-2. */
  handsTracked: number;
  objectId: ObjectId;
  punches: number;
  hits: number;
  destroyed: number;
  missed: number;
  byType: Record<PunchType, number>;
  /** Drives the "nice one" flourish in the HUD. */
  lastHitAt: number;
}

export interface GameResult {
  at: string;
  score: number;
  bestCombo: number;
  punches: number;
  hits: number;
  destroyed: number;
  missed: number;
  byType: Record<PunchType, number>;
  durationMs: number;
}

export interface Burst {
  pos: Point2;
  t0: number;
  power: number;
  tier: TargetTier;
  objectId: ObjectId;
  destroyed: boolean;
}

export interface Popup {
  pos: Point2;
  text: string;
  sub: string;
  t0: number;
  big: boolean;
}

export interface FistView {
  arm: Arm;
  /** The striking point: knuckles when the hand is tracked, wrist otherwise. */
  wrist: Point2;
  elbow: Point2;
  shoulder: Point2;
  /** 1 right after a punch, decaying - drives the glow. */
  heat: number;
  /** All 21 hand joints, when the hand model has them. */
  hand: Point2[] | null;
  /** 0 is a tight fist, 1 is an open hand. */
  openness: number;
  source: 'pose' | 'hand';
}

export interface RenderState {
  stage: GameStage;
  now: number;
  aspect: number;
  targets: readonly Target[];
  bursts: readonly Burst[];
  popups: readonly Popup[];
  fists: readonly FistView[];
  shake: number;
  combo: number;
}

const EMPTY_BY_TYPE: Record<PunchType, number> = { straight: 0, hook: 0, uppercut: 0 };

function idleSnapshot(): GameSnapshot {
  return {
    stage: 'idle',
    score: 0,
    combo: 0,
    bestCombo: 0,
    timeLeftMs: ROUND_MS,
    countdown: 3,
    poseDetected: false,
    handsTracked: 0,
    objectId: DEFAULT_OBJECT,
    punches: 0,
    hits: 0,
    destroyed: 0,
    missed: 0,
    byType: { ...EMPTY_BY_TYPE },
    lastHitAt: 0,
  };
}

export class GameController {
  readonly store: Store<GameSnapshot>;

  private audio: GameAudio | null;
  private random: () => number;
  private config: PunchConfig = NORMAL_CONFIG;

  private stage: GameStage = 'idle';
  private stageStart = 0;
  private lastNow: number | null = null;
  private lastPublish = 0;
  private lastCountdownBeep = -1;

  private trackers: ArmTrackers = createTrackers();
  private fists = new Map<Arm, FistView>();
  private poseDetected = false;
  private handsTracked = 0;
  /** The body frame is re-read less often than the hands; this is the last one. */
  private lastPose: PoseSample | null = null;
  private objectId: ObjectId = DEFAULT_OBJECT;
  private aspect = 16 / 9;

  private targets: Target[] = [];
  private bursts: Burst[] = [];
  private popups: Popup[] = [];
  private shake = 0;
  private nextSpawnAt = 0;

  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private punches = 0;
  private hits = 0;
  private destroyed = 0;
  private missed = 0;
  private byType: Record<PunchType, number> = { ...EMPTY_BY_TYPE };
  private lastHitAt = 0;
  private result: GameResult | null = null;

  constructor(audio: GameAudio | null = null, random: () => number = Math.random) {
    this.audio = audio;
    this.random = random;
    this.store = createStore(idleSnapshot());
  }

  /* ---------------- commands ---------------- */

  setConfig(config: PunchConfig): void {
    this.config = config;
  }

  /** Which object the player wants to hit. Takes effect on the next spawn. */
  setObject(objectId: ObjectId): void {
    this.objectId = objectId;
    this.publish(true);
  }

  setAudio(audio: GameAudio | null): void {
    this.audio = audio;
  }

  start(now: number): void {
    this.resetRound();
    this.stage = 'countdown';
    this.stageStart = now;
    this.lastNow = now;
    this.lastCountdownBeep = -1;
    this.publish(true);
  }

  /** Ends the round early, keeping the score so far. */
  finish(now: number): void {
    if (this.stage !== 'playing' && this.stage !== 'countdown') return;
    this.endRound(now);
  }

  reset(): void {
    this.resetRound();
    this.stage = 'idle';
    this.store.set(idleSnapshot());
  }

  getResult(): GameResult | null {
    return this.result;
  }

  getRenderState(): RenderState {
    return {
      stage: this.stage,
      now: this.lastNow ?? 0,
      aspect: this.aspect,
      targets: this.targets,
      bursts: this.bursts,
      popups: this.popups,
      fists: [...this.fists.values()],
      shake: this.shake,
      combo: this.combo,
    };
  }

  /* ---------------- the loop ---------------- */

  /**
   * One animation frame. `frame` is present only when the video produced a new
   * image to analyse, so physics runs at display rate and tracking at camera
   * rate. Its pose may be null on frames where only the hands were re-read.
   */
  update(now: number, frame: TrackingFrame | null): void {
    const dt = this.lastNow === null ? 0 : Math.min(0.05, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;

    if (frame) this.readFrame(now, frame);
    for (const fist of this.fists.values()) fist.heat = Math.max(0, fist.heat - dt * 3.5);

    if (this.stage === 'countdown') this.tickCountdown(now);
    if (this.stage === 'playing') this.tickRound(now, dt);

    this.stepEffects(now, dt);
    this.publish(false);
  }

  private tickCountdown(now: number): void {
    const elapsed = now - this.stageStart;
    const remaining = Math.max(0, Math.ceil((COUNTDOWN_MS - elapsed) / 1000) - 1);
    if (remaining !== this.lastCountdownBeep) {
      this.lastCountdownBeep = remaining;
      this.audio?.countdown(remaining);
    }
    if (elapsed >= COUNTDOWN_MS) {
      this.stage = 'playing';
      this.stageStart = now;
      this.nextSpawnAt = now + 350;
      this.publish(true);
    }
  }

  private tickRound(now: number, dt: number): void {
    const elapsed = now - this.stageStart;
    if (elapsed >= ROUND_MS) {
      this.endRound(now);
      return;
    }
    const progress = Math.min(1, elapsed / ROUND_MS);

    for (const target of this.targets) stepTarget(target, dt);

    // A target that times out breaks the streak; wild swings never do.
    for (const target of this.targets) {
      if (isExpired(target, now)) {
        target.state = 'dying';
        target.diedAt = now;
        target.vel.y += 0.35;
        this.missed += 1;
        this.combo = 0;
        this.audio?.expire();
      }
    }
    this.targets = this.targets.filter((target) => !isGone(target, now));

    // Busier than a precision game wants: the point is to have something to
    // hit whenever you look up, not to hunt for targets.
    const maxActive = 3 + Math.floor(progress * 2.4);
    const alive = this.targets.filter((target) => target.state === 'alive').length;
    const interval = 950 - progress * 430;
    if (now >= this.nextSpawnAt && alive < maxActive) {
      this.spawn(now, progress);
      this.nextSpawnAt = now + interval;
    }
  }

  private endRound(now: number): void {
    this.stage = 'over';
    this.stageStart = now;
    this.audio?.roundEnd();
    this.result = {
      at: new Date().toISOString(),
      score: this.score,
      bestCombo: this.bestCombo,
      punches: this.punches,
      hits: this.hits,
      destroyed: this.destroyed,
      missed: this.missed,
      byType: { ...this.byType },
      durationMs: ROUND_MS,
    };
    this.publish(true);
  }

  /* ---------------- pose and punches ---------------- */

  private readFrame(now: number, frame: TrackingFrame): void {
    if (frame.pose) this.lastPose = frame.pose;
    const pose = this.lastPose;
    this.handsTracked = frame.hands.length;
    if (!pose) {
      this.poseDetected = false;
      return;
    }
    this.aspect = pose.aspect;

    const posed = { left: armFrame(pose, 'left'), right: armFrame(pose, 'right') };
    const hands = matchHandsToArms(frame.hands, posed);

    let seen = false;
    for (const arm of ['left', 'right'] as const) {
      const hand = hands[arm];
      // The hand model's knuckles beat the pose model's single wrist point,
      // but hands drop out during fast motion, so the wrist is the fallback.
      const armed = posed[arm] && hand ? refineWithHand(posed[arm]!, hand) : posed[arm];

      if (armed) {
        seen = true;
        this.rememberFist(arm, armed, hand);
      } else {
        this.fists.delete(arm);
      }

      const tracked = trackArm(this.trackers[arm], arm, armed, now, this.config);
      this.trackers[arm] = tracked.state;
      if (tracked.punch && this.stage === 'playing') this.handlePunch(tracked.punch);
    }

    this.poseDetected = seen;
  }

  private rememberFist(arm: Arm, frame: ArmFrame, hand: HandReading | null): void {
    const existing = this.fists.get(arm);
    this.fists.set(arm, {
      arm,
      wrist: frame.screen,
      elbow: frame.elbowScreen,
      shoulder: frame.shoulderScreen,
      heat: existing?.heat ?? 0,
      hand: hand ? hand.points : null,
      openness: hand ? hand.openness : 0,
      source: frame.source,
    });
  }

  private handlePunch(punch: Punch): void {
    this.punches += 1;
    this.byType[punch.type] += 1;
    const fist = this.fists.get(punch.arm);
    if (fist) fist.heat = 1;

    const struck = this.findTarget(punch);
    if (!struck) {
      this.audio?.whoosh(punch.power);
      return;
    }

    const { target, point, offset } = struck;
    applyPunch(target, punch, point);

    const breakdown = scoreHit(target.tier, punch, this.combo, offset);
    this.score += breakdown.total;
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.hits += 1;
    this.lastHitAt = punch.at;
    this.shake = Math.min(1, this.shake + 0.35 + punch.power * 0.5);

    this.audio?.hit(punch.power, punch.type, target.objectId);
    if (this.combo >= 2) this.audio?.combo(this.combo);

    const finished = target.state === 'dying';
    if (finished) {
      this.destroyed += 1;
      this.audio?.destroy(target.tier, target.objectId);
    }

    this.bursts.push({
      pos: { ...point },
      t0: punch.at,
      power: punch.power,
      tier: target.tier,
      objectId: target.objectId,
      destroyed: finished,
    });

    const parts = [punchLabel(punch.type)];
    if (breakdown.perfect) parts.push('PERFECT');
    if (breakdown.combo > 1) parts.push(`x${breakdown.combo}`);
    this.popups.push({
      pos: { x: target.pos.x, y: target.pos.y - target.size * 0.6 },
      text: `+${breakdown.total}`,
      sub: parts.join('  '),
      t0: punch.at,
      big: breakdown.perfect || punch.type === 'uppercut',
    });
  }

  /**
   * The first target the fist's path reaches, tested against each object's
   * actual deformed outline rather than a circle around it - so a punch that
   * looks like it grazed the leg of a chair really did.
   */
  private findTarget(punch: Punch): { target: Target; point: Point2; offset: number } | null {
    let best: { target: Target; point: Point2; offset: number } | null = null;
    let bestDistance = Infinity;

    for (const target of this.targets) {
      if (target.state !== 'alive') continue;
      const outline = targetOutline(target, this.aspect);
      const point = sweepHitsPolygon(punch.from, punch.to, outline);
      if (!point) continue;
      const travelled = Math.hypot(
        (point.x - punch.from.x) * this.aspect,
        point.y - punch.from.y
      );
      if (travelled < bestDistance) {
        bestDistance = travelled;
        best = { target, point, offset: hitOffset(target, outline, point, this.aspect) };
      }
    }
    return best;
  }

  /* ---------------- spawning and effects ---------------- */

  private spawn(now: number, progress: number): void {
    const roll = this.random();
    const tier: TargetTier = roll < 0.09 ? 'gold' : roll < 0.09 + progress * 0.32 ? 'tough' : 'normal';

    let pos: Point2 | null = null;
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const candidate = {
        x: 0.14 + this.random() * 0.72,
        y: 0.2 + this.random() * 0.54,
      };
      const tooCloseToFist = [...this.fists.values()].some(
        (fist) => Math.hypot((fist.wrist.x - candidate.x) * this.aspect, fist.wrist.y - candidate.y) < 0.17
      );
      const overlapping = this.targets.some(
        (target) =>
          target.state === 'alive' &&
          Math.hypot((target.pos.x - candidate.x) * this.aspect, target.pos.y - candidate.y) <
            target.size * 1.9
      );
      if (!tooCloseToFist && !overlapping) {
        pos = candidate;
        break;
      }
      pos = candidate;
    }
    if (!pos) return;

    this.targets.push(createTarget(this.objectId, tier, pos, now, this.random));
    this.audio?.spawn();
  }

  private stepEffects(now: number, dt: number): void {
    if (this.stage === 'over') {
      for (const target of this.targets) stepTarget(target, dt);
      this.targets = this.targets.filter((target) => !isGone(target, now));
    }
    this.shake = Math.max(0, this.shake - dt * 2.6);
    this.bursts = this.bursts.filter((burst) => now - burst.t0 < 520);
    this.popups = this.popups.filter((popup) => now - popup.t0 < 1100);
  }

  private resetRound(): void {
    this.trackers = createTrackers();
    this.targets = [];
    this.bursts = [];
    this.popups = [];
    this.shake = 0;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.punches = 0;
    this.hits = 0;
    this.destroyed = 0;
    this.missed = 0;
    this.byType = { ...EMPTY_BY_TYPE };
    this.lastHitAt = 0;
    this.result = null;
  }

  private publish(force: boolean): void {
    const now = this.lastNow ?? 0;
    if (!force && now - this.lastPublish < PUBLISH_MS) return;
    this.lastPublish = now;

    const elapsed = now - this.stageStart;
    this.store.set({
      stage: this.stage,
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      timeLeftMs:
        this.stage === 'playing' ? Math.max(0, ROUND_MS - elapsed) : this.stage === 'over' ? 0 : ROUND_MS,
      countdown: this.stage === 'countdown' ? Math.max(0, Math.ceil((COUNTDOWN_MS - elapsed) / 1000) - 1) : 0,
      poseDetected: this.poseDetected,
      handsTracked: this.handsTracked,
      objectId: this.objectId,
      punches: this.punches,
      hits: this.hits,
      destroyed: this.destroyed,
      missed: this.missed,
      byType: { ...this.byType },
      lastHitAt: this.lastHitAt,
    });
  }
}
