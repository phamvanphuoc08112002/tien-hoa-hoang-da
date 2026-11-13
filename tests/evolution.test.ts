import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { EvolutionProcess, canEvolve, completeEvolution, evolutionChecks, evolutionDuration } from '../src/systems/evolution';
import { computeStats, createPlayerState, type PlayerState } from '../src/systems/playerState';

function ready(form = 0): PlayerState {
  const s = createPlayerState('thuy', 0, 0);
  s.form = form;
  s.maturity = BALANCE.maturity.max;
  s.level = BALANCE.evolution.requiredLevel[form];
  s.hunger = 80;
  s.thirst = 80;
  return s;
}

const safe = { inCombat: false, inShelter: true };

describe('evolution conditions', () => {
  it('requires every condition', () => {
    expect(canEvolve(ready(), safe)).toBe(true);
    const cases: [string, (s: PlayerState) => void, typeof safe][] = [
      ['maturity', (s) => (s.maturity = 99), safe],
      ['level', (s) => (s.level = 4), safe],
      ['hunger', (s) => (s.hunger = 49), safe],
      ['thirst', (s) => (s.thirst = 10), safe],
      ['combat', () => {}, { inCombat: true, inShelter: true }],
      ['shelter', () => {}, { inCombat: false, inShelter: false }],
    ];
    for (const [id, mutate, ctx] of cases) {
      const s = ready();
      mutate(s);
      expect(canEvolve(s, ctx), id).toBe(false);
      expect(evolutionChecks(s, ctx).find((c) => c.id === id)?.ok, id).toBe(false);
    }
  });

  it('final form cannot evolve', () => {
    const s = ready(0);
    s.form = 4;
    s.level = 99;
    s.stats.elites = 99;
    expect(canEvolve(s, safe)).toBe(false);
    expect(evolutionChecks(s, safe).some((c) => c.id === 'final')).toBe(true);
  });

  it('durations cover all four evolution steps', () => {
    expect(evolutionDuration(0)).toBe(20);
    expect(evolutionDuration(1)).toBe(40);
    expect(evolutionDuration(2)).toBe(55);
    expect(evolutionDuration(3)).toBe(75);
  });
});

describe('evolution process', () => {
  it('refuses to start when conditions fail', () => {
    const s = ready();
    s.thirst = 5;
    const p = new EvolutionProcess();
    expect(p.start(s, safe).ok).toBe(false);
    expect(p.active).toBe(false);
  });

  it('interruption keeps maturity and form', () => {
    const s = ready();
    const p = new EvolutionProcess();
    expect(p.start(s, safe).ok).toBe(true);
    for (let i = 0; i < 100; i++) p.update(0.1); // 10s
    expect(p.interrupt('hit')).toBe(true);
    expect(p.active).toBe(false);
    expect(s.form).toBe(0);
    expect(s.maturity).toBe(BALANCE.maturity.max);
    // Can restart afterwards from zero progress.
    expect(p.start(s, safe).ok).toBe(true);
    expect(p.progress).toBe(0);
  });

  it('completes after the full duration and only then resets maturity', () => {
    const s = ready();
    const p = new EvolutionProcess();
    p.start(s, safe);
    let result = 'running';
    let t = 0;
    while (result === 'running') {
      result = p.update(0.05);
      t += 0.05;
      if (result === 'running') expect(s.maturity).toBe(BALANCE.maturity.max);
    }
    expect(result).toBe('done');
    expect(t).toBeGreaterThanOrEqual(19.9);
    expect(t).toBeLessThan(20.2);
    const hpBefore = computeStats(s).maxHp;
    completeEvolution(s);
    expect(s.form).toBe(1);
    expect(s.maturity).toBe(0);
    expect(computeStats(s).maxHp).toBeGreaterThan(hpBefore);
    expect(s.hp).toBe(computeStats(s).maxHp);
  });
});
