/**
 * Every gameplay tunable lives here. Time values are in simulated seconds,
 * distances in world pixels (1 tile = 32 px) unless noted otherwise.
 */
export const BALANCE = {
  saveVersion: 1,
  tile: 32,

  world: {
    widthTiles: 260,
    heightTiles: 260,
    sectorTiles: 20,
    /** Spawn must have suitable food / water within this many BFS steps. */
    spawnMaxFoodSteps: 30,
    spawnMaxWaterSteps: 45,
    shelterSafeRadius: 56,
    chunkTiles: 12,
  },

  time: {
    dayLengthSec: 720,
    startTimeOfDay: 7 / 24,
    dawnHour: 5.5,
    dayHour: 7.5,
    duskHour: 18,
    nightHour: 20,
  },

  weather: {
    minDurationSec: 110,
    maxDurationSec: 230,
    /** Relative weights when rolling a new weather state. */
    weights: { clear: 5, rain: 2.5, heat: 2 },
    rainSpeedMult: 0.93,
    rainThirstMult: 0.75,
    heatThirstMult: 1.7,
    heatStaminaRegenMult: 0.85,
  },

  survival: {
    hungerDecayPerSec: 100 / 600,
    thirstDecayPerSec: 100 / 500,
    sprintDecayMult: 1.6,
    combatDecayMult: 1.25,
    restDecayMult: 0.7,
    sleepDecayMult: 0.45,
    warnLevel: 25,
    criticalLevel: 8,
    /** Fraction of max HP lost per second while starving or dehydrated. */
    starveDamageFracPerSec: 0.012,
    staminaRegenPerSec: 16,
    staminaRegenDelaySec: 0.7,
    sprintStaminaPerSec: 15,
    sprintSpeedMult: 1.55,
    restStaminaMult: 2.4,
    /** Rest only becomes effective after lying still this long (anti toggle-spam). */
    restSettleSec: 1.4,
    restToggleCooldownSec: 0.6,
    hpRegenFracPerSec: 0.002,
    hpRegenMinNeeds: 55,
    restHpMult: 2.5,
    sleepHpMult: 4,
    fatigueGainPerSec: 100 / 960,
    fatigueSprintMult: 1.6,
    fatigueTiredLevel: 70,
    fatigueExhaustedLevel: 92,
    tiredSpeedMult: 0.88,
    exhaustedStaminaRegenMult: 0.5,
    sleepAfterRestSec: 3,
    sleepMinFatigue: 12,
    sleepFatigueRecoverPerSec: 100 / 40,
    sleepOutsideRecoverMult: 0.6,
    restFatigueRecoverPerSec: 100 / 400,
    /** Movement multiplier in swamp mud (species with swampWalker ignore it). */
    swampSpeedMult: 0.75,
    /** Drinking murky swamp water poisons non-swamp species for this long. */
    swampWaterPoisonSec: 8,
  },

  combat: {
    defenseK: 40,
    playerIFramesSec: 0.35,
    npcIFramesSec: 0.12,
    knockbackDecay: 9,
    hitStunSec: 0.16,
    dodgeDurationSec: 0.2,
    dodgeSpeed: 520,
    dodgeCooldownSec: 1.3,
    dodgeStamina: 20,
    combatTimeoutSec: 5,
    /** Max NPCs allowed to actively pursue the player at once. */
    maxPlayerAggressors: 4,
    damageVariance: 0.1,
    /** Mastery gained per enemy hit with a skill (buffs gain 1 per cast). */
    masteryPerHit: 1,
    masteryKillBonus: 2,
  },

  /** World danger: creatures get stronger farther from spawn and as days pass. */
  threat: {
    /** Tiles from spawn per danger tier. */
    tierTiles: 60,
    maxTier: 3,
    hpPerTier: 0.22,
    powerPerTier: 0.16,
    defensePerTier: 0.12,
    levelPerTier: 2,
    /** Extra power/HP per survived day, capped. */
    perDay: 0.04,
    maxDayBonus: 0.4,
    eliteChance: 0.07,
    eliteChancePerTier: 0.04,
    eliteHp: 1.8,
    elitePower: 1.35,
    eliteDefense: 1.25,
    eliteSpeed: 1.1,
    eliteExp: 2.5,
    eliteLevel: 3,
    /** Bosses enrage below this HP fraction. */
    enrageAt: 0.5,
    enrageSpeed: 1.25,
    enrageCooldown: 0.6,
    /** Every Nth night is a blood moon. */
    bloodMoonEvery: 4,
    bloodMoonPower: 1.25,
    bloodMoonDetect: 1.3,
    bloodMoonPopulation: 1.5,
  },

  progression: {
    expBase: 30,
    expGrowth: 1.32,
    maxLevel: 30,
    levelHpBonus: 0.06,
    levelPowerBonus: 0.05,
    levelDefenseBonus: 0.04,
    expPerSector: 8,
    expPerBiome: 25,
    expPerDay: 30,
    expKillPerNpcLevel: 7,
  },

  maturity: {
    max: 100,
    /** Gain multiplier for each form (form 3 is final and cannot grow further). */
    formGainMult: [1, 0.6, 0] as number[],
    passivePerSec: 0.045,
    passiveMinNeeds: 50,
    /** Eating while already this full yields no growth. */
    eatNoGrowthAbove: 90,
    /** Each meal adds 1 "satiation" that halves growth per point; decays over time. */
    eatDiminishPerMeal: 0.45,
    eatDiminishDecayPerSec: 1 / 35,
    perSector: 2.6,
    perBiome: 8,
    perDay: 12,
    perKillBase: 5,
    /** Kills of creatures weaker than this ratio of your power give no growth. */
    killMinPowerRatio: 0.35,
  },

  evolution: {
    requiredLevel: [5, 10] as number[],
    /** Elite kills required as an evolution trial (per form). */
    requiredElites: [0, 1] as number[],
    durationSec: [20, 40] as number[],
    minHunger: 50,
    minThirst: 50,
    /** Glow of evolving attracts predators within this radius. */
    lureRadius: 480,
  },

  npc: {
    nearUpdateMargin: 320,
    farUpdateIntervalSec: 0.5,
    spawnCheckIntervalSec: 6,
    spawnMinPlayerDist: 760,
    spawnViewMargin: 220,
    carcassLifetimeSec: 120,
    giveUpChaseSec: 10,
    lowHpRetreatFrac: 0.25,
    hungerDecayPerSec: 100 / 300,
    thirstDecayPerSec: 100 / 260,
    grazeConsumeChance: 0.35,
    /** Population multiplier for the larger map (uniques excluded). */
    populationScale: 1.8,
    /** Pack members within this radius join a fight. */
    packAlertRadius: 340,
  },

  resources: {
    maxCarcasses: 40,
    maxParticles: 220,
    maxDamageTexts: 30,
  },

  inventory: {
    startSlots: 2,
    maxSlots: 6,
    /** When fuller than this, pressing E on a carriable food picks it up instead of eating. */
    pickupWhenHungerAbove: 92,
  },

  actions: {
    eatSec: 0.8,
    drinkSec: 0.9,
    drinkAmount: 28,
    interactRange: 46,
    drinkRange: 40,
  },

  autosaveIntervalSec: 45,
} as const;

export function expToNext(level: number): number {
  const p = BALANCE.progression;
  return Math.round(p.expBase * Math.pow(p.expGrowth, level - 1));
}
