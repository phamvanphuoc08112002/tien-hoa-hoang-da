import { describe, expect, it } from 'vitest';
import { Cooldowns, HitInstance, arcHits, circleHits, computeDamage } from '../src/systems/combat';
import { killReward, addExp } from '../src/systems/progression';
import { createPlayerState, computeStats } from '../src/systems/playerState';
import { NPCS } from '../src/data/npcs';
import { expToNext } from '../src/config/balance';

describe('damage', () => {
  it('defense mitigates damage and minimum is 1', () => {
    const noDef = computeDamage(20, 1, 0, 0.5);
    const someDef = computeDamage(20, 1, 40, 0.5);
    expect(noDef).toBe(20);
    expect(someDef).toBe(10);
    expect(computeDamage(1, 0.1, 500, 0)).toBe(1);
  });

  it('variance stays within ±10%', () => {
    expect(computeDamage(100, 1, 0, 0)).toBe(90);
    expect(computeDamage(100, 1, 0, 0.999)).toBe(110);
  });
});

describe('cooldowns', () => {
  it('are not ready until enough simulated time passes', () => {
    const c = new Cooldowns();
    expect(c.ready('a')).toBe(true);
    c.start('a', 1);
    expect(c.ready('a')).toBe(false);
    c.tick(0.5);
    expect(c.fraction('a')).toBeCloseTo(0.5);
    expect(c.ready('a')).toBe(false);
    c.tick(0.51);
    expect(c.ready('a')).toBe(true);
  });
});

describe('hit volumes', () => {
  it('a single attack instance hits each target once', () => {
    const h = new HitInstance(1, 1, 100);
    expect(h.tryHit(5)).toBe(true);
    for (let frame = 0; frame < 10; frame++) expect(h.tryHit(5)).toBe(false);
    expect(h.tryHit(6)).toBe(true);
    expect(h.tryHit(1)).toBe(false); // never hits its owner
  });

  it('arc respects direction and range', () => {
    // facing right (0 rad), 90° arc, range 50
    expect(arcHits(0, 0, 0, Math.PI / 2, 50, 40, 0, 5)).toBe(true);
    expect(arcHits(0, 0, 0, Math.PI / 2, 50, -40, 0, 5)).toBe(false);
    expect(arcHits(0, 0, 0, Math.PI / 2, 50, 0, 40, 5)).toBe(false);
    expect(arcHits(0, 0, 0, Math.PI / 2, 50, 70, 0, 5)).toBe(false);
    expect(arcHits(0, 0, 0, Math.PI / 2, 50, 52, 0, 5)).toBe(true); // edge overlap
    expect(circleHits(0, 0, 10, 14, 0, 5)).toBe(true);
    expect(circleHits(0, 0, 10, 16, 0, 5)).toBe(false);
  });
});

describe('progression', () => {
  it('level-ups consume exp and carry the remainder', () => {
    const s = createPlayerState('moc', 0, 0);
    const need = expToNext(1);
    const gained = addExp(s, need + 5);
    expect(gained).toBe(1);
    expect(s.level).toBe(2);
    expect(s.exp).toBe(5);
  });

  it('kills of much weaker creatures give no maturity', () => {
    const s = createPlayerState('hoa', 0, 0);
    s.level = 15;
    const weak = killReward(computeStats(s), NPCS.tho_la);
    expect(weak.maturity).toBe(0);
    const fresh = createPlayerState('hoa', 0, 0);
    const fair = killReward(computeStats(fresh), NPCS.soi_bong);
    expect(fair.maturity).toBeGreaterThan(0);
    expect(fair.exp).toBeGreaterThan(weak.exp);
  });
});
