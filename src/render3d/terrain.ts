import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BALANCE } from '../config/balance';
import { ValueNoise } from '../core/noise';
import { Rng } from '../core/rng';
import { TT, isWaterTile, type WorldData } from '../world/tiles';
import { toZ } from './space';

const T = BALANCE.tile;
const CHUNK = 26;
export const WATER_LEVEL = -4;

const TILE_H: Record<number, number> = {
  [TT.GRASS]: 0,
  [TT.FOREST]: 0,
  [TT.SAND]: -1,
  [TT.WATER]: -13,
  [TT.DEEP]: -24,
  [TT.ROCK]: 2,
  [TT.PLATEAU]: 30,
  [TT.LEDGE]: 22,
  [TT.FORD]: -6,
  [TT.WALL]: 70,
  [TT.SWAMP]: -2,
};

const TILE_C: Record<number, string> = {
  [TT.GRASS]: '#7cc256',
  [TT.FOREST]: '#4e9440',
  [TT.SAND]: '#e6d39a',
  [TT.WATER]: '#c7b27e',
  [TT.DEEP]: '#56806e',
  [TT.ROCK]: '#9d9a8a',
  [TT.PLATEAU]: '#cdb47c',
  [TT.LEDGE]: '#8f7656',
  [TT.FORD]: '#bca877',
  [TT.WALL]: '#6e6656',
  [TT.SWAMP]: '#617040',
};

/** Height field sampled at tile corners (shared by the mesh and by creature placement). */
export class Heightfield {
  readonly w: number;
  readonly h: number;
  readonly hc: Float32Array;
  readonly cc: Float32Array;

  constructor(readonly world: WorldData) {
    const W = world.w;
    const H = world.h;
    this.w = W + 1;
    this.h = H + 1;
    this.hc = new Float32Array(this.w * this.h);
    this.cc = new Float32Array(this.w * this.h * 3);
    const noise = new ValueNoise(new Rng(`${world.seed}:h3d`));
    const tmp = new THREE.Color();
    const col = Object.fromEntries(Object.entries(TILE_C).map(([k, v]) => [k, new THREE.Color(v)])) as Record<number, THREE.Color>;
    for (let cy = 0; cy <= H; cy++) {
      for (let cx = 0; cx <= W; cx++) {
        let landH = 0;
        let landN = 0;
        let wetH = 0;
        let wetN = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let oy = -1; oy <= 0; oy++)
          for (let ox = -1; ox <= 0; ox++) {
            const tx = cx + ox;
            const ty = cy + oy;
            if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
            const t = world.tiles[ty * W + tx];
            const th = TILE_H[t] ?? 0;
            if (isWaterTile(t) && t !== TT.FORD) {
              wetH += th;
              wetN++;
            } else {
              landH += th;
              landN++;
            }
            const c = col[t] ?? col[TT.GRASS];
            r += c.r;
            g += c.g;
            b += c.b;
            n++;
          }
        let hh = landN > 0 ? landH / landN : wetH / Math.max(1, wetN);
        if (landN > 0 && wetN > 0) hh = Math.min(hh, -2);
        const nz = noise.fbm(cx / 7, cy / 7, 3);
        const isWall = hh >= 40;
        hh += (nz - 0.5) * (isWall ? 30 : 2.5);
        const i = cy * this.w + cx;
        this.hc[i] = hh;
        const shade = 0.9 + nz * 0.2 + (((cx * 7349 + cy * 1913) % 17) / 17 - 0.5) * 0.05;
        tmp.setRGB((r / n) * shade, (g / n) * shade, (b / n) * shade);
        this.cc[i * 3] = tmp.r;
        this.cc[i * 3 + 1] = tmp.g;
        this.cc[i * 3 + 2] = tmp.b;
      }
    }
    this.smooth();
  }

  /** One weighted 3×3 pass so shores and plateau rims follow curves instead of the tile grid. */
  private smooth(): void {
    const src = this.hc.slice();
    const { w, h } = this;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (src[i] >= 40) continue;
        let s = src[i] * 4;
        s += (src[i - 1] + src[i + 1] + src[i - w] + src[i + w]) * 2;
        s += src[i - w - 1] + src[i - w + 1] + src[i + w - 1] + src[i + w + 1];
        this.hc[i] = Math.min(s / 16, 40);
      }
  }

  /** Bilinear ground height at world pixel position. */
  at(x: number, y: number): number {
    const fx = Math.max(0, Math.min(this.w - 1.001, x / T));
    const fy = Math.max(0, Math.min(this.h - 1.001, y / T));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const ax = fx - x0;
    const ay = fy - y0;
    const i = y0 * this.w + x0;
    const h00 = this.hc[i];
    const h10 = this.hc[i + 1];
    const h01 = this.hc[i + this.w];
    const h11 = this.hc[i + this.w + 1];
    return (h00 * (1 - ax) + h10 * ax) * (1 - ay) + (h01 * (1 - ax) + h11 * ax) * ay;
  }

  /** Ground height for standing creatures: never below the water surface (fords). */
  standAt(x: number, y: number): number {
    return Math.max(this.at(x, y), WATER_LEVEL - 3);
  }
}

