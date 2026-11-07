import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { NPCS } from '../src/data/npcs';
import { SKILLS, skillLine, skillRoot } from '../src/data/skills';
import { SPECIES } from '../src/data/species';
import { evolutionChecks } from '../src/systems/evolution';
import { createPlayerState } from '../src/systems/playerState';
import { addMastery, equipSkill, equippedSkill, evolvePending, reqLabel, slotUnlocked, syncLearned } from '../src/systems/skills';
import { StatusEffects } from '../src/systems/status';
import { eliteChance, isBloodMoonNight, scaleNpc, tierAt } from '../src/systems/threat';

describe('skill data', () => {
  it('every learnset entry and evolution target exists', () => {
    for (const sp of SPECIES) {
      expect(sp.learnset.length).toBeGreaterThanOrEqual(5);
      for (const e of sp.learnset) {
        expect(SKILLS[e.skill], e.skill).toBeDefined();
        for (const sk of skillLine(e.skill)) expect(skillRoot(sk.id)).toBe(e.skill);
      }
    }
    for (const sk of Object.values(SKILLS)) {
      if (sk.evolvesTo) {
        expect(SKILLS[sk.evolvesTo], sk.evolvesTo).toBeDefined();
        expect(sk.mastery).toBeGreaterThan(0);
      }
    }
  });
});

describe('learning skills', () => {
  it('starts with one skill in Q and the T slot locked', () => {
    const s = createPlayerState('moc', 0, 0);
    expect(s.skills).toEqual(['huc_sung']);
    expect(equippedSkill(s, 0)?.id).toBe('huc_sung');
    expect(slotUnlocked(s, 2)).toBe(false);
  });

  it('learns from level, survival feats and form, auto-equipping free slots', () => {
    const s = createPlayerState('moc', 0, 0);
    s.level = 3;
    expect(syncLearned(s)).toEqual(['giap_reu']);
    expect(s.equipped[1]).toBe('giap_reu');
    s.stats.daysSurvived = 2;
    expect(syncLearned(s)).toEqual(['day_leo']);
    expect(s.equipped).toEqual(['huc_sung', 'giap_reu', null]);
    s.form = 1;
    expect(syncLearned(s)).toEqual(['dia_chan']);
    expect(s.equipped[2]).toBe('dia_chan');
    expect(syncLearned(s)).toEqual([]);
  });

  it('labels requirements with progress', () => {
    const s = createPlayerState('thuy', 0, 0);
    s.stats.drinks = 4;
    expect(reqLabel(s, { drinks: 10 })).toContain('4/10');
  });

  it('equipping swaps slots and rejects locked slots', () => {
    const s = createPlayerState('hoa', 0, 0);
    s.level = 3;
    syncLearned(s);
    expect(equipSkill(s, 'cuong_no', 0)).toBe(true);
    expect(s.equipped.slice(0, 2)).toEqual(['cuong_no', 'vo_moi']);
    expect(equipSkill(s, 'vo_moi', 2)).toBe(false);
  });
});

describe('skill mastery', () => {
  it('evolves a skill once mastered', () => {
    const s = createPlayerState('hoa', 0, 0);
    s.form = 1;
    const need = SKILLS.vo_moi.mastery!;
    expect(addMastery(s, 'vo_moi', need - 1)).toBeNull();
    const evo = addMastery(s, 'vo_moi', 5);
    expect(evo).toEqual({ from: 'vo_moi', to: 'vo_moi_2' });
    expect(s.skills).toContain('vo_moi_2');
    expect(s.equipped[0]).toBe('vo_moi_2');
  });

  it('holds mastered skills until the required form', () => {
    const s = createPlayerState('hoa', 0, 0);
    s.form = 1;
    syncLearned(s);
    expect(SKILLS.hoi_lua.evolveForm).toBe(2);
    expect(addMastery(s, 'hoi_lua', 999)).toBeNull();
    expect(s.mastery.hoi_lua).toBe(SKILLS.hoi_lua.mastery);
    s.form = 2;
    expect(evolvePending(s).map((e) => e.to)).toContain('hoi_lua_2');
  });
});

describe('status effects', () => {
  it('deals damage over time in chunks and expires', () => {
    const st = new StatusEffects<string>();
    st.apply('burn', 2, 10, 'src');
    let total = 0;
    for (let i = 0; i < 30; i++) total += st.tick(0.1).damage;
    expect(total).toBeCloseTo(20, 5);
    expect(st.has('burn')).toBe(false);
  });

  it('keeps the stronger magnitude and longer duration instead of stacking', () => {
    const st = new StatusEffects();
    st.apply('slow', 1, 0.3, null);
    st.apply('slow', 3, 0.2, null);
    expect(st.left('slow')).toBe(3);
    expect(st.speedMult()).toBeCloseTo(0.7);
  });

  it('crowd-control resistance shortens stuns', () => {
    const st = new StatusEffects();
    st.ccResist = 0.5;
    st.apply('stun', 2, 0, null);
    expect(st.left('stun')).toBe(1);
  });
});

describe('threat scaling', () => {
  it('gets harder with distance, days and elite affixes', () => {
    const wolf = NPCS.soi_bong;
    const near = scaleNpc(wolf, tierAt(10), 0, null);
    const far = scaleNpc(wolf, tierAt(500), 0, null);
    const late = scaleNpc(wolf, 0, 8, null);
    const elite = scaleNpc(wolf, 0, 0, 'giap_da');
    expect(tierAt(500)).toBe(BALANCE.threat.maxTier);
    expect(far.maxHp).toBeGreaterThan(near.maxHp);
    expect(far.power).toBeGreaterThan(near.power);
    expect(late.power).toBeGreaterThan(near.power);
    expect(elite.defense).toBeGreaterThan(near.defense * 1.5);
    expect(elite.level).toBeGreaterThan(near.level);
    expect(eliteChance(3, true)).toBeGreaterThan(eliteChance(0, false));
  });

  it('blood moon falls on every Nth night', () => {
    const n = BALANCE.threat.bloodMoonEvery;
    expect(isBloodMoonNight(n)).toBe(true);
    expect(isBloodMoonNight(n + 1)).toBe(false);
    expect(isBloodMoonNight(0)).toBe(false);
  });

  it('the final evolution requires an elite kill', () => {
    const s = createPlayerState('moc', 0, 0);
    s.form = 1;
    const trial = evolutionChecks(s, { inCombat: false, inShelter: true }).find((c) => c.id === 'trial');
    expect(trial?.ok).toBe(false);
    s.stats.elites = 1;
    expect(evolutionChecks(s, { inCombat: false, inShelter: true }).find((c) => c.id === 'trial')?.ok).toBe(true);
  });
});
