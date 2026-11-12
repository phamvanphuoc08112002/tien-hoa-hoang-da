import { BALANCE } from '../config/balance';
import { ValueNoise } from '../core/noise';
import { Rng } from '../core/rng';
import { FOODS, RESOURCES } from '../data/foods';
import { realmOf } from '../data/realms';
import type { Diet, ResourceKind } from '../data/types';
import { BLK, TT, type ObjKind, type WorldData, type WorldObject } from './tiles';

const BIOME = { grass: 0, forest: 1, lake: 2, rock: 3, swamp: 4 } as const;
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const BLOCKING_KINDS: ReadonlySet<ObjKind> = new Set<ObjKind>(['tree', 'pine', 'boulder', 'shrine', 'stone']);

export function generateWorld(seed: string, realm = 0): WorldData {
  const G = realmOf(realm).gen;
  const W = BALANCE.world.widthTiles;
  const H = BALANCE.world.heightTiles;
  const N = W * H;
  const T = BALANCE.tile;
  const rng = new Rng(`${seed}:terrain`);
  const nElev = new ValueNoise(rng);
  const nMoist = new ValueNoise(rng);
  const nDetail = new ValueNoise(rng);

  const tiles = new Uint8Array(N);
  const biome = new Uint8Array(N);
  const idx = (x: number, y: number) => y * W + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // --- Macro layout: rocky corner, swamp in the mirrored corner, central lake, ponds ---
  const corner = rng.int(0, 3);
  const rcx = (corner % 2 === 0 ? 0.84 : 0.16) * W;
  const rcy = (corner < 2 ? 0.16 : 0.84) * H;
  const scx = W - rcx;
  const scy = rcy;
  const swampR = W * G.swampFrac;
  const awayX = Math.sign(W / 2 - rcx);
  const awayY = Math.sign(H / 2 - rcy);
  const lcx = W * 0.5 + awayX * W * rng.range(0.03, 0.09);
  const lcy = H * 0.5 + awayY * H * rng.range(0.03, 0.09);
  const lakeR = rng.range(14, 18) * G.lakeMult;

  const ponds: { x: number; y: number; r: number }[] = [];
  for (let k = 0; k < 3; k++) {
    let px = 0;
    let py = 0;
    for (let tries = 0; tries < 60; tries++) {
      px = rng.range(0.15, 0.85) * W;
      py = rng.range(0.15, 0.85) * H;
      const okLake = Math.hypot(px - lcx, py - lcy) > 45;
      const okRock = Math.hypot(px - rcx, py - rcy) > 70;
      const okSwamp = Math.hypot(px - scx, py - scy) > swampR + 12;
      const okPonds = ponds.every((p) => Math.hypot(px - p.x, py - p.y) > 50);
      if (okLake && okRock && okSwamp && okPonds) break;
    }
    ponds.push({ x: px, y: py, r: rng.range(4.5, 7) });
  }

  const rockiness = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) {
        tiles[i] = TT.WALL;
        continue;
      }
      const d = Math.hypot(x - rcx, y - rcy) / (W * 0.5);
      const rk = 1 - d + (nElev.fbm(x / 22, y / 22) - 0.5) * 0.5 + G.rockBias;
      rockiness[i] = rk;
      const wob = (nDetail.fbm(x / 7, y / 7) - 0.5) * 0.55;
      const lakeD = Math.hypot(x - lcx, y - lcy) / lakeR + wob;
      let pondD = Infinity;
      for (const p of ponds) pondD = Math.min(pondD, Math.hypot(x - p.x, y - p.y) / p.r + wob);
      const swampD = Math.hypot(x - scx, y - scy) / swampR + (nMoist.fbm(x / 14 + 7, y / 14 + 7) - 0.5) * 0.6;
      if (lakeD < 1 || pondD < 1) {
        tiles[i] = lakeD < 0.55 ? TT.DEEP : TT.WATER;
      } else if (rk > 0.84) {
        tiles[i] = TT.PLATEAU;
      } else if (rk > 0.6) {
        tiles[i] = TT.ROCK;
      } else if (swampD < 1) {
        tiles[i] = swampD < 0.85 && nDetail.fbm(x / 5 + 20, y / 5 + 20) > 0.66 ? TT.WATER : TT.SWAMP;
      } else {
        tiles[i] = TT.GRASS;
      }
    }
  }

  // --- Stream from the lake toward a map edge away from the rocks ---
  {
    let sx = lcx;
    let sy = lcy;
    const targetAng = Math.atan2(awayY * (rng.chance(0.5) ? 1 : 0.2), awayX * (rng.chance(0.5) ? 0.2 : 1));
    let ang = targetAng;
    let step = 0;
    while (step < 400) {
      ang += (nDetail.noise(step / 9, 3.3) - 0.5) * 0.5;
      ang = ang * 0.85 + targetAng * 0.15;
      sx += Math.cos(ang);
      sy += Math.sin(ang);
      const tx = Math.round(sx);
      const ty = Math.round(sy);
      if (!inb(tx, ty) || tiles[idx(tx, ty)] === TT.WALL) break;
      const t0 = tiles[idx(tx, ty)];
      if (t0 === TT.ROCK || t0 === TT.PLATEAU) break;
      const ford = step > lakeR + 2 && step % 16 === 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (Math.abs(ox) + Math.abs(oy) > 1 && !ford) continue;
          const x = tx + ox;
          const y = ty + oy;
          if (!inb(x, y)) continue;
          const t = tiles[idx(x, y)];
          if (t === TT.WALL || t === TT.ROCK || t === TT.PLATEAU || t === TT.DEEP) continue;
          tiles[idx(x, y)] = ford ? TT.FORD : t === TT.FORD ? TT.FORD : TT.WATER;
        }
      }
      step++;
    }
  }

  // --- Ledges ring the plateau ---
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (tiles[i] !== TT.PLATEAU) continue;
      for (const [dx, dy] of N4) {
        const t = tiles[idx(x + dx, y + dy)];
        if (t !== TT.PLATEAU && t !== TT.LEDGE && t !== TT.WALL) {
          tiles[i] = TT.LEDGE;
          break;
        }
      }
    }
  }

  // --- Distance to water (BFS) for shores ---
  const waterDist = multiSourceDistance(W, H, (i) => tiles[i] === TT.WATER || tiles[i] === TT.DEEP || tiles[i] === TT.FORD, (i) => tiles[i] !== TT.WALL);

  // --- Biomes: forest by moisture quantile, shore by water distance ---
  const moist: number[] = [];
  const moistArr = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      const m = nMoist.fbm(x / 28, y / 28, 4);
      moistArr[i] = m;
      if (tiles[i] === TT.GRASS) moist.push(m);
    }
  }
  moist.sort((a, b) => a - b);
  const forestThreshold = moist[Math.floor(moist.length * G.forestQuantile)] ?? 0.6;

  for (let i = 0; i < N; i++) {
    const t = tiles[i];
    if (t === TT.ROCK || t === TT.PLATEAU || t === TT.LEDGE) biome[i] = BIOME.rock;
    else if (t === TT.SWAMP) biome[i] = BIOME.swamp;
    else if (t === TT.WATER || t === TT.DEEP || t === TT.FORD) biome[i] = BIOME.lake;
    else if (t === TT.WALL) biome[i] = BIOME.grass;
    else if (waterDist[i] <= 3) {
      biome[i] = BIOME.lake;
      if (waterDist[i] <= 1) tiles[i] = TT.SAND;
    } else if (moistArr[i] > forestThreshold) {
      biome[i] = BIOME.forest;
      tiles[i] = TT.FOREST;
    } else biome[i] = BIOME.grass;
  }

  // --- Terrain connectivity: carve fords so every sizeable region is joined ---
  const walk2T = (i: number) => {
    const t = tiles[i];
    return t !== TT.WATER && t !== TT.DEEP && t !== TT.WALL;
  };
  carveConnectivity(W, H, tiles, walk2T);

  // --- Spawn: grassland near water, far from the rocks ---
  const terrainBlocked = (i: number, climb: boolean) => {
    const t = tiles[i];
    return t === TT.WATER || t === TT.DEEP || t === TT.WALL || (!climb && (t === TT.LEDGE || t === TT.PLATEAU));
  };
  const largest = largestComponent(W, H, (i) => !terrainBlocked(i, false));
  const waterDist2 = multiSourceDistance(W, H, (i) => tiles[i] === TT.WATER || tiles[i] === TT.DEEP || tiles[i] === TT.FORD, (i) => tiles[i] !== TT.WALL);

  const spawnRng = new Rng(`${seed}:spawn`);
  const candidates: number[] = [];
  for (let y = 6; y < H - 6; y++) {
    for (let x = 6; x < W - 6; x++) {
      const i = idx(x, y);
      if (!largest[i]) continue;
      if (biome[i] !== BIOME.grass) continue;
      if (waterDist2[i] < 5 || waterDist2[i] > 16) continue;
      if (rockiness[i] > 0.25) continue;
      if (Math.hypot(x - scx, y - scy) < swampR * G.swampAvoid + G.swampPad) continue;
      candidates.push(i);
    }
  }
  if (candidates.length === 0) {
    for (let i = 0; i < N; i++) if (largest[i] && tiles[i] !== TT.LEDGE && tiles[i] !== TT.PLATEAU && tiles[i] !== TT.ROCK) candidates.push(i);
  }
  const spawnI = spawnRng.pick(candidates);
  const spawn = { tx: spawnI % W, ty: Math.floor(spawnI / W) };

  // --- Objects ---
  const objects: WorldObject[] = [];
  const occ = new Int32Array(N).fill(-1);
  const objBlock = new Uint8Array(N);
  const reachTerrain1 = floodFrom(W, H, spawnI, (i) => !terrainBlocked(i, false));
  const reachTerrain2 = floodFrom(W, H, spawnI, (i) => !terrainBlocked(i, true));

  const addObj = (kind: ObjKind, tx: number, ty: number, variant = 0): WorldObject | null => {
    const i = idx(tx, ty);
    if (occ[i] !== -1) return null;
    const blocks = BLOCKING_KINDS.has(kind);
    const o: WorldObject = { id: objects.length, kind, tx, ty, x: tx * T + T / 2, y: ty * T + T / 2, blocks, variant };
    objects.push(o);
    occ[i] = o.id;
    if (blocks) objBlock[i] = 1;
    return o;
  };

  const nearTerrainBlock = (tx: number, ty: number, r: number) => {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const x = tx + ox;
        const y = ty + oy;
        if (!inb(x, y)) return true;
        const t = tiles[idx(x, y)];
        if (t === TT.WATER || t === TT.DEEP || t === TT.WALL || t === TT.LEDGE || t === TT.FORD) return true;
      }
    }
    return false;
  };
  const nearBlocker = (tx: number, ty: number, r: number) => {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const x = tx + ox;
        const y = ty + oy;
        if (inb(x, y) && objBlock[idx(x, y)]) return true;
      }
    }
    return false;
  };
  /** Blockers are isolated and kept off narrow terrain so they can never sever paths. */
  const canPlaceBlocker = (tx: number, ty: number) => {
    const i = idx(tx, ty);
    if (!reachTerrain2[i] || occ[i] !== -1) return false;
    if (nearTerrainBlock(tx, ty, 2)) return false;
    if (nearBlocker(tx, ty, 1)) return false;
    if (Math.abs(tx - spawn.tx) <= 3 && Math.abs(ty - spawn.ty) <= 3) return false;
    return true;
  };
  const canPlaceFree = (tx: number, ty: number, needReach1 = false) => {
    if (!inb(tx, ty)) return false;
    const i = idx(tx, ty);
    if (occ[i] !== -1) return false;
    if (terrainBlocked(i, true) || tiles[i] === TT.LEDGE) return false;
    if (needReach1 ? !reachTerrain1[i] : !reachTerrain2[i]) return false;
    if (nearBlocker(tx, ty, 0)) return false;
    return true;
  };

  const ringPick = (r: Rng, cx: number, cy: number, minR: number, maxR: number, ok: (x: number, y: number) => boolean): { tx: number; ty: number } | null => {
    for (let k = 0; k < 400; k++) {
      const a = r.range(0, Math.PI * 2);
      const d = r.range(minR, maxR);
      const x = Math.round(cx + Math.cos(a) * d);
      const y = Math.round(cy + Math.sin(a) * d);
      if (inb(x, y) && ok(x, y)) return { tx: x, ty: y };
    }
    return null;
  };

  const orng = new Rng(`${seed}:objects`);
  const clearAround = (tx: number, ty: number) => {
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (inb(tx + ox, ty + oy)) occ[idx(tx + ox, ty + oy)] = occ[idx(tx + ox, ty + oy)] === -1 ? -2 : occ[idx(tx + ox, ty + oy)];
  };

  // Shelters: one near spawn, then one per biome (+ plateau).
  const placeStructure = (kind: ObjKind, pick: { tx: number; ty: number } | null, variant = 0) => {
    if (!pick) return null;
    const o = addObj(kind, pick.tx, pick.ty, variant);
    if (o) clearAround(pick.tx, pick.ty);
    return o;
  };
  const freeSpot = (needReach1: boolean) => (x: number, y: number) =>
    canPlaceFree(x, y, needReach1) && !nearTerrainBlock(x, y, 1);

  placeStructure('shelter', ringPick(orng, spawn.tx, spawn.ty, 5, 10, freeSpot(true)), 0);
  const biomeSpot = (b: number, needReach1: boolean, extra?: (i: number) => boolean) => (x: number, y: number) => {
    const i = idx(x, y);
    return biome[i] === b && freeSpot(needReach1)(x, y) && (!extra || extra(i));
  };
  const randomTileWhere = (r: Rng, ok: (x: number, y: number) => boolean, tries = 4000) => {
    for (let k = 0; k < tries; k++) {
      const x = r.int(3, W - 4);
      const y = r.int(3, H - 4);
      if (ok(x, y)) return { tx: x, ty: y };
    }
    return null;
  };
  const farFromSpawn = (min: number) => (x: number, y: number) => Math.hypot(x - spawn.tx, y - spawn.ty) >= min;
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.forest, true)(x, y) && farFromSpawn(25)(x, y)), 1);
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.forest, true)(x, y) && farFromSpawn(45)(x, y)), 1);
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.forest, true)(x, y) && farFromSpawn(80)(x, y)), 1);
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.grass, true)(x, y) && farFromSpawn(70)(x, y)), 0);
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.lake, true)(x, y) && farFromSpawn(20)(x, y)), 0);
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.lake, true)(x, y) && farFromSpawn(60)(x, y)), 0);
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.swamp, true)(x, y) && Math.hypot(x - scx, y - scy) > swampR * 0.5), 1);
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.swamp, true)(x, y) && Math.hypot(x - scx, y - scy) < swampR * 0.45), 1);
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.rock, true, (i) => tiles[i] === TT.ROCK)(x, y)), 2);
  placeStructure('shelter', randomTileWhere(orng, (x, y) => biomeSpot(BIOME.rock, false, (i) => tiles[i] === TT.PLATEAU)(x, y)), 2);

  // Shrine near spawn region (reachable at form 1).
  placeStructure('shrine', ringPick(orng, spawn.tx, spawn.ty, 9, 22, (x, y) => freeSpot(true)(x, y) && !nearBlocker(x, y, 2)));

  // Exploration stones spread across sectors.
  const stoneSpots: { tx: number; ty: number }[] = [];
  for (let k = 0; k < 14; k++) {
    const p = randomTileWhere(orng, (x, y) => freeSpot(k < 11)(x, y) && !nearBlocker(x, y, 1) && farFromSpawn(14)(x, y) && stoneSpots.every((s) => Math.hypot(s.tx - x, s.ty - y) > 34));
    if (p) {
      stoneSpots.push(p);
      placeStructure('stone', p, k);
    }
  }

  // Guaranteed food near spawn for every diet.
  const nearSpawnFood: [ResourceKind, number][] = [
    ['grass', 5],
    ['berrybush', 2],
    ['leafbush', 1],
    ['nest', 2],
    ['mushroom', 1],
  ];
  for (const [kind, count] of nearSpawnFood) {
    for (let c = 0; c < count; c++) {
      const p = ringPick(orng, spawn.tx, spawn.ty, 2.5, 9, (x, y) => canPlaceFree(x, y, true));
      if (p) addObj(kind, p.tx, p.ty, orng.int(0, 2));
    }
  }

  // Biome scatter with noise clustering.
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const i = idx(x, y);
      if (occ[i] !== -1 || !reachTerrain2[i]) continue;
      const t = tiles[i];
      if (t === TT.WATER || t === TT.DEEP || t === TT.WALL || t === TT.LEDGE || t === TT.FORD) continue;
      const cl = nDetail.fbm(x / 9 + 50, y / 9 + 50, 3);
      const cluster = 0.4 + cl * 1.2;
      const b = biome[i];
      // Weighted table per biome: [kind, probability]; first roll that lands wins.
      let table: [ObjKind, number][];
      if (b === BIOME.grass) {
        table = [
          ['grass', 0.045 * cluster],
          ['berrybush', 0.007],
          ['leafbush', 0.004],
          ['tree', 0.006],
          ['boulder', 0.003],
          ['nest', 0.0015],
        ];
      } else if (b === BIOME.forest) {
        table = [
          [cl > 0.55 ? 'pine' : 'tree', 0.17 * cluster],
          ['leafbush', 0.022],
          ['berrybush', 0.012],
          ['mushroom', cl > 0.5 ? 0.022 : 0.008],
          ['nest', 0.002],
          ['grass', 0.006],
        ];
      } else if (b === BIOME.swamp) {
        table = [
          [cl > 0.6 ? 'pine' : 'tree', 0.035 * cluster],
          ['mushroom', 0.03],
          ['leafbush', 0.016],
          ['grass', 0.012],
          ['nest', 0.004],
        ];
      } else if (b === BIOME.lake) {
        table = t === TT.SAND ? [['grass', 0.01]] : [['grass', 0.04 * cluster], ['berrybush', 0.01], ['tree', 0.004]];
      } else if (t === TT.PLATEAU) {
        table = [['boulder', 0.05], ['crystal', 0.018], ['nest', 0.004]];
      } else {
        table = [['boulder', 0.06 * cluster], ['crystal', 0.004], ['nest', 0.004], ['grass', 0.004]];
      }
      let kind: ObjKind | null = null;
      let acc = 0;
      const r = orng.next();
      for (const [k, p] of table) {
        acc += p;
        if (r < acc) {
          kind = k;
          break;
        }
      }
      if (!kind) continue;
      if (BLOCKING_KINDS.has(kind)) {
        if (canPlaceBlocker(x, y)) addObj(kind, x, y, orng.int(0, 2));
      } else if (canPlaceFree(x, y)) {
        addObj(kind, x, y, orng.int(0, 2));
      }
    }
  }

  // Coins, weighted towards dangerous biomes.
  const coinWeight = [1, 2, 1, 3.2, 2.6];
  let coins = 0;
  for (let k = 0; k < 40000 && coins < 100; k++) {
    const x = orng.int(3, W - 4);
    const y = orng.int(3, H - 4);
    const i = idx(x, y);
    if (!canPlaceFree(x, y)) continue;
    if (Math.hypot(x - spawn.tx, y - spawn.ty) < 8) continue;
    if (orng.next() * 3.2 > coinWeight[biome[i]]) continue;
    if (addObj('coin', x, y)) coins++;
  }

  // Ancient Gate: far from spawn on open, walkable ground so the guardian fight has room.
  // Placed last with its own RNG so every other object keeps its id.
  const prng = new Rng(`${seed}:portal`);
  let portal: { tx: number; ty: number } | null = null;
  for (const [minDist, clear] of [
    [90, 3],
    [60, 2],
    [30, 1],
  ] as const) {
    let bestD = -1;
    let found = 0;
    for (let k = 0; k < 8000 && found < 60; k++) {
      const x = prng.int(6, W - 7);
      const y = prng.int(6, H - 7);
      const d = Math.hypot(x - spawn.tx, y - spawn.ty);
      if (d < minDist || !reachTerrain1[idx(x, y)] || !canPlaceFree(x, y, true)) continue;
      if (tiles[idx(x, y)] === TT.FORD || nearTerrainBlock(x, y, clear) || nearBlocker(x, y, clear)) continue;
      found++;
      if (d > bestD) {
        bestD = d;
        portal = { tx: x, ty: y };
      }
    }
    if (portal) break;
  }
  if (portal) addObj('portal', portal.tx, portal.ty);

  // Restore reserved markers.
  for (let i = 0; i < N; i++) if (occ[i] === -2) occ[i] = -1;

  // --- Final blocking grid and reachability with objects ---
  const blocked = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const t = tiles[i];
    if (t === TT.WALL || objBlock[i]) blocked[i] = BLK.SOLID;
    else if (t === TT.WATER || t === TT.DEEP) blocked[i] = BLK.WATER;
    else if (t === TT.LEDGE) blocked[i] = BLK.LEDGE;
    else blocked[i] = BLK.FREE;
  }
  const reach1 = floodFrom(W, H, spawnI, (i) => blocked[i] === BLK.FREE && tiles[i] !== TT.PLATEAU);
  const reach2 = floodFrom(W, H, spawnI, (i) => blocked[i] === BLK.FREE || blocked[i] === BLK.LEDGE);

  const shoreTiles: number[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = idx(x, y);
      if (!reach2[i] || blocked[i] !== BLK.FREE) continue;
      if (tiles[i] === TT.FORD) {
        shoreTiles.push(i);
        continue;
      }
      for (const [dx, dy] of N4) {
        const t = tiles[idx(x + dx, y + dy)];
        if (t === TT.WATER || t === TT.DEEP || t === TT.FORD) {
          shoreTiles.push(i);
          break;
        }
      }
    }
  }

  return {
    seed,
    w: W,
    h: H,
    tiles,
    biome,
    blocked,
    reach1,
    reach2,
    objects,
    spawn,
    shoreTiles,
    rockCenter: { tx: Math.round(rcx), ty: Math.round(rcy) },
    lakeCenter: { tx: Math.round(lcx), ty: Math.round(lcy) },
    swampCenter: { tx: Math.round(scx), ty: Math.round(scy) },
    portal,
  };
}

