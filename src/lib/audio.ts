/**
 * Every sound in the game is synthesised with the Web Audio API. Nothing is
 * downloaded, which keeps the "no third-party requests" promise intact and
 * means there are no audio files in the repo.
 *
 * The punch sound is the classic three-layer recipe: a bright transient for the
 * slap, a low sine whose pitch drops fast for the body of the thud, and a band
 * of noise for the crunch. Small random detunes stop repeated hits sounding
 * like a loop.
 */
import type { ObjectId } from './objects';
import type { PunchType, TargetTier } from './punch';

/**
 * Each object sounds like what it is: a pillow is a dull thump, a crate is a
 * woody crack. `body` is the pitch of the low thud, `crunch` the centre of the
 * noise band, `rattle` adds the short square blips that read as timber.
 */
const TIMBRE: Record<ObjectId, {
  body: number;
  decay: number;
  crunch: number;
  crunchGain: number;
  rattle: boolean;
}> = {
  ball: { body: 200, decay: 0.15, crunch: 900, crunchGain: 0.8, rattle: false },
  pillow: { body: 145, decay: 0.2, crunch: 560, crunchGain: 0.35, rattle: false },
  bag: { body: 128, decay: 0.26, crunch: 820, crunchGain: 0.95, rattle: false },
  crate: { body: 225, decay: 0.12, crunch: 1900, crunchGain: 1.25, rattle: true },
  chair: { body: 265, decay: 0.1, crunch: 2400, crunchGain: 1.4, rattle: true },
};

type Ctx = AudioContext;