function chunkGeometry(hf: Heightfield, x0: number, y0: number, nx: number, ny: number): THREE.BufferGeometry {
  const vw = nx + 1;
  const vh = ny + 1;
  const pos = new Float32Array(vw * vh * 3);
  const col = new Float32Array(vw * vh * 3);
  for (let j = 0; j < vh; j++)
    for (let i = 0; i < vw; i++) {
      const ci = (y0 + j) * hf.w + (x0 + i);
      const h = hf.hc[ci];
      const k = (j * vw + i) * 3;
      pos[k] = (x0 + i) * T;
      pos[k + 1] = h;
      pos[k + 2] = toZ((y0 + j) * T, h);
      col[k] = hf.cc[ci * 3];
      col[k + 1] = hf.cc[ci * 3 + 1];
      col[k + 2] = hf.cc[ci * 3 + 2];
    }
  const idx: number[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * vw + i;
      const b = a + 1;
      const c = a + vw;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Steep slopes read as rocky cliff faces.
  const nrm = g.attributes.normal as THREE.BufferAttribute;
  for (let v = 0; v < vw * vh; v++) {
    const ny = nrm.getY(v);
    let k = Math.max(0, Math.min(1, (0.97 - ny) / 0.14));
    if (k <= 0 || pos[v * 3 + 1] < 3) continue;
    if (nrm.getZ(v) > 0.15) k = Math.min(1, k * 1.4);
    col[v * 3] += (CLIFF.r - col[v * 3]) * k;
    col[v * 3 + 1] += (CLIFF.g - col[v * 3 + 1]) * k;
    col[v * 3 + 2] += (CLIFF.b - col[v * 3 + 2]) * k;
  }
  g.computeBoundingSphere();
  return g;
}

const CLIFF = new THREE.Color('#6f5a45');

function colorize(g: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo.hasAttribute('uv')) geo.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.computeVertexNormals();
  return geo;
}

function decoGeometries(): Record<string, THREE.BufferGeometry> {
  const blade = (x: number, z: number, h: number, tilt: number, color: string) => {
    const g = new THREE.ConeGeometry(1.4, h, 3);
    g.translate(0, h / 2, 0);
    g.rotateZ(tilt);
    g.translate(x, 0, z);
    return colorize(g, color);
  };
  const tuft = mergeGeometries([blade(0, 0, 9, 0.1, '#5fae45'), blade(-2.5, 1, 7, 0.45, '#7cc95a'), blade(2.5, -1, 8, -0.4, '#4e9a3a'), blade(0.5, 2, 6, -0.2, '#8fd56a')]);
  const fern = mergeGeometries([blade(0, 0, 10, 0.3, '#3d8a3a'), blade(-2, 1, 9, 0.7, '#4ea048'), blade(2, -1, 9, -0.7, '#358033'), blade(0, 2, 8, -0.3, '#5ab452')]);
  const stem = (x: number, z: number) => {
    const s = new THREE.CylinderGeometry(0.4, 0.4, 7, 3);
    s.translate(x, 3.5, z);
    return colorize(s, '#4e9a3a');
  };
  const petal = (x: number, z: number, color: string) => {
    const p = new THREE.IcosahedronGeometry(2, 0);
    p.scale(1, 0.6, 1);
    p.translate(x, 7.5, z);
    return colorize(p, color);
  };
  const flowersA = mergeGeometries([stem(0, 0), petal(0, 0, '#ffe05a'), stem(4, 2), petal(4, 2, '#ffffff'), stem(-3, 3), petal(-3, 3, '#ff8fb8')]);
  const reed = mergeGeometries([blade(0, 0, 16, 0.05, '#6f8a3c'), blade(-2, 1, 13, 0.25, '#879e48'), blade(2, -1, 14, -0.2, '#5d7832'), colorize(new THREE.CapsuleGeometry(1.2, 3, 2, 5).translate(0.4, 16, 0), '#7a5534')]);
  const peb = (x: number, z: number, s: number, c: string) => colorize(new THREE.DodecahedronGeometry(s, 0).scale(1, 0.6, 1).translate(x, s * 0.3, z), c);
  const pebbles = mergeGeometries([peb(0, 0, 3, '#8f8a7c'), peb(4, 2, 2, '#a8a294'), peb(-3, 2, 1.6, '#7b766b')]);
  return { tuft, fern, flowersA, reed, pebbles };
}

