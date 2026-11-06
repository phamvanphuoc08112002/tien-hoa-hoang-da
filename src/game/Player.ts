import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { SKILLS } from '../data/skills';
import type { Diet, FormDef, SkillDef, SpeciesDef, Stats, Weather } from '../data/types';
import { ensurePlayerTexture } from '../gfx/textures';
import type { AudioSystem } from '../systems/audio';
import { Cooldowns } from '../systems/combat';
import { computeStats, formOf, powerScore, speciesOf, type PlayerState } from '../systems/playerState';
import { RestController, StaminaClock, fatigueSpeedMult } from '../systems/survival';
import { moveCircle } from '../world/collision';
import type { WorldData } from '../world/tiles';
import type { CombatSystem } from './CombatSystem';
import type { Effects, ParticleKind } from './Effects';
import type { PlayerInfo } from './Npcs';

export interface PlayerInput {
  mx: number;
  my: number;
  sprint: boolean;
  aim: number;
  attack: boolean;
  q: boolean;
  r: boolean;
  dodge: boolean;
}

export interface PlayerEnv {
  world: WorldData;
  combat: CombatSystem;
  fx: Effects;
  audio: AudioSystem;
  now: number;
  weather: Weather;
}

type ActionKind = 'attack' | 'skill' | 'eat' | 'drink';

interface Action {
  kind: ActionKind;
  t: number;
  total: number;
  dir: number;
  onDone: () => void;
  moveMult: number;
}

interface Buff {
  until: number;
  defenseMult: number;
  regen: number;
  speedMult: number;
  color: number;
}

export class Player implements PlayerInfo {
  readonly uid = 1;
  readonly isPlayer = true;
  readonly kind = 'player';
  alive = true;
  kbx = 0;
  kby = 0;
  iframes = 0;
  inShelter = false;
  evolving = false;
  radius = 12;
  stats!: Stats;
  form!: FormDef;
  species: SpeciesDef;

  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  aura: Phaser.GameObjects.Image;
  texKey = '';
  private curAnim = '';

  rest = new RestController();
  stam = new StaminaClock();
  cds = new Cooldowns();
  action: Action | null = null;
  private vx = 0;
  private vy = 0;
  private dodgeT = 0;
  private dodgeVx = 0;
  private dodgeVy = 0;
  private dashT = 0;
  private dashVx = 0;
  private dashVy = 0;
  stunT = 0;
  buff: Buff | null = null;
  moving = false;
  sprinting = false;
  facing = 1;
  private stepT = 0;
  private outOfStaminaLock = 0;
  hurtFlash = 0;

  constructor(
    private scene: Phaser.Scene,
    public state: PlayerState,
  ) {
    this.species = speciesOf(state);
    this.shadow = scene.add.image(state.x, state.y, 'shadow');
    this.aura = scene.add.image(state.x, state.y, 'glow').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.sprite = scene.add.sprite(state.x, state.y, 'shadow');
    this.refreshForm();
  }

  // ---- Creature / PlayerInfo ----
  get x(): number {
    return this.state.x;
  }
  set x(v: number) {
    this.state.x = v;
  }
  get y(): number {
    return this.state.y;
  }
  set y(v: number) {
    this.state.y = v;
  }
  get hp(): number {
    return this.state.hp;
  }
  set hp(v: number) {
    this.state.hp = v;
  }
  get maxHp(): number {
    return this.stats.maxHp;
  }
  get diet(): Diet {
    return this.species.diet;
  }
  get sleeping(): boolean {
    return this.rest.mode === 'sleeping' && this.rest.settled;
  }
  get score(): number {
    return powerScore(this.stats.power, this.stats.maxHp);
  }
  get canClimb(): boolean {
    return this.form.canClimbLedges;
  }
  defense(): number {
    let d = this.stats.defense;
    if (this.buff) d *= this.buff.defenseMult;
    if (this.sleeping && !this.inShelter) d *= 0.8;
    return d;
  }

  skillQ(): SkillDef {
    return SKILLS[this.form.skillQ];
  }
  skillR(): SkillDef | null {
    return this.form.skillR ? SKILLS[this.form.skillR] : null;
  }

  /** Re-reads form/level data and swaps textures (after evolution, level-up or colour change). */
  refreshForm(): void {
    this.form = formOf(this.state);
    this.stats = computeStats(this.state);
    this.radius = this.form.radius;
    this.texKey = ensurePlayerTexture(this.scene, this.state.speciesId, this.state.form, this.state.colorVariant);
    const s = this.form.art.size * 2;
    this.sprite.setTexture(this.texKey, 0).setOrigin(0.5, (s - 4) / s);
    this.shadow.setDisplaySize(this.radius * 2.6, this.radius * 0.9);
    this.curAnim = '';
    this.play('idle');
  }

