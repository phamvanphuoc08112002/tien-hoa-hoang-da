import Phaser from 'phaser';
import { BALANCE } from '../config/balance';
import { SpatialGrid } from '../core/spatialGrid';
import { dietEfficiency } from '../data/foods';
import { NPC_LIST, NPCS } from '../data/npcs';
import type { Diet, NpcDef, StatusSpec } from '../data/types';
import { npcTextureKey } from '../gfx/textures';
import type { AudioSystem } from '../systems/audio';
import { powerScore } from '../systems/playerState';
import { STATUS_INFO, StatusEffects } from '../systems/status';
import { AFFIXES, AFFIX_IDS, canBeElite, eliteChance, scaleNpc, tierAt, type EliteAffix, type NpcScaling } from '../systems/threat';
import { isPositionFree, moveCircle } from '../world/collision';
import { BLK, TT } from '../world/tiles';
import type { CombatSystem, Creature } from './CombatSystem';
import type { Effects } from './Effects';
import type { Carcass, ResourceNode, WorldView } from './WorldView';

const T = BALANCE.tile;

export type AIState = 'wander' | 'seekFood' | 'seekWater' | 'eat' | 'drink' | 'hunt' | 'flee' | 'fight' | 'rest' | 'dead';

export const AI_STATE_NAMES: Record<AIState, string> = {
  wander: 'Lang thang',
  seekFood: 'Tìm thức ăn',
  seekWater: 'Tìm nước',
  eat: 'Đang ăn',
  drink: 'Đang uống',
  hunt: 'Săn mồi',
  flee: 'Chạy trốn',
  fight: 'Chiến đấu',
  rest: 'Nghỉ',
  dead: 'Chết',
};

/** What NPC AI needs to know about the player. */
export interface PlayerInfo extends Creature {
  diet: Diet;
  sleeping: boolean;
  inShelter: boolean;
  evolving: boolean;
  score: number;
}

export interface NpcEnv {
  now(): number;
  hour(): number;
  isNight(): boolean;
  /** Dawns survived; raises creature strength over time. */
  days(): number;
  bloodMoon(): boolean;
  /** Current realm index; scales every creature. */
  realm: number;
  player: PlayerInfo;
  audio: AudioSystem;
}

type WindupKind = 'basic' | 'heavy' | 'ranged';

let uidCounter = 1000;

export class Npc implements Creature {
  readonly uid = uidCounter++;
  readonly isPlayer = false;
  readonly kind: string;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  alive = true;
  kbx = 0;
  kby = 0;
  iframes = 0;
  score: number;
  canClimb: boolean;
  status = new StatusEffects<Creature>();

  readonly tier: number;
  readonly affix: EliteAffix | null;
  readonly sc: NpcScaling;
  enraged = false;

  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  texKey: string;
  curAnim = '';

  state: AIState = 'wander';
  stateT = 0;
  target: Creature | null = null;
  food: ResourceNode | Carcass | null = null;
  foodIsCarcass = false;
  goal: { x: number; y: number } | null = null;
  pause = 0;
  homeX: number;
  homeY: number;
  chaseX = 0;
  chaseY = 0;
  hunger: number;
  thirst: number;
  atkCd = 0;
  heavyCd: number;
  rangedCd: number;
  windup: { kind: WindupKind; t: number; dir: number } | null = null;
  dash: { vx: number; vy: number; t: number } | null = null;
  lastAttacker: Creature | null = null;
  lastHitAt = -99;
  giveUp = new Map<number, number>();
  moveX = 0;
  moveY = 0;
  speedMult = 0;
  facing = 1;
  accum = 0;
  decideT = Math.random() * 0.3;
  stuckT = 0;
  lastPos = { x: 0, y: 0 };
  hbTimer = 0;
  flash = 0;
  deadT = 0;
  restLen = 20;
  side = Math.random() < 0.5 ? 1 : -1;
  near = true;

  constructor(
    scene: Phaser.Scene,
    readonly def: NpcDef,
    x: number,
    y: number,
    tier: number,
    days: number,
    affix: EliteAffix | null,
    realm = 0,
  ) {
    this.kind = def.id;
    this.x = x;
    this.y = y;
    this.homeX = x;
    this.homeY = y;
    this.tier = tier;
    this.affix = affix;
    this.sc = scaleNpc(def, tier, days, affix, realm);
    this.radius = def.radius * (affix ? 1.12 : 1);
    this.maxHp = this.sc.maxHp;
    this.hp = this.maxHp;
    this.score = powerScore(this.sc.power, this.sc.maxHp);
    this.canClimb = def.biomes.includes('rock');
    this.hunger = 50 + Math.random() * 50;
    this.thirst = 50 + Math.random() * 50;
    this.heavyCd = 1.5 + Math.random() * 2;
    this.rangedCd = 1 + Math.random() * 2;
    if (def.unique) this.status.ccResist = 0.4;
    else if (affix) this.status.ccResist = 0.65;
    this.texKey = npcTextureKey(def.id);
    const s = def.art.size * 2;
    this.shadow = scene.add.image(x, y, 'shadow').setDisplaySize(this.radius * 2.6, this.radius * 0.9).setDepth(y - 30);
    this.sprite = scene.add.sprite(x, y, this.texKey, 0).setOrigin(0.5, (s - 4) / s);
    if (affix) this.sprite.setScale(1.12);
    this.play('idle');
  }

  get elite(): boolean {
    return this.affix !== null;
  }

  get level(): number {
    return this.sc.level;
  }

  get power(): number {
    return this.sc.power;
  }

  get displayName(): string {
    return this.affix ? `★ ${this.def.name} ${AFFIXES[this.affix].name}` : this.def.name;
  }

  defense(): number {
    return this.sc.defense;
  }