/** Builds the terrain chunks, water plane and ground decoration. */
export function buildTerrain(world: WorldData, hf: Heightfield, terrainMat: THREE.Material, decoMat: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const W = world.w;
  const H = world.h;
  for (let cy = 0; cy < H; cy += CHUNK)
    for (let cx = 0; cx < W; cx += CHUNK) {
      const mesh = new THREE.Mesh(chunkGeometry(hf, cx, cy, Math.min(CHUNK, W - cx), Math.min(CHUNK, H - cy)), terrainMat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      group.add(mesh);
    }

  // Water surface: one plane, hidden by the terrain wherever the ground is higher.
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(W * T, H * T, 1, 1),
    new THREE.MeshPhongMaterial({ color: '#3d93d6', transparent: true, opacity: 0.72, shininess: 90, specular: new THREE.Color('#bfe6ff'), depthWrite: false }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set((W * T) / 2, WATER_LEVEL, toZ((H * T) / 2, WATER_LEVEL));
  water.scale.set(1, (toZ(H * T, 0) - toZ(0, 0)) / (H * T), 1);
  water.receiveShadow = true;
  water.renderOrder = 1;
  water.name = 'water';
  group.add(water);

  // Decoration instances per chunk.
  const geos = decoGeometries();
  const rng = new Rng(`${world.seed}:deco3d`);
  const occupied = new Uint8Array(W * H);
  for (const o of world.objects) occupied[o.ty * W + o.tx] = 1;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let cy = 0; cy < H; cy += CHUNK)
    for (let cx = 0; cx < W; cx += CHUNK) {
      const lists: Record<string, THREE.Matrix4[]> = { tuft: [], fern: [], flowersA: [], reed: [], pebbles: [] };
      for (let ty = cy; ty < Math.min(H, cy + CHUNK); ty++)
        for (let tx = cx; tx < Math.min(W, cx + CHUNK); tx++) {
          const i = ty * W + tx;
          if (occupied[i]) continue;
          const t = world.tiles[i];
          const r = rng.next();
          let kind: string | null = null;
          if (t === TT.GRASS) kind = r < 0.16 ? 'tuft' : r < 0.2 ? 'flowersA' : null;
          else if (t === TT.FOREST) kind = r < 0.22 ? 'fern' : r < 0.26 ? 'tuft' : null;
          else if (t === TT.SWAMP) kind = r < 0.2 ? 'reed' : null;
          else if (t === TT.LEDGE) kind = r < 0.4 ? 'pebbles' : null;
          else if (t === TT.ROCK || t === TT.PLATEAU) kind = r < 0.07 ? 'pebbles' : null;
          else if (t === TT.SAND) kind = r < 0.04 ? 'pebbles' : null;
          if (!kind) continue;
          const x = (tx + 0.2 + rng.next() * 0.6) * T;
          const y = (ty + 0.2 + rng.next() * 0.6) * T;
          const h = hf.at(x, y);
          const sc = 0.8 + rng.next() * 0.5;
          q.setFromAxisAngle(up, rng.next() * Math.PI * 2);
          s.set(sc, sc, sc);
          p.set(x, h, toZ(y, h));
          lists[kind].push(m.clone().compose(p, q, s));
        }
      for (const [k, arr] of Object.entries(lists)) {
        if (arr.length === 0) continue;
        const im = new THREE.InstancedMesh(geos[k], decoMat, arr.length);
        arr.forEach((mm, j) => im.setMatrixAt(j, mm));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.receiveShadow = true;
        group.add(im);
      }
    }
  return group;
}
