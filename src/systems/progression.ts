import { BALANCE, expToNext } from '../config/balance';
import type { NpcDef, Stats } from '../data/types';
import { powerScore, type PlayerState } from './playerState';

/** Adds combat EXP; returns number of levels gained. */
export function addExp(s: PlayerState, amount: number): number {
  if (amount <= 0) return 0;
  s.exp += amount;
  let gained = 0;
  while (s.level < BALANCE.progression.maxLevel && s.exp >= expToNext(s.level)) {
    s.exp -= expToNext(s.level);
    s.level++;
    gained++;
  }
  if (s.level >= BALANCE.progression.maxLevel) s.exp = Math.min(s.exp, expToNext(s.level));
  return gained;
}

/** Adds maturity respecting the current form's gain multiplier and the cap. Returns the actual gain. */
export function addMaturity(s: PlayerState, amount: number): number {
  const mult = BALANCE.maturity.formGainMult[s.form] ?? 0;
  if (amount <= 0 || mult <= 0) return 0;
  const before = s.maturity;
  s.maturity = Math.min(BALANCE.maturity.max, s.maturity + amount * mult);
  return s.maturity - before;
}

export function isMaturityFull(s: PlayerState): boolean {
  return s.maturity >= BALANCE.maturity.max - 1e-6;
}

export interface KillReward {
  exp: number;
  maturity: number;
  ratio: number;
}

/** Rewards scale with how strong the victim was relative to the player. */
export function killReward(playerStats: Stats, npc: NpcDef): KillReward {
  const ratio = powerScore(npc.stats.power, npc.stats.maxHp) / powerScore(playerStats.power, playerStats.maxHp);
  const m = BALANCE.maturity;
  const expMult = Math.max(0.25, Math.min(1.5, ratio));
  const exp = Math.round(npc.exp * expMult);
  const maturity = ratio < m.killMinPowerRatio ? 0 : m.perKillBase * Math.min(2, ratio);
  return { exp, maturity, ratio };
}
