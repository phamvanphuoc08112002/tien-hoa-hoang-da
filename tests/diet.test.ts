import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { canEat, dietEfficiency } from '../src/data/foods';
import { addToInventory, eatFood, eatFromSlot } from '../src/systems/diet';
import { createPlayerState } from '../src/systems/playerState';

describe('diet rules', () => {
  it('herbivores eat plants but never meat or eggs', () => {
    expect(canEat('herbivore', 'co_non')).toBe(true);
    expect(canEat('herbivore', 'qua')).toBe(true);
    expect(canEat('herbivore', 'thit')).toBe(false);
    expect(canEat('herbivore', 'trung')).toBe(false);
  });

  it('carnivores eat meat and eggs but no plants', () => {
    expect(canEat('carnivore', 'thit')).toBe(true);
    expect(canEat('carnivore', 'trung')).toBe(true);
    expect(canEat('carnivore', 'co_non')).toBe(false);
    expect(canEat('carnivore', 'qua')).toBe(false);
  });

  it('omnivores eat both with food-dependent efficiency', () => {
    expect(dietEfficiency('omnivore', 'qua')).toBe(1);
    expect(dietEfficiency('omnivore', 'co_non')).toBeLessThan(dietEfficiency('herbivore', 'co_non'));
    expect(dietEfficiency('omnivore', 'thit')).toBeLessThan(dietEfficiency('carnivore', 'thit'));
    expect(canEat('omnivore', 'thit')).toBe(true);
  });
});

describe('eating', () => {
  it('refuses inedible food without changing state', () => {
    const s = createPlayerState('moc', 0, 0);
    s.hunger = 40;
    const r = eatFood(s, 'herbivore', 'thit');
    expect(r.ok).toBe(false);
    expect(s.hunger).toBe(40);
    expect(s.stats.foodEaten).toBe(0);
  });

  it('restores hunger scaled by efficiency and grows maturity', () => {
    const s = createPlayerState('thuy', 0, 0);
    s.hunger = 30;
    const r = eatFood(s, 'omnivore', 'co_non');
    expect(r.ok).toBe(true);
    expect(s.hunger).toBeCloseTo(30 + 14 * 0.4, 5);
    expect(r.maturity).toBeGreaterThan(0);
  });

  it('plants restore HP when eating', () => {
    const s = createPlayerState('moc', 0, 0);
    s.hp = 40;
    s.hunger = 50;
    const maxHp = 100;
    const r = eatFood(s, 'herbivore', 'qua', maxHp);
    expect(r.ok).toBe(true);
    expect(r.heal).toBeGreaterThan(0);
    expect(s.hp).toBeCloseTo(40 + 22 * 0.9, 5);
  });

  it('gives no growth when eating while already full', () => {
    const s = createPlayerState('moc', 0, 0);
    s.hunger = BALANCE.maturity.eatNoGrowthAbove + 1;
    const r = eatFood(s, 'herbivore', 'co_non');
    expect(r.ok).toBe(true);
    expect(r.maturity).toBe(0);
  });

  it('has diminishing growth when eating repeatedly', () => {
    const s = createPlayerState('moc', 0, 0);
    const gains: number[] = [];
    for (let i = 0; i < 6; i++) {
      s.hunger = 10;
      gains.push(eatFood(s, 'herbivore', 'la').maturity);
    }
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThan(gains[i - 1]);
    // Spamming cannot fill the bar quickly: 6 meals stay far below max.
    expect(s.maturity).toBeLessThan(15);
  });

  it('inventory slot is consumed only when eating succeeds', () => {
    const s = createPlayerState('hoa', 0, 0);
    expect(addToInventory(s, 'thit')).toBe(true);
    expect(addToInventory(s, 'co_non')).toBe(false); // not carriable
    s.inventory[1] = 'qua';
    s.hunger = 20;
    const bad = eatFromSlot(s, 'carnivore', 1);
    expect(bad.ok).toBe(false);
    expect(s.inventory[1]).toBe('qua');
    const good = eatFromSlot(s, 'carnivore', 0);
    expect(good.ok).toBe(true);
    expect(s.inventory[0]).toBeNull();
  });

  it('inventory respects capacity', () => {
    const s = createPlayerState('hoa', 0, 0);
    for (let i = 0; i < s.slots; i++) expect(addToInventory(s, 'thit')).toBe(true);
    expect(addToInventory(s, 'thit')).toBe(false);
  });
});
