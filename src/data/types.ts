export type Diet = 'herbivore' | 'carnivore' | 'omnivore';
export type Biome = 'grass' | 'forest' | 'lake' | 'rock';
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
  | 'gem';

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
  knockback: number;
  arcDeg?: number;
  speed?: number;
  count?: number;
  spreadDeg?: number;
  durationSec?: number;
  buff?: { defenseMult?: number; regenFracPerSec?: number; speedMult?: number };
  color: number;
  particle: 'spark' | 'leaf' | 'drop' | 'dust';
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
  skillQ: string;
  skillR: string | null;
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
  forms: [FormDef, FormDef, FormDef];
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
  };
  drops: number;
  exp: number;
  population: number;
  respawnSec: number;
  unique?: boolean;
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
