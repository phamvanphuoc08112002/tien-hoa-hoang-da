import type { Settings } from './settings';

export type Sfx =
  | 'step'
  | 'attack'
  | 'hit'
  | 'hurt'
  | 'eat'
  | 'drink'
  | 'coin'
  | 'pickup'
  | 'dodge'
  | 'skill'
  | 'levelup'
  | 'evolveStart'
  | 'evolveDone'
  | 'interrupt'
  | 'death'
  | 'ui'
  | 'warn'
  | 'telegraph'
  | 'npcDie';

const PENTA = [0, 2, 4, 7, 9];

/**
 * All sound is synthesized with Web Audio. The context is created lazily on
 * the first user gesture (`unlock`) to satisfy browser autoplay rules.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private ambBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  private rainGain: GainNode | null = null;
  private droneOsc: OscillatorNode[] = [];
  private droneGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private nextBeat = 0;
  private beat = 0;
  private night = false;
  private ambientCooldown = 2;
  private lastStep = 0;
  private settings: Settings = { music: 0.5, sfx: 0.7, muted: false, graphics3d: true };

  get ready(): boolean {
    return this.ctx !== null;
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return;
    const ctx: AudioContext = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes();
  }

  setSettings(s: Settings): void {
    this.settings = { ...s };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.55, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.settings.sfx * 0.8, t, 0.1);
  }

  // ---- primitives ----
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, opts: { slideTo?: number; attack?: number; delay?: number; bus?: GainNode } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t0 + dur);
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(opts.bus ?? this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType, opts: { q?: number; slideTo?: number; delay?: number; bus?: GainNode; attack?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) f.frequency.exponentialRampToValueAtTime(opts.slideTo, t0 + dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(opts.bus ?? this.sfxBus);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  play(name: Sfx): void {
    if (!this.ctx) return;
    const r = () => 0.92 + Math.random() * 0.16;
    switch (name) {
      case 'step': {
        const now = this.ctx.currentTime;
        if (now - this.lastStep < 0.12) return;
        this.lastStep = now;
        this.noise(0.07, 0.07, 700 * r(), 'lowpass', { q: 0.8 });
        break;
      }
      case 'attack':
        this.noise(0.16, 0.22, 2400 * r(), 'bandpass', { q: 1.2, slideTo: 600 });
        break;
      case 'hit':
        this.tone(160 * r(), 0.14, 'square', 0.18, { slideTo: 60 });
        this.noise(0.08, 0.2, 1800, 'lowpass');
        break;
      case 'hurt':
        this.tone(320 * r(), 0.22, 'sawtooth', 0.14, { slideTo: 110 });
        this.noise(0.1, 0.18, 900, 'lowpass');
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) this.noise(0.06, 0.16, 1500 * r(), 'bandpass', { q: 3, delay: i * 0.13 });
        break;
      case 'drink':
        for (let i = 0; i < 3; i++) this.tone(420 * r() + i * 60, 0.12, 'sine', 0.16, { slideTo: 900, delay: i * 0.18 });
        break;
      case 'coin':
        this.tone(988, 0.09, 'square', 0.08);
        this.tone(1319, 0.22, 'square', 0.08, { delay: 0.08 });
        break;
      case 'pickup':
        this.tone(660, 0.1, 'triangle', 0.14, { slideTo: 990 });
        break;
      case 'dodge':
        this.noise(0.18, 0.14, 800, 'bandpass', { q: 0.7, slideTo: 3000 });
        break;
      case 'skill':
        this.tone(220, 0.3, 'sawtooth', 0.1, { slideTo: 660 });
        this.noise(0.3, 0.12, 1200, 'bandpass', { q: 1.5, slideTo: 4000 });
        break;
      case 'levelup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.14, { delay: i * 0.09 }));
        break;
      case 'evolveStart':
        this.tone(130, 1.6, 'sine', 0.2, { slideTo: 260, attack: 0.4 });
        break;
      case 'evolveDone':
        [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.9, 'triangle', 0.12, { delay: i * 0.08 }));
        this.noise(1.4, 0.12, 6000, 'highpass', { attack: 0.05 });
        break;
      case 'interrupt':
        this.tone(440, 0.4, 'square', 0.1, { slideTo: 110 });
        break;
      case 'death':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.14, { delay: i * 0.22 }));
        break;
      case 'ui':
        this.tone(880, 0.06, 'triangle', 0.08);
        break;
      case 'warn':
        this.tone(330, 0.15, 'square', 0.06);
        this.tone(330, 0.15, 'square', 0.06, { delay: 0.2 });
        break;
      case 'telegraph':
        this.tone(110, 0.5, 'sawtooth', 0.08, { slideTo: 220, attack: 0.2 });
        break;
      case 'npcDie':
        this.tone(260, 0.3, 'triangle', 0.12, { slideTo: 90 });
        break;
    }
  }

  // ---- loops ----
  setRain(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.rainGain) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2200;
      f.Q.value = 0.5;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0;
      src.connect(f).connect(this.rainGain).connect(this.ambBus);
      src.start();
    }
    this.rainGain.gain.setTargetAtTime(intensity * 0.22, ctx.currentTime, 0.8);
  }

  setEvolveDrone(on: boolean, progress = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.droneGain) {
      this.droneGain = ctx.createGain();
      this.droneGain.gain.value = 0.0001;
      this.droneGain.connect(this.sfxBus);
      for (const f of [110, 165, 220.5]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(this.droneGain);
        o.start();
        this.droneOsc.push(o);
      }
    }
    if (this.droneGain) {
      if (on) {
        this.droneGain.gain.setTargetAtTime(0.05 + progress * 0.08, ctx.currentTime, 0.2);
        this.droneOsc.forEach((o, i) => o.frequency.setTargetAtTime([110, 165, 220.5][i] * (1 + progress), ctx.currentTime, 0.3));
      } else {
        const g = this.droneGain;
        const oscs = this.droneOsc;
        g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.1);
        oscs.forEach((o) => o.stop(ctx.currentTime + 0.6));
        this.droneGain = null;
        this.droneOsc = [];
      }
    }
  }

  /** Called every frame by the game with simulated dt; schedules ambient one-shots. */
  updateAmbient(dt: number, night: boolean, raining: boolean): void {
    if (!this.ctx) return;
    this.night = night;
    this.ambientCooldown -= dt;
    if (this.ambientCooldown > 0) return;
    this.ambientCooldown = 2 + Math.random() * 5;
    if (raining) return;
    if (night) {
      // crickets
      for (let i = 0; i < 4; i++) this.tone(4200 + Math.random() * 300, 0.04, 'sine', 0.025, { delay: i * 0.07, bus: this.ambBus });
    } else {
      // bird chirp
      const base = 1800 + Math.random() * 1200;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
        this.tone(base, 0.09, 'sine', 0.035, { slideTo: base * 1.4, delay: i * 0.13, bus: this.ambBus });
      }
    }
  }

  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    this.nextBeat = this.ctx.currentTime + 0.2;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 150);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  stopLoops(): void {
    this.stopMusic();
    this.setRain(0);
    this.setEvolveDrone(false);
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const beatLen = 0.75;
    while (this.nextBeat < ctx.currentTime + 0.6) {
      const t = this.nextBeat - ctx.currentTime;
      const root = this.night ? 196 : 262;
      const bar = Math.floor(this.beat / 8) % 4;
      const prog = this.night ? [0, -4, -2, -5] : [0, 5, -3, 7];
      const chordRoot = root * Math.pow(2, prog[bar] / 12);
      if (this.beat % 8 === 0) {
        for (const iv of [0, 7, 12]) {
          this.tone(chordRoot * Math.pow(2, iv / 12) / 2, beatLen * 7.5, 'triangle', 0.05, { attack: 1.2, delay: t, bus: this.musicBus });
        }
      }
      if (Math.random() < (this.night ? 0.3 : 0.5)) {
        const deg = PENTA[Math.floor(Math.random() * PENTA.length)] + (Math.random() < 0.3 ? 12 : 0);
        this.tone(chordRoot * Math.pow(2, deg / 12), beatLen * 1.6, 'sine', 0.05, { attack: 0.04, delay: t, bus: this.musicBus });
      }
      this.nextBeat += beatLen;
      this.beat++;
    }
  }
}

export const audio = new AudioSystem();