// ---------------------------------------------------------------------------
// Grid helpers
// ---------------------------------------------------------------------------

function multiSourceDistance(W: number, H: number, isSource: (i: number) => boolean, passable: (i: number) => boolean): Int32Array {
  const N = W * H;
  const dist = new Int32Array(N).fill(1 << 29);
  const q = new Int32Array(N);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < N; i++) {
    if (isSource(i)) {
      dist[i] = 0;
      q[tail++] = i;
    }
  }
  while (head < tail) {
    const i = q[head++];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (dist[j] <= dist[i] + 1 || !passable(j)) continue;
      dist[j] = dist[i] + 1;
      q[tail++] = j;
    }
  }
  return dist;
}

export function floodFrom(W: number, H: number, start: number, passable: (i: number) => boolean): Uint8Array {
  const N = W * H;
  const seen = new Uint8Array(N);
  if (!passable(start)) return seen;
  const q = new Int32Array(N);
  let head = 0;
  let tail = 0;
  q[tail++] = start;
  seen[start] = 1;
  while (head < tail) {
    const i = q[head++];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (seen[j] || !passable(j)) continue;
      seen[j] = 1;
      q[tail++] = j;
    }
  }
  return seen;
}

function labelComponents(W: number, H: number, passable: (i: number) => boolean): { labels: Int32Array; sizes: number[] } {
  const N = W * H;
  const labels = new Int32Array(N).fill(-1);
  const sizes: number[] = [];
  const q = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (labels[s] !== -1 || !passable(s)) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    q[tail++] = s;
    labels[s] = id;
    while (head < tail) {
      const i = q[head++];
      const x = i % W;
      const y = (i / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (labels[j] !== -1 || !passable(j)) continue;
        labels[j] = id;
        q[tail++] = j;
      }
    }
    sizes.push(tail);
  }
  return { labels, sizes };
}