  /** Status inflicted by melee attacks (species trait or elite affix). */
  meleeStatus(): StatusSpec | null {
    return this.def.attackStatus ?? (this.affix ? AFFIXES[this.affix].status ?? null : null);
  }

  play(name: string): void {
    if (this.curAnim === name) return;
    this.curAnim = name;
    this.sprite.play(`${this.texKey}:${name}`, true);
  }

  setState(s: AIState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
    this.windup = null;
    if (s !== 'hunt' && s !== 'fight') this.target = s === 'flee' ? this.target : null;
    if (s !== 'seekFood' && s !== 'eat') this.food = null;
    this.goal = null;
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
  }
}

type SpawnZone = 'grass' | 'forest' | 'lake' | 'rock' | 'plateau' | 'swamp';

export class NpcManager {
  npcs: Npc[] = [];
  readonly grid = new SpatialGrid<Npc>(128);
  private zones: Record<SpawnZone, number[]> = { grass: [], forest: [], lake: [], rock: [], plateau: [], swamp: [] };
  private spawnTimer = 3;
  private nextAllowed: Record<string, number> = {};
  /** Simulated time each unique boss was last defeated. */
  bossDefeatedAt: Record<string, number> = {};
  /** Called when an NPC finishes dying (for UI cleanup). */
  onRemoved: ((n: Npc) => void) | null = null;
  /** Called when a boss enrages. */
  onEnrage: ((n: Npc) => void) | null = null;

  constructor(
    private scene: Phaser.Scene,
    private wv: WorldView,
    private combat: CombatSystem,
    private fx: Effects,
    private env: NpcEnv,
  ) {
    const d = wv.data;
    for (let i = 0; i < d.w * d.h; i++) {
      if (!d.reach2[i] || d.blocked[i] !== BLK.FREE) continue;
      const t = d.tiles[i];
      if (t === TT.FORD) continue;
      const b = d.biome[i];
      if (t === TT.PLATEAU) this.zones.plateau.push(i);
      else if (b === 0) this.zones.grass.push(i);
      else if (b === 1) this.zones.forest.push(i);
      else if (b === 2) this.zones.lake.push(i);
      else if (b === 4) this.zones.swamp.push(i);
      else this.zones.rock.push(i);
    }
  }

  private zonesFor(def: NpcDef): number[][] {
    if (def.plateauOnly) return [this.zones.plateau];
    return def.biomes.map((b) => this.zones[b]);
  }

  /** Picks a valid spawn tile for a species respecting distance and view rules. */
  private pickSpawn(def: NpcDef, minPlayerDist: number, avoidView: boolean): { x: number; y: number } | null {
    const zones = this.zonesFor(def).filter((z) => z.length > 0);
    if (zones.length === 0) return null;
    const P = this.env.player;
    const view = this.scene.cameras.main.worldView;
    const m = BALANCE.npc.spawnViewMargin;
    for (let tries = 0; tries < 40; tries++) {
      const z = zones[Math.floor(Math.random() * zones.length)];
      const i = z[Math.floor(Math.random() * z.length)];
      const x = (i % this.wv.data.w) * T + T / 2;
      const y = Math.floor(i / this.wv.data.w) * T + T / 2;
      if (Math.hypot(x - P.x, y - P.y) < minPlayerDist) continue;
      if (avoidView && x > view.x - m && x < view.right + m && y > view.y - m && y < view.bottom + m) continue;
      if (this.wv.shelterAt(x, y)) continue;
      if (!isPositionFree(this.wv.data, x, y, def.radius, this.canClimbDef(def))) continue;
      return { x, y };
    }
    return null;
  }

  private canClimbDef(def: NpcDef): boolean {
    return def.biomes.includes('rock');
  }

  private tierFor(x: number, y: number): number {
    const s = this.wv.data.spawn;
    return tierAt(Math.hypot(x / T - s.tx, y / T - s.ty));
  }

  spawn(def: NpcDef, x: number, y: number, affix: EliteAffix | null = null): Npc {
    const n = new Npc(this.scene, def, x, y, this.tierFor(x, y), this.env.days(), affix, this.env.realm);
    this.npcs.push(n);
    this.grid.insert(n);
    return n;
  }

  /** The realm's gate guardian, if it has been summoned and is still alive. */
  guardian(): Npc | null {
    return this.npcs.find((n) => n.alive && n.def.guardian) ?? null;
  }

  /** Brings the gate guardian in at a spot near the portal and sets it on the player. */
  summonGuardian(def: NpcDef, x: number, y: number): Npc {
    const n = this.spawn(def, x, y);
    n.setState('fight');
    n.target = this.env.player;
    n.chaseX = x;
    n.chaseY = y;
    n.hbTimer = 999;
    return n;
  }

  private rollAffix(def: NpcDef, x: number, y: number): EliteAffix | null {
    if (!canBeElite(def)) return null;
    if (Math.random() >= eliteChance(this.tierFor(x, y), this.env.bloodMoon(), this.env.realm)) return null;
    return AFFIX_IDS[Math.floor(Math.random() * AFFIX_IDS.length)];
  }

  /** Spawns a pack (or single creature) around a point. Returns how many were placed. */
  private spawnGroup(def: NpcDef, p: { x: number; y: number }, size: number): number {
    let placed = 0;
    for (let g = 0; g < size; g++) {
      const ox = g === 0 ? 0 : (Math.random() - 0.5) * 80;
      const oy = g === 0 ? 0 : (Math.random() - 0.5) * 80;
      const x = p.x + ox;
      const y = p.y + oy;
      if (g > 0 && !isPositionFree(this.wv.data, x, y, def.radius, this.canClimbDef(def))) continue;
      const n = this.spawn(def, x, y, this.rollAffix(def, x, y));
      n.homeX = p.x;
      n.homeY = p.y;
      placed++;
    }
    return placed;
  }

