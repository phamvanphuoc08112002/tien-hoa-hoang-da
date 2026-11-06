import type { Diet, FoodDef, ResourceDef, ResourceKind } from './types';

export const FOODS: Record<string, FoodDef> = {
  co_non: {
    id: 'co_non',
    name: 'Cỏ non',
    hunger: 14,
    thirst: 2,
    maturity: 2.2,
    efficiency: { herbivore: 1, omnivore: 0.4, carnivore: 0 },
    carriable: false,
    icon: 'food_grass',
  },
  la: {
    id: 'la',
    name: 'Lá non',
    hunger: 18,
    thirst: 1,
    maturity: 2.6,
    efficiency: { herbivore: 1, omnivore: 0.5, carnivore: 0 },
    carriable: true,
    icon: 'food_leaf',
  },
  qua: {
    id: 'qua',
    name: 'Quả mọng',
    hunger: 16,
    thirst: 5,
    maturity: 2.6,
    efficiency: { herbivore: 0.9, omnivore: 1, carnivore: 0 },
    carriable: true,
    icon: 'food_berry',
  },
  nam: {
    id: 'nam',
    name: 'Nấm rừng',
    hunger: 20,
    thirst: 0,
    maturity: 3,
    efficiency: { herbivore: 0.6, omnivore: 0.9, carnivore: 0 },
    carriable: true,
    icon: 'food_mushroom',
  },
  trung: {
    id: 'trung',
    name: 'Trứng chim',
    hunger: 22,
    thirst: 2,
    maturity: 3,
    efficiency: { herbivore: 0, omnivore: 0.9, carnivore: 0.8 },
    carriable: true,
    icon: 'food_egg',
  },
  thit: {
    id: 'thit',
    name: 'Thịt',
    hunger: 30,
    thirst: 0,
    maturity: 4,
    efficiency: { herbivore: 0, omnivore: 0.8, carnivore: 1 },
    carriable: true,
    icon: 'food_meat',
  },
  khoang: {
    id: 'khoang',
    name: 'Khoáng tinh thể',
    hunger: 5,
    thirst: 0,
    maturity: 12,
    efficiency: { herbivore: 1, omnivore: 1, carnivore: 1 },
    carriable: false,
    icon: 'crystal',
  },
};

export const RESOURCES: Record<ResourceKind, ResourceDef> = {
  grass: { kind: 'grass', name: 'Cỏ non', food: 'co_non', portions: 1, regrowSec: 75, verb: 'Gặm' },
  leafbush: { kind: 'leafbush', name: 'Bụi lá', food: 'la', portions: 2, regrowSec: 110, verb: 'Ăn' },
  berrybush: { kind: 'berrybush', name: 'Bụi quả mọng', food: 'qua', portions: 3, regrowSec: 140, verb: 'Ăn' },
  mushroom: { kind: 'mushroom', name: 'Nấm rừng', food: 'nam', portions: 1, regrowSec: 160, verb: 'Ăn' },
  nest: { kind: 'nest', name: 'Tổ trứng', food: 'trung', portions: 2, regrowSec: 200, verb: 'Ăn' },
  crystal: { kind: 'crystal', name: 'Khoáng tinh thể', food: 'khoang', portions: 1, regrowSec: 360, verb: 'Liếm' },
};

export function dietEfficiency(diet: Diet, foodId: string): number {
  const f = FOODS[foodId];
  if (!f) return 0;
  return f.efficiency[diet] ?? 0;
}

export function canEat(diet: Diet, foodId: string): boolean {
  return dietEfficiency(diet, foodId) > 0;
}