export class GameAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;

  /** Must be called from a user gesture, or browsers will not allow sound. */
  async unlock(): Promise<void> {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        /* A blocked resume just means the round plays silently. */
      }
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.55, this.ctx.currentTime, 0.02);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  close(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }

  private ensure(): Ctx | null {
    if (this.ctx) return this.ctx;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.55;

    // Glues the hits together and keeps a flurry of punches from clipping.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    master.connect(compressor);
    compressor.connect(ctx.destination);

    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  private noise(ctx: Ctx): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(ctx.sampleRate * 0.7);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** A burst of filtered noise with a percussive envelope. */
  private burst(
    ctx: Ctx,
    options: {
      at: number;
      duration: number;
      gain: number;
      type: BiquadFilterType;
      from: number;
      to?: number;
      q?: number;
    }
  ): void {
    if (!this.master) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise(ctx);
    source.playbackRate.value = 0.85 + Math.random() * 0.3;

    const filter = ctx.createBiquadFilter();
    filter.type = options.type;
    filter.frequency.setValueAtTime(options.from, options.at);
    if (options.to !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.to), options.at + options.duration);
    }
    filter.Q.value = options.q ?? 1;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, options.at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), options.at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, options.at + options.duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(options.at);
    source.stop(options.at + options.duration + 0.05);
  }

  /** A pitched tone, optionally sweeping. */
  private tone(
    ctx: Ctx,
    options: {
      at: number;
      duration: number;
      gain: number;
      from: number;
      to?: number;
      type?: OscillatorType;
      attack?: number;
    }
  ): void {
    if (!this.master) return;
    const osc = ctx.createOscillator();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(options.from, options.at);
    if (options.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), options.at + options.duration);
    }

    const gain = ctx.createGain();
    const attack = options.attack ?? 0.002;
    gain.gain.setValueAtTime(0.0001, options.at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, options.gain), options.at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, options.at + options.duration);

    osc.connect(gain);
    gain.connect(this.master);
    osc.start(options.at);
    osc.stop(options.at + options.duration + 0.05);
  }

  /** The fist connecting with a particular object. */
  hit(power: number, type: PunchType, objectId: ObjectId = 'ball'): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const strength = 0.45 + Math.max(0, Math.min(1, power)) * 0.55;
    const detune = 0.9 + Math.random() * 0.25;
    const timbre = TIMBRE[objectId];

    // 1. The slap.
    this.burst(ctx, { at: now, duration: 0.03, gain: 0.32 * strength, type: 'highpass', from: 2600, q: 0.7 });
    // 2. The body - a low sine dropping fast is what reads as "thud".
    this.tone(ctx, {
      at: now,
      duration: timbre.decay,
      gain: 0.95 * strength,
      from: timbre.body * detune,
      to: Math.max(30, timbre.body * 0.23),
      type: 'sine',
      attack: 0.001,
    });
    // 3. The crunch, tilted by how the punch was thrown.
    const centre = timbre.crunch * (type === 'hook' ? 1.3 : type === 'uppercut' ? 0.85 : 1);
    this.burst(ctx, {
      at: now + 0.004,
      duration: type === 'hook' ? 0.1 : 0.07,
      gain: 0.3 * strength * timbre.crunchGain,
      type: 'bandpass',
      from: centre * detune,
      to: centre * 0.45,
      q: 1.3,
    });

    // 4. Timber rattles; a pillow does not.
    if (timbre.rattle) {
      this.tone(ctx, {
        at: now + 0.012,
        duration: 0.06,
        gain: 0.14 * strength,
        from: 380 * detune,
        to: 180,
        type: 'square',
        attack: 0.002,
      });
    }

    if (type === 'uppercut') {
      // A lift, because the target is going up.
      this.tone(ctx, {
        at: now + 0.01,
        duration: 0.16,
        gain: 0.28 * strength,
        from: 300,
        to: 820,
        type: 'triangle',
        attack: 0.01,
      });
    }
  }

  /** A punch that met nothing but air. */
  whoosh(power: number): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const strength = 0.3 + Math.max(0, Math.min(1, power)) * 0.7;
    this.burst(ctx, {
      at: ctx.currentTime,
      duration: 0.2,
      gain: 0.1 * strength,
      type: 'bandpass',
      from: 520,
      to: 2300,
      q: 2.4,
    });
  }

  /** A target finished off. */
  destroy(tier: TargetTier, objectId: ObjectId = 'ball'): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const timbre = TIMBRE[objectId];

    if (tier === 'gold') {
      [740, 988, 1319].forEach((frequency, index) => {
        this.tone(ctx, {
          at: now + index * 0.055,
          duration: 0.18,
          gain: 0.3,
          from: frequency,
          type: 'triangle',
          attack: 0.006,
        });
      });
      return;
    }

    this.burst(ctx, {
      at: now,
      duration: 0.26,
      gain: 0.32 * (timbre.rattle ? 1.1 : 0.8),
      type: 'lowpass',
      from: timbre.rattle ? 7500 : 3800,
      to: 420,
      q: 0.8,
    });
    const base = timbre.body * 2.6;
    [base, base * 0.76, base * 0.56].forEach((frequency, index) => {
      this.tone(ctx, {
        at: now + index * 0.035,
        duration: 0.09,
        gain: 0.15,
        from: frequency,
        type: timbre.rattle ? 'square' : 'triangle',
        attack: 0.003,
      });
    });
  }

  /** Rising ladder as the streak climbs. */
  combo(streak: number): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const steps = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
    const step = steps[Math.min(steps.length - 1, Math.max(0, streak - 2))] ?? 0;
    this.tone(ctx, {
      at: ctx.currentTime,
      duration: 0.13,
      gain: 0.22,
      from: 440 * Math.pow(2, step / 12),
      type: 'triangle',
      attack: 0.005,
    });
  }

  /** A target timed out. Soft, never a buzzer. */
  expire(): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    this.tone(ctx, {
      at: ctx.currentTime,
      duration: 0.22,
      gain: 0.16,
      from: 300,
      to: 150,
      type: 'sine',
      attack: 0.012,
    });
  }

  spawn(): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    this.tone(ctx, { at: ctx.currentTime, duration: 0.1, gain: 0.08, from: 520, to: 700, type: 'sine', attack: 0.01 });
  }

  countdown(remaining: number): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const go = remaining <= 0;
    this.tone(ctx, {
      at: ctx.currentTime,
      duration: go ? 0.32 : 0.12,
      gain: go ? 0.32 : 0.2,
      from: go ? 880 : 560,
      type: 'triangle',
      attack: 0.005,
    });
  }

  roundEnd(): void {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    [523, 440, 349].forEach((frequency, index) => {
      this.tone(ctx, {
        at: now + index * 0.13,
        duration: 0.4,
        gain: 0.26,
        from: frequency,
        type: 'triangle',
        attack: 0.01,
      });
    });
  }
}
