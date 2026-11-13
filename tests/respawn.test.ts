import { describe, expect, it } from 'vitest';
import { RESOURCES } from '../src/data/foods';
import { BALANCE } from '../src/config/balance';

describe('respawn timings', () => {
  it('plants define a finite regrow time', () => {
    for (const r of Object.values(RESOURCES)) {
      expect(r.regrowSec).toBeGreaterThan(10);
      expect(r.regrowSec).toBeLessThanOrEqual(300);
    }
  });

  it('heal pillars recharge after a short cooldown', () => {
    expect(BALANCE.heal.healpad.cooldownSec).toBeGreaterThan(10);
    expect(BALANCE.heal.healpad.cooldownSec).toBeLessThanOrEqual(90);
  });

  it('npc site respawn uses a positive delay multiplier', () => {
    expect(BALANCE.npc.siteRespawnMult).toBeGreaterThan(0);
    expect(BALANCE.npc.siteRespawnPlayerDist).toBeGreaterThan(0);
  });
});
