import Phaser from 'phaser';
import { app, type GameStartData } from '../app';
import { BALANCE, expToNext } from '../config/balance';
import { formatClock, formatDuration } from '../core/math';
import { CONSUMABLES, isConsumable } from '../data/consumables';
import { FOODS, canEat } from '../data/foods';
import { MILESTONE_MAP } from '../data/milestones';
import { NPCS } from '../data/npcs';
import { primaryQuest } from '../data/quests';
import { LAST_REALM, REALMS, REALM_PLAYER_BONUS, realmOf, realmSeed } from '../data/realms';
import { COLOR_VARIANTS, SHOP } from '../data/shop';
import { SKILLS } from '../data/skills';
import { getSpecies } from '../data/species';
import type { BuffDef, SkillDef, StatusKind } from '../data/types';
import { audio } from '../systems/audio';
import { noteBestiary } from '../systems/bestiary';
import { addToInventory, applyHeal, decaySatiation, drinkWater, eatFood, eatFromSlot, hasInventorySpace, takeConsumable } from '../systems/diet';
import { EvolutionProcess, canEvolve, completeEvolution, evolutionChecks, evolutionDuration } from '../systems/evolution';
import { SKILL_SLOTS, computeStats, createPlayerState, displayName, ensureLives, finalFormIndex, formOf, isFinalForm, sanitizePlayerName, type PlayerState } from '../systems/playerState';
import { addExp, addMaturity, isMaturityFull, killReward } from '../systems/progression';
import { SLOT_KEYS, addMastery, equipSkill, evolvePending, slotUnlocked, syncLearned, type SkillEvolution } from '../systems/skills';
import { STATUS_INFO } from '../systems/status';
import { canDefeatNpc, isBloodMoonNight } from '../systems/threat';
import { deleteSave, writeSave, type SaveData } from '../systems/save';
import { DEBUG_ENABLED, saveSettings } from '../systems/settings';
import { maxStamina, tickSurvival } from '../systems/survival';
import { WorldClock, WeatherSystem, WEATHER_NAMES } from '../systems/timeWeather';
import { eventModsForNight, type EventMods } from '../systems/worldEvents';
import { basicAttackIconUrl, dodgeIconUrl, formatSkillTip, restIconUrl } from '../gfx/skillIcons';
import { Minimap } from '../ui/Minimap';
import { esc, type HudData } from '../ui/UI';
import { findDrinkableWater, isPositionFree } from '../world/collision';
import { findPath } from '../world/pathfind';
import { BIOME_IDS, BIOME_NAMES, type WorldData } from '../world/tiles';
import { generateWorld } from '../world/worldGen';
import { CombatSystem, type Creature, type DamageEvent } from '../game/CombatSystem';
import { Effects, FX_DEPTH } from '../game/Effects';
import { Lighting } from '../game/Lighting';
import { AI_STATE_NAMES, Npc, NpcManager, type PlayerInfo } from '../game/Npcs';
import { Player, type PlayerInput } from '../game/Player';
import { RemotePlayer } from '../game/RemotePlayer';
import type { Carcass, ResourceNode } from '../game/WorldView';
import { WorldView } from '../game/WorldView';
import type { NetMsg, PlayerStateMsg } from '../net/room';
import { Renderer3D, webglAvailable } from '../render3d/Renderer3D';

const SUPPORT_RANGE = 120;
const SUPPORT_HPS = 5;
const MULTI_SEND_HZ = 10;

const T = BALANCE.tile;

type KeyName =
  | 'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SHIFT' | 'SPACE' | 'E' | 'F' | 'Q' | 'R' | 'T' | 'M' | 'TAB' | 'ESC'
  | 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE' | 'SIX' | 'F6' | 'F7' | 'F8' | 'F9';

interface Interaction {
  html: string;
  run: () => void;
}

export class GameScene extends Phaser.Scene {
  private world!: WorldData;
  private wv!: WorldView;
  private player!: Player;
  private npcs!: NpcManager;
  private combat!: CombatSystem;
  private fx!: Effects;
  private lighting!: Lighting;
  private clock!: WorldClock;
  private weather!: WeatherSystem;
  private evo = new EvolutionProcess();
  private minimap!: Minimap;
  private overlayG!: Phaser.GameObjects.Graphics;
  private r3d: Renderer3D | null = null;
  private render3d = () => this.r3d?.render();
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private seed = '';
  private realm = 0;
  private guardianDown = false;

  private paused = false;
  private dead = false;
  /** Soft-death in progress (waiting to respawn at a heal pillar). */
  private dying = false;
  private started = false;
  private attackQueued = false;
  private tapAim = false;
  private moveAim = 0;
  private lastCombatAt = -99;
  private lastDamageCause = '';
  private autosaveT = 0;
  private hudT = 0;
  private bandT = 0;
  private camShift = 0;
  private camShiftTarget = 0;
  private minimapT = 0;
  private charT = 0;
  private exploreT = 0;
  private lastSector = -1;
  private lastTarget: Npc | null = null;
  private lastTargetAt = -99;
  private warned = { hunger: false, thirst: false };
  private prevRestMode = 'awake';
  private restHealFxT = 0;
  private padHealFxT = 0;
  private nearHealpad = false;
  private interaction: Interaction | null = null;
  /** Navigation pin from the full-map UI (world pixels). */
  private navTarget: { x: number; y: number } | null = null;
  private navPath: { x: number; y: number }[] = [];
  private navPathT = 0;
  private debug = { hitbox: false, god: false };
  private discovered = new Set<number>();
  private bloodWarnedNight = -1;
  private bloodActive = false;
  private bloodSurvivedNight = -1;
  private eventWarnedNight = -1;
  private bestiaryScanT = 0;
  private remotes = new Map<string, RemotePlayer>();
  private multiOff: (() => void) | null = null;
  private multiJoinOff: (() => void) | null = null;
  private multiSendT = 0;
  private multiMode = false;

  private onResize = (size: Phaser.Structs.Size) => {
    this.cameras.main.setSize(size.width, size.height);
    this.lighting?.resize(size.width, size.height);
  };
  private onVisibility = () => {
    if (document.hidden && this.started && !this.dead && !this.paused) this.openPause();
  };
  private onBlur = () => this.input.keyboard?.resetKeys();
  private onUnload = () => this.saveNow(false);

  constructor() {
    super('Game');
  }

  init(): void {
    this.evo = new EvolutionProcess();
    this.paused = false;
    this.dead = false;
    this.dying = false;
    this.started = false;
    this.attackQueued = false;
    this.tapAim = false;
    this.moveAim = 0;
    this.lastCombatAt = -99;
    this.autosaveT = 0;
    this.bandT = 0;
    this.camShift = 0;
    this.camShiftTarget = 0;
    this.lastSector = -1;
    this.lastTarget = null;
    this.warned = { hunger: false, thirst: false };
    this.prevRestMode = 'awake';
    this.interaction = null;
    this.debug = { hitbox: false, god: false };
    this.bloodWarnedNight = -1;
    this.bloodActive = false;
    this.bloodSurvivedNight = -1;
    this.eventWarnedNight = -1;
    this.bestiaryScanT = 0;
    this.remotes.clear();
    this.multiOff = null;
    this.multiJoinOff = null;
    this.multiSendT = 0;
    this.multiMode = false;
  }

  private currentEvent(): EventMods {
    return eventModsForNight(this.seed, this.nightIndex, this.clock.isNight);
  }

  /** Night counter: the night that starts on day N is night N. */
  private get nightIndex(): number {
    return this.clock.hour >= 12 ? this.clock.day : this.clock.day - 1;
  }

  private get bloodMoon(): boolean {
    return this.clock.isNight && isBloodMoonNight(this.nightIndex);
  }

  create(data: GameStartData): void {
    const save: SaveData | undefined = data.mode !== 'new' ? data.save : undefined;
    const travel = data.mode === 'travel';
    this.seed = save ? save.seed : (data.seed as string);
    this.realm = save ? save.player.realm : 0;
    this.guardianDown = !!save && !travel && save.world.guardianDown;
    this.world = generateWorld(realmSeed(this.seed, this.realm), this.realm);
    this.wv = new WorldView(this, this.world);
    if (save && !travel) this.wv.applySave(save.world);

    const sx = this.world.spawn.tx * T + T / 2;
    const sy = this.world.spawn.ty * T + T / 2;
    const state: PlayerState = save ? save.player : createPlayerState(data.speciesId as string, sx, sy);
    if (!save && data.playerName) state.name = sanitizePlayerName(data.playerName);
    if (!state.name) state.name = '';
    ensureLives(state);
    if (travel) {
      state.x = sx;
      state.y = sy;
      state.lives = BALANCE.lives.max;
    }
    this.clock = new WorldClock(save ? save.world.time : 0);
    this.weather = new WeatherSystem(this.seed);
    if (save) this.weather.restore(save.world.weather, save.world.weatherRemaining, save.world.weatherRolls);
    this.discovered = new Set(state.discoveredSectors);

    this.fx = new Effects(this);
    this.combat = new CombatSystem(this, this.fx, this.world, (x, y, r) => this.creaturesNear(x, y, r), (e) => this.onDamage(e));
    this.player = new Player(this, state);
    this.player.onSkillCast = (sk) => {
      if (sk.kind === 'buff') this.gainMastery(sk, BALANCE.combat.masteryPerHit);
    };
    this.npcs = new NpcManager(this, this.wv, this.combat, this.fx, {
      now: () => this.clock.time,
      hour: () => this.clock.hour,
      isNight: () => this.clock.isNight,
      days: () => this.player.state.stats.daysSurvived,
      bloodMoon: () => this.bloodMoon,
      threatBoost: () => {
        const e = this.currentEvent();
        return { power: e.power, detect: e.detect, population: e.population, eliteBonus: e.eliteBonus };
      },
      realm: this.realm,
      player: this.player,
      audio,
      allies: () => [...this.remotes.values()] as PlayerInfo[],
    });
    this.npcs.bossDefeatedAt = save && !travel ? { ...save.world.bosses } : {};
    this.npcs.onRemoved = (n) => {
      if (this.lastTarget === n) this.lastTarget = null;
    };
    this.npcs.onRespawned = (n) => {
      if (Math.hypot(n.x - this.player.x, n.y - this.player.y) < 520) {
        app.ui.toast(`${n.displayName} xuất hiện lại.`, '');
      }
    };
    this.wv.onResourceRegrow = (node) => {
      this.fx.burst(node.x, node.y - 8, 'leaf', 10, { speed: 60, life: 0.55, tint: 0x7dffb0 });
      this.fx.pulse(node.x, node.y, 0x7dffb0, 4, 28, 0.4, 0.22);
    };
    this.wv.onHealpadReady = (pad) => {
      this.fx.burst(pad.obj.x, pad.obj.y - 16, 'star', 10, { speed: 70, life: 0.55, tint: 0x5ef0a0 });
      this.fx.pulse(pad.obj.x, pad.obj.y, 0x5ef0a0, 6, 36, 0.45, 0.25);
    };
    this.npcs.onEnrage = (n) => {
      if (Math.hypot(n.x - this.player.x, n.y - this.player.y) < 780) {
        app.ui.toast(`${n.def.name} nổi điên! Tấn công nhanh và dữ dội hơn.`, 'bad');
        this.cameras.main.shake(380, n.def.guardian || n.def.id === 'hu_khong_than' ? 0.016 : 0.011);
        this.fx.burst(n.x, n.y, 'dust', 24, { speed: 200, life: 0.7, gravity: 160 });
        this.fx.pulse(n.x, n.y, 0xff6a5a, 20, 120, 0.55, 0.25);
      }
    };
    this.npcs.initialPopulate();

    this.lighting = new Lighting(this);
    this.lighting.realmTint = realmOf(this.realm).tint;
    this.wv.setPortalOpen(this.guardianDown);
    this.overlayG = this.add.graphics().setDepth(FX_DEPTH);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.world.w * T, this.world.h * T);
    cam.startFollow(this.player.sprite, true, 0.14, 0.14);
    cam.setRoundPixels(true);

    this.r3d = null;
    if (app.settings.graphics3d && webglAvailable()) {
      try {
        this.r3d = new Renderer3D({
          scene: this,
          world: this.world,
          wv: this.wv,
          player: this.player,
          npcs: this.npcs,
          remotes: () => this.remotes.values(),
        });
      } catch (e) {
        console.error('3D view unavailable, using 2D', e);
        this.r3d = null;
      }
    }
    if (this.r3d) {
      this.wv.animateWater = false;
      this.lighting.setScreenTint(false);
      this.game.events.on(Phaser.Core.Events.POST_RENDER, this.render3d);
    } else cam.setBackgroundColor('#1b2a1b');

    this.setupInput();

