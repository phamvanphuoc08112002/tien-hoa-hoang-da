import Phaser from 'phaser';
import { BALANCE } from '../config/balance';

export type ParticleKind = 'dust' | 'leaf' | 'spark' | 'star' | 'drop' | 'blood' | 'bubble';

interface Particle {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  spin: number;
  active: boolean;
  fade: boolean;
}

interface FloatText {
  txt: Phaser.GameObjects.Text;
  vy: number;
  life: number;
  active: boolean;
}

export interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  color: number;
  life: number;
  maxLife: number;
  width: number;
  fill?: number;
}

export interface Beam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: number;
  life: number;
  maxLife: number;
  width: number;
}

export const FX_DEPTH = 9500;

function hexColor(n: number): string {
  return `#${(n >>> 0).toString(16).padStart(6, '0')}`;
}

/** Pooled particles, floating texts and expanding rings. All driven by simulated dt. */
export class Effects {
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  rings: Ring[] = [];
  beams: Beam[] = [];

  constructor(scene: Phaser.Scene) {
    for (let i = 0; i < BALANCE.resources.maxParticles; i++) {
      const img = scene.add.image(0, 0, 'p_dust').setVisible(false).setActive(false);
      this.particles.push({ img, vx: 0, vy: 0, life: 0, maxLife: 1, gravity: 0, drag: 0, spin: 0, active: false, fade: true });
    }
    for (let i = 0; i < BALANCE.resources.maxDamageTexts; i++) {
      const txt = scene.add
        .text(0, 0, '', { fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#ffffff', stroke: '#1a1020', strokeThickness: 4 })
        .setOrigin(0.5)
        .setDepth(FX_DEPTH + 10)
        .setVisible(false);
      this.texts.push({ txt, vy: 0, life: 0, active: false });
    }
  }

  burst(
    x: number,
    y: number,
    kind: ParticleKind,
    count: number,
    opts: { speed?: number; life?: number; gravity?: number; tint?: number; up?: number; spread?: number; depth?: number; scale?: number; dir?: number; additive?: boolean } = {},
  ): void {
    for (let n = 0; n < count; n++) {
      const p = this.particles.find((q) => !q.active);
      if (!p) return;
      const sp = (opts.speed ?? 80) * (0.5 + Math.random() * 0.8);
      const spread = opts.spread ?? Math.PI * 2;
      const a = (opts.dir ?? -Math.PI / 2) + (Math.random() - 0.5) * spread;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp - (opts.up ?? 0);
      p.life = p.maxLife = (opts.life ?? 0.6) * (0.7 + Math.random() * 0.6);
      p.gravity = opts.gravity ?? 0;
      p.drag = 2;
      p.spin = (Math.random() - 0.5) * 6;
      p.active = true;
      p.fade = true;
      p.img
        .setTexture(`p_${kind}`)
        .setPosition(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6)
        .setVisible(true)
        .setActive(true)
        .setAlpha(1)
        .setScale(opts.scale ?? 1)
        .setRotation(0)
        .setDepth(opts.depth ?? FX_DEPTH - 1)
        .setBlendMode(opts.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      if (opts.tint !== undefined) p.img.setTint(opts.tint);
      else p.img.clearTint();
    }
  }

  text(x: number, y: number, s: string, color = '#ffffff', size = 16): void {
    const t = this.texts.find((q) => !q.active) ?? this.texts[0];
    t.active = true;
    t.life = 0.9;
    t.vy = -46;
    t.txt.setText(s).setPosition(x, y).setColor(color).setFontSize(size).setVisible(true).setAlpha(1);
  }

  /** Bigger cast callout for skill names. */
  skillName(x: number, y: number, name: string, color: number): void {
    this.text(x, y, name, hexColor(color), 17);
  }

  ring(x: number, y: number, color: number, r0: number, r1: number, life = 0.4, width = 3, fill = 0): void {
    if (this.rings.length > 64) this.rings.shift();
    this.rings.push({ x, y, r0, r1, color, life, maxLife: life, width, fill });
  }

  /** Soft filled pulse that expands and fades (great for nova / buff). */
  pulse(x: number, y: number, color: number, r0: number, r1: number, life = 0.45, fill = 0.28): void {
    this.ring(x, y, color, r0, r1, life, 3, fill);
  }

  /** Short directional streak (muzzle / dash afterimage). */
  beam(x0: number, y0: number, x1: number, y1: number, color: number, life = 0.28, width = 10): void {
    if (this.beams.length > 48) this.beams.shift();
    this.beams.push({ x0, y0, x1, y1, color, life, maxLife: life, width });
  }

  update(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.img.setVisible(false).setActive(false);
        continue;
      }
      p.vy += p.gravity * dt;
      p.vx *= 1 - Math.min(1, p.drag * dt);
      p.vy *= 1 - Math.min(1, p.drag * dt * 0.5);
      p.img.x += p.vx * dt;
      p.img.y += p.vy * dt;
      p.img.rotation += p.spin * dt;
      if (p.fade) p.img.setAlpha(Math.min(1, (p.life / p.maxLife) * 1.6));
    }
    for (const t of this.texts) {
      if (!t.active) continue;
      t.life -= dt;
      t.txt.y += t.vy * dt;
      t.vy *= 1 - Math.min(1, 2.5 * dt);
      t.txt.setAlpha(Math.min(1, t.life * 2.5));
      if (t.life <= 0) {
        t.active = false;
        t.txt.setVisible(false);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      this.rings[i].life -= dt;
      if (this.rings[i].life <= 0) this.rings.splice(i, 1);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= dt;
      if (this.beams[i].life <= 0) this.beams.splice(i, 1);
    }
  }

  drawRings(g: Phaser.GameObjects.Graphics): void {
    for (const r of this.rings) {
      const t = 1 - r.life / r.maxLife;
      const rad = r.r0 + (r.r1 - r.r0) * t;
      const a = 1 - t;
      if (r.fill && r.fill > 0) {
        g.fillStyle(r.color, r.fill * a);
        g.fillCircle(r.x, r.y, rad);
      }
      g.lineStyle(r.width, r.color, a);
      g.strokeCircle(r.x, r.y, rad);
    }
    for (const b of this.beams) {
      const t = 1 - b.life / b.maxLife;
      const a = 1 - t;
      g.lineStyle(b.width * (1 - t * 0.5), b.color, a * 0.85);
      g.lineBetween(b.x0, b.y0, b.x1, b.y1);
      g.lineStyle(Math.max(2, b.width * 0.35), 0xffffff, a * 0.45);
      g.lineBetween(b.x0, b.y0, b.x1, b.y1);
    }
  }

  destroy(): void {
    this.particles.forEach((p) => p.img.destroy());
    this.texts.forEach((t) => t.txt.destroy());
    this.particles = [];
    this.texts = [];
    this.rings = [];
    this.beams = [];
  }
}
