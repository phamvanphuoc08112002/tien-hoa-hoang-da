import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { ValueNoise } from '../core/noise';
import { Rng } from '../core/rng';
import { SpatialGrid } from '../core/spatialGrid';
import { RESOURCES } from '../data/foods';
import type { ResourceDef, ResourceKind } from '../data/types';
import { tilesetFrames } from '../gfx/textures';
import { TI } from '../gfx/tilesetGen';
import type { ResourceChange, WorldSave } from '../systems/save';
import { TT, type WorldData, type WorldObject } from '../world/tiles';

const T = BALANCE.tile;

export interface ResourceNode {
  id: number;
  obj: WorldObject;
  def: ResourceDef;
  x: number;
  y: number;
  portions: number;
  regrowAt: number;
  img: Phaser.GameObjects.Image;
}

export interface Carcass {
  id: number;
  x: number;
  y: number;
  portions: number;
  expireAt: number;
  img: Phaser.GameObjects.Image;
}

interface Pickup {
  obj: WorldObject;
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  done: boolean;
}

let carcassIds = 1;

export class WorldView {
  readonly resources: ResourceNode[] = [];
  readonly resGrid = new SpatialGrid<ResourceNode>(128);
  carcasses: Carcass[] = [];
  readonly carcGrid = new SpatialGrid<Carcass>(128);
  readonly coins: Pickup[] = [];
  readonly stones: Pickup[] = [];
  readonly shelters: WorldObject[] = [];
  shrine: WorldObject | null = null;
  readonly shoreGrid = new SpatialGrid<{ x: number; y: number }>(160);

  private map: Phaser.Tilemaps.Tilemap;
  private chunks = new Map<number, Phaser.GameObjects.GameObject[]>();
  private visibleChunks = new Set<number>();
  private cullTimer = 0;
  private waterTimer = 0;
  private waterFrame = 0;
  private regrowTimer = 0;
  private depleted = new Set<ResourceNode>();

  constructor(
    private scene: Phaser.Scene,
    readonly data: WorldData,
  ) {
    this.map = this.buildTilemap();
    this.buildObjects();
    for (let k = 0; k < data.shoreTiles.length; k += 2) {
      const i = data.shoreTiles[k];
      this.shoreGrid.insert({ x: (i % data.w) * T + T / 2, y: Math.floor(i / data.w) * T + T / 2 });
    }
  }

