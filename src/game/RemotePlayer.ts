import Phaser from 'phaser';
import { getSpecies } from '../data/species';
import { ensurePlayerTexture } from '../gfx/textures';
import type { PlayerStateMsg } from '../net/room';
import { StatusEffects } from '../systems/status';
import type { Creature } from './CombatSystem';

let nextUid = 10_000;

/**
 * Another human player mirrored from the network. Implements Creature so local
 * combat can hit enemies; same-species allies are filtered in CombatSystem.
 */
export class RemotePlayer implements Creature {
  readonly uid: number;
  readonly isPlayer = false;
  /** Used for NPC-style friendly checks; remotes use speciesId instead. */
  kind: string;
  speciesId: string;
  peerId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive = true;
  kbx = 0;
  kby = 0;
  iframes = 0;
  radius: number;
  form = 0;
  variant = 'goc';
  facing = 1;
  anim = 'idle';
  displayName = '';
  status = new StatusEffects<Creature>();

  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  nameTag: Phaser.GameObjects.Text;
  texKey = '';
  private curAnim = '';
  private tx: number;
  private ty: number;

  constructor(scene: Phaser.Scene, peerId: string, speciesId: string, x: number, y: number, name = '') {
    this.uid = nextUid++;
    this.peerId = peerId;
    this.speciesId = speciesId;
    this.kind = `remote:${speciesId}`;
    this.x = x;
    this.y = y;
    this.tx = x;
    this.ty = y;
    this.displayName = name;
    const sp = getSpecies(speciesId);
    this.radius = sp.forms[0].radius;
    this.hp = sp.forms[0].stats.maxHp;
    this.maxHp = this.hp;
    this.shadow = scene.add.image(x, y, 'shadow').setDisplaySize(this.radius * 2.6, this.radius * 0.9).setDepth(y - 30);
    this.sprite = scene.add.sprite(x, y, 'shadow');
    // Phaser Text is nearly invisible with pixelArt; HTML NameTags are used instead.
    this.nameTag = scene.add.text(x, y, '').setVisible(false).setActive(false);
    this.applyAppearance(speciesId, 0, 'goc');
  }

  defense(): number {
    return getSpecies(this.speciesId).forms[this.form]?.stats.defense ?? 8;
  }

  applyAppearance(speciesId: string, form: number, variant: string): void {
    const sp = getSpecies(speciesId);
    const f = Math.max(0, Math.min(2, form));
    this.speciesId = speciesId;
    this.kind = `remote:${speciesId}`;
    this.form = f;
    this.variant = variant;
    this.radius = sp.forms[f].radius;
    this.maxHp = sp.forms[f].stats.maxHp;
    this.texKey = ensurePlayerTexture(this.sprite.scene, speciesId, f, variant);
    const s = sp.forms[f].art.size * 2;
    this.sprite.setTexture(this.texKey, 0).setOrigin(0.5, (s - 4) / s);
    this.shadow.setDisplaySize(this.radius * 2.6, this.radius * 0.9);
    this.curAnim = '';
    this.play('idle');
    this.refreshNameTag();
  }

  setDisplayName(name: string): void {
    this.displayName = name.trim();
    this.refreshNameTag();
  }

  private refreshNameTag(): void {
    /* HTML NameTags in UI handle the visible label. */
  }

  get label(): string {
    const sp = getSpecies(this.speciesId);
    return this.displayName || sp.forms[this.form]?.name || sp.element;
  }

  nameAnchorY(): number {
    return this.y - getSpecies(this.speciesId).forms[this.form].art.size * 2.15;
  }

  applyState(msg: PlayerStateMsg): void {
    if (msg.speciesId !== this.speciesId || msg.form !== this.form || msg.variant !== this.variant) {
      this.applyAppearance(msg.speciesId, msg.form, msg.variant);
    }
    if (msg.name !== undefined) this.setDisplayName(msg.name);
    this.tx = msg.x;
    this.ty = msg.y;
    this.hp = msg.hp;
    this.maxHp = msg.maxHp;
    this.alive = msg.alive;
    this.facing = msg.facing;
    this.anim = msg.anim;
    if (msg.alive) this.play(msg.anim);
    else this.play('dead');
  }

  /** Smoothly catch up to the latest network pose. */
  update(dt: number): void {
    const k = Math.min(1, dt * 14);
    this.x += (this.tx - this.x) * k;
    this.y += (this.ty - this.y) * k;
    this.sprite.setPosition(this.x, this.y);
    this.sprite.setFlipX(this.facing < 0);
    this.sprite.setDepth(this.y);
    this.sprite.setAlpha(this.alive ? 1 : 0.35);
    this.shadow.setPosition(this.x, this.y).setDepth(this.y - 30).setAlpha(this.sprite.alpha * 0.7);
    if (this.iframes > 0) this.iframes = Math.max(0, this.iframes - dt);
  }

  setAllyTint(_ally: boolean): void {
    /* HTML name tag color is set by GameScene. */
  }

  /** Shown in toasts when a peer joins. */
  get joinLabel(): string {
    const sp = getSpecies(this.speciesId);
    return this.displayName ? `${this.displayName} (${sp.element})` : sp.element;
  }

  play(name: string): void {
    if (this.curAnim === name || !this.texKey) return;
    this.curAnim = name;
    const key = `${this.texKey}:${name}`;
    if (this.sprite.anims.animationManager.exists(key)) this.sprite.play(key, true);
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.nameTag.destroy();
  }
}
