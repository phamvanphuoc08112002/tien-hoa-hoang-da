import { BALANCE } from '../config/balance';
import { getSpecies } from '../data/species';
import type { FormDef, SpeciesDef, Stats } from '../data/types';

export interface PlayerStats {
  kills: number;
  foodEaten: number;
  drinks: number;
  daysSurvived: number;
  timeAlive: number;
  evolutions: number;
  elites: number;
  bosses: number;
  stones: number;
  bloodMoons: number;
}

export const SKILL_SLOTS = 3;

export interface PlayerState {
  speciesId: string;
  form: number;
  level: number;
  exp: number;
  maturity: number;
  hp: number;
  hunger: number;
  thirst: number;
  stamina: number;
  fatigue: number;
  coins: number;
  slots: number;
  inventory: (string | null)[];
  colorVariant: string;
  unlockedColors: string[];
  markersUnlocked: boolean;
  markers: { x: number; y: number }[];
  x: number;
  y: number;
  /** Diminishing-returns counter for growth from food. */
  satiation: number;
  milestones: string[];
  discoveredSectors: number[];
  discoveredBiomes: string[];
  stats: PlayerStats;
  /** Learned skill ids (current stage of each line). */
  skills: string[];
  /** Skill ids bound to Q / R / T. */
  equipped: (string | null)[];
  /** Mastery points per learned skill id. */
  mastery: Record<string, number>;
}

export function createPlayerState(speciesId: string, x: number, y: number): PlayerState {
  const sp = getSpecies(speciesId);
  const base = sp.forms[0].stats;
  return {
    speciesId,
    form: 0,
    level: 1,
    exp: 0,
    maturity: 0,
    hp: base.maxHp,
    hunger: 80,
    thirst: 80,
    stamina: base.stamina,
    fatigue: 10,
    coins: 0,
    slots: BALANCE.inventory.startSlots,
    inventory: new Array(BALANCE.inventory.startSlots).fill(null),
    colorVariant: 'goc',
    unlockedColors: ['goc'],
    markersUnlocked: false,
    markers: [],
    x,
    y,
    satiation: 0,
    milestones: [],
    discoveredSectors: [],
    discoveredBiomes: [],
    stats: { kills: 0, foodEaten: 0, drinks: 0, daysSurvived: 0, timeAlive: 0, evolutions: 0, elites: 0, bosses: 0, stones: 0, bloodMoons: 0 },
    skills: [sp.learnset[0].skill],
    equipped: [sp.learnset[0].skill, null, null],
    mastery: {},
  };
}

export function speciesOf(s: PlayerState): SpeciesDef {
  return getSpecies(s.speciesId);
}

export function formOf(s: PlayerState): FormDef {
  return getSpecies(s.speciesId).forms[s.form];
}

/** Effective stats from form base values scaled by combat level. */
export function computeStats(s: PlayerState): Stats {
  const f = formOf(s);
  const p = BALANCE.progression;
  const lv = s.level - 1;
  return {
    maxHp: Math.round(f.stats.maxHp * (1 + p.levelHpBonus * lv)),
    speed: f.stats.speed,
    power: f.stats.power * (1 + p.levelPowerBonus * lv),
    defense: f.stats.defense * (1 + p.levelDefenseBonus * lv),
    stamina: f.stats.stamina,
  };
}

export function powerScore(power: number, maxHp: number): number {
  return power * Math.sqrt(maxHp);
}