  private buildTilemap(): Phaser.Tilemaps.Tilemap {
    const d = this.data;
    const noise = new ValueNoise(new Rng(`${d.seed}:decor`));
    const rows: number[][] = [];
    const isWaterish = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= d.w || y >= d.h) return true;
      const t = d.tiles[y * d.w + x];
      return t === TT.WATER || t === TT.DEEP || t === TT.FORD;
    };
    for (let y = 0; y < d.h; y++) {
      const row: number[] = [];
      for (let x = 0; x < d.w; x++) {
        const t = d.tiles[y * d.w + x];
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        const n = noise.fbm(x / 8, y / 8, 2);
        let idx: number;
        switch (t) {
          case TT.GRASS:
            idx = n > 0.62 && h % 3 !== 0 ? TI.GRASS_FLOWERS : n < 0.32 && h % 2 === 0 ? TI.GRASS_TALL : TI.GRASS[h % 2];
            break;
          case TT.FOREST:
            idx = h % 7 === 0 ? TI.FOREST_FERN : n > 0.55 && h % 2 === 0 ? TI.FOREST_LEAVES : TI.FOREST[h % 2];
            break;
          case TT.SAND:
            idx = TI.SAND[h % 5 === 0 ? 1 : 0];
            break;
          case TT.ROCK:
            idx = h % 6 === 0 ? TI.ROCK_PEBBLES : TI.ROCK[h % 2];
            break;
          case TT.PLATEAU:
            idx = TI.PLATEAU[h % 4 === 0 ? 1 : 0];
            break;
          case TT.LEDGE:
            idx = TI.LEDGE;
            break;
          case TT.WALL:
            idx = TI.WALL[h % 2];
            break;
          case TT.SWAMP:
            idx = n > 0.6 && h % 3 === 0 ? TI.SWAMP_REEDS : TI.SWAMP[h % 3 === 1 ? 1 : 0];
            break;
          case TT.FORD:
            idx = TI.FORD;
            break;
          case TT.DEEP:
            idx = TI.DEEP;
            break;
          default: {
            let mask = 0;
            if (!isWaterish(x, y - 1)) mask |= 1;
            if (!isWaterish(x + 1, y)) mask |= 2;
            if (!isWaterish(x, y + 1)) mask |= 4;
            if (!isWaterish(x - 1, y)) mask |= 8;
            idx = TI.WATER_BASE + mask;
          }
        }
        row.push(idx);
      }
      rows.push(row);
    }
    const map = this.scene.make.tilemap({ data: rows, tileWidth: T, tileHeight: T });
    const ts = map.addTilesetImage('tiles', 'tiles', T, T, 0, 0);
    if (!ts) throw new Error('Không tạo được tileset');
    const layer = map.createLayer(0, ts, 0, 0);
    layer?.setDepth(-10);
    return map;
  }

  private chunkKey(x: number, y: number): number {
    const C = BALANCE.world.chunkTiles * T;
    return Math.floor(x / C) * 1000 + Math.floor(y / C);
  }

  private addToChunk(obj: Phaser.GameObjects.GameObject & { x: number; y: number; setVisible(v: boolean): unknown }): void {
    const k = this.chunkKey(obj.x, obj.y);
    let arr = this.chunks.get(k);
    if (!arr) {
      arr = [];
      this.chunks.set(k, arr);
    }
    arr.push(obj);
    obj.setVisible(false);
  }

  private buildObjects(): void {
    const s = this.scene;
    for (const o of this.data.objects) {
      const baseY = o.ty * T + T;
      switch (o.kind) {
        case 'tree':
        case 'pine': {
          const img = s.add.image(o.x, baseY - 2, `${o.kind}${o.variant % 3}`).setOrigin(0.5, 1).setDepth(baseY - 2);
          this.addToChunk(img);
          break;
        }
        case 'boulder': {
          const img = s.add.image(o.x, baseY - 1, `boulder${o.variant % 3}`).setOrigin(0.5, 1).setDepth(baseY - 1);
          this.addToChunk(img);
          break;
        }
        case 'shelter': {
          const img = s.add.image(o.x, baseY + 6, `shelter${o.variant % 3}`).setOrigin(0.5, 1).setDepth(o.y - 20);
          this.addToChunk(img);
          this.shelters.push(o);
          break;
        }
        case 'shrine': {
          const img = s.add.image(o.x, baseY + 2, 'shrine').setOrigin(0.5, 1).setDepth(baseY);
          this.addToChunk(img);
          this.shrine = o;
          break;
        }
        case 'stone': {
          const img = s.add.image(o.x, baseY, 'stone_new').setOrigin(0.5, 1).setDepth(baseY);
          this.addToChunk(img);
          this.stones.push({ obj: o, sprite: img, done: false });
          break;
        }
        case 'coin': {
          const spr = s.add.sprite(o.x, o.y, 'coin', 0).setDepth(o.y);
          spr.play({ key: 'coin:spin', startFrame: o.id % 4 });
          this.addToChunk(spr);
          this.coins.push({ obj: o, sprite: spr, done: false });
          break;
        }
        default: {
          const def = RESOURCES[o.kind as ResourceKind];
          if (!def) break;
          const img = s.add.image(o.x, baseY - 4, `${o.kind}_full`).setOrigin(0.5, 1).setDepth(baseY - 8);
          this.addToChunk(img);
          const node: ResourceNode = { id: o.id, obj: o, def, x: o.x, y: o.y, portions: def.portions, regrowAt: 0, img };
          this.resources.push(node);
          this.resGrid.insert(node);
        }
      }
    }
  }

  applySave(ws: WorldSave): void {
    const byId = new Map(this.resources.map((r) => [r.id, r]));
    for (const [id, ch] of Object.entries(ws.resources)) {
      const node = byId.get(Number(id));
      if (!node) continue;
      node.portions = Math.max(0, Math.min(node.def.portions, Math.floor(ch.p)));
      node.regrowAt = ch.at;
      if (node.portions < node.def.portions) this.depleted.add(node);
      this.refreshNode(node);
    }
    const coinSet = new Set(ws.collectedCoins);
    for (const c of this.coins) {
      if (coinSet.has(c.obj.id)) {
        c.done = true;
        c.sprite.destroy();
      }
    }
    const stoneSet = new Set(ws.stonesUsed);
    for (const st of this.stones) {
      if (stoneSet.has(st.obj.id)) {
        st.done = true;
        (st.sprite as Phaser.GameObjects.Image).setTexture('stone_used');
      }
    }
  }

  exportState(): Pick<WorldSave, 'resources' | 'collectedCoins' | 'stonesUsed'> {
    const resources: Record<string, ResourceChange> = {};
    for (const n of this.depleted) resources[n.id] = { p: n.portions, at: n.regrowAt };
    return {
      resources,
      collectedCoins: this.coins.filter((c) => c.done).map((c) => c.obj.id),
      stonesUsed: this.stones.filter((s) => s.done).map((s) => s.obj.id),
    };
  }

  private refreshNode(n: ResourceNode): void {
    n.img.setTexture(`${n.obj.kind}_${n.portions > 0 ? 'full' : 'empty'}`);
  }

  /** Takes one portion. Regrowth timer starts when the first portion is taken. */
  consume(n: ResourceNode, now: number): boolean {
    if (n.portions <= 0) return false;
    if (n.portions === n.def.portions) n.regrowAt = now + n.def.regrowSec;
    n.portions--;
    this.depleted.add(n);
    this.refreshNode(n);
    return true;
  }

  addCarcass(x: number, y: number, portions: number, now: number): void {
    if (this.carcasses.length >= BALANCE.resources.maxCarcasses) this.removeCarcass(this.carcasses[0]);
    const img = this.scene.add.image(x, y + 4, 'meat').setDepth(y - 6);
    const c: Carcass = { id: carcassIds++, x, y, portions, expireAt: now + BALANCE.npc.carcassLifetimeSec, img };
    this.carcasses.push(c);
    this.carcGrid.insert(c);
  }

  consumeCarcass(c: Carcass): boolean {
    if (c.portions <= 0) return false;
    c.portions--;
    if (c.portions <= 0) this.removeCarcass(c);
    return true;
  }

  removeCarcass(c: Carcass): void {
    c.img.destroy();
    this.carcGrid.remove(c);
    this.carcasses = this.carcasses.filter((q) => q !== c);
  }

  collectCoin(p: Pickup): void {
    p.done = true;
    p.sprite.destroy();
  }

  useStone(p: Pickup): void {
    p.done = true;
    (p.sprite as Phaser.GameObjects.Image).setTexture('stone_used');
  }

  shelterAt(x: number, y: number): WorldObject | null {
    const r = BALANCE.world.shelterSafeRadius;
    for (const s of this.shelters) if (Math.hypot(s.x - x, s.y - y) <= r) return s;
    return null;
  }

  tileAt(x: number, y: number): number {
    const tx = Math.floor(x / T);
    const ty = Math.floor(y / T);
    if (tx < 0 || ty < 0 || tx >= this.data.w || ty >= this.data.h) return TT.WALL;
    return this.data.tiles[ty * this.data.w + tx];
  }

  biomeAt(x: number, y: number): number {
    const tx = Math.floor(x / T);
    const ty = Math.floor(y / T);
    if (tx < 0 || ty < 0 || tx >= this.data.w || ty >= this.data.h) return 0;
    return this.data.biome[ty * this.data.w + tx];
  }

  update(dt: number, now: number, cam: Phaser.Cameras.Scene2D.Camera): void {
    this.cullTimer -= dt;
    if (this.cullTimer <= 0) {
      this.cullTimer = 0.15;
      this.cull(cam);
    }
    this.waterTimer -= dt;
    if (this.waterTimer <= 0 && tilesetFrames.length > 0) {
      this.waterTimer = 0.38;
      this.waterFrame = (this.waterFrame + 1) % tilesetFrames.length;
      const tex = this.scene.textures.get('tiles') as Phaser.Textures.CanvasTexture;
      tex.context.drawImage(tilesetFrames[this.waterFrame], 0, 0);
      tex.refresh();
    }
    this.regrowTimer -= dt;
    if (this.regrowTimer <= 0) {
      this.regrowTimer = 1;
      for (const n of [...this.depleted]) {
        if (now >= n.regrowAt) {
          n.portions = n.def.portions;
          this.depleted.delete(n);
          this.refreshNode(n);
        }
      }
      for (const c of [...this.carcasses]) if (now >= c.expireAt) this.removeCarcass(c);
    }
  }

  private cull(cam: Phaser.Cameras.Scene2D.Camera): void {
    const C = BALANCE.world.chunkTiles * T;
    const v = cam.worldView;
    const x0 = Math.floor((v.x - 64) / C);
    const x1 = Math.floor((v.right + 64) / C);
    const y0 = Math.floor((v.y - 64) / C);
    const y1 = Math.floor((v.bottom + 140) / C);
    const now = new Set<number>();
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) now.add(cx * 1000 + cy);
    for (const k of this.visibleChunks) {
      if (now.has(k)) continue;
      this.chunks.get(k)?.forEach((o) => (o as unknown as { setVisible(v: boolean): void }).setVisible(false));
    }
    for (const k of now) {
      if (this.visibleChunks.has(k)) continue;
      this.chunks.get(k)?.forEach((o) => {
        if (o.active) (o as unknown as { setVisible(v: boolean): void }).setVisible(true);
      });
    }
    this.visibleChunks = now;
  }

  destroy(): void {
    this.map.destroy();
    for (const arr of this.chunks.values()) arr.forEach((o) => o.destroy());
    this.chunks.clear();
    this.carcasses.forEach((c) => c.img.destroy());
    this.carcasses = [];
  }
}
