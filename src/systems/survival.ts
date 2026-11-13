import { BALANCE } from '../config/balance';
import type { FormDef, Stats, Weather } from '../data/types';
import type { PlayerState } from './playerState';

export type RestMode = 'awake' | 'resting' | 'sleeping';

/**
 * Rest / sleep state machine. Rest only becomes effective after settling,
 * and toggling has a cooldown, so spamming F cannot farm recovery.
 */
export class RestController {
  mode: RestMode = 'awake';
  restTime = 0;
  toggleCooldown = 0;

  get settled(): boolean {
    return this.mode !== 'awake' && this.restTime >= BALANCE.survival.restSettleSec;
  }

  toggle(): boolean {
    if (this.toggleCooldown > 0) return false;
    this.toggleCooldown = BALANCE.survival.restToggleCooldownSec;
    if (this.mode === 'awake') {
      this.mode = 'resting';
      this.restTime = 0;
    } else {
      this.mode = 'awake';
      this.restTime = 0;
    }
    return true;
  }

  wake(): void {
    this.mode = 'awake';
    this.restTime = 0;
  }

  update(dt: number, fatigue: number): void {
    this.toggleCooldown = Math.max(0, this.toggleCooldown - dt);
    if (this.mode === 'awake') return;
    this.restTime += dt;
    const S = BALANCE.survival;
    if (this.mode === 'resting' && this.restTime >= S.sleepAfterRestSec && fatigue >= S.sleepMinFatigue) {
      this.mode = 'sleeping';
    } else if (this.mode === 'sleeping' && fatigue <= 0.01) {
      this.mode = 'resting';
    }
  }
}

export interface SurvivalContext {
  moving: boolean;
  sprinting: boolean;
  inCombat: boolean;
  rest: RestController;
  inShelter: boolean;
  weather: Weather;
  /** Additional regen from buffs (fraction of max HP per second). */
  buffRegen: number;
  /** Poison stops natural HP regeneration. */
  poisoned?: boolean;
}

export interface SurvivalTick {
  starving: boolean;
  dehydrated: boolean;
  damage: number;
  /** True if sprint should stop because stamina ran out. */
  outOfStamina: boolean;
}

/** Runtime-only stamina regen delay, kept out of the save file. */
export class StaminaClock {
  delay = 0;
  spend(s: PlayerState, amount: number): boolean {
    if (s.stamina < amount) return false;
    s.stamina -= amount;
    this.delay = BALANCE.survival.staminaRegenDelaySec;
    return true;
  }
}

export function tickSurvival(
  s: PlayerState,
  stats: Stats,
  form: FormDef,
  dt: number,
  ctx: SurvivalContext,
  stamClock: StaminaClock,
): SurvivalTick {
  const S = BALANCE.survival;
  const Wt = BALANCE.weather;
  const rest = ctx.rest;
  const resting = rest.settled && rest.mode === 'resting';
  const sleeping = rest.settled && rest.mode === 'sleeping';

  let decayMult = 1;
  if (ctx.sprinting && ctx.moving) decayMult *= S.sprintDecayMult;
  if (ctx.inCombat) decayMult *= S.combatDecayMult;
  if (sleeping) decayMult *= S.sleepDecayMult;
  else if (resting) decayMult *= S.restDecayMult;

  let thirstWeather = 1;
  if (ctx.weather === 'heat') thirstWeather = 1 + (Wt.heatThirstMult - 1) * (1 - form.heatResist);
  else if (ctx.weather === 'rain') thirstWeather = Wt.rainThirstMult;

  s.hunger = Math.max(0, s.hunger - S.hungerDecayPerSec * form.hungerMult * decayMult * dt);
  s.thirst = Math.max(0, s.thirst - S.thirstDecayPerSec * form.thirstMult * decayMult * thirstWeather * dt);

  // Fatigue
  if (sleeping) {
    const rate = S.sleepFatigueRecoverPerSec * (ctx.inShelter ? 1 : S.sleepOutsideRecoverMult);
    s.fatigue = Math.max(0, s.fatigue - rate * dt);
  } else if (resting) {
    s.fatigue = Math.max(0, s.fatigue - S.restFatigueRecoverPerSec * dt);
  } else {
    const fm = ctx.sprinting && ctx.moving ? S.fatigueSprintMult : 1;
    s.fatigue = Math.min(100, s.fatigue + S.fatigueGainPerSec * fm * dt);
  }

  // Stamina
  let outOfStamina = false;
  if (ctx.sprinting && ctx.moving) {
    s.stamina -= S.sprintStaminaPerSec * form.staminaCostMult * dt;
    stamClock.delay = S.staminaRegenDelaySec;
    if (s.stamina <= 0) {
      s.stamina = 0;
      outOfStamina = true;
    }
  } else {
    stamClock.delay = Math.max(0, stamClock.delay - dt);
    if (stamClock.delay <= 0) {
      let regen = S.staminaRegenPerSec;
      if (rest.settled) regen *= S.restStaminaMult;
      if (s.fatigue >= S.fatigueExhaustedLevel) regen *= S.exhaustedStaminaRegenMult;
      if (ctx.weather === 'heat') regen *= 1 - (1 - Wt.heatStaminaRegenMult) * (1 - form.heatResist);
      s.stamina = Math.min(maxStamina(s, stats), s.stamina + regen * dt);
    }
  }
  s.stamina = Math.min(s.stamina, maxStamina(s, stats));

  // HP: starvation damage or regen
  const starving = s.hunger <= 0;
  const dehydrated = s.thirst <= 0;
  let damage = 0;
  if (starving || dehydrated) {
    const mult = (starving ? 1 : 0) + (dehydrated ? 1 : 0);
    damage = stats.maxHp * S.starveDamageFracPerSec * mult * dt;
    s.hp = Math.max(0, s.hp - damage);
  } else if (s.hp > 0 && !ctx.inCombat && !ctx.poisoned && s.hp < stats.maxHp) {
    const need = resting || sleeping ? S.hpRegenRestMinNeeds : S.hpRegenMinNeeds;
    if (s.hunger >= need && s.thirst >= need) {
      let mult = 1;
      if (sleeping) mult = S.sleepHpMult;
      else if (resting) mult = S.restHpMult;
      s.hp = Math.min(stats.maxHp, s.hp + stats.maxHp * S.hpRegenFracPerSec * mult * dt);
    }
  }
  if (ctx.buffRegen > 0 && s.hp > 0) s.hp = Math.min(stats.maxHp, s.hp + stats.maxHp * ctx.buffRegen * dt);

  s.stats.timeAlive += dt;
  return { starving, dehydrated, damage, outOfStamina };
}

/** Exhaustion trims usable stamina. */
export function maxStamina(s: PlayerState, stats: Stats): number {
  const S = BALANCE.survival;
  if (s.fatigue >= S.fatigueExhaustedLevel) return stats.stamina * 0.6;
  if (s.fatigue >= S.fatigueTiredLevel) return stats.stamina * 0.8;
  return stats.stamina;
}

export function fatigueSpeedMult(s: PlayerState): number {
  return s.fatigue >= BALANCE.survival.fatigueTiredLevel ? BALANCE.survival.tiredSpeedMult : 1;
}
