import { BALANCE } from '../config/balance';
import { TT, type WorldData, type WorldObject } from '../world/tiles';

const TILE_COLORS: Record<number, string> = {
  [TT.GRASS]: '#5f9e48',
  [TT.FOREST]: '#2f5f2c',
  [TT.SAND]: '#d2bd84',
  [TT.WATER]: '#3a7fc4',
  [TT.DEEP]: '#2a5a9c',
  [TT.ROCK]: '#8b8679',
  [TT.PLATEAU]: '#a8916c',
  [TT.LEDGE]: '#5a5244',
  [TT.FORD]: '#6aa6d8',
  [TT.WALL]: '#2a2824',
  [TT.SWAMP]: '#4c5a34',
};

export interface MinimapDots {
  px: number;
  py: number;
  hostiles: { x: number; y: number }[];
  markers: { x: number; y: number }[];
  discovered: Set<number>;
  portalOpen?: boolean;
}

/** Pre-rendered terrain image with a cheap dynamic overlay (fog, player, markers). */
export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private base: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private sectorsX: number;

  constructor(
    private world: WorldData,
    private shelters: WorldObject[],
    private shrine: WorldObject | null,
  ) {
    const W = world.w;
    const H = world.h;
    this.base = document.createElement('canvas');
    this.base.width = W;
    this.base.height = H;
    const bg = this.base.getContext('2d') as CanvasRenderingContext2D;
    const img = bg.createImageData(W, H);
    const cache = new Map<number, [number, number, number]>();
    for (let i = 0; i < W * H; i++) {
      const t = world.tiles[i];
      let rgb = cache.get(t);
      if (!rgb) {
        const hex = TILE_COLORS[t] ?? '#000000';
        const n = parseInt(hex.slice(1), 16);
        rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        cache.set(t, rgb);
      }
      img.data[i * 4] = rgb[0];
      img.data[i * 4 + 1] = rgb[1];
      img.data[i * 4 + 2] = rgb[2];
      img.data[i * 4 + 3] = 255;
    }
    for (const o of world.objects) {
      if (o.kind === 'tree' || o.kind === 'pine') {
        const i = (o.ty * W + o.tx) * 4;
        img.data[i] = 30;
        img.data[i + 1] = 70;
        img.data[i + 2] = 32;
      }
    }
    bg.putImageData(img, 0, 0);
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'minimap';
    this.g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.sectorsX = Math.ceil(W / BALANCE.world.sectorTiles);
  }

  draw(d: MinimapDots): void {
    const g = this.g;
    const T = BALANCE.tile;
    const S = BALANCE.world.sectorTiles;
    g.drawImage(this.base, 0, 0);
    g.fillStyle = 'rgba(8,10,14,0.82)';
    const sy = Math.ceil(this.world.h / S);
    for (let y = 0; y < sy; y++) {
      for (let x = 0; x < this.sectorsX; x++) {
        if (!d.discovered.has(y * this.sectorsX + x)) g.fillRect(x * S, y * S, S, S);
      }
    }
    for (const s of this.shelters) {
      const sec = Math.floor(s.ty / S) * this.sectorsX + Math.floor(s.tx / S);
      if (!d.discovered.has(sec)) continue;
      g.fillStyle = '#ffffff';
      g.fillRect(s.tx - 2, s.ty - 2, 4, 4);
      g.fillStyle = '#6a4a2a';
      g.fillRect(s.tx - 1, s.ty - 1, 2, 2);
    }
    if (this.shrine) {
      g.fillStyle = '#ffcf4a';
      g.fillRect(this.shrine.tx - 2, this.shrine.ty - 2, 5, 5);
    }
    const pt = this.world.portal;
    if (pt) {
      g.fillStyle = '#ffffff';
      g.fillRect(pt.tx - 4, pt.ty - 4, 9, 9);
      g.fillStyle = d.portalOpen ? '#c08aff' : '#6a3ad0';
      g.fillRect(pt.tx - 3, pt.ty - 3, 7, 7);
    }
    g.fillStyle = '#ff4a4a';
    for (const h of d.hostiles) g.fillRect(Math.floor(h.x / T) - 1, Math.floor(h.y / T) - 1, 3, 3);
    for (const m of d.markers) {
      const mx = Math.floor(m.x / T);
      const my = Math.floor(m.y / T);
      g.fillStyle = '#c08aff';
      g.beginPath();
      g.moveTo(mx, my - 5);
      g.lineTo(mx + 3, my);
      g.lineTo(mx, my + 5);
      g.lineTo(mx - 3, my);
      g.fill();
    }
    const px = d.px / T;
    const py = d.py / T;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(px, py, 3.2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#2a8aff';
    g.beginPath();
    g.arc(px, py, 2, 0, Math.PI * 2);
    g.fill();
  }
}
