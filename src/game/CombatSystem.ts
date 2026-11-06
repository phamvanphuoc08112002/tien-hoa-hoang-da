import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { HitInstance, arcHits, circleHits, computeDamage } from '../systems/combat';
import { BLK, type WorldData } from '../world/tiles';
import type { Effects, ParticleKind } from './Effects';

export interface Creature {
  uid: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  isPlayer: boolean;
  /** Species id for NPCs, 'player' for the player. Same-species NPCs never hurt each other. */
  kind: string;
  kbx: number;
  kby: number;
  iframes: number;
  defense(): number;
}

interface ActiveHit {
  inst: HitInstance;
  owner: Creature;
  shape: 'arc' | 'circle';
  x: number;
  y: number;
  dir: number;
  arc: number;
  range: number;
  radius: number;
  power: number;
  t: number;
  follow: boolean;
  color: number;
}

interface Projectile {
  inst: HitInstance;
  owner: Creature;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  power: number;
  sprite: Phaser.GameObjects.Image;
  particle: ParticleKind;
}

export interface Telegraph {
  ownerUid: number;
  kind: 'slam' | 'lunge';
  x: number;
  y: number;
  dir: number;
  range: number;
  radius: number;
  t: number;
  total: number;
}

export interface DamageEvent {
  attacker: Creature;
  target: Creature;
  damage: number;
  killed: boolean;
}

export class CombatSystem {
  private hits: ActiveHit[] = [];
  private projectiles: Projectile[] = [];
  telegraphs: Telegraph[] = [];
  godMode = false;

  constructor(
    private scene: Phaser.Scene,
    private fx: Effects,
    private world: WorldData,
    private queryTargets: (x: number, y: number, r: number) => Creature[],
    private onDamage: (e: DamageEvent) => void,
  ) {}

  /** Melee arc in front of the owner. Active for `duration`, each target hit at most once. */
  arc(owner: Creature, dir: number, arcDeg: number, range: number, power: number, mult: number, knockback: number, duration: number, color = 0xffffff): void {
    const inst = new HitInstance(owner.uid, mult, knockback);
    this.hits.push({ inst, owner, shape: 'arc', x: owner.x, y: owner.y, dir, arc: (arcDeg * Math.PI) / 180, range, radius: 0, power, t: duration, follow: true, color });
  }

  circle(owner: Creature, x: number, y: number, radius: number, power: number, mult: number, knockback: number, duration: number, follow: boolean, color = 0xffffff): void {
    const inst = new HitInstance(owner.uid, mult, knockback);
    this.hits.push({ inst, owner, shape: 'circle', x, y, dir: 0, arc: 0, range: 0, radius, power, t: duration, follow, color });
  }

  projectile(owner: Creature, x: number, y: number, dir: number, speed: number, range: number, r: number, power: number, mult: number, knockback: number, tint: number, particle: ParticleKind): void {
    const sprite = this.scene.add.image(x, y, 'p_bubble').setScale(Math.max(1.2, r / 5)).setTint(tint).setDepth(9400);
    this.projectiles.push({
      inst: new HitInstance(owner.uid, mult, knockback),
      owner,
      x,
      y,
      vx: Math.cos(dir) * speed,
      vy: Math.sin(dir) * speed,
      r,
      life: range / speed,
      power,
      sprite,
      particle,
    });
  }

  telegraph(t: Telegraph): void {
    this.telegraphs.push(t);
  }

  removeTelegraphs(ownerUid: number): void {
    this.telegraphs = this.telegraphs.filter((t) => t.ownerUid !== ownerUid);
  }

  /** Cancels any hit volumes owned by a creature (e.g. on death). */
  cancelOwner(uid: number): void {
    this.hits = this.hits.filter((h) => h.owner.uid !== uid);
    this.removeTelegraphs(uid);
  }

