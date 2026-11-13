import { BALANCE } from '../config/balance';
import { CONSUMABLES, isConsumable } from '../data/consumables';
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
  heal: number;
}

/** Heals up to `amount` without reviving a dead creature. Returns HP actually gained. */
export function applyHeal(s: PlayerState, maxHp: number, amount: number): number {
  if (s.hp <= 0 || amount <= 0 || s.hp >= maxHp) return 0;
  const before = s.hp;
  s.hp = Math.min(maxHp, s.hp + amount);
  return s.hp - before;
}

/** Applies eating a food to the player. Pure state mutation; caller handles resource depletion. */
export function eatFood(s: PlayerState, diet: Diet, foodId: string, maxHp = 0): EatResult {
  const food = FOODS[foodId];
  const eff = dietEfficiency(diet, foodId);
  if (!food || eff <= 0) return { ok: false, reason: 'Không ăn được thứ này', hunger: 0, thirst: 0, maturity: 0, heal: 0 };
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
  const heal = maxHp > 0 ? applyHeal(s, maxHp, food.heal * eff) : 0;
  s.stats.foodEaten++;
  return { ok: true, hunger: s.hunger - h0, thirst: s.thirst - t0, maturity: growth, heal };
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

/** Adds a carriable food or consumable to the first empty slot. */
export function addToInventory(s: PlayerState, itemId: string): boolean {
  if (!FOODS[itemId]?.carriable && !isConsumable(itemId)) return false;
  const i = s.inventory.indexOf(null);
  if (i < 0) return false;
  s.inventory[i] = itemId;
  return true;
}

export function inventoryItemLabel(id: string): string {
  return FOODS[id]?.name ?? CONSUMABLES[id]?.name ?? id;
}

export function hasInventorySpace(s: PlayerState): boolean {
  return s.inventory.includes(null);
}

/** Eats the food in a slot; consumes it only if eating succeeded. */
export function eatFromSlot(s: PlayerState, diet: Diet, slot: number, maxHp = 0): EatResult {
  const id = s.inventory[slot];
  if (!id) return { ok: false, reason: 'Ô trống', hunger: 0, thirst: 0, maturity: 0, heal: 0 };
  if (isConsumable(id)) return { ok: false, reason: 'Dùng vật phẩm tiêu hao', hunger: 0, thirst: 0, maturity: 0, heal: 0 };
  const food = FOODS[id];
  const canHeal = !!food && food.heal > 0 && maxHp > 0 && s.hp > 0 && s.hp < maxHp;
  if (s.hunger >= 99.5 && !canHeal) return { ok: false, reason: 'Đã no', hunger: 0, thirst: 0, maturity: 0, heal: 0 };
  const r = eatFood(s, diet, id, maxHp);
  if (r.ok) s.inventory[slot] = null;
  return r;
}

export interface ConsumableResult {
  ok: boolean;
  reason?: string;
  id: string;
  heal: number;
  hunger: number;
}

/** Uses a consumable from inventory; caller applies buffs / bait / status clears. */
export function takeConsumable(s: PlayerState, slot: number, maxHp = 0): ConsumableResult {
  const id = s.inventory[slot];
  if (!id || !isConsumable(id)) return { ok: false, reason: 'Không phải vật phẩm tiêu hao', id: '', heal: 0, hunger: 0 };
  const def = CONSUMABLES[id];
  let heal = 0;
  let hunger = 0;
  if (def.use === 'ration') {
    if (def.hunger) {
      const before = s.hunger;
      s.hunger = Math.min(100, s.hunger + def.hunger);
      hunger = s.hunger - before;
    }
    if (def.heal && maxHp > 0) heal = applyHeal(s, maxHp, def.heal);
  }
  s.inventory[slot] = null;
  return { ok: true, id, heal, hunger };
}
