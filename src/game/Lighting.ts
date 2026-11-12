import Phaser from 'phaser';
import type { Weather } from '../data/types';
import { ambientTint, nightFactor } from '../systems/timeWeather';

function multiplyColor(a: number, b: number): number {
  const ch = (s: number) => Math.round((((a >> s) & 255) * ((b >> s) & 255)) / 255);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

const DEPTH = 9000;

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
}

/**
 * Screen-space lighting: multiplicative ambient tint, night vision mask
 * centred on the player, rain streaks and the evolution light column.
 */
export class Lighting {
  private tint: Phaser.GameObjects.Rectangle;
  private vision: Phaser.GameObjects.Image;
  private rain: Phaser.GameObjects.Graphics;
  private heatHaze: Phaser.GameObjects.Rectangle;
  private bloodHaze: Phaser.GameObjects.Rectangle;
  private drops: Drop[] = [];
  private rainAmount = 0;
  private heatAmount = 0;
  private bloodAmount = 0;
  private visionScale = 6;
  /** Per-realm colour cast multiplied into the ambient light. */
  realmTint = 0xffffff;
  /** Current ambient colour (time of day × weather × realm); applied by the 3D view when active. */
  ambient = 0xffffff;
  night = 0;
  evoGlow: Phaser.GameObjects.Image;
  evoBeam: Phaser.GameObjects.Image;

  constructor(private scene: Phaser.Scene) {
    const cam = scene.cameras.main;
    this.tint = scene.add.rectangle(0, 0, cam.width, cam.height, 0xffffff).setOrigin(0).setScrollFactor(0).setDepth(DEPTH).setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.heatHaze = scene.add.rectangle(0, 0, cam.width, cam.height, 0xffd890).setOrigin(0).setScrollFactor(0).setDepth(DEPTH + 1).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.bloodHaze = scene.add.rectangle(0, 0, cam.width, cam.height, 0xff1a1a).setOrigin(0).setScrollFactor(0).setDepth(DEPTH + 2.5).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.vision = scene.add.image(0, 0, 'vision').setScrollFactor(0).setDepth(DEPTH + 2).setAlpha(0);
    this.rain = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH + 3);
    this.evoGlow = scene.add.image(0, 0, 'glow').setDepth(DEPTH - 5).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.evoBeam = scene.add.image(0, 0, 'beam').setOrigin(0.5, 1).setDepth(DEPTH - 4).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    for (let i = 0; i < 140; i++) this.drops.push(this.newDrop(cam.width, cam.height, true));
  }

  private newDrop(w: number, h: number, anywhere: boolean): Drop {
    return { x: Math.random() * (w + 200) - 100, y: anywhere ? Math.random() * h : -20 - Math.random() * 60, len: 10 + Math.random() * 10, speed: 600 + Math.random() * 250 };
  }

  /** The multiply tint cannot darken a canvas underneath Phaser's, so the 3D view lights itself instead. */
  setScreenTint(on: boolean): void {
    this.tint.setVisible(on);
  }

  resize(w: number, h: number): void {
    this.tint.setSize(w, h);
    this.heatHaze.setSize(w, h);
    this.bloodHaze.setSize(w, h);
  }

  /** Visible radius in px for the current conditions (used for AI and UI too). */
  static visionRadius(hour: number, inForest: boolean): number {
    const nf = nightFactor(hour);
    let r = 900 - nf * 640;
    if (inForest) r *= 0.75;
    return r;
  }

  update(dt: number, hour: number, weather: Weather, px: number, py: number, inForest: boolean, bloodMoon = false): void {
    const targetBlood = bloodMoon ? nightFactor(hour) : 0;
    this.bloodAmount += (targetBlood - this.bloodAmount) * Math.min(1, dt * 0.8);
    this.bloodHaze.setAlpha(this.bloodAmount * (0.12 + 0.03 * Math.sin(this.scene.time.now / 600)));
    const cam = this.scene.cameras.main;
    this.ambient = multiplyColor(ambientTint(hour, weather), this.realmTint);
    this.tint.fillColor = this.ambient;

    const nf = nightFactor(hour);
    this.night = nf;
    const forestDim = inForest ? 0.35 : 0;
    const visAlpha = Math.min(0.88, nf * 0.82 + forestDim * (0.6 + nf * 0.4));
    const radius = Lighting.visionRadius(hour, inForest);
    const targetScale = radius / 70;
    this.visionScale += (targetScale - this.visionScale) * Math.min(1, dt * 3);
    this.vision.setPosition(px, py).setScale(this.visionScale).setAlpha(visAlpha);
    // Ensure the mask always covers the screen even at large radius.
    this.vision.setVisible(visAlpha > 0.01);

    const targetRain = weather === 'rain' ? 1 : 0;
    this.rainAmount += (targetRain - this.rainAmount) * Math.min(1, dt * 0.6);
    const targetHeat = weather === 'heat' ? 1 : 0;
    this.heatAmount += (targetHeat - this.heatAmount) * Math.min(1, dt * 0.5);
    this.heatHaze.setAlpha(this.heatAmount * 0.07 * (0.8 + 0.2 * Math.sin(this.scene.time.now / 400)));

    this.rain.clear();
    if (this.rainAmount > 0.02) {
      const n = Math.floor(this.drops.length * this.rainAmount);
      this.rain.lineStyle(1.5, 0xc8dcff, 0.45 * this.rainAmount);
      for (let i = 0; i < n; i++) {
        const d = this.drops[i];
        d.y += d.speed * dt;
        d.x -= d.speed * 0.18 * dt;
        if (d.y > cam.height + 20) Object.assign(d, this.newDrop(cam.width, cam.height, false));
        this.rain.lineBetween(d.x, d.y, d.x + d.len * 0.18, d.y - d.len);
      }
    }
  }

  get rainIntensity(): number {
    return this.rainAmount;
  }

  destroy(): void {
    this.tint.destroy();
    this.heatHaze.destroy();
    this.bloodHaze.destroy();
    this.vision.destroy();
    this.rain.destroy();
    this.evoGlow.destroy();
    this.evoBeam.destroy();
  }
}