  update(dt: number): void {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (h.follow) {
        h.x = h.owner.x;
        h.y = h.owner.y;
      }
      if (!h.owner.alive) {
        this.hits.splice(i, 1);
        continue;
      }
      const reach = h.shape === 'arc' ? h.range : h.radius;
      for (const t of this.queryTargets(h.x, h.y, reach + 40)) {
        if (!t.alive || t.uid === h.owner.uid) continue;
        if (!h.owner.isPlayer && !t.isPlayer && t.kind === h.owner.kind) continue;
        const inside = h.shape === 'arc' ? arcHits(h.x, h.y, h.dir, h.arc, h.range, t.x, t.y, t.radius) : circleHits(h.x, h.y, h.radius, t.x, t.y, t.radius);
        if (!inside || !h.inst.tryHit(t.uid)) continue;
        const ang = Math.atan2(t.y - h.y, t.x - h.x);
        this.applyDamage(h.owner, t, h.power, h.inst.damageMult, h.inst.knockback, Math.cos(ang), Math.sin(ang));
      }
      h.t -= dt;
      if (h.t <= 0) this.hits.splice(i, 1);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.sprite.setPosition(p.x, p.y);
      const ptx = Math.floor(p.x / BALANCE.tile);
      const pty = Math.floor(p.y / BALANCE.tile);
      const outside = ptx < 0 || pty < 0 || ptx >= this.world.w || pty >= this.world.h;
      let dead = p.life <= 0 || outside || this.world.blocked[pty * this.world.w + ptx] === BLK.SOLID;
      if (!dead) {
        for (const t of this.queryTargets(p.x, p.y, p.r + 40)) {
          if (!t.alive || t.uid === p.owner.uid) continue;
          if (!circleHits(p.x, p.y, p.r, t.x, t.y, t.radius) || !p.inst.tryHit(t.uid)) continue;
          const len = Math.hypot(p.vx, p.vy) || 1;
          this.applyDamage(p.owner, t, p.power, p.inst.damageMult, p.inst.knockback, p.vx / len, p.vy / len);
          dead = true;
          break;
        }
      }
      if (Math.random() < 0.5) this.fx.burst(p.x, p.y, p.particle, 1, { speed: 20, life: 0.3 });
      if (dead) {
        this.fx.burst(p.x, p.y, p.particle, 6, { speed: 90, life: 0.4 });
        p.sprite.destroy();
        this.projectiles.splice(i, 1);
      }
    }

    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      this.telegraphs[i].t -= dt;
      if (this.telegraphs[i].t <= 0) this.telegraphs.splice(i, 1);
    }
  }

  applyDamage(attacker: Creature, target: Creature, power: number, mult: number, knockback: number, dx: number, dy: number): number {
    if (target.iframes > 0 || !target.alive) return 0;
    const dmg = computeDamage(power, mult, target.defense(), Math.random());
    const real = target.isPlayer && this.godMode ? 0 : dmg;
    target.hp = Math.max(0, target.hp - real);
    const massFactor = 14 / Math.max(14, target.radius);
    target.kbx += dx * knockback * massFactor;
    target.kby += dy * knockback * massFactor;
    target.iframes = target.isPlayer ? BALANCE.combat.playerIFramesSec : BALANCE.combat.npcIFramesSec;
    const killed = target.hp <= 0;
    this.fx.burst(target.x, target.y - target.radius * 0.6, 'star', 4, { speed: 120, life: 0.25 });
    this.fx.text(target.x + (Math.random() - 0.5) * 10, target.y - target.radius * 2 - 6, String(dmg), target.isPlayer ? '#ff6a6a' : '#fff3a0', target.isPlayer ? 18 : 15);
    this.onDamage({ attacker, target, damage: real, killed });
    return real;
  }

  draw(g: Phaser.GameObjects.Graphics, debug: boolean, timeNow: number): void {
    for (const t of this.telegraphs) {
      const k = 1 - t.t / t.total;
      const pulse = 0.5 + 0.5 * Math.sin(timeNow / 60);
      if (t.kind === 'slam') {
        g.fillStyle(0xff2a1a, 0.12 + 0.1 * pulse);
        g.fillCircle(t.x, t.y, t.radius);
        g.fillStyle(0xff3a1a, 0.35);
        g.fillCircle(t.x, t.y, t.radius * k);
        g.lineStyle(2, 0xff5a3a, 0.9);
        g.strokeCircle(t.x, t.y, t.radius);
      } else {
        const ex = t.x + Math.cos(t.dir) * t.range;
        const ey = t.y + Math.sin(t.dir) * t.range;
        g.lineStyle(t.radius * 2, 0xff2a1a, 0.14 + 0.1 * pulse);
        g.lineBetween(t.x, t.y, ex, ey);
        g.lineStyle(t.radius * 2 * k, 0xff4a2a, 0.4);
        g.lineBetween(t.x, t.y, t.x + Math.cos(t.dir) * t.range * k, t.y + Math.sin(t.dir) * t.range * k);
        g.lineStyle(2, 0xff6a3a, 0.9);
        g.strokeCircle(ex, ey, t.radius);
      }
    }
    if (debug) {
      for (const h of this.hits) {
        g.lineStyle(2, 0xff00ff, 0.9);
        if (h.shape === 'circle') g.strokeCircle(h.x, h.y, h.radius);
        else {
          g.beginPath();
          g.moveTo(h.x, h.y);
          g.arc(h.x, h.y, h.range, h.dir - h.arc / 2, h.dir + h.arc / 2);
          g.closePath();
          g.strokePath();
        }
      }
      for (const p of this.projectiles) {
        g.lineStyle(1, 0xff00ff, 1);
        g.strokeCircle(p.x, p.y, p.r);
      }
    }
  }

  /** Draws a short-lived swing arc visual for feedback (not debug). */
  swingVisual(g: Phaser.GameObjects.Graphics): void {
    for (const h of this.hits) {
      if (h.shape !== 'arc' || !h.owner.isPlayer) continue;
      g.lineStyle(3, h.color, 0.55);
      g.beginPath();
      g.arc(h.x, h.y, h.range * 0.9, h.dir - h.arc / 2, h.dir + h.arc / 2);
      g.strokePath();
    }
  }

  destroy(): void {
    this.projectiles.forEach((p) => p.sprite.destroy());
    this.projectiles = [];
    this.hits = [];
    this.telegraphs = [];
  }
}