function largestComponent(W: number, H: number, passable: (i: number) => boolean): Uint8Array {
  const { labels, sizes } = labelComponents(W, H, passable);
  let best = 0;
  for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[best]) best = k;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) if (labels[i] === best) out[i] = 1;
  return out;
}

/** Joins every component of >= 10 tiles to the largest one by turning water on the shortest crossing into fords. */
function carveConnectivity(W: number, H: number, tiles: Uint8Array, walk: (i: number) => boolean): void {
  for (let iter = 0; iter < 30; iter++) {
    const { labels, sizes } = labelComponents(W, H, walk);
    if (sizes.length <= 1) return;
    let main = 0;
    for (let k = 1; k < sizes.length; k++) if (sizes[k] > sizes[main]) main = k;
    let target = -1;
    for (let k = 0; k < sizes.length; k++) if (k !== main && sizes[k] >= 10) target = k;
    if (target === -1) return;
    // BFS from the target component through anything but walls until hitting main.
    const N = W * H;
    const prev = new Int32Array(N).fill(-2);
    const q = new Int32Array(N);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < N; i++) {
      if (labels[i] === target) {
        prev[i] = -1;
        q[tail++] = i;
      }
    }
    let hit = -1;
    while (head < tail && hit === -1) {
      const i = q[head++];
      const x = i % W;
      const y = (i / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        const j = ny * W + nx;
        if (prev[j] !== -2 || tiles[j] === TT.WALL) continue;
        prev[j] = i;
        if (labels[j] === main) {
          hit = j;
          break;
        }
        q[tail++] = j;
      }
    }
    if (hit === -1) return;
    let c = prev[hit];
    while (c >= 0 && prev[c] !== -1) {
      if (!walk(c)) tiles[c] = TT.FORD;
      c = prev[c];
    }
    if (c >= 0 && !walk(c)) tiles[c] = TT.FORD;
  }
}

