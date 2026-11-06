import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { NPCS } from '../src/data/npcs';
import { decaySatiation, drinkWater, eatFood } from '../src/systems/diet';
import { canEvolve } from '../src/systems/evolution';
import { computeStats, createPlayerState, formOf } from '../src/systems/playerState';
import { addExp, addMaturity, killReward } from '../src/systems/progression';
import { RestController, StaminaClock, tickSurvival } from '../src/systems/survival';

/**
 * Scripted "newcomer" run using the real systems: explores a new sector every
 * ~40 s, finds the 3 form-1 biomes early, eats when hungry, drinks when thirsty
 * and wins a fair fight every ~3 minutes. Returns minutes until form 2 is possible.
 */
function minutesToFirstEvolution(speciesId: string, diet: 'herbivore' | 'carnivore' | 'omnivore', food: string): number {
  const s = createPlayerState(speciesId, 0, 0);
  const M = BALANCE.maturity;
  const P = BALANCE.progression;
  const rest = new RestController();
  const clock = new StaminaClock();
  const dt = 0.5;
  const biomeTimes = [0, 90, 210];
  const prey = [NPCS.tho_la, NPCS.huou_suong, NPCS.heo_gai];
  for (let t = 0; t < 30 * 60; t += dt) {
    tickSurvival(s, computeStats(s), formOf(s), dt, { moving: true, sprinting: false, inCombat: false, rest, inShelter: false, weather: 'clear', buffRegen: 0 }, clock);
    decaySatiation(s, dt);
    if (s.hunger >= M.passiveMinNeeds && s.thirst >= M.passiveMinNeeds) addMaturity(s, M.passivePerSec * dt);
    if (t > 0 && t % 40 === 0) {
      addMaturity(s, M.perSector);
      addExp(s, P.expPerSector);
    }
    if (biomeTimes.includes(t) && t > 0) {
      addMaturity(s, M.perBiome);
      addExp(s, P.expPerBiome);
    }
    if (t > 0 && t % 180 === 0) {
      const r = killReward(computeStats(s), prey[(t / 180) % prey.length]);
      addMaturity(s, r.maturity);
      addExp(s, r.exp);
    }
    while (s.hunger < 60) eatFood(s, diet, food as never);
    if (s.thirst < 55) drinkWater(s);
    if (canEvolve(s, { inCombat: false, inShelter: true })) return t / 60;
  }
  return Infinity;
}

describe('pacing', () => {
  it.each([
    ['moc', 'herbivore', 'qua'],
    ['hoa', 'carnivore', 'thit'],
    ['thuy', 'omnivore', 'qua'],
  ] as const)('%s reaches form 2 in roughly 8-12 minutes of steady play', (id, diet, food) => {
    const min = minutesToFirstEvolution(id, diet, food);
    expect(min).toBeGreaterThanOrEqual(8);
    expect(min).toBeLessThanOrEqual(12);
  });
});
