import { BALANCE } from '../config/balance';
import { FOODS, dietEfficiency } from '../data/foods';
import type { Diet } from '../data/types';
import type { PlayerState } from './playerState';
import { addMaturity } from './progression';

export interface EatResult {
  ok: boolean;
  reason?: string;
  hunger: number;
  thirst: number;
  maturity: number;
}

/** Applies eating a food to the player. Pure state mutation; caller handles resource depletion. */
export function eatFood(s: PlayerState, diet: Diet, foodId: string): EatResult {
  const food = FOODS[foodId];
  const eff = dietEfficiency(diet, foodId);
  if (!food || eff <= 0) return { ok: false, reason: 'Không ăn được thứ này', hunger: 0, thirst: 0, maturity: 0 };
  const m = BALANCE.maturity;
  const hungerBefore = s.hunger;
  const h0 = s.hunger;
  const t0 = s.thirst;
  s.hunger = Math.min(100, s.hunger + food.hunger * eff);
  s.thirst = Math.min(100, s.thirst + food.thirst * eff);
  let growth = 0;
  const special = foodId === 'khoang';
  if (special || hungerBefore <= m.eatNoGrowthAbove) {
    const dim = 1 / (1 + s.satiation * m.eatDiminishPerMeal);
    growth = addMaturity(s, food.maturity * eff * dim);
    s.satiation += 1;
  }
  s.stats.foodEaten++;
  return { ok: true, hunger: s.hunger - h0, thirst: s.thirst - t0, maturity: growth };
}

export function drinkWater(s: PlayerState): number {
  const before = s.thirst;
  s.thirst = Math.min(100, s.thirst + BALANCE.actions.drinkAmount);
  s.stats.drinks++;
  return s.thirst - before;
}

export function decaySatiation(s: PlayerState, dt: number): void {
  s.satiation = Math.max(0, s.satiation - BALANCE.maturity.eatDiminishDecayPerSec * dt);
}

/** Adds a carriable food to the first empty slot. */
export function addToInventory(s: PlayerState, foodId: string): boolean {
  if (!FOODS[foodId]?.carriable) return false;
  const i = s.inventory.indexOf(null);
  if (i < 0) return false;
  s.inventory[i] = foodId;
  return true;
}

export function hasInventorySpace(s: PlayerState): boolean {
  return s.inventory.includes(null);
}

/** Eats the food in a slot; consumes it only if eating succeeded. */
export function eatFromSlot(s: PlayerState, diet: Diet, slot: number): EatResult {
  const id = s.inventory[slot];
  if (!id) return { ok: false, reason: 'Ô trống', hunger: 0, thirst: 0, maturity: 0 };
  if (s.hunger >= 99.5) return { ok: false, reason: 'Đã no', hunger: 0, thirst: 0, maturity: 0 };
  const r = eatFood(s, diet, id);
  if (r.ok) s.inventory[slot] = null;
  return r;
}