  recomputeStats(): void {
    this.stats = computeStats(this.state);
  }

  play(name: string): void {
    if (this.curAnim === name) return;
    this.curAnim = name;
    this.sprite.play(`${this.texKey}:${name}`, true);
  }

  get busy(): boolean {
    return !!this.action || this.dodgeT > 0 || this.dashT > 0 || this.stunT > 0;
  }

  get inCombatAction(): boolean {
    return !!this.action && (this.action.kind === 'attack' || this.action.kind === 'skill');
  }

  cancelAction(): void {
    if (this.action && (this.action.kind === 'eat' || this.action.kind === 'drink')) this.action = null;
  }

  startTimedAction(kind: 'eat' | 'drink', sec: number, onDone: () => void): boolean {
    if (this.busy || this.evolving) return false;
    this.rest.wake();
    this.action = { kind, t: sec, total: sec, dir: this.facing > 0 ? 0 : Math.PI, onDone, moveMult: 0 };
    return true;
  }

  stun(sec: number): void {
    this.stunT = Math.max(this.stunT, sec);
    if (this.action && this.action.kind !== 'skill') {
      if (this.action.kind === 'attack') this.pendingFire = null;
      this.action = null;
    }
  }

  update(dt: number, input: PlayerInput, env: PlayerEnv): void {
    this.iframes = Math.max(0, this.iframes - dt);
    this.stunT = Math.max(0, this.stunT - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.outOfStaminaLock = Math.max(0, this.outOfStaminaLock - dt);
    this.cds.tick(dt);
    if (this.buff && env.now >= this.buff.until) this.buff = null;

    if (!this.alive) {
      this.play('dead');
      this.syncSprite();
      return;
    }

    this.tickPending(dt);
    if (this.action) {
      this.action.t -= dt;
      if (this.action.t <= 0) {
        const a = this.action;
        this.action = null;
        a.onDone();
      }
    }

    const wantsMove = input.mx !== 0 || input.my !== 0;
    if (this.evolving) {
      this.vx = this.vy = 0;
    } else {
      if (this.rest.mode !== 'awake' && (wantsMove || input.attack || input.q || input.r || input.dodge)) this.rest.wake();
      const canAct = !this.busy && this.rest.mode === 'awake';

      if (input.dodge && canAct && this.cds.ready('dodge')) {
        if (this.stam.spend(this.state, BALANCE.combat.dodgeStamina * this.form.staminaCostMult)) {
          const ang = wantsMove ? Math.atan2(input.my, input.mx) : input.aim;
          this.dodgeT = BALANCE.combat.dodgeDurationSec;
          this.dodgeVx = Math.cos(ang) * BALANCE.combat.dodgeSpeed;
          this.dodgeVy = Math.sin(ang) * BALANCE.combat.dodgeSpeed;
          this.iframes = Math.max(this.iframes, BALANCE.combat.dodgeDurationSec + 0.05);
          this.cds.start('dodge', BALANCE.combat.dodgeCooldownSec);
          env.fx.burst(this.x, this.y, 'dust', 6, { speed: 70, life: 0.4 });
          env.audio.play('dodge');
        }
      } else if (input.attack && canAct && this.cds.ready('basic')) {
        this.startBasic(input.aim, env);
      } else if (input.q && canAct) {
        this.startSkill('q', input.aim, env);
      } else if (input.r && canAct) {
        this.startSkill('r', input.aim, env);
      }
    }

    // ---- movement ----
    const len = Math.hypot(input.mx, input.my) || 1;
    const dirX = this.evolving || this.rest.mode !== 'awake' ? 0 : input.mx / len;
    const dirY = this.evolving || this.rest.mode !== 'awake' ? 0 : input.my / len;
    this.moving = (dirX !== 0 || dirY !== 0) && this.stunT <= 0;
    this.sprinting = input.sprint && this.moving && this.state.stamina > 1 && this.outOfStaminaLock <= 0 && !this.action;
    let speed = this.stats.speed * fatigueSpeedMult(this.state);
    if (this.sprinting) speed *= BALANCE.survival.sprintSpeedMult;
    if (env.weather === 'rain') speed *= BALANCE.weather.rainSpeedMult;
    if (this.buff) speed *= this.buff.speedMult;
    if (this.action) speed *= this.action.moveMult;
    if (this.stunT > 0) speed = 0;
    const tvx = this.moving ? dirX * speed : 0;
    const tvy = this.moving ? dirY * speed : 0;
    const accel = Math.min(1, dt * 14);
    this.vx += (tvx - this.vx) * accel;
    this.vy += (tvy - this.vy) * accel;

    let mvx = this.vx;
    let mvy = this.vy;
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      mvx = this.dodgeVx;
      mvy = this.dodgeVy;
      if (Math.random() < 0.6) env.fx.burst(this.x, this.y, 'dust', 1, { speed: 20, life: 0.3 });
    } else if (this.dashT > 0) {
      this.dashT -= dt;
      mvx = this.dashVx;
      mvy = this.dashVy;
    }
    const decay = Math.exp(-BALANCE.combat.knockbackDecay * dt);
    const dx = (mvx + this.kbx) * dt;
    const dy = (mvy + this.kby) * dt;
    this.kbx *= decay;
    this.kby *= decay;
    if (Math.abs(this.kbx) < 2) this.kbx = 0;
    if (Math.abs(this.kby) < 2) this.kby = 0;
    if (dx !== 0 || dy !== 0) {
      const r = moveCircle(env.world, this.x, this.y, dx, dy, this.radius, this.canClimb);
      this.x = r.x;
      this.y = r.y;
      if (this.dashT > 0 && (r.blockedX || r.blockedY)) this.dashT = 0;
    }

    if (this.action && (this.action.kind === 'attack' || this.action.kind === 'skill')) this.facing = Math.cos(this.action.dir) >= 0 ? 1 : -1;
    else if (Math.abs(this.vx) > 8) this.facing = this.vx > 0 ? 1 : -1;

    // footsteps
    if (this.moving && this.dodgeT <= 0) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = this.sprinting ? 0.2 : 0.3;
        env.audio.play('step');
        env.fx.burst(this.x - this.facing * this.radius * 0.5, this.y, env.weather === 'rain' ? 'drop' : 'dust', 1, { speed: 25, life: 0.35, depth: this.y - 1 });
      }
    }

    // buff aura
    if (this.buff) {
      this.aura.setVisible(true).setPosition(this.x, this.y - this.radius).setScale((this.radius * 3) / 128).setTint(this.buff.color).setAlpha(0.45 + 0.15 * Math.sin(env.now * 8)).setDepth(this.y + 1);
    } else this.aura.setVisible(false);

    this.pickAnim();
    this.syncSprite();
  }

  /** Called when sprint drained stamina to zero: block sprint for a moment. */
  exhaustSprint(): void {
    this.outOfStaminaLock = 1.2;
  }

  private startBasic(aim: number, env: PlayerEnv): void {
    const A = this.form.basic;
    const cost = A.stamina * this.form.staminaCostMult;
    if (this.state.stamina < cost) {
      env.fx.text(this.x, this.y - this.radius * 3, 'Hết thể lực!', '#ffd84a', 13);
      return;
    }
    this.stam.spend(this.state, cost);
    this.cds.start('basic', A.cooldownSec);
    const color = Phaser.Display.Color.HexStringToColor(this.species.elementColor).color;
    this.action = {
      kind: 'attack',
      t: A.windupSec + A.activeSec,
      total: A.windupSec + A.activeSec,
      dir: aim,
      moveMult: 0.35,
      onDone: () => {},
    };
    this.pendingFire = {
      t: A.windupSec,
      fn: () => {
        env.combat.arc(this, aim, A.arcDeg, A.range + this.radius * 0.6, this.stats.power, A.dmgMult, A.knockback, A.activeSec, color);
        env.audio.play('attack');
      },
    };
  }

  /** A deferred hit spawn, ticked in sim time. */
  pendingFire: { t: number; fn: () => void } | null = null;

  tickPending(dt: number): void {
    if (!this.pendingFire) return;
    this.pendingFire.t -= dt;
    if (this.pendingFire.t <= 0) {
      const f = this.pendingFire.fn;
      this.pendingFire = null;
      if (this.alive && !this.evolving) f();
    }
  }

  private startSkill(slot: 'q' | 'r', aim: number, env: PlayerEnv): void {
    const sk = slot === 'q' ? this.skillQ() : this.skillR();
    if (!sk) return;
    const id = `skill_${slot}`;
    if (!this.cds.ready(id)) return;
    const cost = sk.stamina * this.form.staminaCostMult;
    if (this.state.stamina < cost) {
      env.fx.text(this.x, this.y - this.radius * 3, 'Hết thể lực!', '#ffd84a', 13);
      return;
    }
    this.stam.spend(this.state, cost);
    this.cds.start(id, sk.cooldownSec);
    this.action = { kind: 'skill', t: sk.windupSec + 0.12, total: sk.windupSec + 0.12, dir: aim, moveMult: sk.kind === 'dash' ? 0 : 0.2, onDone: () => {} };
    env.fx.burst(this.x, this.y - this.radius, sk.particle as ParticleKind, 6, { speed: 50, life: 0.4, tint: sk.color });
    this.pendingFire = { t: sk.windupSec, fn: () => this.fireSkill(sk, aim, env) };
  }

  private fireSkill(sk: SkillDef, aim: number, env: PlayerEnv): void {
    const p = this.stats.power;
    env.audio.play('skill');
    const pk = sk.particle as ParticleKind;
    switch (sk.kind) {
      case 'dash': {
        const speed = sk.speed ?? 560;
        this.dashT = sk.range / speed;
        this.dashVx = Math.cos(aim) * speed;
        this.dashVy = Math.sin(aim) * speed;
        this.iframes = Math.max(this.iframes, this.dashT * 0.7);
        env.combat.circle(this, this.x, this.y, sk.radius + this.radius * 0.5, p, sk.dmgMult, sk.knockback, this.dashT + 0.05, true, sk.color);
        env.fx.burst(this.x, this.y, pk, 10, { speed: 90, life: 0.5, tint: sk.color });
        break;
      }
      case 'projectile': {
        const n = sk.count ?? 1;
        const spread = ((sk.spreadDeg ?? 0) * Math.PI) / 180;
        for (let i = 0; i < n; i++) {
          const a = n === 1 ? aim : aim - spread + (2 * spread * i) / (n - 1);
          env.combat.projectile(this, this.x + Math.cos(a) * this.radius, this.y - this.radius * 0.6 + Math.sin(a) * this.radius, a, sk.speed ?? 500, sk.range, sk.radius, p, sk.dmgMult, sk.knockback, sk.color, pk);
        }
        break;
      }
      case 'cone': {
        env.combat.arc(this, aim, sk.arcDeg ?? 60, sk.range, p, sk.dmgMult, sk.knockback, 0.25, sk.color);
        env.fx.burst(this.x + Math.cos(aim) * 20, this.y - 8 + Math.sin(aim) * 20, pk, 26, {
          speed: sk.range * 2.2,
          life: 0.45,
          dir: aim,
          spread: ((sk.arcDeg ?? 60) * Math.PI) / 180,
          tint: sk.color,
          additive: true,
        });
        break;
      }
      case 'nova': {
        env.combat.circle(this, this.x, this.y, sk.radius, p, sk.dmgMult, sk.knockback, 0.15, false, sk.color);
        env.fx.ring(this.x, this.y, sk.color, 10, sk.radius, 0.45, 5);
        env.fx.ring(this.x, this.y, 0xffffff, 6, sk.radius * 0.7, 0.35, 2);
        env.fx.burst(this.x, this.y, pk, 24, { speed: sk.radius * 2.5, life: 0.5, tint: sk.color });
        this.scene.cameras.main.shake(150, 0.005);
        break;
      }
      case 'buff': {
        const b = sk.buff ?? {};
        this.buff = {
          until: env.now + (sk.durationSec ?? 5),
          defenseMult: b.defenseMult ?? 1,
          regen: b.regenFracPerSec ?? 0,
          speedMult: b.speedMult ?? 1,
          color: sk.color,
        };
        env.fx.ring(this.x, this.y, sk.color, 4, 50, 0.5, 4);
        env.fx.burst(this.x, this.y - 10, pk, 14, { speed: 60, life: 0.7, tint: sk.color });
        break;
      }
    }
  }

  private pickAnim(): void {
    let a = 'idle';
    if (!this.alive) a = 'dead';
    else if (this.stunT > 0 || this.hurtFlash > 0.1) a = 'hurt';
    else if (this.action && (this.action.kind === 'attack' || this.action.kind === 'skill')) a = 'attack';
    else if (this.dashT > 0) a = 'attack';
    else if (this.action && (this.action.kind === 'eat' || this.action.kind === 'drink')) a = 'eat';
    else if (this.rest.mode === 'sleeping') a = 'sleep';
    else if (this.rest.mode === 'resting') a = 'rest';
    else if (this.moving || this.dodgeT > 0) a = 'walk';
    this.play(a);
    this.sprite.anims.timeScale = a === 'walk' ? (this.sprinting ? 1.5 : 1) : 1;
  }

  syncSprite(): void {
    this.sprite.setPosition(this.x, this.y).setFlipX(this.facing < 0).setDepth(this.y + 0.5);
    this.shadow.setPosition(this.x, this.y + 1).setDepth(this.y - 30);
    if (this.hurtFlash > 0.15) this.sprite.setTintFill(0xffffff);
    else if (this.iframes > 0 && this.dodgeT <= 0 && this.dashT <= 0) this.sprite.setTint(0xffb0b0).setAlpha(Math.floor(this.scene.time.now / 70) % 2 ? 0.6 : 1);
    else if (!this.evolving) this.sprite.clearTint().setAlpha(this.dodgeT > 0 ? 0.7 : 1);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.aura.destroy();
  }
}
