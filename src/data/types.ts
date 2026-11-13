export type Diet = 'herbivore' | 'carnivore' | 'omnivore';
export type Biome = 'grass' | 'forest' | 'lake' | 'rock' | 'swamp';
export type Weather = 'clear' | 'rain' | 'heat';

export interface Palette {
  outline: string;
  dark: string;
  base: string;
  light: string;
  belly: string;
  accent: string;
  accent2: string;
  eye: string;
}

export type BeastFeature =
  | 'leaf_ears'
  | 'pointy_ears'
  | 'round_ears'
  | 'long_ears'
  | 'fin_ears'
  | 'horns'
  | 'big_horns'
  | 'curled_horns'
  | 'antlers'
  | 'back_leaves'
  | 'tree_crown'
  | 'moss'
  | 'flame_tail'
  | 'flame_mane'
  | 'flame_crest'
  | 'back_fin'
  | 'shell'
  | 'spikes'
  | 'crystals'
  | 'tusks'
  | 'stripes'
  | 'spots'
  | 'whiskers'
  | 'beard'
  | 'gem'
  /** Soft elemental glow behind the body (forms 4–5). */
  | 'aura'
  /** Sharp rays bursting from the body (form 5). */
  | 'aura_burst'
  /** Ring of light above the head. */
  | 'halo'
  /** Large back wings / energy sails. */
  | 'wings'
  /** Permanent fierce brow over the eye. */
  | 'fierce_eyes'
  /** Form 4: stands and walks on two legs. */
  | 'biped'
  /** Form 5: hovers / flies above the ground. */
  | 'fly';

export interface BeastArt {
  /** Low-res frame size in art pixels (final texture is 2x). */
  size: number;
  bodyW: number;
  bodyH: number;
  headR: number;
  headDx: number;
  headDy: number;
  snout: number;
  legLen: number;
  legW: number;
  tailLen: number;
  tailW: number;
  tailKind: 'thin' | 'bushy' | 'leaf' | 'fin' | 'stub' | 'lizard';
  features: BeastFeature[];
  pal: Palette;
}

export interface Stats {
  maxHp: number;
  speed: number;
  power: number;
  defense: number;
  stamina: number;
}

export interface AttackDef {
  name: string;
  range: number;
  arcDeg: number;
  windupSec: number;
  activeSec: number;
  cooldownSec: number;
  stamina: number;
  dmgMult: number;
  knockback: number;
}

export type SkillKind = 'dash' | 'projectile' | 'cone' | 'nova' | 'buff';

export type StatusKind = 'burn' | 'poison' | 'slow' | 'stun';

/** A status applied on hit. `mag` is the slow fraction, or DoT per second as a multiple of the attacker's power. */
export interface StatusSpec {
  kind: StatusKind;
  sec: number;
  mag?: number;
}

export interface BuffDef {
  defenseMult?: number;
  regenFracPerSec?: number;
  speedMult?: number;
  powerMult?: number;
  /** Fraction of damage dealt returned as HP. */
  lifesteal?: number;
  /** Fraction of melee damage taken reflected to the attacker. */
  thorns?: number;
  /** Removes negative statuses when cast. */
  cleanse?: boolean;
}

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  kind: SkillKind;
  cooldownSec: number;
  stamina: number;
  windupSec: number;
  dmgMult: number;
  range: number;
  radius: number;
  /** Negative values pull targets toward the caster. */
  knockback: number;
  arcDeg?: number;
  speed?: number;
  count?: number;
  spreadDeg?: number;
  durationSec?: number;
  buff?: BuffDef;
  status?: StatusSpec;
  color: number;
  particle: 'spark' | 'leaf' | 'drop' | 'dust';
  /** Skill this one turns into once mastered. */
  evolvesTo?: string;
  /** Mastery points needed to evolve (hits for attacks, casts for buffs). */
  mastery?: number;
  /** Minimum form index (0-based) before the evolution can happen. */
  evolveForm?: number;
}

