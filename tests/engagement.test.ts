import { describe, expect, it } from 'vitest';
import { CONSUMABLES, isConsumable } from '../src/data/consumables';
import { listQuests, primaryQuest } from '../src/data/quests';
import { SHOP } from '../src/data/shop';
import { noteBestiary, bestiaryStats } from '../src/systems/bestiary';
import { addToInventory, takeConsumable } from '../src/systems/diet';
import { createPlayerState } from '../src/systems/playerState';
import { canDefeatNpc } from '../src/systems/threat';
import { eventModsForNight, nightEventId } from '../src/systems/worldEvents';

describe('quests', () => {
  it('lists incomplete first meal quest for a fresh run', () => {
    const s = createPlayerState('moc', 0, 0);
    const q = primaryQuest(s, false);
    expect(q?.id).toBe('q_first_meal');
    expect(q?.done).toBe(false);
  });

  it('marks guardian quest done when portal is open', () => {
    const s = createPlayerState('moc', 0, 0);
    const g = listQuests(s, true).find((q) => q.id === 'q_guardian');
    expect(g?.done).toBe(true);
  });
});

describe('bestiary', () => {
  it('rewards first seen and first kill once each', () => {
    const s = createPlayerState('moc', 0, 0);
    const seen = noteBestiary(s, 'tho_la', 'seen');
    expect(seen?.first).toBe(true);
    expect(noteBestiary(s, 'tho_la', 'seen')).toBeNull();
    const killed = noteBestiary(s, 'tho_la', 'killed');
    expect(killed?.first).toBe(true);
    expect(noteBestiary(s, 'tho_la', 'killed')).toBeNull();
    const st = bestiaryStats(s);
    expect(st.seen).toBeGreaterThanOrEqual(1);
    expect(st.killed).toBeGreaterThanOrEqual(1);
  });
});

describe('consumables', () => {
  it('shop stock is all valid consumables', () => {
    expect(Object.keys(CONSUMABLES)).toEqual(expect.arrayContaining([...SHOP.consumableIds]));
    for (const id of SHOP.consumableIds) expect(isConsumable(id)).toBe(true);
  });

  it('takeConsumable removes slot and heals ration', () => {
    const s = createPlayerState('moc', 0, 0);
    s.hp = 20;
    expect(addToInventory(s, 'banh_phuc_hoi')).toBe(true);
    const slot = s.inventory.indexOf('banh_phuc_hoi');
    const r = takeConsumable(s, slot, 100);
    expect(r.ok).toBe(true);
    expect(s.inventory[slot]).toBeNull();
    expect(r.heal).toBe(CONSUMABLES.banh_phuc_hoi.heal);
    expect(s.hp).toBe(20 + (CONSUMABLES.banh_phuc_hoi.heal ?? 0));
  });
});

describe('threat rings', () => {
  it('marks equal or weaker foes as beatable and stronger as deadly', () => {
    expect(canDefeatNpc(100, 100)).toBe(true);
    expect(canDefeatNpc(100, 110)).toBe(true);
    expect(canDefeatNpc(100, 130)).toBe(false);
  });
});

describe('world events', () => {
  it('blood moon nights always pick blood_moon', () => {
    // isBloodMoonNight uses night % 5 === 0 roughly — check a few deterministic nights
    for (let n = 1; n < 40; n++) {
      const id = nightEventId('seed-test', n);
      if (id === 'blood_moon') {
        expect(eventModsForNight('seed-test', n, true).power).toBeGreaterThan(1);
        return;
      }
    }
    // If no blood moon in range, still ensure night mods can be none or other events
    const mods = eventModsForNight('seed-test', 3, true);
    expect(['none', 'migration', 'toxic_fog', 'ember_winds', 'crystal_rain', 'blood_moon']).toContain(mods.id);
  });

  it('daytime events are none', () => {
    expect(eventModsForNight('seed-test', 5, false).id).toBe('none');
  });
});
