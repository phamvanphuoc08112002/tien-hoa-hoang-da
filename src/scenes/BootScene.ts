import Phaser from 'phaser';
import { registerAllTextures } from '../gfx/textures';

/** Generates every texture once, then hands control to the DOM menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    registerAllTextures(this);
    this.game.events.emit('textures-ready');
    this.scene.stop();
  }
}