/** Conditions for learning a skill; every listed field must be met. */
export interface LearnReq {
  level?: number;
  form?: number;
  kills?: number;
  elites?: number;
  days?: number;
  drinks?: number;
  stones?: number;
}

export interface LearnEntry {
  skill: string;
  req: LearnReq;
}

export interface FormDef {
  name: string;
  title: string;
  desc: string;
  stats: Stats;
  radius: number;
  hungerMult: number;
  thirstMult: number;
  staminaCostMult: number;
  basic: AttackDef;
  canClimbLedges: boolean;
  /** 0..1 reduction of heat thirst penalty. */
  heatResist: number;
  art: BeastArt;
}

export interface SpeciesDef {
  id: string;
  lineName: string;
  element: string;
  elementColor: string;
  diet: Diet;
  dietLabel: string;
  blurb: string;
  /** Five evolution stages: juvenile → adult → apex → terror → mythic. */
  forms: [FormDef, FormDef, FormDef, FormDef, FormDef];
  /** Skills learned over a run, in unlock order. The first entry is known from the start. */
  learnset: LearnEntry[];
  /** Ignores the movement penalty of swamp mud. */
  swampWalker?: boolean;
}

export type Temperament = 'prey' | 'skittish' | 'neutral' | 'territorial' | 'predator' | 'apex';

export interface NpcDef {
  id: string;
  name: string;
  diet: Diet;
  biomes: Biome[];
  level: number;
  stats: { maxHp: number; speed: number; power: number; defense: number };
  radius: number;
  temperament: Temperament;
  detectRange: number;
  fleeRange: number;
  leash: number;
  nocturnal: boolean;
  /** NPC ids this creature hunts for food. */
  preys: string[];
  attack: AttackDef;
  heavy?: {
    name: string;
    kind: 'slam' | 'lunge';
    range: number;
    radius: number;
    windupSec: number;
    cooldownSec: number;
    dmgMult: number;
    knockback: number;
    status?: StatusSpec;
  };
  /** Status inflicted by the basic attack. */
  attackStatus?: StatusSpec;
  /** Spit / spine volley fired from a distance. */
  ranged?: {
    name: string;
    range: number;
    speed: number;
    radius: number;
    windupSec: number;
    cooldownSec: number;
    dmgMult: number;
    knockback: number;
    count: number;
    spreadDeg: number;
    color: number;
    status?: StatusSpec;
    /** Backs away when the target gets too close. */
    kite?: boolean;
  };
  /** Signature boss ultimates (unique / guardians). */
  ult?: {
    name: string;
    /** nova = expanding rings; barrage = multi-wave projectile storm. */
    kind: 'slam' | 'lunge' | 'nova' | 'barrage';
    range: number;
    radius: number;
    windupSec: number;
    cooldownSec: number;
    dmgMult: number;
    knockback: number;
    status?: StatusSpec;
    /** Projectile count per wave (barrage). */
    count?: number;
    /** Extra waves after the first (barrage / nova). */
    waves?: number;
    speed?: number;
    color?: number;
    spreadDeg?: number;
  };
  /** Spawns in groups of this size; members join each other's fights. */
  pack?: number;
  drops: number;
  exp: number;
  population: number;
  respawnSec: number;
  unique?: boolean;
  /** Gate boss of a realm: never spawns naturally, only when summoned at the portal. Stats are used as-is. */
  guardian?: boolean;
  /** Spawns only on rocky plateau tiles. */
  plateauOnly?: boolean;
  art: BeastArt;
  desc: string;
}

export type ResourceKind = 'grass' | 'leafbush' | 'berrybush' | 'mushroom' | 'nest' | 'crystal';

export interface FoodDef {
  id: string;
  name: string;
  hunger: number;
  thirst: number;
  maturity: number;
  /** Diet efficiency multiplier; 0 means inedible. */
  efficiency: Record<Diet, number>;
  carriable: boolean;
  icon: string;
}

export interface ResourceDef {
  kind: ResourceKind;
  name: string;
  food: string;
  portions: number;
  regrowSec: number;
  verb: string;
}
