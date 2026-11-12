import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { NPCS } from '../src/data/npcs';
import { REALMS, realmSeed } from '../src/data/realms';
import { computeStats, createPlayerState } from '../src/systems/playerState';
import { scaleNpc } from '../src/systems/threat';
import { stepDistances, generateWorld, verifySpawn } from '../src/world/worldGen';

const SEEDS = ['ALPHA', 'B7K2M9QX', 'river'];

describe('realms', () => {
  it('every realm has its own summon-only guardian, each stronger than the last', () => {
    let prev = { hp: 0, power: 0, level: 0 };
    for (const r of REALMS) {
      const g = NPCS[r.guardian];
      expect(g, r.guardian).toBeDefined();
      expect(g.guardian).toBe(true);
      expect(g.population).toBe(0);
      expect(g.stats.maxHp).toBeGreaterThan(prev.hp);
      expect(g.stats.power).toBeGreaterThan(prev.power);
      expect(g.level).toBeGreaterThan(prev.level);
      prev = { hp: g.stats.maxHp, power: g.stats.power, level: g.level };
    }
  });

  it('creatures get stronger and more rewarding in every later realm', () => {
    const wolf = NPCS.soi_bong;
    for (let i = 1; i < REALMS.length; i++) {
      const a = scaleNpc(wolf, 0, 0, null, i - 1);
      const b = scaleNpc(wolf, 0, 0, null, i);
      expect(b.maxHp).toBeGreaterThan(a.maxHp);
      expect(b.power).toBeGreaterThan(a.power);
      expect(b.level).toBeGreaterThan(a.level);
      expect(b.expMult).toBeGreaterThan(a.expMult);
    }
  });

  it('guardians use their designed stats regardless of distance, days or realm', () => {
    const g = NPCS.moc_than;
    const s = scaleNpc(g, 3, 20, null, 4);
    expect(s.maxHp).toBe(g.stats.maxHp);
    expect(s.power).toBe(g.stats.power);
    expect(s.level).toBe(g.level);
  });

  it('crossing gates permanently strengthens the player', () => {
    const p = createPlayerState('hoa', 0, 0);
    const base = computeStats(p);
    p.realm = 2;
    const boosted = computeStats(p);
    expect(boosted.maxHp).toBeGreaterThan(base.maxHp);
    expect(boosted.power).toBeGreaterThan(base.power);
    expect(boosted.defense).toBeGreaterThan(base.defense);
  });

  it('realm 0 keeps the original seed; later realms get distinct maps', () => {
    expect(realmSeed('ABC', 0)).toBe('ABC');
    const seeds = new Set(REALMS.map((_, i) => realmSeed('ABC', i)));
    expect(seeds.size).toBe(REALMS.length);
  });

  for (let ri = 0; ri < REALMS.length; ri++) {
    for (const seed of SEEDS) {
      it(`realm ${ri} "${seed}": valid spawn and a reachable gate far away`, () => {
        const w = generateWorld(realmSeed(seed, ri), ri);
        for (const diet of ['herbivore', 'carnivore', 'omnivore'] as const) {
          const r = verifySpawn(w, diet);
          expect(r.spawnBlocked, `${diet} blocked`).toBe(false);
          expect(r.foodSteps, `${diet} food`).toBeLessThanOrEqual(BALANCE.world.spawnMaxFoodSteps);
          expect(r.waterSteps, `${diet} water`).toBeLessThanOrEqual(BALANCE.world.spawnMaxWaterSteps);
          expect(r.shelterSteps).toBeLessThan(Infinity);
        }
        expect(w.portal).not.toBeNull();
        const pt = w.portal as { tx: number; ty: number };
        expect(w.reach1[pt.ty * w.w + pt.tx], 'gate reachable without climbing').toBe(1);
        expect(Math.hypot(pt.tx - w.spawn.tx, pt.ty - w.spawn.ty)).toBeGreaterThanOrEqual(60);
        const d = stepDistances(w, w.spawn.tx, w.spawn.ty, false);
        expect(d[pt.ty * w.w + pt.tx]).toBeGreaterThan(0);
      });
    }
  }
});