    this.minimap = new Minimap(
      this.world,
      this.wv.shelters,
      this.wv.shrine,
      this.wv.healpads.map((h) => h.obj),
    );
    app.ui.hideScreens();
    app.ui.closeOverlay();
    app.ui.showHud(true);
    app.ui.mountMinimap(this.minimap.canvas);
    this.minimap.canvas.title = 'Chạm để mở bản đồ lớn';
    const openMap = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.dead || app.ui.modalOpen) return;
      this.openWorldMap();
    };
    this.minimap.canvas.addEventListener('pointerdown', openMap);
    this.minimap.canvas.addEventListener('click', openMap);
    // Wrap also receives clicks (CSS pointer-events); canvas may miss some touch browsers.
    const wrap = this.minimap.canvas.parentElement;
    wrap?.addEventListener('pointerdown', openMap);
    wrap?.addEventListener('click', openMap);
    app.ui.evoProgress(false);

    audio.setSettings(app.settings);
    audio.startMusic();

    this.scale.on('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('beforeunload', this.onUnload);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());

    this.started = true;
    if (DEBUG_ENABLED) (window as unknown as { __scene?: GameScene }).__scene = this;
    const realm = realmOf(this.realm);
    this.multiMode = !!(data.multi && app.multiRoom?.isOpen);
    if (data.multi && !app.multiRoom?.isOpen) {
      app.ui.toast('Mất kết nối phòng mạng — chơi đơn.', 'bad');
    }
    if (this.multiMode) {
      const room = app.multiRoom!;
      // Guests spawn at the host's last known position so they can actually meet.
      const h = Math.imul(room.peerId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) + 13, 2654435761) >>> 0;
      const ang = (h / 4294967296) * Math.PI * 2;
      const ox = Math.cos(ang) * 56;
      const oy = Math.sin(ang) * 56;
      if (room.meetValid) {
        this.player.x = room.meetX + ox;
        this.player.y = room.meetY + oy;
      } else {
        this.player.x += ox;
        this.player.y += oy;
      }
      room.setMeetPoint(this.player.x, this.player.y);
      this.setupMultiplayer();
      app.ui.setMultiBanner(`Phòng ${room.code} · ${room.role === 'host' ? 'Chủ phòng' : 'Khách'} · cùng loài = đồng minh`);
      app.ui.toast(`Chơi mạng — mã phòng ${room.code}. Người chơi khác hiện chấm vàng trên bản đồ.`, 'evo');
    } else app.ui.setMultiBanner(null);

    if (!save) {
      app.ui.toast(`Chào mừng, ${displayName(state)}! Hãy tìm thức ăn và nước.`, 'good');
      if (!this.multiMode) app.ui.toast(`Tiến hóa tới dạng cuối rồi tìm Cổng Cổ (ô tím trên bản đồ) để thách đấu Boss Giữ Cổng.`);
      this.saveNow(false);
    } else if (travel) {
      app.ui.toast(`Vùng đất ${this.realm + 1}/${REALMS.length}: ${realm.name} — ${realm.desc}`, 'evo');
      this.saveNow(false);
    } else app.ui.toast(`Đã tải bản lưu — ${realm.name} (${this.realm + 1}/${REALMS.length}).`, 'good');
    this.checkExploration(true);
    (document.getElementById('game-root') as HTMLElement).focus();
  }

  // ------------------------------------------------------------------ input

  private setupInput(): void {
    const kb = this.input.keyboard as Phaser.Input.Keyboard.KeyboardPlugin;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,SPACE,E,F,Q,R,T,M,TAB,ESC,ONE,TWO,THREE,FOUR,FIVE,SIX,F6,F7,F8,F9', true) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      audio.unlock();
      // On phones the on-screen Attack button is the only intentional attack input —
      // canvas taps were easy to hit by accident and also triggered Safari zoom.
      if (app.ui.touch.enabled && p.wasTouch) return;
      if ((p.wasTouch || p.leftButtonDown()) && !app.ui.modalOpen && !this.paused) {
        this.attackQueued = true;
        this.tapAim = true;
      }
    });
    app.ui.onInvTap = (i) => {
      if (this.paused || this.dead || !this.player.alive || this.evo.active || i >= this.player.state.slots) return;
      // Allow eating from the character panel bag; block other modals.
      if (app.ui.modalOpen && app.ui.openPanel !== 'char') return;
      this.eatSlot(i);
      if (app.ui.openPanel === 'char') app.ui.refreshChar();
    };
    app.ui.onPromptTap = () => {
      if (!app.ui.modalOpen && !this.paused && this.interaction && !this.evo.active) this.interaction.run();
    };
  }

  private just(k: KeyName): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keys[k]);
  }

  private readInput(): PlayerInput {
    const k = this.keys;
    const T = app.ui.touch;
    const blocked = app.ui.modalOpen || this.paused || this.dead;
    let mx = 0;
    let my = 0;
    if (!blocked) {
      if (k.A.isDown || k.LEFT.isDown) mx -= 1;
      if (k.D.isDown || k.RIGHT.isDown) mx += 1;
      if (k.W.isDown || k.UP.isDown) my -= 1;
      if (k.S.isDown || k.DOWN.isDown) my += 1;
      if (mx === 0 && my === 0 && T.enabled) {
        mx = T.mx;
        my = T.my;
      }
    }
    if (mx !== 0 || my !== 0) this.moveAim = Math.atan2(my, mx);
    const q = this.just('Q') || T.take('q');
    const r = this.just('R') || T.take('r');
    const t = this.just('T') || T.take('t');
    const skill = blocked ? -1 : q ? 0 : r ? 1 : t ? 2 : -1;
    const dodge = this.just('SPACE') || T.take('dodge');
    const attacking = !blocked && (this.attackQueued || T.attackHeld);
    const lock = this.lockedTarget(skill >= 0 ? 560 : 240);
    let aim: number;
    // Skills (and locked basic attacks) snap to the combat target; otherwise mouse / touch auto-aim.
    if (lock && (skill >= 0 || attacking || T.enabled)) {
      aim = this.aimAt(lock);
    } else if (T.enabled && !this.tapAim) {
      aim = this.autoAim();
    } else {
      const ptr = this.input.activePointer;
      const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      aim = Math.atan2(wp.y - (this.player.y - this.player.radius * 0.6), wp.x - this.player.x);
    }
    const inp: PlayerInput = {
      mx,
      my,
      sprint: !blocked && (k.SHIFT.isDown || (T.enabled && T.sprinting)),
      aim,
      attack: attacking,
      skill,
      dodge: !blocked && dodge,
    };
    this.attackQueued = false;
    this.tapAim = false;
    return inp;
  }

  /** Soft-locked enemy from recent hits; cleared when dead, timed out, or too far. */
  private lockedTarget(maxDist = 520): Npc | null {
    const n = this.lastTarget;
    if (!n?.alive) return null;
    if (this.clock.time - this.lastTargetAt > 10) return null;
    if (Math.hypot(n.x - this.player.x, n.y - this.player.y) > maxDist) return null;
    return n;
  }

  private aimAt(c: Creature): number {
    const P = this.player;
    return Math.atan2(c.y - c.radius * 0.6 - (P.y - P.radius * 0.6), c.x - P.x);
  }

  /** Touch aiming: nearest creature in reach (last target first), else the movement direction. */
  private autoAim(): number {
    const P = this.player;
    const reach = 220;
    const lock = this.lockedTarget(reach);
    if (lock) return this.aimAt(lock);
    let best: Creature | null = null;
    let bd = reach;
    for (const n of this.creaturesNear(P.x, P.y, reach)) {
      if (n === P || !n.alive) continue;
      if (n.speciesId && n.speciesId === P.speciesId) continue;
      const d = Math.hypot(n.x - P.x, n.y - P.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (best) return this.aimAt(best);
    return this.moveAim;
  }

  private handleMenuKeys(): void {
    const T = app.ui.touch;
    if (this.just('ESC') || T.take('pause')) {
      if (app.ui.openPanel === 'pause') this.resume();
      else if (app.ui.openPanel) app.ui.closeOverlay();
      else if (!app.ui.modalOpen && !this.dead && !this.dying) this.openPause();
    }
    if ((this.just('TAB') || T.take('char')) && !this.paused && !this.dead && !this.dying) {
      if (app.ui.openPanel === 'char') app.ui.closeOverlay();
      else if (!app.ui.modalOpen) this.openCharPanel();
    }
  }

  // ------------------------------------------------------------------ main loop

  update(_time: number, delta: number): void {
    if (!this.started) return;
    this.handleMenuKeys();
    const dt = Math.min(delta, 50) / 1000;

    if (this.paused) {
      app.ui.touch.endFrame();
      this.drawOverlay();
      this.r3d?.hideFrom2D();
      return;
    }

    const P = this.player;
    const S = P.state;

    // --- time & weather ---
    const dawns = this.clock.update(dt);
    for (let i = 0; i < dawns; i++) this.onDawn();
    if (this.weather.update(dt, this.clock.hour)) app.ui.toast(`Thời tiết: ${WEATHER_NAMES[this.weather.state]}`);
    this.updateWorldEvents(dt);

    // --- one-shot keys (gameplay) ---
    const blocked = app.ui.modalOpen || this.dead || this.dying;
    if (!blocked && P.alive) this.handleActionKeys();

    // --- player ---
    const input = this.readInput();
    if (this.evo.active && input.dodge) {
      this.interruptEvolution('Bạn đã hủy tiến hóa.');
      input.dodge = false;
    }
    P.inShelter = !!this.wv.shelterAt(P.x, P.y);
    P.evolving = this.evo.active;
    P.update(dt, input, {
      world: this.world,
      combat: this.combat,
      fx: this.fx,
      audio,
      now: this.clock.time,
      weather: this.weather.state,
      skillAim: () => {
        const lock = this.lockedTarget(560);
        return lock ? this.aimAt(lock) : null;
      },
    });

    if (P.alive) {
      const dot = P.status.tick(dt);
      if (dot.damage > 0) {
        const src = dot.source && dot.source !== P ? dot.source : null;
        this.lastDamageCause = dot.kind === 'poison' ? `Chết vì trúng độc${src instanceof Npc ? ` (${src.def.name})` : ''}.` : `Bị thiêu cháy${src instanceof Npc ? ` bởi ${src.def.name}` : ''}.`;
        this.combat.dotDamage(P, dot.damage, src, dot.kind === 'poison' ? '#b6f07a' : '#ffb46a');
      }
      P.rest.update(dt, S.fatigue);
      const inCombat = this.inCombat();
      const tick = tickSurvival(
        S,
        P.stats,
        P.form,
        dt,
        {
          moving: P.moving,
          sprinting: P.sprinting,
          inCombat,
          rest: P.rest,
          inShelter: P.inShelter,
          weather: this.weather.state,
          buffRegen: P.buff?.regen ?? 0,
          poisoned: P.status.has('poison'),
        },
        P.stam,
      );
      if (tick.outOfStamina) P.exhaustSprint();
      if (tick.starving) this.lastDamageCause = 'Chết đói.';
      else if (tick.dehydrated) this.lastDamageCause = 'Chết khát.';
      decaySatiation(S, dt);
      this.passiveGrowth(dt);
      this.applyHealpadAura(dt);
      this.trackRest(dt);
      this.warnNeeds();
      if (this.debug.god) S.hp = Math.max(S.hp, 1);
    }

    this.updateEvolution(dt);
    this.npcs.update(dt);
    this.scanBestiary(dt);
    this.combat.update(dt);
    this.tickMultiplayer(dt);
    this.wv.update(dt, this.clock.time, this.cameras.main);
    this.fx.update(dt);
    this.pickupCoins();

    this.exploreT -= dt;
    if (this.exploreT <= 0) {
      this.exploreT = 0.25;
      this.checkExploration(false);
    }

    this.interaction = P.alive && !blocked ? this.computeInteraction() : null;
    app.ui.setPrompt(this.evo.active ? '<kbd>Space</kbd>Hủy tiến hóa' : this.interaction ? this.interaction.html : P.rest.mode !== 'awake' ? '<kbd>F</kbd>Đứng dậy' : null);

    if (P.alive && S.hp <= 0) this.onPlayerDeath();

    this.lighting.update(dt, this.clock.hour, this.weather.state, P.x - this.cameras.main.worldView.x, P.y - this.player.radius - this.cameras.main.worldView.y, this.inFoggyBiome(), this.bloodMoon);
    audio.updateAmbient(dt, this.clock.isNight, this.weather.state === 'rain');
    audio.setRain(this.lighting.rainIntensity);
    this.drawOverlay();
    this.updateCameraShift(dt);
    this.syncNameTags();
    if (this.r3d) {
      this.r3d.setAmbient(this.lighting.ambient, this.lighting.night);
      this.r3d.hideFrom2D();
    }

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      app.ui.updateHud(this.hudData());
      app.ui.touch.setMarkerVisible(S.markersUnlocked);
      if (DEBUG_ENABLED) app.ui.setDebug(this.debugText());
    }
    this.minimapT -= dt;
    if (this.minimapT <= 0) {
      this.minimapT = 0.25;
      this.drawMinimap();
      if (app.ui.openPanel === 'map') app.ui.refreshWorldMap();
    }
    this.navPathT -= dt;
    if (this.navTarget && this.navPathT <= 0) {
      this.navPathT = 0.6;
      this.recomputeNavPath(false);
      if (Math.hypot(P.x - this.navTarget.x, P.y - this.navTarget.y) < 48) {
        this.navTarget = null;
        this.navPath = [];
        app.ui.toast('Đã tới điểm đánh dấu.', 'good');
      }
    }
    this.charT -= dt;
    if (this.charT <= 0) {
      this.charT = 0.4;
      app.ui.refreshChar();
    }
    this.autosaveT += dt;
    if (this.autosaveT >= BALANCE.autosaveIntervalSec && P.alive) {
      this.autosaveT = 0;
      this.saveNow(false);
    }
    app.ui.touch.endFrame();
  }

  private handleActionKeys(): void {
    const P = this.player;
    const T = app.ui.touch;
    const interact = this.just('E') || T.take('interact');
    const rest = this.just('F') || T.take('rest');
    if (interact && this.interaction && !this.evo.active) this.interaction.run();
    if (rest && !this.evo.active && !P.busy) {
      if (P.rest.toggle()) {
        if (P.rest.mode === 'resting') app.ui.toast(P.inShelter ? 'Nằm nghỉ trong nơi trú ẩn.' : 'Nằm nghỉ ngoài trời — hãy cẩn thận!');
      }
    }
    const slotKeys: KeyName[] = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
    slotKeys.forEach((k, i) => {
      if (this.just(k) && i < P.state.slots && !this.evo.active) this.eatSlot(i);
    });
    if (this.just('M') || T.take('marker')) this.toggleMarker();
    if (DEBUG_ENABLED) {
      if (this.just('F6')) this.debug.hitbox = !this.debug.hitbox;
      if (this.just('F7')) this.toggleGod();
      if (this.just('F8')) this.debugQuickEvolve();
      if (this.just('F9')) this.clock.time += BALANCE.time.dayLengthSec / 8;
    }
  }

  /** Forest canopy and swamp mist both shrink vision. */
  private inFoggyBiome(): boolean {
    const b = this.wv.biomeAt(this.player.x, this.player.y);
    return b === 1 || b === 4;
  }

  private updateWorldEvents(dt: number): void {
    const night = this.nightIndex;
    const mods = this.currentEvent();
    const active = this.bloodMoon;
    if (isBloodMoonNight(night) && this.clock.hour >= BALANCE.time.duskHour && this.bloodWarnedNight !== night) {
      this.bloodWarnedNight = night;
      if (!active) {
        app.ui.toast('🌕 Trăng Máu sắp mọc! Đêm nay thú dữ mạnh hơn và đông hơn — hãy tìm nơi trú ẩn.', 'bad');
        audio.play('warn');
      }
    }
    if (active && !this.bloodActive) {
      app.ui.toast(mods.toast || '🩸 Trăng Máu đã mọc! Thú săn mồi phát hiện bạn từ xa hơn.', 'bad');
      audio.play('telegraph');
      this.bloodSurvivedNight = night;
    }
    this.bloodActive = active;

    if (this.clock.isNight && mods.id !== 'none' && mods.id !== 'blood_moon' && this.eventWarnedNight !== night) {
      this.eventWarnedNight = night;
      app.ui.toast(`${mods.icon} ${mods.toast}`, mods.id === 'crystal_rain' ? 'good' : 'bad');
      audio.play('warn');
    }
    if (!this.clock.isNight) this.eventWarnedNight = -1;

    const aura = mods.playerAura;
    const P = this.player;
    if (aura && P.alive && this.clock.isNight && !P.inShelter && Math.random() < aura.chancePerSec * dt) {
      P.status.apply(aura.kind, aura.sec, aura.mag, null);
    }
  }

  private scanBestiary(dt: number): void {
    this.bestiaryScanT -= dt;
    if (this.bestiaryScanT > 0) return;
    this.bestiaryScanT = 0.55;
    const P = this.player;
    if (!P.alive) return;
    const S = P.state;
    for (const n of this.npcs.creaturesNear(P.x, P.y, 460)) {
      if (!n.alive) continue;
      const r = noteBestiary(S, n.def.id, 'seen');
      if (!r) continue;
      S.coins += r.coins;
      this.gainExp(r.exp);
      app.ui.toast(`📖 Ghi sổ: ${n.def.name} (+${r.coins} xu)`, 'good');
      break;
    }
  }

  private inCombat(): boolean {
    if (this.clock.time - this.lastCombatAt < BALANCE.combat.combatTimeoutSec) return true;
    const P = this.player;
    for (const n of this.npcs.creaturesNear(P.x, P.y, 260)) {
      if (n.alive && n.target === P && (n.state === 'hunt' || n.state === 'fight')) return true;
    }
    return false;
  }

  private creaturesNear(x: number, y: number, r: number): Creature[] {
    const out: Creature[] = this.npcs.creaturesNear(x, y, r);
    const P = this.player;
    if (P.alive && Math.hypot(P.x - x, P.y - y) <= r) out.push(P);
    for (const rem of this.remotes.values()) {
      if (rem.alive && Math.hypot(rem.x - x, rem.y - y) <= r) out.push(rem);
    }
    return out;
  }

  private setupMultiplayer(): void {
    const room = app.multiRoom;
    if (!room) return;
    this.multiOff = room.onMessage((msg, from) => this.onNetMsg(msg, from));
    this.multiJoinOff = room.onPeerJoin(() => {
      // A peer just connected (or we just linked to host) — shout our pose immediately.
      this.broadcastState(true);
    });
    // Announce ourselves so peers already in-game spawn our avatar.
    this.broadcastState(true);
    window.setTimeout(() => this.broadcastState(true), 400);
    window.setTimeout(() => this.broadcastState(true), 1200);
  }

  private onNetMsg(msg: NetMsg, _from: string): void {
    if (!this.started || !this.multiMode) return;
    if (msg.t === 'welcome') {
      // Late welcome updates (shouldn't happen) — keep meet point fresh for travel.
      if (msg.meet) app.multiRoom?.setMeetPoint(msg.x, msg.y);
      return;
    }
    if (msg.t === 'leave' || msg.t === 'peerGone') {
      this.removeRemote(msg.from);
      return;
    }
    if (msg.t === 'hello') {
      if (msg.from === app.multiRoom?.peerId) return;
      const x = Number.isFinite(msg.x) ? msg.x : this.player.x + 40;
      const y = Number.isFinite(msg.y) ? msg.y : this.player.y;
      this.ensureRemote(msg.from, msg.speciesId, x, y, msg.name);
      return;
    }
    if (msg.t === 'state') {
      if (msg.from === app.multiRoom?.peerId) return;
      if (!Number.isFinite(msg.x) || !Number.isFinite(msg.y)) return;
      const r = this.ensureRemote(msg.from, msg.speciesId, msg.x, msg.y, msg.name);
      r.applyState(msg);
      r.setAllyTint(msg.speciesId === this.player.speciesId);
      return;
    }
    if (msg.t === 'hit') {
      const room = app.multiRoom;
      if (!room || msg.to !== room.peerId) return;
      const P = this.player;
      if (!P.alive) return;
      const dmg = this.debug.god ? 0 : Math.max(1, Math.round(msg.damage));
      P.hp = Math.max(0, P.hp - dmg);
      P.kbx += msg.kx;
      P.kby += msg.ky;
      P.iframes = BALANCE.combat.playerIFramesSec;
      P.hurtFlash = 0.22;
      P.stun(BALANCE.combat.hitStunSec);
      P.cancelAction();
      this.lastCombatAt = this.clock.time;
      this.lastDamageCause = 'Bị người chơi khác hạ gục.';
      audio.play('hurt');
      app.ui.touch.buzz(18);
      this.cameras.main.shake(120, 0.004);
      this.fx.text(P.x, P.y - P.radius * 2 - 6, String(Math.round(msg.damage)), '#ff6a6a', 18);
      if (P.hp <= 0) this.onPlayerDeath();
      else this.broadcastState(true);
      return;
    }
    if (msg.t === 'guardian') {
      if (msg.from === app.multiRoom?.peerId) return;
      this.applyRemoteGuardian(msg.action, msg.x, msg.y);
    }
  }

  private ensureRemote(peerId: string, speciesId: string, x: number, y: number, name = ''): RemotePlayer {
    let r = this.remotes.get(peerId);
    if (!r) {
      r = new RemotePlayer(this, peerId, speciesId, x, y, name);
      r.setAllyTint(speciesId === this.player.speciesId);
      this.remotes.set(peerId, r);
      const dist = Math.hypot(x - this.player.x, y - this.player.y);
      const meters = Math.round(dist / 32);
      app.ui.toast(
        meters <= 8
          ? `${r.joinLabel} ở ngay gần bạn!`
          : `${r.joinLabel} đã vào — cách ~${meters} ô (chấm vàng trên bản đồ).`,
        speciesId === this.player.speciesId ? 'good' : 'bad',
      );
      this.broadcastState(true);
    } else if (name) r.setDisplayName(name);
    return r;
  }

  private removeRemote(peerId: string): void {
    const r = this.remotes.get(peerId);
    if (!r) return;
    r.destroy();
    this.remotes.delete(peerId);
    app.ui.toast('Một người chơi đã rời phòng.');
  }

  private broadcastState(force = false): void {
    const room = app.multiRoom;
    if (!room || !this.multiMode || !this.player) return;
    const P = this.player;
    const msg: PlayerStateMsg = {
      t: 'state',
      from: room.peerId,
      x: P.x,
      y: P.y,
      hp: P.hp,
      maxHp: P.maxHp,
      speciesId: P.speciesId,
      form: P.state.form,
      variant: P.state.colorVariant,
      anim: P.animName,
      facing: P.facing,
      alive: P.alive,
      name: displayName(P.state),
      evolving: this.evo.active,
    };
    // Host publishes a rendezvous point so late joiners spawn nearby.
    room.setMeetPoint(P.x, P.y);
    room.send(msg);
    if (force) {
      room.send({
        t: 'hello',
        from: room.peerId,
        speciesId: P.speciesId,
        form: P.state.form,
        variant: P.state.colorVariant,
        name: displayName(P.state),
        x: P.x,
        y: P.y,
      });
    }
  }

  private tickMultiplayer(dt: number): void {
    if (!this.multiMode) return;
    for (const r of this.remotes.values()) r.update(dt);

    // Ally support aura: slow heal while standing near same-species remotes.
    const P = this.player;
    if (P.alive) {
      let nearAlly = false;
      for (const r of this.remotes.values()) {
        if (!r.alive || r.speciesId !== P.speciesId) continue;
        if (Math.hypot(r.x - P.x, r.y - P.y) <= SUPPORT_RANGE) {
          nearAlly = true;
          break;
        }
      }
      if (nearAlly) P.hp = Math.min(P.maxHp, P.hp + SUPPORT_HPS * dt);
    }

    this.multiSendT -= dt;
    if (this.multiSendT <= 0) {
      this.multiSendT = 1 / MULTI_SEND_HZ;
      this.broadcastState(false);
    }
  }

  // ------------------------------------------------------------------ survival helpers

  private passiveGrowth(dt: number): void {
    const S = this.player.state;
    const m = BALANCE.maturity;
    if (S.hunger >= m.passiveMinNeeds && S.thirst >= m.passiveMinNeeds) addMaturity(S, m.passivePerSec * dt);
  }

  private trackRest(dt: number): void {
    const P = this.player;
    const mode = P.rest.mode;
    if (mode !== this.prevRestMode) {
      if (mode === 'sleeping') {
        app.ui.toast(P.inShelter ? 'Bạn đã ngủ say trong nơi trú ẩn.' : 'Bạn ngủ ngoài trời — kẻ săn mồi có thể tấn công!', P.inShelter ? 'good' : 'bad');
        if (P.inShelter) this.milestone('safe_sleep');
      } else if (this.prevRestMode === 'sleeping' && mode === 'resting') app.ui.toast('Bạn đã ngủ đủ, hết mệt mỏi.', 'good');
      else if (mode === 'resting') app.ui.toast('Nằm nghỉ — máu sẽ hồi dần nếu no đủ.', 'good');
      this.prevRestMode = mode;
      this.restHealFxT = 0;
    }
    if (P.rest.settled && P.hp > 0 && P.hp < P.maxHp && !this.nearHealpad) {
      this.restHealFxT -= dt;
      if (this.restHealFxT <= 0) {
        this.restHealFxT = 1.4;
        const need = BALANCE.survival.hpRegenRestMinNeeds;
        if (P.state.hunger >= need && P.state.thirst >= need && !this.inCombat()) {
          this.fx.text(P.x, P.y - P.radius * 2.3, '+máu', '#7dffb0', 11);
        }
      }
    }
  }

  private warnNeeds(): void {
    const S = this.player.state;
    const w = BALANCE.survival.warnLevel;
    if (S.hunger < w && !this.warned.hunger) {
      this.warned.hunger = true;
      app.ui.toast('Bạn đang đói! Hết độ no sẽ mất máu.', 'bad');
      audio.play('warn');
    } else if (S.hunger > w + 5) this.warned.hunger = false;
    if (S.thirst < w && !this.warned.thirst) {
      this.warned.thirst = true;
      app.ui.toast('Bạn đang khát! Hết nước sẽ mất máu.', 'bad');
      audio.play('warn');
    } else if (S.thirst > w + 5) this.warned.thirst = false;
  }

  private onDawn(): void {
    const S = this.player.state;
    if (!this.player.alive) return;
    S.stats.daysSurvived++;
    let exp = BALANCE.progression.expPerDay;
    let bonus = '';
    if (this.bloodSurvivedNight >= 0 && this.bloodSurvivedNight === this.clock.day - 1) {
      S.stats.bloodMoons++;
      exp *= 2;
      S.coins += 5;
      bonus = ' Vượt qua Trăng Máu: x2 EXP, +5 xu!';
      this.milestone('blood_moon');
    }
    this.bloodSurvivedNight = -1;
    const mat = addMaturity(S, BALANCE.maturity.perDay);
    this.gainExp(exp);
    app.ui.toast(`Bình minh ngày ${this.clock.day}: sống sót thêm một đêm (+${exp} EXP, +${mat.toFixed(0)} trưởng thành).${bonus}`, 'good');
    if (S.stats.daysSurvived >= 3) this.milestone('day_3');
    this.checkLearn();
  }

  private gainExp(amount: number): void {
    const S = this.player.state;
    const levels = addExp(S, amount);
    if (levels > 0) {
      const oldMax = this.player.stats.maxHp;
      this.player.recomputeStats();
      S.hp = Math.min(this.player.stats.maxHp, S.hp + (this.player.stats.maxHp - oldMax) + this.player.stats.maxHp * 0.2);
      app.ui.toast(`Lên cấp ${S.level}! Sức mạnh, máu và phòng thủ tăng.`, 'good');
      audio.play('levelup');
      this.fx.ring(this.player.x, this.player.y, 0xffe08a, 8, 60, 0.6, 3);
      this.fx.burst(this.player.x, this.player.y - 10, 'star', 12, { speed: 90, life: 0.8 });
      this.checkLearn();
    }
  }

  // ------------------------------------------------------------------ skills

  /** Learns any skill whose requirement was just met. */
  private checkLearn(): void {
    const S = this.player.state;
    for (const id of syncLearned(S)) {
      const slot = S.equipped.indexOf(id);
      const where = slot >= 0 ? `Đã gắn vào phím ${SLOT_KEYS[slot]}.` : 'Mở bảng nhân vật (Tab) để gắn vào ô chiêu.';
      app.ui.toast(`📜 Học được chiêu mới: ${SKILLS[id].name}! ${where}`, 'evo');
      audio.play('levelup');
      this.fx.ring(this.player.x, this.player.y, SKILLS[id].color, 6, 80, 0.7, 4);
      this.fx.burst(this.player.x, this.player.y - 12, 'star', 16, { speed: 110, life: 0.8, tint: SKILLS[id].color });
    }
  }

  private gainMastery(sk: SkillDef, amount: number): void {
    const S = this.player.state;
    const before = S.mastery[sk.id] ?? 0;
    const evo = addMastery(S, sk.id, amount);
    if (evo) this.announceSkillEvolution(evo);
    else if (sk.mastery && before < sk.mastery && (S.mastery[sk.id] ?? 0) >= sk.mastery) {
      app.ui.toast(`${sk.name} đã thành thạo tối đa — sẽ tiến hóa khi bạn đạt dạng ${(sk.evolveForm ?? 0) + 1}.`, 'good');
    }
  }

  private announceSkillEvolution(e: SkillEvolution): void {
    const a = SKILLS[e.from];
    const b = SKILLS[e.to];
    app.ui.toast(`⚡ Chiêu thức tiến hóa: ${a.name} ➜ ${b.name}!`, 'evo');
    audio.play('evolveDone');
    this.fx.ring(this.player.x, this.player.y, b.color, 8, 120, 0.8, 5);
    this.fx.burst(this.player.x, this.player.y - 12, b.particle, 24, { speed: 150, life: 0.9, tint: b.color });
    this.milestone('skill_evolve');
  }

  private milestone(id: string): void {
    const S = this.player.state;
    if (S.milestones.includes(id)) return;
    const m = MILESTONE_MAP[id];
    if (!m) return;
    S.milestones.push(id);
    S.coins += m.coins;
    if (m.maturity) addMaturity(S, m.maturity);
    app.ui.toast(`🏆 Mốc sinh tồn: ${m.name} (+${m.exp} EXP, +${m.coins} xu)`, 'good');
    audio.play('coin');
    if (m.exp) this.gainExp(m.exp);
  }

  private checkExploration(silent: boolean): void {
    const P = this.player;
    const S = P.state;
    const sx = Math.floor(P.x / T / BALANCE.world.sectorTiles);
    const sy = Math.floor(P.y / T / BALANCE.world.sectorTiles);
    const sectorsX = Math.ceil(this.world.w / BALANCE.world.sectorTiles);
    const sec = sy * sectorsX + sx;
    if (sec !== this.lastSector) {
      this.lastSector = sec;
      if (!this.discovered.has(sec)) {
        this.discovered.add(sec);
        S.discoveredSectors.push(sec);
        if (!silent) {
          const mat = addMaturity(S, BALANCE.maturity.perSector);
          this.gainExp(BALANCE.progression.expPerSector);
          app.ui.toast(`Khám phá khu vực mới (+${BALANCE.progression.expPerSector} EXP, +${mat.toFixed(1)} trưởng thành)`);
        }
      }
    }
    const biome = BIOME_IDS[this.wv.biomeAt(P.x, P.y)];
    if (!S.discoveredBiomes.includes(biome)) {
      S.discoveredBiomes.push(biome);
      if (!silent) {
        const mat = addMaturity(S, BALANCE.maturity.perBiome);
        this.gainExp(BALANCE.progression.expPerBiome);
        app.ui.toast(`Lần đầu đặt chân tới ${BIOME_NAMES[biome]}! (+${BALANCE.progression.expPerBiome} EXP, +${mat.toFixed(0)} trưởng thành)`, 'good');
      }
      if (S.discoveredBiomes.length >= BIOME_IDS.length) this.milestone('all_biomes');
    }
  }

  // ------------------------------------------------------------------ interactions

  private computeInteraction(): Interaction | null {
    const P = this.player;
    const S = P.state;
    if (P.busy || this.evo.active) return null;
    const diet = P.diet;
    const reach = BALANCE.actions.interactRange + P.radius;
    const full = S.hunger >= 99.5;
    const preferPick = S.hunger >= BALANCE.inventory.pickupWhenHungerAbove && hasInventorySpace(S);

    // Structures first
    const gate = this.wv.portal;
    if (gate && Math.hypot(gate.obj.x - P.x, gate.obj.y - P.y) < reach + 22) {
      const g = NPCS[realmOf(this.realm).guardian];
      if (this.guardianDown) {
        if (this.realm >= LAST_REALM) return { html: '<kbd>E</kbd>Cổng Cổ đã yên nghỉ', run: () => app.ui.toast('Bạn đã chinh phục mọi vùng đất!', 'good') };
        return { html: `<kbd>E</kbd>Bước qua Cổng ➜ ${esc(REALMS[this.realm + 1].name)}`, run: () => void this.confirmTravel() };
      }
      if (!this.npcs.guardian()) {
        if (S.form < BALANCE.evolution.gateForm) {
          return {
            html: `<kbd>E</kbd>Cổng Cổ <small>(cần dạng ${BALANCE.evolution.gateForm + 1}+)</small>`,
            run: () => app.ui.toast(`Cổng Cổ đang ngủ yên. Hãy tiến hóa tới dạng ${BALANCE.evolution.gateForm + 1} trở lên để triệu hồi ${g.name}.`, 'bad'),
          };
        }
        return { html: `<kbd>E</kbd>Triệu hồi Boss Giữ Cổng: ${esc(g.name)}`, run: () => void this.confirmSummon() };
      }
    }
    if (this.wv.shrine && Math.hypot(this.wv.shrine.x - P.x, this.wv.shrine.y - P.y) < reach + 14) {
      return { html: '<kbd>E</kbd>Mở Đền Cổ (nâng cấp bằng tiền xu)', run: () => this.openShop() };
    }
    for (const pad of this.wv.healpads) {
      if (Math.hypot(pad.obj.x - P.x, pad.obj.y - P.y) < reach + 10) {
        const cd = Math.max(0, pad.readyAt - this.clock.time);
        if (P.hp >= P.maxHp) return { html: '<kbd>E</kbd>Trụ Hồi Máu <small>(đã đầy máu)</small>', run: () => app.ui.toast('Bạn đã đầy máu.', '') };
        if (cd > 0) {
          return {
            html: `<kbd>E</kbd>Trụ Hồi Máu <small>(hồi sau ${Math.ceil(cd)}s · đứng gần vẫn hồi nhẹ)</small>`,
            run: () => app.ui.toast(`Trụ đang hồi năng lượng (${Math.ceil(cd)}s). Đứng gần vẫn được hồi nhẹ.`, ''),
          };
        }
        return { html: '<kbd>E</kbd>Hấp thụ Trụ Hồi Máu', run: () => this.useHealpad(pad) };
      }
    }
    for (const st of this.wv.stones) {
      if (st.done) continue;
      if (Math.hypot(st.obj.x - P.x, st.obj.y - P.y) < reach + 6) return { html: '<kbd>E</kbd>Khám phá Đá Cổ', run: () => this.useStone(st) };
    }

    // Food
    let food: { label: string; dist: number; run: () => void } | null = null;
    const wantHeal = P.hp < P.maxHp * 0.7;
    const canSnackHeal = P.hp < P.maxHp;
    // Carcasses often drop outside melee after a skill kill — give a bit more reach.
    const carcassReach = reach + 36;
    const carcass = this.wv.carcGrid.nearest(P.x, P.y, carcassReach, (c) => c.portions > 0);
    if (carcass && canEat(diet, 'thit')) {
      const d = Math.hypot(carcass.x - P.x, carcass.y - P.y);
      const bagOk = hasInventorySpace(S);
      // Loot into bag first (post-kill); only force-eat when bag is full or desperately hungry/hurt.
      if (bagOk && (!full || !wantHeal)) {
        food = { label: `<kbd>E</kbd>Nhặt Thịt vào túi`, dist: d, run: () => this.pickCarcass(carcass) };
      } else if (!full || canSnackHeal) {
        const f = FOODS.thit;
        const heal = Math.round(f.heal * f.efficiency[diet]);
        food = {
          label: `<kbd>E</kbd>Ăn Thịt <small>(+${Math.round(f.hunger * f.efficiency[diet])} no${heal > 0 ? ` · +${heal} máu` : ''})</small>`,
          dist: d,
          run: () => this.eatCarcass(carcass),
        };
      }
    }
    const node = this.wv.resGrid.nearest(P.x, P.y, reach, (n) => n.portions > 0 && canEat(diet, n.def.food));
    if (node) {
      const d = Math.hypot(node.x - P.x, node.y - P.y);
      if (!food || d < food.dist) {
        const f = FOODS[node.def.food];
        const eff = f.efficiency[diet];
        if (preferPick && f.carriable && !wantHeal) food = { label: `<kbd>E</kbd>Hái ${esc(f.name)} vào túi`, dist: d, run: () => this.pickNode(node) };
        else if (!full || canSnackHeal || node.def.kind === 'crystal') {
          const effTxt = eff < 1 ? ` · hiệu quả ${Math.round(eff * 100)}%` : '';
          const heal = Math.round(f.heal * eff);
          const healTxt = heal > 0 ? ` · +${heal} máu` : '';
          food = {
            label: `<kbd>E</kbd>${esc(node.def.verb)} ${esc(f.name)} <small>(+${Math.round(f.hunger * eff)} no${healTxt}${effTxt})</small>`,
            dist: d,
            run: () => this.eatNode(node),
          };
        }
      }
    }

    let water: Interaction | null = null;
    if (S.thirst < 99.5) {
      const w = findDrinkableWater(this.world, P.x, P.y, P.radius, BALANCE.actions.drinkRange);
      if (w) water = { html: '<kbd>E</kbd>Uống nước', run: () => this.drink() };
    }

    if (food && water) return S.hunger <= S.thirst ? { html: food.label, run: food.run } : water;
    if (food) return { html: food.label, run: food.run };
    return water;
  }

  private eatNode(node: ResourceNode): void {
    const P = this.player;
    this.faceTo(node.x);
    P.startTimedAction('eat', BALANCE.actions.eatSec, () => {
      if (node.portions <= 0) return;
      const r = eatFood(P.state, P.diet, node.def.food, P.stats.maxHp);
      if (!r.ok) return;
      this.wv.consume(node, this.clock.time);
      this.afterEat(node.def.food, r.hunger, r.maturity, r.heal, node.x, node.y);
    });
    audio.play('eat');
  }

  private eatCarcass(c: Carcass): void {
    const P = this.player;
    this.faceTo(c.x);
    P.startTimedAction('eat', BALANCE.actions.eatSec, () => {
      if (c.portions <= 0) return;
      const r = eatFood(P.state, P.diet, 'thit', P.stats.maxHp);
      if (!r.ok) return;
      this.wv.consumeCarcass(c);
      this.afterEat('thit', r.hunger, r.maturity, r.heal, c.x, c.y);
    });
    audio.play('eat');
  }

  private pickNode(node: ResourceNode): void {
    const S = this.player.state;
    if (node.portions <= 0 || !addToInventory(S, node.def.food)) return;
    this.wv.consume(node, this.clock.time);
    audio.play('pickup');
    app.ui.toast(`Đã cất ${FOODS[node.def.food].name} vào túi.`);
  }

  private pickCarcass(c: Carcass): void {
    const S = this.player.state;
    if (c.portions <= 0) {
      app.ui.toast('Xác đã hết thịt.', '');
      return;
    }
    if (!hasInventorySpace(S)) {
      app.ui.toast('Túi đầy — ăn thịt tại chỗ hoặc bỏ bớt đồ.', 'bad');
      return;
    }
    if (!addToInventory(S, 'thit')) {
      app.ui.toast('Không thể cất thịt vào túi.', 'bad');
      return;
    }
    this.wv.consumeCarcass(c);
    audio.play('pickup');
    app.ui.toast('Đã cất Thịt vào túi.');
  }

  private eatSlot(i: number): void {
    const P = this.player;
    const id = P.state.inventory[i];
    if (!id) return;
    if (isConsumable(id)) {
      this.useConsumableSlot(i);
      return;
    }
    if (!canEat(P.diet, id)) {
      app.ui.toast(`${FOODS[id].name} không hợp với chế độ ăn của bạn.`, 'bad');
      return;
    }
    const canHeal = FOODS[id].heal > 0 && P.hp < P.maxHp;
    if (P.state.hunger >= 99.5 && !canHeal) {
      app.ui.toast('Bạn đã no.', '');
      return;
    }
    P.startTimedAction('eat', BALANCE.actions.eatSec, () => {
      const r = eatFromSlot(P.state, P.diet, i, P.stats.maxHp);
      if (r.ok) this.afterEat(id, r.hunger, r.maturity, r.heal, P.x, P.y);
    });
    audio.play('eat');
  }

  private useConsumableSlot(i: number): void {
    const P = this.player;
    const id = P.state.inventory[i];
    if (!id || !isConsumable(id)) return;
    const def = CONSUMABLES[id];
    const r = takeConsumable(P.state, i, P.stats.maxHp);
    if (!r.ok) {
      app.ui.toast(r.reason ?? 'Không dùng được.', 'bad');
      return;
    }
    audio.play('eat');
    if (def.clear) for (const k of def.clear) P.status.clear(k as StatusKind);
    if (def.use === 'tonic' && def.buff) this.applyConsumableBuff(def.buff, def.durationSec ?? 10, def.color, def.name);
    if (def.use === 'bait') this.throwBait(def.durationSec ?? 10);
    const bits: string[] = [];
    if (r.heal > 0.5) bits.push(`+${Math.round(r.heal)} máu`);
    if (r.hunger > 0.5) bits.push(`+${Math.round(r.hunger)} no`);
    if (def.clear?.includes('poison')) bits.push('hết độc');
    if (def.clear?.includes('burn')) bits.push('hết bỏng');
    if (def.use === 'tonic') bits.push(def.name);
    if (def.use === 'bait') bits.push('mồi đã thả');
    this.fx.text(P.x, P.y - P.radius * 2.6, bits.join(' · ') || def.name, '#7dffb0', 14);
    this.fx.burst(P.x, P.y - 8, 'spark', 10, { speed: 70, life: 0.45, tint: def.color });
    app.ui.toast(`Dùng ${def.name}.`, 'good');
    if (app.ui.openPanel === 'char') app.ui.refreshChar();
  }

  private applyConsumableBuff(b: BuffDef, sec: number, color: number, name = 'Tonic'): void {
    const P = this.player;
    P.buff = {
      until: this.clock.time + sec,
      duration: sec,
      name,
      defenseMult: b.defenseMult ?? 1,
      regen: b.regenFracPerSec ?? 0,
      speedMult: b.speedMult ?? 1,
      powerMult: b.powerMult ?? 1,
      lifesteal: b.lifesteal ?? 0,
      thorns: b.thorns ?? 0,
      color,
    };
    if (b.cleanse) {
      P.status.clear();
      P.stunT = 0;
    }
    this.fx.ring(P.x, P.y, color, P.radius * 1.2, P.radius * 2.8, 0.7, 5);
  }

  private throwBait(sec: number): void {
    const P = this.player;
    const until = this.clock.time + sec;
    for (const n of this.npcs.creaturesNear(P.x, P.y, 300)) {
      if (!n.alive) continue;
      const t = n.def.temperament;
      if (t !== 'predator' && t !== 'apex' && t !== 'territorial') continue;
      n.giveUp.delete(P.uid);
      n.setState('hunt');
      n.target = P;
      n.chaseX = P.x;
      n.chaseY = P.y;
      n.hbTimer = Math.max(n.hbTimer, until - this.clock.time);
    }
    this.fx.ring(P.x, P.y, 0xc04040, 8, 90, 0.55, 4);
  }

  private afterEat(foodId: string, hunger: number, maturity: number, heal: number, x: number, y: number): void {
    this.fx.burst(x, y - 6, foodId === 'thit' ? 'blood' : 'leaf', 6, { speed: 60, life: 0.5, tint: foodId === 'thit' ? 0xc04040 : undefined });
    const bits = [`+${Math.round(hunger)} no`];
    if (heal > 0.5) bits.push(`+${Math.round(heal)} máu`);
    if (maturity > 0.05) bits.push(`+${maturity.toFixed(1)} 🌱`);
    this.fx.text(this.player.x, this.player.y - this.player.radius * 2.6, bits.join(' · '), heal > 0.5 ? '#7dffb0' : '#9af07a', 14);
    if (maturity <= 0.05 && BALANCE.maturity.formGainMult[this.player.state.form] > 0 && foodId !== 'khoang') {
      if (Math.random() < 0.3) app.ui.toast('Ăn quá no hoặc ăn liên tục không giúp trưởng thành thêm.', '');
    }
    this.milestone('first_meal');
  }

  private useHealpad(pad: import('../game/WorldView').HealPad): void {
    const P = this.player;
    const H = BALANCE.heal.healpad;
    if (pad.readyAt > this.clock.time) return;
    if (P.hp >= P.maxHp) {
      app.ui.toast('Bạn đã đầy máu.', '');
      return;
    }
    const got = applyHeal(P.state, P.stats.maxHp, P.stats.maxHp * H.burstFrac);
    if (got <= 0) return;
    this.wv.useHealpad(pad, this.clock.time, H.cooldownSec);
    audio.play('drink');
    this.fx.burst(pad.obj.x, pad.obj.y - 18, 'star', 12, { speed: 70, life: 0.7, tint: 0x5ef0a0 });
    this.fx.ring(pad.obj.x, pad.obj.y, 0x5ef0a0, 3, 36, 0.6, 2);
    this.fx.text(P.x, P.y - P.radius * 2.6, `+${Math.round(got)} máu`, '#7dffb0', 16);
    app.ui.toast(`Trụ Hồi Máu chữa lành bạn (+${Math.round(got)} máu). Sẽ nạp lại sau ${H.cooldownSec}s.`, 'good');
  }

  private applyHealpadAura(dt: number): void {
    const P = this.player;
    if (!P.alive || P.hp <= 0 || P.hp >= P.maxHp) {
      this.nearHealpad = false;
      return;
    }
    const H = BALANCE.heal.healpad;
    let rate = 0;
    for (const pad of this.wv.healpads) {
      if (Math.hypot(pad.obj.x - P.x, pad.obj.y - P.y) > H.auraRadius) continue;
      rate = pad.readyAt > this.clock.time ? H.auraFracPerSec * 0.25 : H.auraFracPerSec;
      break;
    }
    this.nearHealpad = rate > 0;
    if (rate <= 0) return;
    const got = applyHeal(P.state, P.stats.maxHp, P.stats.maxHp * rate * dt);
    this.padHealFxT -= dt;
    if (got > 0 && this.padHealFxT <= 0) {
      this.padHealFxT = 1.1;
      this.fx.text(P.x, P.y - P.radius * 2.4, `+${Math.max(1, Math.round(got * 8))} máu`, '#7dffb0', 12);
    }
  }

  private drink(): void {
    const P = this.player;
    P.startTimedAction('drink', BALANCE.actions.drinkSec, () => {
      const w = findDrinkableWater(this.world, P.x, P.y, P.radius, BALANCE.actions.drinkRange + 6);
      if (!w) return;
      const got = drinkWater(P.state);
      this.fx.burst(w.x, w.y, 'drop', 8, { speed: 60, life: 0.5, up: 40, gravity: 200 });
      this.fx.ring(w.x, w.y, 0xbfe8ff, 2, 18, 0.5, 2);
      this.fx.text(P.x, P.y - P.radius * 2.6, `+${Math.round(got)} nước`, '#8fd0ff', 14);
      if (this.wv.biomeAt(w.x, w.y) === 4 && !getSpecies(P.state.speciesId).swampWalker && !P.flies) {
        P.status.apply('poison', BALANCE.survival.swampWaterPoisonSec, P.stats.maxHp * 0.01, null);
        app.ui.toast('Nước đầm lầy tù đọng — bạn bị trúng độc! (Loài hệ Thủy miễn nhiễm)', 'bad');
      }
      this.milestone('first_drink');
      this.checkLearn();
    });
    audio.play('drink');
  }

  private faceTo(x: number): void {
    this.player.facing = x >= this.player.x ? 1 : -1;
  }

  private useStone(st: { obj: { x: number; y: number; variant: number }; done: boolean }): void {
    const S = this.player.state;
    const coins = 4 + (st.obj.variant % 3) * 2;
    S.coins += coins;
    S.stats.stones++;
    this.wv.useStone(st as never);
    this.gainExp(15);
    const mat = addMaturity(S, 3);
    audio.play('coin');
    this.fx.burst(st.obj.x, st.obj.y - 20, 'star', 14, { speed: 80, life: 0.8, tint: 0x5ef0d0 });
    app.ui.toast(`Đá Cổ tỏa sáng: +${coins} xu, +15 EXP, +${mat.toFixed(0)} trưởng thành`, 'good');
    this.checkLearn();
    this.saveNow(false);
  }

  private pickupCoins(): void {
    const P = this.player;
    if (!P.alive) return;
    for (const c of this.wv.coins) {
      if (c.done) continue;
      if (Math.abs(c.obj.x - P.x) > 40 || Math.abs(c.obj.y - P.y) > 40) continue;
      if (Math.hypot(c.obj.x - P.x, c.obj.y - P.y) < P.radius + 14) {
        this.wv.collectCoin(c);
        P.state.coins += 1;
        audio.play('coin');
        this.fx.burst(c.obj.x, c.obj.y, 'star', 5, { speed: 50, life: 0.5, tint: 0xffd84a });
        this.fx.text(c.obj.x, c.obj.y - 14, '+1 🪙', '#ffd84a', 13);
      }
    }
  }

  private toggleMarker(): void {
    const S = this.player.state;
    if (!S.markersUnlocked) {
      app.ui.toast('Chưa mở khóa dấu bản đồ — mua tại Đền Cổ.', '');
      return;
    }
    const i = S.markers.findIndex((m) => Math.hypot(m.x - this.player.x, m.y - this.player.y) < 70);
    if (i >= 0) {
      S.markers.splice(i, 1);
      app.ui.toast('Đã xóa dấu bản đồ.');
    } else if (S.markers.length >= SHOP.maxMarkers) {
      app.ui.toast(`Tối đa ${SHOP.maxMarkers} dấu. Đứng gần dấu cũ và nhấn M để xóa.`, 'bad');
    } else {
      S.markers.push({ x: Math.round(this.player.x), y: Math.round(this.player.y) });
      app.ui.toast('Đã đặt dấu bản đồ.', 'good');
    }
    audio.play('ui');
  }

  private openWorldMap(): void {
    audio.play('ui');
    app.ui.openWorldMap({
      minimap: this.minimap,
      getDots: () => this.minimapDots(),
      onMark: (wx, wy) => {
        this.navTarget = { x: Math.round(wx), y: Math.round(wy) };
        this.recomputeNavPath(true);
        this.navPathT = 0.6;
        audio.play('ui');
      },
      onClear: () => {
        this.navTarget = null;
        this.navPath = [];
        app.ui.toast('Đã xóa dấu đường đi.');
        audio.play('ui');
      },
    });
  }

  private recomputeNavPath(toast: boolean): void {
    if (!this.navTarget) {
      this.navPath = [];
      return;
    }
    const path = findPath(this.world, this.player.x, this.player.y, this.navTarget.x, this.navTarget.y, this.player.canClimb);
    if (!path) {
      this.navPath = [];
      if (toast) app.ui.toast('Không tìm được đường đi tới điểm đó.', 'bad');
      return;
    }
    this.navPath = path;
    if (toast) app.ui.toast('Đã đánh dấu — theo mũi tên trên mặt đất.', 'good');
  }

  private minimapDots() {
    const P = this.player;
    const vision = Lighting.visionRadius(this.clock.hour, this.inFoggyBiome());
    const hostiles = this.npcs
      .creaturesNear(P.x, P.y, Math.min(700, vision + 100))
      .filter((n) => n.alive && (n.def.temperament === 'predator' || n.def.temperament === 'apex' || n.def.temperament === 'territorial'))
      .map((n) => ({ x: n.x, y: n.y }));
    const peers = [...this.remotes.values()]
      .filter((r) => r.alive)
      .map((r) => ({ x: r.x, y: r.y, ally: r.speciesId === P.speciesId }));
    return {
      px: P.x,
      py: P.y,
      hostiles,
      markers: P.state.markers,
      peers,
      discovered: this.discovered,
      portalOpen: this.guardianDown,
      waypoint: this.navTarget,
      path: this.navPath,
    };
  }

  // ------------------------------------------------------------------ combat events

  private onDamage(e: DamageEvent): void {
    const now = this.clock.time;
    const P = this.player;
    if (e.target instanceof RemotePlayer) {
      if (e.attacker.isPlayer && !e.dot && app.multiRoom) {
        this.lastCombatAt = now;
        audio.play('hit');
        app.ui.touch.buzz(10);
        const len = Math.hypot(e.target.kbx, e.target.kby) || 1;
        app.multiRoom.send({
          t: 'hit',
          from: app.multiRoom.peerId,
          to: e.target.peerId,
          damage: e.damage,
          kx: (e.target.kbx / len) * 40,
          ky: (e.target.kby / len) * 40,
        });
      }
      return;
    }
    if (e.target.isPlayer) {
      this.lastCombatAt = now;
      if (P.rest.mode !== 'awake') {
        if (P.rest.mode === 'sleeping') app.ui.toast('Bạn bị tấn công và bị đánh thức!', 'bad');
        P.rest.wake();
      }
      if (this.evo.active) this.interruptEvolution('Tiến hóa bị gián đoạn do bị tấn công! Thanh trưởng thành được giữ nguyên.');
      if (e.dot) {
        P.hurtFlash = Math.max(P.hurtFlash, 0.1);
        return;
      }
      P.hurtFlash = 0.22;
      P.stun(BALANCE.combat.hitStunSec);
      P.cancelAction();
      audio.play('hurt');
      app.ui.touch.buzz(18);
      this.cameras.main.shake(120, 0.004);
      if (e.attacker instanceof Npc) {
        const n = e.attacker;
        this.lastTarget = n;
        this.lastTargetAt = now;
        this.lastDamageCause = `Bị ${n.displayName} hạ gục.`;
        if (n.sc.lifesteal > 0 && n.alive) n.hp = Math.min(n.maxHp, n.hp + e.damage * n.sc.lifesteal);
        const thorns = P.buff && now < P.buff.until ? P.buff.thorns : 0;
        if (thorns > 0 && n.alive && P.alive) {
          const dmg = e.damage * thorns;
          this.combat.dotDamage(n, dmg, P, '#c8f08a');
        }
      }
      return;
    }
    const n = e.target as Npc;
    if (!e.dot) this.npcs.onDamaged(n, e.attacker);
    if (e.attacker.isPlayer) {
      this.lastCombatAt = now;
      this.lastTarget = n;
      this.lastTargetAt = now;
      if (!e.dot) {
        audio.play('hit');
        app.ui.touch.buzz(10);
        const ls = P.buff && now < P.buff.until ? P.buff.lifesteal : 0;
        if (ls > 0 && P.alive) P.state.hp = Math.min(P.stats.maxHp, P.state.hp + e.damage * ls);
        if (e.tag && SKILLS[e.tag]) this.gainMastery(SKILLS[e.tag], BALANCE.combat.masteryPerHit + (e.killed ? BALANCE.combat.masteryKillBonus : 0));
      }
    }
    if (e.killed) {
      this.npcs.kill(n, e.attacker);
      if (n.sprite.visible) audio.play('npcDie');
      if (e.attacker.isPlayer) this.onPlayerKill(n);
    }
  }

  private onPlayerKill(n: Npc): void {
    const S = this.player.state;
    const P = this.player;
    S.stats.kills++;
    const r = killReward(P.stats, n.def, n.sc);
    const mat = addMaturity(S, r.maturity);
    this.gainExp(r.exp);
    this.fx.text(n.x, n.y - n.radius * 2 - 18, `+${r.exp} EXP`, '#ffe08a', 15);
    if (mat > 0.05) this.fx.text(n.x, n.y - n.radius * 2 - 34, `+${mat.toFixed(1)} 🌱`, '#9af07a', 13);
    else if (r.ratio < BALANCE.maturity.killMinPowerRatio) app.ui.toast('Con mồi quá yếu so với bạn — không giúp trưởng thành.', '');
    const br = noteBestiary(S, n.def.id, 'killed');
    if (br) {
      S.coins += br.coins;
      this.gainExp(br.exp);
      app.ui.toast(`📖 Lần đầu hạ ${n.def.name}! +${br.coins} xu`, 'good');
    }
    const H = BALANCE.heal;
    let healFrac = H.killFrac;
    if (n.elite) healFrac += H.killEliteFrac;
    if (n.def.guardian || n.def.unique) healFrac += H.killBossFrac;
    const healed = applyHeal(S, P.stats.maxHp, P.stats.maxHp * healFrac);
    if (healed > 0.5) this.fx.text(P.x, P.y - P.radius * 2.6, `+${Math.round(healed)} máu`, '#7dffb0', 14);
    if (n.elite) {
      S.stats.elites++;
      const coins = 3 + n.tier * 2;
      S.coins += coins;
      audio.play('coin');
      app.ui.toast(`★ Hạ gục Tinh anh ${n.displayName}! +${coins} xu`, 'good');
      this.milestone('elite_1');
    }
    if (n.def.guardian) {
      S.stats.bosses++;
      this.onGuardianDefeated(n);
    } else if (n.def.unique) {
      S.stats.bosses++;
      this.milestone(n.def.id === 'thuy_xa_vuong' ? 'swamp_boss' : 'alpha');
    }
    this.milestone('first_kill');
    if (S.stats.kills >= 10) this.milestone('hunter_10');
    this.checkLearn();
  }

  // ------------------------------------------------------------------ realms & gate guardians

  private async confirmSummon(): Promise<void> {
    const gate = this.wv.portal;
    if (!gate || this.guardianDown || this.npcs.guardian()) return;
    const g = NPCS[realmOf(this.realm).guardian];
    this.paused = true;
    const ok = await app.ui.confirm(
      `Triệu hồi ${g.name}?`,
      `<p>${esc(g.desc)}</p><p>Cấp <b>${g.level}</b> · Máu <b>${g.stats.maxHp}</b> · Sức mạnh <b>${g.stats.power}</b></p><p><small>Boss nổi điên khi còn một nửa máu. Hạ gục sẽ nạp đầy 5 tim. Hết tim sẽ chơi lại map từ đầu.</small></p>`,
      'Triệu hồi',
      'Để sau',
    );
    this.paused = false;
    if (!ok || this.dead || this.npcs.guardian()) return;
    // Emerges on the far side of the gate from the player, on the first free spot.
    const away = Math.atan2(this.player.y - gate.obj.y, this.player.x - gate.obj.x) + Math.PI;
    let x = gate.obj.x;
    let y = gate.obj.y - 90;
    for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const cx = gate.obj.x + Math.cos(away + off) * 100;
      const cy = gate.obj.y + Math.sin(away + off) * 100;
      if (isPositionFree(this.world, cx, cy, g.radius, false)) {
        x = cx;
        y = cy;
        break;
      }
    }
    const n = this.npcs.summonGuardian(g, x, y);
    this.lastTarget = n;
    this.lastTargetAt = this.clock.time;
    this.fx.ring(n.x, n.y, 0xc08aff, 10, 160, 0.9, 6);
    this.fx.burst(n.x, n.y - 20, 'spark', 30, { speed: 180, life: 1, tint: 0xc08aff });
    this.cameras.main.shake(400, 0.01);
    audio.play('evolveStart');
    app.ui.toast(`⚠ ${g.name} đã xuất hiện!`, 'bad');
    this.broadcastGuardian('summon', n.x, n.y);
  }

  private onGuardianDefeated(n: Npc): void {
    const S = this.player.state;
    const realm = realmOf(this.realm);
    this.guardianDown = true;
    this.wv.setPortalOpen(true);
    S.coins += realm.guardianCoins;
    S.lives = BALANCE.lives.max;
    audio.play('evolveDone');
    this.cameras.main.flash(500, 200, 160, 255);
    const gate = this.wv.portal;
    if (gate) this.fx.ring(gate.obj.x, gate.obj.y - 30, 0xc08aff, 12, 200, 1.2, 6);
    app.ui.toast(`👑 Đã hạ ${n.def.name}! +${realm.guardianCoins} xu — Cổng Cổ mở · tim đầy ${BALANCE.lives.max}♥`, 'evo');
    this.broadcastGuardian('down');
    this.saveNow(false);
    if (this.realm >= LAST_REALM) this.time.delayedCall(1800, () => void this.showVictory());
  }

  private broadcastGuardian(action: 'summon' | 'down', x?: number, y?: number): void {
    const room = app.multiRoom;
    if (!room || !this.multiMode) return;
    room.send({ t: 'guardian', from: room.peerId, action, x, y });
  }

  private applyRemoteGuardian(action: 'summon' | 'down', x?: number, y?: number): void {
    if (action === 'down') {
      if (!this.guardianDown) {
        this.guardianDown = true;
        this.wv.setPortalOpen(true);
        const g = this.npcs.guardian();
        if (g) this.npcs.kill(g, this.player);
        app.ui.toast('👑 Đồng đội đã hạ Boss Giữ Cổng — Cổng Cổ mở!', 'evo');
      }
      return;
    }
    if (this.guardianDown || this.npcs.guardian()) return;
    const def = NPCS[realmOf(this.realm).guardian];
    const gx = x ?? this.wv.portal?.obj.x ?? this.player.x;
    const gy = y ?? (this.wv.portal?.obj.y ?? this.player.y) - 90;
    const n = this.npcs.summonGuardian(def, gx, gy);
    this.lastTarget = n;
    this.lastTargetAt = this.clock.time;
    app.ui.toast(`⚠ Đồng đội triệu hồi ${def.name}! Bảo vệ nhau!`, 'bad');
    audio.play('telegraph');
  }

  private async confirmTravel(): Promise<void> {
    if (!this.guardianDown || this.realm >= LAST_REALM || this.evo.active) return;
    const next = REALMS[this.realm + 1];
    const b = REALM_PLAYER_BONUS;
    this.paused = true;
    const ok = await app.ui.confirm(
      `Đến ${next.name}?`,
      `<p>${esc(next.desc)}</p><p>Bạn giữ nguyên cấp độ, dạng tiến hóa, chiêu thức, túi đồ và tiền xu, và nhận vĩnh viễn <b>+${Math.round(b.hp * 100)}% máu, +${Math.round(b.power * 100)}% sức mạnh, +${Math.round(b.defense * 100)}% phòng thủ</b>.</p><p><small>Sinh vật ở vùng đất mới mạnh hơn nhiều. Không thể quay lại vùng đất cũ.</small></p>`,
      'Bước qua cổng',
      'Ở lại',
    );
    this.paused = false;
    if (!ok || this.dead) return;
    const save = this.buildSave();
    const p = save.player;
    p.realm = this.realm + 1;
    p.discoveredSectors = [];
    p.discoveredBiomes = [];
    p.markers = [];
    p.hp = computeStats(p).maxHp;
    p.hunger = Math.max(p.hunger, 70);
    p.thirst = Math.max(p.thirst, 70);
    save.world = { ...save.world, resources: {}, collectedCoins: [], stonesUsed: [], alphaDefeatedAt: null, bosses: {}, guardianDown: false };
    audio.play('evolveDone');
    this.cameras.main.fadeOut(600, 20, 10, 40);
    this.started = false;
    window.setTimeout(() => app.startGame({ mode: 'travel', save, multi: this.multiMode || undefined }), 650);
  }

  private async showVictory(): Promise<void> {
    if (this.dead) return;
    const S = this.player.state;
    this.paused = true;
    const back = await app.ui.confirm(
      '🏆 Chinh phục mọi vùng đất!',
      `<p>${esc(formOf(S).name)} đã đánh bại cả ${REALMS.length} Boss Giữ Cổng và trở thành huyền thoại của thế giới hoang dã.</p><p>Cấp ${S.level} · ${S.stats.kills} lần hạ gục · ${S.stats.daysSurvived} ngày sinh tồn · ${formatDuration(S.stats.timeAlive)}</p>`,
      'Tiếp tục khám phá',
      'Về menu chính',
    );
    this.paused = false;
    if (!back) {
      this.saveNow(false);
      app.showMenu(null);
    }
  }

  // ------------------------------------------------------------------ evolution

  private evoContext() {
    return { inCombat: this.inCombat(), inShelter: !!this.wv.shelterAt(this.player.x, this.player.y) };
  }

  private openCharPanel(): void {
    app.ui.openChar(
      () => {
        const S = this.player.state;
        const ctx = this.evoContext();
        return {
          state: S,
          stats: this.player.stats,
          checks: evolutionChecks(S, ctx),
          canEvolve: canEvolve(S, ctx) && !this.evo.active,
          evoDuration: evolutionDuration(S.form),
          guardianDown: this.guardianDown,
        };
      },
      () => void this.requestEvolution(),
      (id, slot) => {
        if (slot >= SKILL_SLOTS || !slotUnlocked(this.player.state, slot)) return;
        if (equipSkill(this.player.state, id, slot)) audio.play('ui');
      },
    );
  }

  private async requestEvolution(): Promise<void> {
    const S = this.player.state;
    const dur = evolutionDuration(S.form);
    const next = getSpecies(S.speciesId).forms[S.form + 1];
    const ok = await app.ui.confirm(
      'Bắt đầu tiến hóa?',
      `<p>${esc(formOf(S).name)} sẽ tiến hóa thành <b>${esc(next.name)}</b>.</p>
       <p>Thời gian cần chờ: <b>${dur} giây</b>. Trong lúc này bạn không thể di chuyển.</p>
       <ul class="checklist">${evolutionChecks(S, this.evoContext()).map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${esc(c.label)}</li>`).join('')}</ul>
       <p style="color:#ffb0a0">Nếu bị tấn công, quá trình sẽ bị ngắt (giữ nguyên thanh trưởng thành). Ánh sáng tiến hóa có thể thu hút thú săn mồi gần đó. Nhấn Space để hủy.</p>`,
      'Tiến hóa',
      'Để sau',
    );
    if (!ok) return;
    const res = this.evo.start(S, this.evoContext());
    if (!res.ok) {
      app.ui.toast(`Chưa thể tiến hóa: ${res.reason}`, 'bad');
      return;
    }
    app.ui.closeOverlay();
    this.player.rest.wake();
    this.player.evolving = true;
    audio.play('evolveStart');
    audio.setEvolveDrone(true, 0);
    app.ui.toast('Quá trình tiến hóa bắt đầu...', 'evo');
    if (this.multiMode && this.remotes.size > 0) {
      app.ui.toast('Đồng đội: hãy bảo vệ người đang tiến hóa!', 'evo');
      this.broadcastState(true);
    }
  }

  private updateEvolution(dt: number): void {
    const P = this.player;
    if (!this.evo.active) {
      this.lighting.evoGlow.setVisible(false);
      this.lighting.evoBeam.setVisible(false);
      return;
    }
    const st = this.evo.update(dt);
    const prog = this.evo.progress;
    const next = getSpecies(P.state.speciesId).forms[P.state.form + 1];
    if (st === 'done') {
      this.finishEvolution();
      return;
    }
    app.ui.evoProgress(true, `Đang tiến hóa thành ${next?.name ?? ''}...`, prog, this.evo.duration - this.evo.elapsed);
    audio.setEvolveDrone(true, prog);
    const t = this.time.now / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * (4 + prog * 14));
    P.sprite.setTintFill(Phaser.Display.Color.GetColor(255, 255, Math.round(200 + 55 * pulse)));
    P.sprite.setAlpha(0.6 + 0.4 * pulse);
    P.sprite.setScale(1 + 0.06 * Math.sin(t * 6) * prog);
    this.lighting.evoGlow.setVisible(true).setPosition(P.x, P.y - P.radius).setScale((P.radius * (4 + prog * 4)) / 128).setAlpha(0.5 + 0.4 * pulse);
    this.lighting.evoBeam.setVisible(true).setPosition(P.x, P.y + 4).setScale(0.8 + prog * 0.8, 1.4 + prog).setAlpha(0.25 + 0.45 * prog);
    if (Math.random() < 0.3 + prog) this.fx.burst(P.x + (Math.random() - 0.5) * P.radius * 3, P.y, 'star', 1, { speed: 30, up: 60 + prog * 80, life: 0.9, dir: -Math.PI / 2, spread: 0.6 });
  }

  private interruptEvolution(reason: string): void {
    if (!this.evo.interrupt(reason)) return;
    const P = this.player;
    P.evolving = false;
    P.sprite.clearTint().setAlpha(1).setScale(1);
    audio.setEvolveDrone(false);
    audio.play('interrupt');
    app.ui.evoProgress(false);
    app.ui.toast(reason, 'bad');
  }

  private finishEvolution(): void {
    const P = this.player;
    const S = P.state;
    completeEvolution(S);
    P.evolving = false;
    P.refreshForm();
    P.sprite.clearTint().setAlpha(1).setScale(1);
    audio.setEvolveDrone(false);
    audio.play('evolveDone');
    app.ui.evoProgress(false);
    this.cameras.main.flash(500, 255, 250, 220);
    this.fx.ring(P.x, P.y, 0xffffff, 10, 160, 0.8, 6);
    this.fx.ring(P.x, P.y, 0xc08aff, 10, 110, 0.6, 4);
    this.fx.burst(P.x, P.y - P.radius, 'star', 40, { speed: 220, life: 1 });
    this.tweens.add({ targets: P.sprite, scale: { from: 1.35, to: 1 }, duration: 600, ease: 'Back.Out' });
    const f = formOf(S);
    app.ui.toast(`✨ Tiến hóa thành công: ${f.name}!`, 'evo');
    if (f.canClimbLedges) app.ui.toast('Bạn giờ có thể leo vách đá để lên cao nguyên đá.', 'good');
    if (S.form === 1) app.ui.toast(`Mở khóa ô chiêu thứ 3 (phím ${SLOT_KEYS[2]}).`, 'good');
    if (S.form === BALANCE.evolution.gateForm && !this.guardianDown) {
      app.ui.toast(`Đủ mạnh để mở Cổng Cổ! Hãy tới ô tím trên bản đồ để thách đấu ${NPCS[realmOf(this.realm).guardian].name}.`, 'evo');
    }
    if (isFinalForm(S)) app.ui.toast('Bạn đã đạt dạng thần thoại tối thượng!', 'evo');
    this.checkLearn();
    for (const e of evolvePending(S)) this.announceSkillEvolution(e);
    const evoMs = S.form === 1 ? 'evolve_1' : S.form === 2 ? 'evolve_2' : S.form === 3 ? 'evolve_3' : S.form === 4 ? 'evolve_4' : null;
    if (evoMs) this.milestone(evoMs);
    this.saveNow(true);
  }

  // ------------------------------------------------------------------ shop

  private openShop(): void {
    const S = this.player.state;
    const refresh = () => this.openShop();
    app.ui.openShop(S, {
      buySlot: () => {
        const cost = SHOP.slotUpgradeCosts[S.slots - BALANCE.inventory.startSlots];
        if (cost === undefined || S.coins < cost || S.slots >= BALANCE.inventory.maxSlots) return;
        S.coins -= cost;
        S.slots++;
        S.inventory.push(null);
        audio.play('coin');
        app.ui.toast(`Túi đồ giờ có ${S.slots} ô.`, 'good');
        this.saveNow(false);
        refresh();
      },
      buyMarkers: () => {
        if (S.markersUnlocked || S.coins < SHOP.markerUnlockCost) return;
        S.coins -= SHOP.markerUnlockCost;
        S.markersUnlocked = true;
        audio.play('coin');
        app.ui.toast('Đã mở dấu bản đồ! Nhấn M để đặt dấu.', 'good');
        this.saveNow(false);
        refresh();
      },
      buyColor: (id) => {
        const v = COLOR_VARIANTS.find((c) => c.id === id);
        if (!v || S.unlockedColors.includes(id) || S.coins < v.cost) return;
        S.coins -= v.cost;
        S.unlockedColors.push(id);
        S.colorVariant = id;
        this.player.refreshForm();
        audio.play('coin');
        app.ui.toast(`Đã mở màu ${v.name}.`, 'good');
        this.saveNow(false);
        refresh();
      },
      equipColor: (id) => {
        if (!S.unlockedColors.includes(id)) return;
        S.colorVariant = id;
        this.player.refreshForm();
        audio.play('ui');
        this.saveNow(false);
        refresh();
      },
      buyConsumable: (id) => {
        const def = CONSUMABLES[id];
        if (!def || S.coins < def.cost || !hasInventorySpace(S)) {
          if (def && S.coins >= def.cost && !hasInventorySpace(S)) app.ui.toast('Túi đầy — mở thêm ô hoặc dùng bớt đồ.', 'bad');
          return;
        }
        if (!addToInventory(S, id)) return;
        S.coins -= def.cost;
        audio.play('coin');
        app.ui.toast(`Mua ${def.name}.`, 'good');
        this.saveNow(false);
        refresh();
      },
    });
  }

  // ------------------------------------------------------------------ pause / save / death

  private openPause(): void {
    this.paused = true;
    this.anims.pauseAll();
    this.tweens.pauseAll();
    audio.setEvolveDrone(false);
    app.ui.openPause(app.settings, {
      resume: () => this.resume(),
      save: () => {
        const ok = this.saveNow(false);
        app.ui.toast(ok ? 'Đã lưu game.' : 'Lưu thất bại!', ok ? 'good' : 'bad');
      },
      quit: () => {
        this.saveNow(false);
        app.showMenu(null);
      },
      settings: (s) => {
        app.settings = s;
        saveSettings(s);
        audio.setSettings(s);
      },
      debug: DEBUG_ENABLED
        ? {
            toggleHitbox: () => (this.debug.hitbox = !this.debug.hitbox),
            toggleGod: () => this.toggleGod(),
            quickEvolve: () => this.debugQuickEvolve(),
            skipTime: () => (this.clock.time += BALANCE.time.dayLengthSec / 8),
            flags: () => `Hitbox: ${this.debug.hitbox ? 'BẬT' : 'tắt'} • Bất tử: ${this.debug.god ? 'BẬT' : 'tắt'}`,
          }
        : undefined,
    });
  }

  private resume(): void {
    app.ui.closeOverlay();
    this.paused = false;
    this.anims.resumeAll();
    this.tweens.resumeAll();
    this.input.keyboard?.resetKeys();
    (document.getElementById('game-root') as HTMLElement).focus();
  }

  private toggleGod(): void {
    this.debug.god = !this.debug.god;
    this.combat.godMode = this.debug.god;
    app.ui.toast(`[Debug] Bất tử: ${this.debug.god ? 'BẬT' : 'tắt'}`);
  }

  private debugQuickEvolve(): void {
    const S = this.player.state;
    if (S.form >= finalFormIndex(S.speciesId)) return;
    S.maturity = BALANCE.maturity.max;
    S.stats.elites = Math.max(S.stats.elites, BALANCE.evolution.requiredElites[S.form] ?? 0);
    while (S.level < BALANCE.evolution.requiredLevel[S.form]) addExp(S, expToNext(S.level));
    this.player.recomputeStats();
    this.checkLearn();
    S.hunger = 100;
    S.thirst = 100;
    const P = this.player;
    const d = (s: { x: number; y: number }) => Math.hypot(s.x - P.x, s.y - P.y);
    const reachable = this.wv.shelters.filter((s) => this.world.reach1[s.ty * this.world.w + s.tx]);
    const sh = reachable.sort((a, b) => d(a) - d(b))[0];
    if (sh) {
      P.x = sh.x;
      P.y = sh.y;
    }
    app.ui.toast('[Debug] Đủ điều kiện tiến hóa — đã dịch chuyển tới nơi trú ẩn gần nhất.');
  }

  private buildSave(): SaveData {
    const ex = this.wv.exportState();
    return {
      version: BALANCE.saveVersion,
      savedAt: Date.now(),
      seed: this.seed,
      player: JSON.parse(JSON.stringify(this.player.state)) as PlayerState,
      world: {
        time: this.clock.time,
        weather: this.weather.state,
        weatherRemaining: this.weather.remaining,
        weatherRolls: this.weather.rolls,
        resources: ex.resources,
        collectedCoins: ex.collectedCoins,
        stonesUsed: ex.stonesUsed,
        alphaDefeatedAt: this.npcs.bossDefeatedAt.nham_chua ?? null,
        bosses: { ...this.npcs.bossDefeatedAt },
        guardianDown: this.guardianDown,
      },
    };
  }

  /** Writes a consistent snapshot of the whole run. Never saves a dead character. */
  saveNow(showToast: boolean): boolean {
    if (!this.started || this.dead || this.dying || !this.player.alive) return false;
    const r = writeSave(localStorage, this.buildSave());
    if (!r.ok) app.ui.toast(`Không thể lưu: ${r.error}`, 'bad');
    else if (showToast) app.ui.toast('Đã tự động lưu.', 'good');
    return r.ok;
  }

  private onPlayerDeath(): void {
    if (this.dead || this.dying) return;
    const P = this.player;
    const S = P.state;
    ensureLives(S);
    P.alive = false;
    if (this.evo.active) this.interruptEvolution('Tiến hóa thất bại.');
    audio.play('death');
    audio.setEvolveDrone(false);
    this.combat.cancelOwner(P.uid);
    S.lives = Math.max(0, S.lives - 1);

    if (S.lives > 0) {
      this.dying = true;
      app.ui.toast(`Mất 1 tim · còn ${S.lives}/${BALANCE.lives.max}♥ — hồi sinh tại trụ máu gần nhất…`, 'bad');
      this.time.delayedCall(1100, () => this.respawnAtNearestPillar());
      return;
    }

    this.dead = true;
    deleteSave(localStorage);
    const summary = {
      name: displayName(S),
      cause: this.lastDamageCause || 'Kiệt sức.',
      days: S.stats.daysSurvived,
      time: formatDuration(S.stats.timeAlive),
      level: S.level,
      form: `${formOf(S).name} (dạng ${S.form + 1}/5) — ${realmOf(this.realm).name} (${this.realm + 1}/${REALMS.length})`,
      kills: S.stats.kills,
      coins: S.coins,
      realmName: realmOf(this.realm).name,
    };
    this.time.delayedCall(1400, () =>
      app.ui.showDeath(
        summary,
        () => this.restartCurrentMap(),
        () => app.showMenu(null),
        { mapFail: true },
      ),
    );
  }

  /** Nearest heal pillar to a world point (fallback: shelter, then spawn). */
  private nearestRespawnPoint(x: number, y: number): { x: number; y: number } {
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - x, p.y - y);
    const pads = this.wv.healpads.map((h) => h.obj);
    if (pads.length) return pads.slice().sort((a, b) => dist(a) - dist(b))[0]!;
    const shelters = this.wv.shelters;
    if (shelters.length) return shelters.slice().sort((a, b) => dist(a) - dist(b))[0]!;
    return {
      x: this.world.spawn.tx * T + T / 2,
      y: this.world.spawn.ty * T + T / 2,
    };
  }

  private respawnAtNearestPillar(): void {
    if (this.dead || !this.dying) return;
    const P = this.player;
    const S = P.state;
    const dest = this.nearestRespawnPoint(P.x, P.y);
    let x = dest.x;
    let y = dest.y;
    for (const off of [0, 24, -24, 40, -40, 56]) {
      for (const ang of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const cx = dest.x + Math.cos(ang) * Math.abs(off);
        const cy = dest.y + Math.sin(ang) * Math.abs(off);
        if (isPositionFree(this.world, cx, cy, P.moveRadius, false)) {
          x = cx;
          y = cy;
          break;
        }
      }
    }
    P.x = x;
    P.y = y;
    P.alive = true;
    P.hp = P.maxHp;
    P.iframes = 2.5;
    P.stunT = 0;
    P.buff = null;
    P.action = null;
    P.status.clear();
    P.rest.wake();
    S.hunger = Math.max(S.hunger, 35);
    S.thirst = Math.max(S.thirst, 35);
    this.dying = false;
    this.lastTarget = null;
    this.fx.ring(P.x, P.y, 0x7dffb0, 8, 90, 0.8, 5);
    this.fx.burst(P.x, P.y - 16, 'spark', 18, { speed: 120, life: 0.7, tint: 0x7dffb0 });
    this.cameras.main.flash(280, 80, 200, 140);
    audio.play('coin');
    app.ui.toast(`Hồi sinh tại trụ máu · còn ${S.lives}/${BALANCE.lives.max}♥`, 'good');
    this.saveNow(false);
  }

  /** After all hearts are lost: keep character progress, regenerate the current realm map. */
  private restartCurrentMap(): void {
    const save = this.buildSave();
    const p = save.player;
    ensureLives(p);
    p.lives = BALANCE.lives.max;
    p.hp = computeStats(p).maxHp;
    p.hunger = Math.max(p.hunger, 70);
    p.thirst = Math.max(p.thirst, 70);
    p.discoveredSectors = [];
    p.discoveredBiomes = [];
    p.markers = [];
    save.world = {
      ...save.world,
      time: 0,
      resources: {},
      collectedCoins: [],
      stonesUsed: [],
      alphaDefeatedAt: null,
      bosses: {},
      guardianDown: false,
    };
    writeSave(localStorage, save);
    audio.play('evolveDone');
    this.cameras.main.fadeOut(500, 20, 10, 40);
    this.started = false;
    window.setTimeout(() => app.startGame({ mode: 'travel', save, multi: this.multiMode || undefined }), 550);
  }

  // ------------------------------------------------------------------ drawing

  /** Keeps the player centred in the strip between the top and bottom HUD rather than under it on short screens. */
  private updateCameraShift(dt: number): void {
    const cam = this.cameras.main;
    this.bandT -= dt;
    if (this.bandT <= 0) {
      this.bandT = 0.3;
      const band = app.ui.clearBand();
      const want = (band.top + band.bottom) / 2 - cam.height / 2;
      this.camShiftTarget = band.bottom > band.top ? Phaser.Math.Clamp(want, -cam.height * 0.25, cam.height * 0.25) : 0;
    }
    this.camShift += (this.camShiftTarget - this.camShift) * Math.min(1, dt * 4);
    cam.setFollowOffset(0, Math.round(this.camShift));
  }

  /** Projects world positions onto crisp HTML labels above each creature. */
  private syncNameTags(): void {
    const cam = this.cameras.main;
    const view = cam.worldView;
    const sx = (wx: number, wy: number) => ({
      x: ((wx - view.x) / view.width) * cam.width,
      y: ((wy - view.y) / view.height) * cam.height,
    });
    const P = this.player;
    if (P.alive) {
      const p = sx(P.x, P.nameAnchorY());
      app.ui.nameTags.set(
        'self',
        { name: displayName(P.state), form: P.state.form, hp: P.hp, maxHp: P.maxHp, kind: 'self' },
        p.x,
        p.y,
      );
    } else app.ui.nameTags.hide('self');

    const seen = new Set<string>(P.alive ? ['self'] : []);
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      seen.add(r.peerId);
      const p = sx(r.x, r.nameAnchorY());
      app.ui.nameTags.set(
        r.peerId,
        {
          name: r.label,
          form: r.form,
          hp: r.hp,
          maxHp: r.maxHp,
          kind: r.speciesId === P.speciesId ? 'ally' : 'enemy',
        },
        p.x,
        p.y,
      );
    }

    // Nearby wild creatures: compact Lv only (threat color via ring + text).
    if (P.alive) {
      const near = this.npcs
        .creaturesNear(P.x, P.y, 360)
        .filter((n) => n.alive && n.sprite.visible)
        .sort((a, b) => Math.hypot(a.x - P.x, a.y - P.y) - Math.hypot(b.x - P.x, b.y - P.y))
        .slice(0, 8);
      for (const n of near) {
        const id = `npc:${n.uid}`;
        seen.add(id);
        const safe = canDefeatNpc(P.score, n.score);
        const p = sx(n.x, n.y - n.def.art.size * 2 * (n.elite ? 1.05 : 0.95) - 4);
        app.ui.nameTags.set(
          id,
          {
            name: '',
            level: n.level,
            hp: n.hp,
            maxHp: n.maxHp,
            kind: 'npc',
            threat: safe ? 'safe' : 'deadly',
          },
          p.x,
          p.y,
        );
      }
    }
    app.ui.nameTags.prune(seen);
  }

  /** Ground chevrons along the nav path (instead of a solid line). */
  private drawNavGroundArrows(g: Phaser.GameObjects.Graphics, t: number): void {
    const path = this.navPath;
    if (path.length < 2) return;
    const P = this.player;
    const spacing = 52;
    // Skip segments already behind the player.
    let start = 0;
    let bestD = Infinity;
    for (let i = 0; i < path.length; i++) {
      const d = Math.hypot(path[i].x - P.x, path[i].y - P.y);
      if (d < bestD) {
        bestD = d;
        start = i;
      }
    }
    if (start > 0) start -= 1;

    let carry = 0;
    let drawn = 0;
    const maxArrows = 28;
    for (let i = Math.max(0, start); i < path.length - 1 && drawn < maxArrows; i++) {
      const a = path[i];
      const b = path[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const ux = dx / len;
      const uy = dy / len;
      const ang = Math.atan2(uy, ux);
      let d = carry;
      while (d < len && drawn < maxArrows) {
        const x = a.x + ux * d;
        const y = a.y + uy * d;
        // Only paint arrows near the camera / player to keep the ground readable.
        if (Math.hypot(x - P.x, y - P.y) < 720) {
          const pulse = 0.55 + 0.25 * Math.sin(t * 5 - drawn * 0.45);
          this.drawGroundChevron(g, x, y, ang, pulse);
          drawn++;
        }
        d += spacing;
      }
      carry = d - len;
    }
  }

  private drawGroundChevron(g: Phaser.GameObjects.Graphics, x: number, y: number, ang: number, alpha: number): void {
    const tip = 14;
    const wing = 10;
    const back = 5;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    // Soft ground shadow
    g.fillStyle(0x0a1520, alpha * 0.35);
    g.fillEllipse(x, y + 1, 18, 10);
    // Main chevron pointing along the path
    const tx = x + c * tip;
    const ty = y + s * tip;
    const lx = x - c * back + s * wing;
    const ly = y - s * back - c * wing;
    const rx = x - c * back - s * wing;
    const ry = y - s * back + c * wing;
    g.fillStyle(0x5ad0ff, alpha * 0.9);
    g.fillTriangle(tx, ty, lx, ly, rx, ry);
    g.fillStyle(0xe8f7ff, alpha * 0.55);
    const mx = x + c * (tip * 0.25);
    const my = y + s * (tip * 0.25);
    g.fillTriangle(
      mx + c * 6,
      my + s * 6,
      x - c * 1 + s * 4.5,
      y - s * 1 - c * 4.5,
      x - c * 1 - s * 4.5,
      y - s * 1 + c * 4.5,
    );
  }

  /** Persistent self-buff ring + countdown while a buff is active. */
  private drawBuffAura(g: Phaser.GameObjects.Graphics): void {
    const P = this.player;
    const b = P.buff;
    if (!P.alive || !b) return;
    const left = Math.max(0, b.until - this.clock.time);
    if (left <= 0) return;
    const t = this.time.now / 1000;
    const frac = b.duration > 0 ? Math.min(1, left / b.duration) : 0;
    const r = P.radius * (1.85 + Math.sin(t * 5) * 0.08);
    const x = P.x;
    const y = P.y;
    // Soft fill
    g.fillStyle(b.color, 0.1 + Math.sin(t * 4) * 0.04);
    g.fillCircle(x, y, r);
    // Outer ring
    g.lineStyle(2.5, b.color, 0.75);
    g.strokeCircle(x, y, r);
    g.lineStyle(1.5, 0xffffff, 0.45);
    g.strokeCircle(x, y, r + 5);
    // Remaining-duration arc (sweeps down as buff expires)
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * frac;
    g.lineStyle(4, b.color, 0.95);
    g.beginPath();
    g.arc(x, y, r + 10, start, end, false);
    g.strokePath();
    // Orbiting sparks
    for (let i = 0; i < 3; i++) {
      const a = t * 2.4 + (i / 3) * Math.PI * 2;
      g.fillStyle(0xffffff, 0.7);
      g.fillCircle(x + Math.cos(a) * (r + 10), y + Math.sin(a) * (r + 10), 2.2);
    }
  }

  /** Combat lock ring — shown while an enemy is soft-targeted. */
  private drawTargetReticle(g: Phaser.GameObjects.Graphics): void {
    const n = this.lockedTarget(700);
    if (!n) return;
    const t = this.time.now / 1000;
    const pulse = 1 + Math.sin(t * 7) * 0.07;
    const r = Math.max(18, n.radius * 1.4) * pulse;
    const x = n.x;
    const y = n.y;
    g.lineStyle(3, 0xff5a3a, 0.9);
    g.strokeCircle(x, y, r);
    g.lineStyle(1.5, 0xffd84a, 0.65 + Math.sin(t * 5) * 0.15);
    g.strokeCircle(x, y, r + 6);
    // Rotating corner ticks
    const tick = r * 0.38;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + t * 1.8;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x0 = x + c * (r + 2);
      const y0 = y + s * (r + 2);
      const x1 = x + c * (r + 2 + tick);
      const y1 = y + s * (r + 2 + tick);
      g.lineStyle(2.5, 0xffcf4a, 0.95);
      g.lineBetween(x0, y0, x1, y1);
    }
    // Ground disc so the lock reads under tall forms
    g.fillStyle(0xff5a3a, 0.12 + Math.sin(t * 6) * 0.04);
    g.fillCircle(x, y, r * 0.92);
  }

  private drawOverlay(): void {
    const g = this.overlayG;
    g.clear();
    this.combat.draw(g, this.debug.hitbox, this.time.now);
    this.combat.swingVisual(g);
    this.npcs.drawBars(g, this.player.score, this.debug.hitbox);
    this.fx.drawRings(g);
    this.drawBuffAura(g);
    this.drawTargetReticle(g);
    const t = this.time.now / 1000;
    // Living aura for terror / mythic forms (and remotes of the same tier).
    const drawAura = (x: number, y: number, radius: number, color: number, burst: boolean) => {
      const pulse = 1 + Math.sin(t * 3.5) * 0.08;
      g.lineStyle(2, color, 0.35 + Math.sin(t * 4) * 0.1);
      g.strokeCircle(x, y, radius * 1.85 * pulse);
      g.lineStyle(1.5, 0xffffff, 0.2);
      g.strokeCircle(x, y, radius * 2.35 * pulse);
      if (burst) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + t * 1.2;
          const r0 = radius * 1.4;
          const r1 = radius * (2.1 + Math.sin(t * 5 + k) * 0.15);
          g.lineStyle(2, color, 0.45);
          g.lineBetween(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1);
        }
      }
    };
    const P = this.player;
    if (P.alive && P.state.form >= 3) {
      const col = Phaser.Display.Color.HexStringToColor(P.species.elementColor).color;
      drawAura(P.x, P.y, P.radius, col, P.state.form >= 4);
    }
    for (const r of this.remotes.values()) {
      if (!r.alive || r.form < 3) continue;
      const col = Phaser.Display.Color.HexStringToColor(getSpecies(r.speciesId).elementColor).color;
      drawAura(r.x, r.y, r.radius, col, r.form >= 4);
    }
    for (const m of this.player.state.markers) {
      const y = m.y - 26 + Math.sin(t * 3) * 3;
      g.fillStyle(0xc08aff, 0.9);
      g.fillTriangle(m.x - 7, y - 10, m.x + 7, y - 10, m.x, y + 2);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(m.x, y - 7, 2.5);
    }
    this.drawNavGroundArrows(g, t);
    if (this.navTarget) {
      const n = this.navTarget;
      const y = n.y - 28 + Math.sin(t * 3.2) * 3;
      g.fillStyle(0xff9a3a, 0.95);
      g.fillTriangle(n.x - 8, y - 12, n.x + 8, y - 12, n.x, y + 3);
      g.fillStyle(0xfff6d0, 0.95);
      g.fillCircle(n.x, y - 8, 2.8);
      g.lineStyle(1.5, 0xff9a3a, 0.35 + Math.sin(t * 4) * 0.1);
      g.strokeCircle(n.x, n.y, 18 + Math.sin(t * 3) * 3);
      // Destination pad on the ground
      g.fillStyle(0xff9a3a, 0.18 + Math.sin(t * 4) * 0.05);
      g.fillCircle(n.x, n.y, 16);
      g.lineStyle(2, 0xff9a3a, 0.55);
      g.strokeCircle(n.x, n.y, 14 + Math.sin(t * 3) * 2);
    }
    if (this.debug.hitbox) {
      g.lineStyle(1, 0x00ff00, 1);
      g.strokeCircle(P.x, P.y, P.radius);
      g.lineStyle(1, 0xffff00, 0.6);
      g.strokeCircle(P.x, P.y, BALANCE.actions.interactRange + P.radius);
      for (const s of this.wv.shelters) {
        g.lineStyle(1, 0x80ffff, 0.6);
        g.strokeCircle(s.x, s.y, BALANCE.world.shelterSafeRadius);
      }
    }
  }

  private drawMinimap(): void {
    this.minimap.draw(this.minimapDots());
  }

  private hudData(): HudData {
    const P = this.player;
    const S = P.state;
    const f = P.form;
    const status: string[] = [];
    const inCombat = this.inCombat();
    if (this.evo.active) status.push('Đang tiến hóa');
    if (P.inShelter) status.push('🏠 Nơi trú ẩn');
    if (P.rest.mode === 'sleeping') status.push(P.inShelter ? 'Đang ngủ' : 'Ngủ ngoài trời (nguy hiểm)');
    else if (P.rest.mode === 'resting') status.push(P.rest.settled ? 'Đang nghỉ · hồi máu' : 'Nằm xuống...');
    if (this.nearHealpad) status.push('💊 Trụ hồi máu');
    if (inCombat) status.push('⚔ Chiến đấu');
    if (P.sprinting) status.push('Chạy nhanh');
    if (P.buff) {
      const left = Math.max(0, P.buff.until - this.clock.time);
      status.push(`✨ ${P.buff.name} ${left.toFixed(1)}s`);
    }
    if (S.fatigue >= BALANCE.survival.fatigueExhaustedLevel) status.push('Kiệt sức');
    else if (S.fatigue >= BALANCE.survival.fatigueTiredLevel) status.push('Mệt mỏi (chậm hơn)');
    const warnings: string[] = [];
    if (S.hunger <= 0) warnings.push('ĐANG CHẾT ĐÓI');
    else if (S.hunger < BALANCE.survival.warnLevel) warnings.push('Đói');
    if (S.thirst <= 0) warnings.push('ĐANG CHẾT KHÁT');
    else if (S.thirst < BALANCE.survival.warnLevel) warnings.push('Khát');
    if (S.fatigue >= BALANCE.survival.fatigueExhaustedLevel) warnings.push('Cần ngủ');

    for (const k of P.status.list()) status.push(`${STATUS_INFO[k].icon} ${STATUS_INFO[k].name} ${Math.ceil(P.status.left(k))}s`);
    if (P.inSwamp && !getSpecies(S.speciesId).swampWalker && !P.flies) status.push('Lội bùn (chậm)');
    if (P.inWater && !P.flies) status.push('🏊 Bơi (chậm)');
    if (P.flies) status.push('Bay lượn');
    else if (P.bipedal) status.push('Đi hai chân');
    const ev = this.currentEvent();
    if (ev.id === 'blood_moon') status.push('🩸 Trăng Máu');
    else if (ev.id !== 'none') status.push(`${ev.icon} ${ev.name}`);

    const q = primaryQuest(S, this.guardianDown);
    const quest = q
      ? { title: q.title, progress: q.progress, target: q.target, done: q.done }
      : null;

    const atkColor = Phaser.Display.Color.HexStringToColor(P.species.elementColor).color;
    const basicTip = {
      title: f.basic.name,
      body: 'Đòn đánh thường cận chiến.',
      meta: `Hồi ${f.basic.cooldownSec}s · ${f.basic.stamina} thể lực · x${f.basic.dmgMult.toFixed(1)} sát thương`,
      icon: basicAttackIconUrl(atkColor),
    };
    const skills: HudData['skills'] = [
      {
        key: 'Chuột',
        name: f.basic.name,
        cd: P.cds.fraction('basic'),
        cdLeft: P.cds.left('basic'),
        locked: false,
        icon: basicTip.icon,
        tip: basicTip,
      },
    ];
    for (let i = 0; i < SKILL_SLOTS; i++) {
      const sk = P.skillAt(i);
      const open = slotUnlocked(S, i);
      const key = sk ? Player.cdKey(sk) : '';
      const tip = sk ? formatSkillTip(sk) : null;
      skills.push({
        key: SLOT_KEYS[i],
        name: !open ? 'Khóa (dạng 2)' : sk ? sk.name : 'Trống',
        cd: sk ? P.cds.fraction(key) : 0,
        cdLeft: sk ? P.cds.left(key) : 0,
        locked: !open || !sk,
        icon: tip?.icon,
        tip: tip ?? (!open ? { title: 'Ô chiêu khóa', body: 'Mở khóa ô T khi tiến hóa lên dạng 2.', meta: 'Tiến hóa để mở', icon: basicTip.icon } : null),
      });
    }
    const dodgeTip = {
      title: 'Né',
      body: 'Lướt nhanh theo hướng đang nhìn, tránh đòn đánh.',
      meta: `Hồi chiêu riêng · tốn thể lực`,
      icon: dodgeIconUrl(),
    };
    const resting = P.rest.mode !== 'awake';
    const restTip = {
      title: resting ? 'Đứng dậy' : 'Nghỉ',
      body: resting ? 'Dừng nằm nghỉ và đứng dậy.' : 'Nằm nghỉ để hồi máu từ từ (an toàn hơn trong nơi trú ẩn).',
      meta: resting ? 'Nhấn để dậy' : 'Hồi máu khi nghỉ',
      icon: restIconUrl(!resting),
    };
    skills.push(
      { key: 'Space', name: 'Né', cd: P.cds.fraction('dodge'), cdLeft: P.cds.left('dodge'), locked: false, icon: dodgeTip.icon, tip: dodgeTip },
      { key: 'F', name: resting ? 'Dậy' : 'Nghỉ', cd: 0, cdLeft: 0, locked: false, icon: restTip.icon, tip: restTip },
    );

    let target: HudData['target'] = null;
    const lt = this.lockedTarget(700);
    if (lt) {
      const safe = canDefeatNpc(P.score, lt.score);
      const st = lt.status.list().map((k) => STATUS_INFO[k].icon).join('');
      target = {
        name: `${lt.displayName}${lt.enraged ? ' 💢' : ''}${st ? ` ${st}` : ''}${safe ? '' : ' · quá mạnh'}`,
        level: lt.level,
        hp: lt.hp,
        maxHp: lt.maxHp,
        state: AI_STATE_NAMES[lt.state],
        danger: safe ? '#8ae06a' : '#ff6a5a',
      };
    }
    const locked = BALANCE.maturity.formGainMult[S.form] <= 0;
    return {
      speciesName: getSpecies(S.speciesId).lineName,
      formName: f.name,
      playerName: displayName(S),
      hp: S.hp,
      maxHp: P.stats.maxHp,
      hunger: S.hunger,
      thirst: S.thirst,
      stamina: S.stamina,
      maxStamina: maxStamina(S, P.stats),
      fatigue: S.fatigue,
      level: S.level,
      exp: S.exp,
      expNext: expToNext(S.level),
      maturity: locked ? BALANCE.maturity.max : S.maturity,
      maturityMax: BALANCE.maturity.max,
      maturityLocked: locked,
      evoReady: !locked && isMaturityFull(S),
      clock: formatClock(this.clock.timeOfDay),
      day: this.clock.day,
      weather: this.weather.state,
      night: this.clock.isNight,
      biome: `Vùng ${this.realm + 1} · ${BIOME_NAMES[BIOME_IDS[this.wv.biomeAt(P.x, P.y)]]}`,
      coins: S.coins,
      inventory: S.inventory,
      skills,
      status,
      warnings,
      target,
      quest,
      lives: S.lives ?? BALANCE.lives.max,
      maxLives: BALANCE.lives.max,
    };
  }

  private debugText(): string {
    const P = this.player;
    const counts: Record<string, number> = {};
    for (const n of this.npcs.npcs) if (n.alive) counts[n.def.name] = (counts[n.def.name] ?? 0) + 1;
    return [
      `[DEBUG] FPS ${Math.round(this.game.loop.actualFps)} | F6 hitbox F7 bất tử F8 tiến hóa nhanh F9 +3h`,
      `seed ${this.seed} | pos ${Math.round(P.x / T)},${Math.round(P.y / T)} | t=${this.clock.time.toFixed(0)}s`,
      `NPC ${this.npcs.npcs.length}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`,
      `hitbox ${this.debug.hitbox ? 'BẬT' : 'tắt'} | bất tử ${this.debug.god ? 'BẬT' : 'tắt'} | aggro ${this.npcs.countAggroOnPlayer()} | đêm ${this.nightIndex}${this.bloodMoon ? ' TRĂNG MÁU' : ''}`,
    ].join('\n');
  }

  // ------------------------------------------------------------------ teardown

  private cleanup(): void {
    this.started = false;
    this.scale.off('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('beforeunload', this.onUnload);
    this.input.off('pointerdown');
    const kb = this.input.keyboard;
    if (kb) {
      kb.removeAllKeys(true);
      kb.clearCaptures();
    }
    this.multiOff?.();
    this.multiOff = null;
    this.multiJoinOff?.();
    this.multiJoinOff = null;
    for (const r of this.remotes.values()) r.destroy();
    this.remotes.clear();
    app.ui.setMultiBanner(null);
    this.multiMode = false;
    // Room stays open across travel; menu / leaveMultiRoom owns destruction.
    audio.stopLoops();
    this.game.events.off(Phaser.Core.Events.POST_RENDER, this.render3d);
    this.r3d?.dispose();
    this.r3d = null;
    this.combat?.destroy();
    this.npcs?.destroy();
    this.fx?.destroy();
    this.lighting?.destroy();
    this.player?.destroy();
    this.wv?.destroy();
    this.anims.resumeAll();
    this.tweens.killAll();
    this.time.removeAllEvents();
    app.ui.nameTags.clear();
    app.ui.showHud(false);
    app.ui.evoProgress(false);
    app.ui.setPrompt(null);
    app.ui.setDebug(null);
    app.ui.onInvTap = null;
    app.ui.onPromptTap = null;
    app.ui.touch.reset();
  }
}
