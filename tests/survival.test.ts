import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { computeStats, createPlayerState, formOf } from '../src/systems/playerState';
import { RestController, StaminaClock, tickSurvival, type SurvivalContext } from '../src/systems/survival';

function ctx(over: Partial<SurvivalContext> = {}): SurvivalContext {
  return { moving: false, sprinting: false, inCombat: false, rest: new RestController(), inShelter: false, weather: 'clear', buffRegen: 0, ...over };
}

function run(seconds: number, fn: (dt: number) => void): void {
  for (let t = 0; t < seconds; t += 0.1) fn(0.1);
}

describe('survival needs', () => {
  it('decay slowly enough to explore (minutes, not seconds)', () => {
    const s = createPlayerState('moc', 0, 0);
    s.hunger = 100;
    s.thirst = 100;
    const c = ctx();
    run(120, (dt) => tickSurvival(s, computeStats(s), formOf(s), dt, c, new StaminaClock()));
    expect(s.hunger).toBeGreaterThan(70);
    expect(s.thirst).toBeGreaterThan(60);
  });

  it('heat makes thirst drop faster, rain slower', () => {
    const mk = () => {
      const s = createPlayerState('thuy', 0, 0);
      s.thirst = 100;
      return s;
    };
    const clear = mk();
    const heat = mk();
    const rain = mk();
    run(60, (dt) => {
      tickSurvival(clear, computeStats(clear), formOf(clear), dt, ctx(), new StaminaClock());
      tickSurvival(heat, computeStats(heat), formOf(heat), dt, ctx({ weather: 'heat' }), new StaminaClock());
      tickSurvival(rain, computeStats(rain), formOf(rain), dt, ctx({ weather: 'rain' }), new StaminaClock());
    });
    expect(heat.thirst).toBeLessThan(clear.thirst);
    expect(rain.thirst).toBeGreaterThan(clear.thirst);
  });

  it('starvation drains HP gradually, not instantly', () => {
    const s = createPlayerState('hoa', 0, 0);
    s.hunger = 0;
    s.thirst = 80;
    const max = computeStats(s).maxHp;
    run(10, (dt) => tickSurvival(s, computeStats(s), formOf(s), dt, ctx(), new StaminaClock()));
    expect(s.hp).toBeLessThan(max);
    expect(s.hp).toBeGreaterThan(max * 0.8);
  });

  it('regeneration never revives a creature at 0 HP', () => {
    const s = createPlayerState('moc', 0, 0);
    s.hp = 0;
    const rest = new RestController();
    rest.toggle();
    run(10, (dt) => {
      rest.update(dt, s.fatigue);
      tickSurvival(s, computeStats(s), formOf(s), dt, ctx({ rest, inShelter: true }), new StaminaClock());
    });
    expect(s.hp).toBe(0);
  });

  it('sprinting consumes stamina; resting recovers faster than standing', () => {
    const s = createPlayerState('hoa', 0, 0);
    const st = computeStats(s);
    run(3, (dt) => tickSurvival(s, st, formOf(s), dt, ctx({ moving: true, sprinting: true }), new StaminaClock()));
    expect(s.stamina).toBeLessThan(st.stamina - 40);

    const a = createPlayerState('hoa', 0, 0);
    const b = createPlayerState('hoa', 0, 0);
    a.stamina = 0;
    b.stamina = 0;
    const rest = new RestController();
    rest.toggle();
    const ca = ctx();
    const cb = ctx({ rest });
    const clkA = new StaminaClock();
    const clkB = new StaminaClock();
    run(4, (dt) => {
      rest.update(dt, b.fatigue);
      tickSurvival(a, st, formOf(a), dt, ca, clkA);
      tickSurvival(b, st, formOf(b), dt, cb, clkB);
    });
    expect(b.stamina).toBeGreaterThan(a.stamina);
  });

  it('toggling rest repeatedly never reaches the settled state (no free recovery)', () => {
    const r = new RestController();
    let settledSeen = false;
    for (let i = 0; i < 200; i++) {
      r.toggle();
      r.update(0.1, 50);
      if (r.settled) settledSeen = true;
    }
    expect(settledSeen).toBe(false);
  });

  it('sleep reduces fatigue, faster in shelter', () => {
    const mk = () => {
      const s = createPlayerState('moc', 0, 0);
      s.fatigue = 80;
      return s;
    };
    const inside = mk();
    const outside = mk();
    const r1 = new RestController();
    const r2 = new RestController();
    r1.toggle();
    r2.toggle();
    run(15, (dt) => {
      r1.update(dt, inside.fatigue);
      r2.update(dt, outside.fatigue);
      tickSurvival(inside, computeStats(inside), formOf(inside), dt, ctx({ rest: r1, inShelter: true }), new StaminaClock());
      tickSurvival(outside, computeStats(outside), formOf(outside), dt, ctx({ rest: r2, inShelter: false }), new StaminaClock());
    });
    expect(r1.mode).toBe('sleeping');
    expect(inside.fatigue).toBeLessThan(outside.fatigue);
    expect(inside.fatigue).toBeLessThan(80 - BALANCE.survival.sleepFatigueRecoverPerSec * 5);
  });
});