  bossDown(def: NpcDef): boolean {
    const at = this.bossDefeatedAt[def.id];
    return def.unique === true && at !== undefined && this.env.now() - at < def.respawnSec;
  }

  targetPopulation(def: NpcDef): number {
    if (def.unique) return def.population;
    let p = def.population * BALANCE.npc.populationScale;
    if (this.env.bloodMoon() && (def.temperament === 'predator' || def.temperament === 'apex')) p *= BALANCE.threat.bloodMoonPopulation;
    return Math.round(p);
  }

  initialPopulate(): void {
    for (const def of NPC_LIST) {
      if (this.bossDown(def)) continue;
      const dangerous = def.temperament === 'predator' || def.temperament === 'apex' || def.temperament === 'territorial';
      const minD = dangerous ? 30 * T : 6 * T;
      const target = this.targetPopulation(def);
      let placed = 0;
      let guard = 0;
      while (placed < target && guard++ < target * 3) {
        const p = this.pickSpawn(def, minD, false);
        if (!p) break;
        placed += this.spawnGroup(def, p, Math.min(def.pack ?? 1, target - placed));
      }
    }
  }

  countAggroOnPlayer(): number {
    let c = 0;
    for (const n of this.npcs) if (n.alive && n.target === this.env.player && (n.state === 'hunt' || n.state === 'fight')) c++;
    return c;
  }

  creaturesNear(x: number, y: number, r: number): Npc[] {
    return this.grid.queryRadius(x, y, r);
  }

  onDamaged(n: Npc, attacker: Creature): void {
    n.lastAttacker = attacker;
    n.lastHitAt = this.env.now();
    n.hbTimer = 4;
    n.flash = 0.12;
    if (n.state === 'rest' || n.state === 'eat' || n.state === 'drink') n.setState('wander');
    n.windup = n.windup && n.windup.kind === 'heavy' ? n.windup : null;
    if (!n.windup) this.combat.removeTelegraphs(n.uid);
    n.decideT = 0;
    if (attacker.isPlayer) this.alertPack(n, attacker);
  }

  /** Pack members near `n` join the fight against `target`. */
  private alertPack(n: Npc, target: Creature): void {
    if (!n.def.pack || n.def.pack < 2) return;
    for (const o of this.grid.queryRadius(n.x, n.y, BALANCE.npc.packAlertRadius)) {
      if (o === n || !o.alive || o.def.id !== n.def.id || o.target === target) continue;
      if (o.state === 'flee') continue;
      o.setState('fight');
      o.target = target;
      o.chaseX = o.x;
      o.chaseY = o.y;
      o.hbTimer = 4;
    }
  }

  kill(n: Npc, killer: Creature | null): Carcass | null {
    if (!n.alive) return null;
    n.alive = false;
    n.state = 'dead';
    n.deadT = 0;
    n.windup = null;
    n.dash = null;
    n.status.clear();
    this.combat.cancelOwner(n.uid);
    n.play('dead');
    this.fx.burst(n.x, n.y - n.radius, 'blood', 8, { speed: 110, life: 0.5, tint: 0xd04040, gravity: 200 });
    if (n.def.unique) this.bossDefeatedAt[n.def.id] = this.env.now();
    this.wv.addCarcass(n.x, n.y, n.def.drops + (n.elite ? 2 : 0), this.env.now());
    const carcass = this.wv.carcasses[this.wv.carcasses.length - 1] ?? null;
    if (killer && !killer.isPlayer) {
      const k = killer as Npc;
      if (k.alive && carcass && dietEfficiency(k.def.diet, 'thit') > 0) {
        k.setState('seekFood');
        k.food = carcass;
        k.foodIsCarcass = true;
      } else if (k.alive) k.setState('wander');
    }
    return carcass;
  }

  // -------------------------------------------------------------------------

