import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { BIOME_IDS, BLK, TT } from '../src/world/tiles';
import { generateWorld, stepDistances, verifySpawn } from '../src/world/worldGen';
import { findDrinkableWater, isPositionFree } from '../src/world/collision';

const SEEDS = ['ALPHA', 'B7K2M9QX', 'seed-3', 'ZZZZ', '42', 'river', 'X1'];

describe('world generation', () => {
  it('is deterministic for the same seed', () => {
    const a = generateWorld('DETERMINISM');
    const b = generateWorld('DETERMINISM');
    const same = (x: Uint8Array, y: Uint8Array) => x.length === y.length && x.every((v, i) => v === y[i]);
    expect(same(a.tiles, b.tiles)).toBe(true);
    expect(a.objects.length).toBe(b.objects.length);
    expect(a.spawn).toEqual(b.spawn);
    const c = generateWorld('OTHER');
    expect(same(a.tiles, c.tiles)).toBe(false);
  });

  for (const seed of SEEDS) {
    it(`seed "${seed}": spawn is valid and food/water reachable for every diet`, () => {
      const w = generateWorld(seed);
      const T = BALANCE.tile;
      const sx = w.spawn.tx * T + T / 2;
      const sy = w.spawn.ty * T + T / 2;
      expect(isPositionFree(w, sx, sy, 12, false)).toBe(true);
      for (const diet of ['herbivore', 'carnivore', 'omnivore'] as const) {
        const r = verifySpawn(w, diet);
        expect(r.spawnBlocked, `${diet} blocked`).toBe(false);
        expect(r.foodSteps, `${diet} food`).toBeLessThanOrEqual(BALANCE.world.spawnMaxFoodSteps);
        expect(r.waterSteps, `${diet} water`).toBeLessThanOrEqual(BALANCE.world.spawnMaxWaterSteps);
        expect(r.shelterSteps, 'shelter').toBeLessThan(Infinity);
        expect(r.shrineSteps, 'shrine').toBeLessThan(Infinity);
      }
      // Spawn is far from the dangerous rocky corner.
      expect(Math.hypot(w.spawn.tx - w.rockCenter.tx, w.spawn.ty - w.rockCenter.ty)).toBeGreaterThan(40);
    });

    it(`seed "${seed}": all biomes exist and are reachable`, () => {
      const w = generateWorld(seed);
      const counts = BIOME_IDS.map(() => 0);
      const reached = BIOME_IDS.map(() => 0);
      for (let i = 0; i < w.w * w.h; i++) {
        if (w.tiles[i] === TT.WALL) continue;
        counts[w.biome[i]]++;
        if (w.reach1[i]) reached[w.biome[i]]++;
      }
      for (let b = 0; b < BIOME_IDS.length; b++) {
        expect(counts[b], `biome ${b} exists`).toBeGreaterThan(300);
        expect(reached[b], `biome ${b} reachable at form 1`).toBeGreaterThan(150);
      }
      // Plateau exists and needs climbing (form 2+).
      let plateau = 0;
      let plateauReach1 = 0;
      let plateauReach2 = 0;
      for (let i = 0; i < w.w * w.h; i++) {
        if (w.tiles[i] !== TT.PLATEAU) continue;
        plateau++;
        if (w.reach1[i]) plateauReach1++;
        if (w.reach2[i]) plateauReach2++;
      }
      expect(plateau).toBeGreaterThan(50);
      expect(plateauReach1).toBe(0);
      expect(plateauReach2).toBeGreaterThan(plateau * 0.5);
    });

    it(`seed "${seed}": most walkable land is connected (no isolated pockets)`, () => {
      const w = generateWorld(seed);
      let walk = 0;
      let reach = 0;
      for (let i = 0; i < w.w * w.h; i++) {
        if (w.blocked[i] === BLK.FREE || w.blocked[i] === BLK.LEDGE) {
          walk++;
          if (w.reach2[i]) reach++;
        }
      }
      expect(reach / walk).toBeGreaterThan(0.98);
    });
  }

  it('drinking requires being close to water with no obstacle between', () => {
    const w = generateWorld('ALPHA');
    const T = BALANCE.tile;
    const shore = w.shoreTiles.find((i) => w.tiles[i] !== TT.FORD) as number;
    const tx = shore % w.w;
    const ty = Math.floor(shore / w.w);
    expect(findDrinkableWater(w, tx * T + T / 2, ty * T + T / 2, 12, BALANCE.actions.drinkRange)).not.toBeNull();
    // A far-away land tile has no water in range.
    const d = stepDistances(w, w.spawn.tx, w.spawn.ty, false);
    let far = -1;
    for (let i = 0; i < d.length; i++) {
      if (d[i] > 0 && w.blocked[i] === BLK.FREE) {
        const x = i % w.w;
        const y = Math.floor(i / w.w);
        let nearWater = false;
        for (let oy = -4; oy <= 4 && !nearWater; oy++) for (let ox = -4; ox <= 4; ox++) {
          const t = w.tiles[(y + oy) * w.w + (x + ox)];
          if (t === TT.WATER || t === TT.DEEP || t === TT.FORD) nearWater = true;
        }
        if (!nearWater) {
          far = i;
          break;
        }
      }
    }
    expect(far).toBeGreaterThanOrEqual(0);
    expect(findDrinkableWater(w, (far % w.w) * T + T / 2, Math.floor(far / w.w) * T + T / 2, 12, BALANCE.actions.drinkRange)).toBeNull();
  });
});