// ---------------------------------------------------------------------------
// Queries used by gameplay and tests
// ---------------------------------------------------------------------------

/** BFS step distance from a tile over walkable terrain + objects. */
export function stepDistances(world: WorldData, startTx: number, startTy: number, canClimb: boolean): Int32Array {
  const { w: W, h: H, blocked } = world;
  const N = W * H;
  const dist = new Int32Array(N).fill(-1);
  const pass = (i: number) => blocked[i] === BLK.FREE || (canClimb && blocked[i] === BLK.LEDGE);
  const s = startTy * W + startTx;
  if (!pass(s)) return dist;
  const q = new Int32Array(N);
  let head = 0;
  let tail = 0;
  q[tail++] = s;
  dist[s] = 0;
  while (head < tail) {
    const i = q[head++];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (dist[j] !== -1 || !pass(j)) continue;
      dist[j] = dist[i] + 1;
      q[tail++] = j;
    }
  }
  return dist;
}

const RES_KINDS = new Set<string>(Object.keys(RESOURCES));

export interface SpawnReport {
  ok: boolean;
  foodSteps: number;
  waterSteps: number;
  shelterSteps: number;
  shrineSteps: number;
  spawnBlocked: boolean;
}

/** Validates that a diet can reach suitable food, water and a shelter from spawn. */
export function verifySpawn(world: WorldData, diet: Diet): SpawnReport {
  const { w: W } = world;
  const d = stepDistances(world, world.spawn.tx, world.spawn.ty, false);
  const spawnI = world.spawn.ty * W + world.spawn.tx;
  const spawnBlocked = world.blocked[spawnI] !== BLK.FREE;
  let foodSteps = Infinity;
  let shelterSteps = Infinity;
  let shrineSteps = Infinity;
  const stepsTo = (tx: number, ty: number, solid: boolean): number => {
    if (!solid) {
      const v = d[ty * W + tx];
      return v < 0 ? Infinity : v;
    }
    // Solid objects are used from an adjacent tile.
    let best = Infinity;
    for (const [dx, dy] of N4) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= world.h) continue;
      const v = d[ny * W + nx];
      if (v >= 0) best = Math.min(best, v + 1);
    }
    return best;
  };
  for (const o of world.objects) {
    if (RES_KINDS.has(o.kind)) {
      const food = RESOURCES[o.kind as ResourceKind].food;
      if ((FOODS[food].efficiency[diet] ?? 0) > 0) foodSteps = Math.min(foodSteps, stepsTo(o.tx, o.ty, false));
    } else if (o.kind === 'shelter') shelterSteps = Math.min(shelterSteps, stepsTo(o.tx, o.ty, false));
    else if (o.kind === 'shrine') shrineSteps = Math.min(shrineSteps, stepsTo(o.tx, o.ty, true));
  }
  let waterSteps = Infinity;
  for (const i of world.shoreTiles) if (d[i] >= 0) waterSteps = Math.min(waterSteps, d[i]);
  const B = BALANCE.world;
  return {
    ok: !spawnBlocked && foodSteps <= B.spawnMaxFoodSteps && waterSteps <= B.spawnMaxWaterSteps && shelterSteps < Infinity && shrineSteps < Infinity,
    foodSteps,
    waterSteps,
    shelterSteps,
    shrineSteps,
    spawnBlocked,
  };
}

export function biomeAt(world: WorldData, px: number, py: number): number {
  const tx = Math.floor(px / BALANCE.tile);
  const ty = Math.floor(py / BALANCE.tile);
  if (tx < 0 || ty < 0 || tx >= world.w || ty >= world.h) return 0;
  return world.biome[ty * world.w + tx];
}