  update(dt: number): void {
    const cam = this.scene.cameras.main;
    const v = cam.worldView;
    const m = BALANCE.npc.nearUpdateMargin;
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const n = this.npcs[i];
      const near = n.x > v.x - m && n.x < v.right + m && n.y > v.y - m && n.y < v.bottom + m;
      n.near = near;
      const visible = n.x > v.x - 80 && n.x < v.right + 80 && n.y > v.y - 120 && n.y < v.bottom + 80;
      n.sprite.setVisible(visible);
      n.shadow.setVisible(visible);
      if (n.state === 'dead') {
        n.deadT += dt;
        n.sprite.setAlpha(Math.max(0, 1 - Math.max(0, n.deadT - 0.8) / 0.7));
        n.shadow.setAlpha(n.sprite.alpha);
        if (n.deadT > 1.5) {
          this.grid.remove(n);
          n.destroy();
          this.npcs.splice(i, 1);
          this.onRemoved?.(n);
        }
        continue;
      }
      if (near) this.step(n, dt);
      else {
        n.accum += dt;
        if (n.accum >= BALANCE.npc.farUpdateIntervalSec) {
          this.step(n, n.accum);
          n.accum = 0;
        }
      }
      this.grid.update(n);
      if (visible && n.alive) this.render(n, dt);
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = BALANCE.npc.spawnCheckIntervalSec;
      this.maintainPopulation();
    }
  }

  private maintainPopulation(): void {
    const now = this.env.now();
    const counts: Record<string, number> = {};
    for (const n of this.npcs) if (n.alive) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
    for (const def of NPC_LIST) {
      const alive = counts[def.id] ?? 0;
      const target = this.targetPopulation(def);
      if (alive >= target) continue;
      if (this.bossDown(def)) continue;
      if ((this.nextAllowed[def.id] ?? 0) > now) continue;
      const p = this.pickSpawn(def, BALANCE.npc.spawnMinPlayerDist, true);
      if (!p) continue;
      this.spawnGroup(def, p, Math.min(def.pack ?? 1, target - alive));
      const fill = alive / target;
      this.nextAllowed[def.id] = now + def.respawnSec * (0.5 + fill) * (this.env.bloodMoon() ? 0.5 : 1);
    }
  }

  // ---- AI ----------------------------------------------------------------

  private detectRange(n: Npc): number {
    let r = n.def.detectRange;
    const night = this.env.isNight();
    if (night) r *= n.def.nocturnal ? 1.35 : 0.75;
    if (this.env.bloodMoon()) r *= BALANCE.threat.bloodMoonDetect;
    const b = this.wv.biomeAt(n.x, n.y);
    if (b === 1 || b === 4) r *= 0.8;
    if (n.elite) r *= 1.15;
    return r;
  }

  private isThreat(n: Npc, o: Creature): boolean {
    if (!o.alive || o.uid === n.uid) return false;
    const t = n.def.temperament;
    if (o.isPlayer) {
      const P = o as PlayerInfo;
      if (t === 'prey' || t === 'skittish') {
        if (P.diet !== 'herbivore') return true;
        return n.lastAttacker === o && this.env.now() - n.lastHitAt < 10;
      }
      return false;
    }
    const od = (o as Npc).def;
    if (od.id === n.def.id) return false;
    if (t === 'prey' || t === 'skittish') return od.temperament === 'predator' || od.temperament === 'apex';
    if (t === 'territorial' || t === 'neutral') return od.temperament === 'apex' && n.hp < n.maxHp * 0.6;
    return false;
  }

  private canTargetPlayer(n: Npc, dist: number): boolean {
    const P = this.env.player;
    if (!P.alive) return false;
    const now = this.env.now();
    if ((n.giveUp.get(P.uid) ?? 0) > now) return false;
    const hostile = n.def.temperament === 'predator' || n.def.temperament === 'apex';
    const lure = P.evolving && dist < BALANCE.evolution.lureRadius && (hostile || n.def.temperament === 'territorial');
    if (P.inShelter && !lure) return false;
    if (n.target !== P && this.countAggroOnPlayer() >= BALANCE.combat.maxPlayerAggressors) return false;
    if (lure) return true;
    const blood = this.env.bloodMoon();
    switch (n.def.temperament) {
      case 'apex':
        return dist < this.detectRange(n) * 0.9;
      case 'territorial':
        return dist < n.def.detectRange * (n.elite ? 1.3 : 1);
      case 'predator': {
        if (blood || n.elite) return dist < this.detectRange(n);
        const weak = P.score < n.score * 1.8 || P.hp < P.maxHp * 0.5;
        const motivated = n.hunger < 75 || (n.def.nocturnal && this.env.isNight());
        return dist < this.detectRange(n) && (P.sleeping || (weak && motivated));
      }
      default:
        return false;
    }
  }

  private pickAggroTarget(n: Npc): Creature | null {
    const t = n.def.temperament;
    if (t === 'prey' || t === 'skittish' || t === 'neutral') return null;
    const P = this.env.player;
    const now = this.env.now();
    const det = this.detectRange(n);
    const pd = Math.hypot(P.x - n.x, P.y - n.y);
    let best: Creature | null = null;
    let bestD = Infinity;
    if (pd < det + 50 && this.canTargetPlayer(n, pd)) {
      best = P;
      bestD = pd;
    }
    const hungry = n.hunger < 60;
    for (const o of this.grid.queryRadius(n.x, n.y, det)) {
      if (!o.alive || o === n || o.def.id === n.def.id) continue;
      if ((n.giveUp.get(o.uid) ?? 0) > now) continue;
      const d = Math.hypot(o.x - n.x, o.y - n.y);
      if (d >= bestD) continue;
      let want = false;
      if (t === 'predator') want = hungry && n.def.preys.includes(o.def.id);
      else if (t === 'apex') want = (hungry && n.def.preys.includes(o.def.id)) || d < det * 0.5;
      else if (t === 'territorial') want = o.def.temperament === 'predator' && d < n.def.detectRange;
      if (want) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  private decide(n: Npc): void {
    const P = this.env.player;
    const now = this.env.now();
    const t = n.def.temperament;
    const det = this.detectRange(n);

    // Threat scan
    let threat: Creature | null = null;
    let threatD = Infinity;
    if (t !== 'predator' && t !== 'apex') {
      const fr = Math.max(n.def.fleeRange, det * 0.8);
      const pd = Math.hypot(P.x - n.x, P.y - n.y);
      if (pd < fr && this.isThreat(n, P)) {
        threat = P;
        threatD = pd;
      }
      for (const o of this.grid.queryRadius(n.x, n.y, fr)) {
        const d = Math.hypot(o.x - n.x, o.y - n.y);
        if (d < threatD && this.isThreat(n, o)) {
          threat = o;
          threatD = d;
        }
      }
    }

    const recentlyHit = !!n.lastAttacker && n.lastAttacker.alive && now - n.lastHitAt < 8 && (n.giveUp.get(n.lastAttacker.uid) ?? 0) <= now;

    // Badly hurt creatures retreat from whoever hurt them (elites and bosses fight to the end).
    if (n.hp < n.maxHp * BALANCE.npc.lowHpRetreatFrac && recentlyHit && t !== 'apex' && !n.elite) {
      if (n.state !== 'flee' || n.target !== n.lastAttacker) {
        n.setState('flee');
        n.target = n.lastAttacker;
      }
      return;
    }

    if (threat && (t === 'prey' || t === 'skittish' || t === 'territorial' || t === 'neutral')) {
      const standGround = t === 'skittish' && recentlyHit && n.lastAttacker === threat && n.hp > n.maxHp * 0.5;
      if (!standGround) {
        if (n.state !== 'flee' || n.target !== threat) {
          n.setState('flee');
          n.target = threat;
        }
        return;
      }
    }

    if (recentlyHit && t !== 'prey' && n.lastAttacker) {
      if (n.state !== 'fight' || n.target !== n.lastAttacker) {
        if (n.lastAttacker !== P || P.alive) {
          n.setState('fight');
          n.target = n.lastAttacker;
          n.chaseX = n.x;
          n.chaseY = n.y;
        }
      }
      return;
    }

    if ((n.state === 'hunt' || n.state === 'fight') && n.target && n.target.alive) return;
    if (n.state === 'flee' && n.target && n.stateT < 3) return;

    const aggro = this.pickAggroTarget(n);
    if (aggro) {
      const isHunt = !aggro.isPlayer && n.def.preys.includes((aggro as Npc).def.id);
      n.setState(isHunt ? 'hunt' : aggro.isPlayer && t === 'predator' ? 'hunt' : 'fight');
      n.target = aggro;
      n.chaseX = n.x;
      n.chaseY = n.y;
      if (aggro.isPlayer) this.alertPack(n, aggro);
      return;
    }

    if (n.state === 'eat' || n.state === 'drink' || n.state === 'rest') return;
    if (n.state === 'seekFood' || n.state === 'seekWater') {
      if (n.stateT < 25) return;
    }

    if (n.thirst < 35) {
      n.setState('seekWater');
      return;
    }
    if (n.hunger < 45) {
      n.setState('seekFood');
      return;
    }
    const h = this.env.hour();
    const offHours = n.def.nocturnal ? h > 10 && h < 16 : h >= 21 || h < 5;
    if (offHours && Math.random() < 0.25 && !this.env.bloodMoon()) {
      n.setState('rest');
      n.restLen = 20 + Math.random() * 30;
      return;
    }
    if (n.state !== 'wander') n.setState('wander');
  }

  private findFood(n: Npc): void {
    const diet = n.def.diet;
    const range = 650;
    if (diet !== 'herbivore') {
      const c = this.wv.carcGrid.nearest(n.x, n.y, range, (q) => q.portions > 0);
      if (c) {
        n.food = c;
        n.foodIsCarcass = true;
        return;
      }
    }
    if (diet !== 'carnivore') {
      const r = this.wv.resGrid.nearest(n.x, n.y, range, (q) => q.portions > 0 && dietEfficiency(diet, q.def.food) > 0 && q.def.kind !== 'crystal');
      if (r) {
        n.food = r;
        n.foodIsCarcass = false;
        return;
      }
    }
    if (n.def.preys.length > 0) {
      const prey = this.grid.nearest(n.x, n.y, range, (q) => q.alive && n.def.preys.includes(q.def.id) && (n.giveUp.get(q.uid) ?? 0) <= this.env.now());
      if (prey) {
        n.setState('hunt');
        n.target = prey;
        n.chaseX = n.x;
        n.chaseY = n.y;
        return;
      }
    }
    // Nothing nearby: wander somewhere new and try again later.
    n.setState('wander');
    n.hunger = Math.min(100, n.hunger + 15);
  }

  private step(n: Npc, dt: number): void {
    n.stateT += dt;
    n.iframes = Math.max(0, n.iframes - dt);
    const cdRate = n.enraged ? 1 / BALANCE.threat.enrageCooldown : 1;
    n.atkCd = Math.max(0, n.atkCd - dt * cdRate);
    n.heavyCd = Math.max(0, n.heavyCd - dt * cdRate);
    n.rangedCd = Math.max(0, n.rangedCd - dt * cdRate);
    n.hbTimer = Math.max(0, n.hbTimer - dt);
    n.flash = Math.max(0, n.flash - dt);
    n.hunger = Math.max(0, n.hunger - BALANCE.npc.hungerDecayPerSec * dt * (n.state === 'rest' ? 0.4 : 1));
    n.thirst = Math.max(0, n.thirst - BALANCE.npc.thirstDecayPerSec * dt * (n.state === 'rest' ? 0.4 : 1));
    if (n.state === 'rest') n.hp = Math.min(n.maxHp, n.hp + n.maxHp * 0.02 * dt);
    else if (n.state !== 'fight' && n.state !== 'hunt' && n.state !== 'flee' && !n.status.has('poison')) n.hp = Math.min(n.maxHp, n.hp + n.maxHp * 0.004 * dt);

    const dot = n.status.tick(dt);
    if (dot.damage > 0) {
      this.combat.dotDamage(n, dot.damage, dot.source, dot.kind === 'poison' ? '#b6f07a' : '#ffb46a');
      if (!n.alive) return;
    }

    if (n.def.unique && !n.enraged && n.hp < n.maxHp * BALANCE.threat.enrageAt) {
      n.enraged = true;
      this.fx.ring(n.x, n.y, 0xff3a3a, 10, 140, 0.7, 5);
      this.fx.text(n.x, n.y - n.radius * 3, 'NỔI ĐIÊN!', '#ff5a4a', 18);
      this.onEnrage?.(n);
    }

    n.decideT -= dt;
    if (n.decideT <= 0) {
      n.decideT = n.near ? 0.25 : 0.5;
      this.decide(n);
    }

    n.moveX = 0;
    n.moveY = 0;
    n.speedMult = 0;
    let spd = n.sc.speed * (n.def.nocturnal && this.env.isNight() ? 1.1 : 1) * n.status.speedMult();
    if (n.enraged) spd *= BALANCE.threat.enrageSpeed;

    if (n.status.stunned) {
      if (n.windup) {
        n.windup = null;
        this.combat.removeTelegraphs(n.uid);
      }
      n.dash = null;
    } else if (n.dash) {
      n.dash.t -= dt;
      const r = moveCircle(this.wv.data, n.x, n.y, n.dash.vx * dt, n.dash.vy * dt, n.radius, n.canClimb);
      n.x = r.x;
      n.y = r.y;
      if (n.dash.t <= 0 || r.blockedX || r.blockedY) n.dash = null;
    } else if (n.windup) {
      n.windup.t -= dt;
      if (n.target && n.target.alive && n.windup.kind !== 'heavy') n.windup.dir = Math.atan2(n.target.y - n.y, n.target.x - n.x);
      if (n.windup.t <= 0) this.releaseAttack(n);
    } else {
      this.behave(n, dt);
    }

    // Movement + knockback integration
    let dx = n.moveX * spd * n.speedMult * dt + n.kbx * dt;
    let dy = n.moveY * spd * n.speedMult * dt + n.kby * dt;
    const decay = Math.exp(-BALANCE.combat.knockbackDecay * dt);
    n.kbx *= decay;
    n.kby *= decay;
    if (Math.abs(n.kbx) < 2) n.kbx = 0;
    if (Math.abs(n.kby) < 2) n.kby = 0;
    if (dx !== 0 || dy !== 0) {
      const r = moveCircle(this.wv.data, n.x, n.y, dx, dy, n.radius, n.canClimb);
      if ((r.blockedX || r.blockedY) && n.speedMult > 0) {
        // Simple feeler avoidance: try a side-step direction.
        const ang = Math.atan2(n.moveY, n.moveX) + n.side * 1.1;
        const r2 = moveCircle(this.wv.data, n.x, n.y, Math.cos(ang) * spd * n.speedMult * dt, Math.sin(ang) * spd * n.speedMult * dt, n.radius, n.canClimb);
        n.x = r2.x;
        n.y = r2.y;
      } else {
        n.x = r.x;
        n.y = r.y;
      }
      dx = n.moveX;
      if (Math.abs(dx) > 0.15) n.facing = dx > 0 ? 1 : -1;
    }

    // Stuck detection
    if (n.speedMult > 0) {
      n.stuckT += dt;
      if (n.stuckT > 1.2) {
        const moved = Math.hypot(n.x - n.lastPos.x, n.y - n.lastPos.y);
        if (moved < 6) {
          n.side *= -1;
          n.goal = null;
          if (n.state === 'seekWater' || n.state === 'seekFood') n.setState('wander');
        }
        n.stuckT = 0;
        n.lastPos.x = n.x;
        n.lastPos.y = n.y;
      }
    }
  }

  private behave(n: Npc, dt: number): void {
    const now = this.env.now();
    const P = this.env.player;
    const moveTo = (x: number, y: number, mult: number) => {
      const dx = x - n.x;
      const dy = y - n.y;
      const d = Math.hypot(dx, dy) || 1;
      n.moveX = dx / d;
      n.moveY = dy / d;
      n.speedMult = mult;
      return d;
    };
    switch (n.state) {
      case 'wander': {
        if (n.pause > 0) {
          n.pause -= dt;
          break;
        }
        if (!n.goal) {
          for (let k = 0; k < 6; k++) {
            const a = Math.random() * Math.PI * 2;
            const r = 40 + Math.random() * 180;
            const gx = n.homeX + Math.cos(a) * r;
            const gy = n.homeY + Math.sin(a) * r;
            if (isPositionFree(this.wv.data, gx, gy, n.radius, n.canClimb)) {
              n.goal = { x: gx, y: gy };
              break;
            }
          }
          if (!n.goal) n.pause = 1;
          break;
        }
        if (moveTo(n.goal.x, n.goal.y, 0.42) < 12) {
          n.goal = null;
          n.pause = 1 + Math.random() * 3;
        }
        break;
      }
      case 'seekWater': {
        if (!n.goal) {
          const s = this.wv.shoreGrid.nearest(n.x, n.y, 1400, () => true);
          if (!s) {
            n.thirst = 100;
            n.setState('wander');
            break;
          }
          n.goal = { x: s.x, y: s.y };
        }
        if (moveTo(n.goal.x, n.goal.y, 0.62) < 22) n.setState('drink');
        break;
      }
      case 'drink':
        if (n.stateT > 3) {
          n.thirst = 100;
          n.setState('wander');
          n.homeX = n.x;
          n.homeY = n.y;
        }
        break;
      case 'seekFood': {
        if (!n.food) {
          this.findFood(n);
          if (n.state !== 'seekFood') break;
        }
        const f = n.food;
        if (!f || f.portions <= 0) {
          n.food = null;
          break;
        }
        if (moveTo(f.x, f.y, 0.6) < n.radius + 16) {
          const keep = n.food;
          n.setState('eat');
          n.food = keep;
        }
        break;
      }
      case 'eat': {
        if (n.stateT > 2.5) {
          const f = n.food;
          if (f && f.portions > 0) {
            if (n.foodIsCarcass) this.wv.consumeCarcass(f as Carcass);
            else if (Math.random() < BALANCE.npc.grazeConsumeChance) this.wv.consume(f as ResourceNode, now);
            n.hunger = Math.min(100, n.hunger + 55);
          }
          n.setState('wander');
          n.homeX = n.x;
          n.homeY = n.y;
        }
        break;
      }
      case 'rest':
        if (n.stateT > n.restLen) n.setState('wander');
        break;
      case 'flee': {
        const th = n.target;
        if (!th || !th.alive) {
          n.setState('wander');
          break;
        }
        const dx = n.x - th.x;
        const dy = n.y - th.y;
        const d = Math.hypot(dx, dy) || 1;
        // Bias the escape direction toward home so creatures don't flee off the map edge forever.
        const hx = n.homeX - n.x;
        const hy = n.homeY - n.y;
        const hd = Math.hypot(hx, hy) || 1;
        const w = hd > 400 ? 0.35 : 0.1;
        const ex = dx / d + (hx / hd) * w;
        const ey = dy / d + (hy / hd) * w;
        const el = Math.hypot(ex, ey) || 1;
        n.moveX = ex / el;
        n.moveY = ey / el;
        n.speedMult = n.def.temperament === 'prey' ? 1.55 : 1.3;
        if (n.stateT > 4 && d > Math.max(n.def.fleeRange, 120) * 1.6) {
          n.setState(n.hp < n.maxHp * 0.5 ? 'rest' : 'wander');
          n.restLen = 15;
          n.homeX = n.x;
          n.homeY = n.y;
        }
        break;
      }
      case 'hunt':
      case 'fight': {
        const tg = n.target;
        if (!tg || !tg.alive) {
          n.setState('wander');
          break;
        }
        if (tg === P && P.inShelter && !(P.evolving && n.def.temperament !== 'neutral')) {
          n.giveUp.set(tg.uid, now + 12);
          if (n.lastAttacker === tg) n.lastAttacker = null;
          n.setState('wander');
          break;
        }
        const fromHome = Math.hypot(n.x - n.chaseX, n.y - n.chaseY);
        const leash = (n.def.leash || 300) * (n.elite || n.enraged ? 1.4 : 1);
        if (fromHome > leash || (n.state === 'hunt' && n.stateT > BALANCE.npc.giveUpChaseSec)) {
          n.giveUp.set(tg.uid, now + 20);
          n.setState('wander');
          n.goal = { x: n.chaseX, y: n.chaseY };
          if (n.lastAttacker === tg) n.lastAttacker = null;
          break;
        }
        const d = Math.hypot(tg.x - n.x, tg.y - n.y);
        const gap = d - tg.radius - n.radius;
        const dir = Math.atan2(tg.y - n.y, tg.x - n.x);
        const H = n.def.heavy;
        if (H && n.heavyCd <= 0 && n.atkCd <= 0) {
          const ok = H.kind === 'slam' ? d < H.radius * 0.85 : gap > 30 && gap < H.range * 0.85;
          if (ok) {
            this.startWindup(n, 'heavy', dir);
            break;
          }
        }
        const R = n.def.ranged;
        if (R && n.rangedCd <= 0 && n.atkCd <= 0 && gap > 50 && gap < R.range * 0.9) {
          this.startWindup(n, 'ranged', dir);
          break;
        }
        if (R?.kite && gap < 70 && n.rangedCd > 0.6) {
          moveTo(n.x * 2 - tg.x, n.y * 2 - tg.y, 0.9);
          break;
        }
        if (gap <= n.def.attack.range * 0.8) {
          if (n.atkCd <= 0) this.startWindup(n, 'basic', dir);
          n.facing = tg.x > n.x ? 1 : -1;
        } else {
          moveTo(tg.x, tg.y, n.state === 'hunt' ? 1.12 : 1);
        }
        break;
      }
      default:
        break;
    }
  }

  private startWindup(n: Npc, kind: WindupKind, dir: number): void {
    const H = n.def.heavy;
    const R = n.def.ranged;
    const nearPlayer = Math.hypot(this.env.player.x - n.x, this.env.player.y - n.y) < 500;
    if (kind === 'heavy' && H) {
      n.windup = { kind, t: H.windupSec, dir };
      this.combat.telegraph({ ownerUid: n.uid, kind: H.kind, x: n.x, y: n.y, dir, range: H.range, radius: H.radius, t: H.windupSec, total: H.windupSec });
      if (nearPlayer) this.env.audio.play('telegraph');
    } else if (kind === 'ranged' && R) {
      n.windup = { kind, t: R.windupSec, dir };
      this.fx.burst(n.x, n.y - n.radius, 'spark', 6, { speed: 40, life: 0.4, tint: R.color });
    } else {
      n.windup = { kind: 'basic', t: n.def.attack.windupSec, dir };
    }
    n.facing = Math.cos(dir) >= 0 ? 1 : -1;
  }

  private releaseAttack(n: Npc): void {
    const w = n.windup;
    n.windup = null;
    if (!w) return;
    const p = n.power * (this.env.bloodMoon() ? BALANCE.threat.bloodMoonPower : 1);
    if (w.kind === 'heavy' && n.def.heavy) {
      const H = n.def.heavy;
      const opts = { status: H.status ?? n.meleeStatus() };
      n.heavyCd = H.cooldownSec * n.sc.atkCdMult;
      n.atkCd = 0.8;
      if (H.kind === 'slam') {
        this.combat.circle(n, n.x, n.y, H.radius, p, H.dmgMult, H.knockback, 0.12, false, 0xff6a3a, opts);
        this.fx.ring(n.x, n.y, 0xffa060, 10, H.radius, 0.45, 4);
        this.fx.burst(n.x, n.y, 'dust', 14, { speed: 160, life: 0.6 });
        if (Math.hypot(this.env.player.x - n.x, this.env.player.y - n.y) < 600) {
          this.scene.cameras.main.shake(180, 0.006);
          this.env.audio.play('hit');
        }
      } else {
        const dur = 0.28;
        const sp = H.range / dur;
        n.dash = { vx: Math.cos(w.dir) * sp, vy: Math.sin(w.dir) * sp, t: dur };
        this.combat.circle(n, n.x, n.y, H.radius, p, H.dmgMult, H.knockback, dur, true, 0xff6a3a, opts);
        this.fx.burst(n.x, n.y, 'dust', 6, { speed: 80, life: 0.4 });
      }
    } else if (w.kind === 'ranged' && n.def.ranged) {
      const R = n.def.ranged;
      n.rangedCd = R.cooldownSec * n.sc.atkCdMult;
      n.atkCd = 0.6;
      const count = R.count + (n.enraged ? 2 : 0);
      const spread = (((R.spreadDeg || 0) + (n.enraged ? 12 : 0)) * Math.PI) / 180;
      for (let i = 0; i < count; i++) {
        const a = count === 1 ? w.dir : w.dir - spread + (2 * spread * i) / (count - 1);
        this.combat.projectile(n, n.x + Math.cos(a) * n.radius, n.y - n.radius * 0.6, a, R.speed, R.range, R.radius, p, R.dmgMult, R.knockback, R.color, 'drop', { status: R.status ?? null });
      }
    } else {
      const A = n.def.attack;
      n.atkCd = A.cooldownSec * n.sc.atkCdMult;
      this.combat.arc(n, w.dir, A.arcDeg, A.range + n.radius, p, A.dmgMult, A.knockback, A.activeSec, 0xffffff, { status: n.meleeStatus() });
    }
  }

  private render(n: Npc, _dt: number): void {
    n.sprite.setPosition(n.x, n.y);
    n.sprite.setFlipX(n.facing < 0);
    n.sprite.setDepth(n.y);
    n.shadow.setPosition(n.x, n.y + 1).setDepth(n.y - 30);
    let anim = 'idle';
    if (n.status.stunned) anim = 'hurt';
    else if (n.dash || n.windup) anim = 'attack';
    else if (n.state === 'eat' || n.state === 'drink') anim = 'eat';
    else if (n.state === 'rest') anim = this.env.isNight() ? 'sleep' : 'rest';
    else if (n.speedMult > 0.01) anim = 'walk';
    if (n.iframes > 0 && n.flash > 0) anim = 'hurt';
    n.play(anim);
    if (n.sprite.anims.currentAnim && anim === 'walk') n.sprite.anims.timeScale = 0.6 + n.speedMult * 0.8;
    else n.sprite.anims.timeScale = 1;
    const now = this.scene.time.now;
    const st = n.status.list()[0];
    if (n.flash > 0) n.sprite.setTintFill(0xffffff);
    else if (n.windup && n.windup.kind !== 'basic') n.sprite.setTint(Math.floor(now / 90) % 2 ? 0xff8080 : 0xffffff);
    else if (st && Math.floor(now / 160) % 2) n.sprite.setTint(STATUS_INFO[st].tint);
    else if (n.enraged) n.sprite.setTint(Math.floor(now / 200) % 2 ? 0xff6a5a : 0xffb0a0);
    else if (n.affix) n.sprite.setTint(AFFIXES[n.affix].tint);
    else n.sprite.clearTint();
    if (st === 'burn' && Math.random() < 0.25) this.fx.burst(n.x, n.y - n.radius, 'spark', 1, { speed: 30, life: 0.4, tint: 0xff8a3a });
    else if (st === 'poison' && Math.random() < 0.2) this.fx.burst(n.x, n.y - n.radius, 'bubble', 1, { speed: 20, life: 0.5, tint: 0x9ae06a });
    else if (st === 'stun' && Math.random() < 0.2) this.fx.burst(n.x, n.y - n.radius * 2.2, 'star', 1, { speed: 25, life: 0.4 });
  }

  drawBars(g: Phaser.GameObjects.Graphics, playerScore: number, debug: boolean): void {
    const P = this.env.player;
    for (const n of this.npcs) {
      if (!n.alive || !n.sprite.visible) continue;
      if (debug) {
        g.lineStyle(1, 0x00ffff, 0.8);
        g.strokeCircle(n.x, n.y, n.radius);
      }
      const special = n.elite || n.def.unique;
      const engaged = n.target === P && (n.state === 'hunt' || n.state === 'fight');
      const show = n.hbTimer > 0 || engaged || (special && Math.hypot(n.x - P.x, n.y - P.y) < 420);
      if (!show) continue;
      const w = Math.max(28, n.radius * 2.4);
      const y = n.y - n.def.art.size * 2 * 0.85 * (n.elite ? 1.12 : 1) - 6;
      const ratio = n.score / Math.max(1, playerScore);
      const col = ratio > 1.3 ? 0xff4a4a : ratio > 0.7 ? 0xffc04a : 0x7ad05a;
      g.fillStyle(0x10131a, 0.85);
      g.fillRect(n.x - w / 2 - 1, y - 1, w + 2, 6);
      g.fillStyle(col, 1);
      g.fillRect(n.x - w / 2, y, w * (n.hp / n.maxHp), 4);
      if (special) {
        g.lineStyle(1, n.def.unique ? 0xff5a4a : 0xffd84a, 1);
        g.strokeRect(n.x - w / 2 - 1.5, y - 1.5, w + 3, 7);
        g.fillStyle(n.def.unique ? 0xff5a4a : 0xffd84a, 1);
        const sx = n.x - w / 2 - 7;
        const sy = y + 2;
        g.fillTriangle(sx - 3, sy, sx + 3, sy, sx, sy - 5);
        g.fillTriangle(sx - 3, sy - 3, sx + 3, sy - 3, sx, sy + 2);
      }
      if (engaged) {
        g.fillStyle(0xff3a3a, 1);
        g.fillTriangle(n.x - 4, y - 9, n.x + 4, y - 9, n.x, y - 3);
      }
    }
  }

  destroy(): void {
    this.npcs.forEach((n) => n.destroy());
    this.npcs = [];
    this.grid.clear();
  }

  static def(id: string): NpcDef {
    return NPCS[id];
  }
}
