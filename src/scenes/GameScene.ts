import Phaser from 'phaser';
import { app, type GameStartData } from '../app';
import { BALANCE, expToNext } from '../config/balance';
import { formatClock, formatDuration } from '../core/math';
import { FOODS, canEat } from '../data/foods';
import { MILESTONE_MAP } from '../data/milestones';
import { COLOR_VARIANTS, SHOP } from '../data/shop';
import { SKILLS } from '../data/skills';
import { getSpecies } from '../data/species';
import { audio } from '../systems/audio';
import { addToInventory, decaySatiation, drinkWater, eatFood, eatFromSlot, hasInventorySpace } from '../systems/diet';
import { EvolutionProcess, canEvolve, completeEvolution, evolutionChecks, evolutionDuration } from '../systems/evolution';
import { createPlayerState, formOf, type PlayerState } from '../systems/playerState';
import { addExp, addMaturity, isMaturityFull, killReward } from '../systems/progression';
import { deleteSave, writeSave, type SaveData } from '../systems/save';
import { DEBUG_ENABLED, saveSettings } from '../systems/settings';
import { maxStamina, tickSurvival } from '../systems/survival';
import { WorldClock, WeatherSystem, WEATHER_NAMES } from '../systems/timeWeather';
import { Minimap } from '../ui/Minimap';
import { esc, type HudData } from '../ui/UI';
import { findDrinkableWater } from '../world/collision';
import { BIOME_IDS, BIOME_NAMES, type WorldData } from '../world/tiles';
import { generateWorld } from '../world/worldGen';
import { CombatSystem, type Creature, type DamageEvent } from '../game/CombatSystem';
import { Effects, FX_DEPTH } from '../game/Effects';
import { Lighting } from '../game/Lighting';
import { AI_STATE_NAMES, Npc, NpcManager } from '../game/Npcs';
import { Player, type PlayerInput } from '../game/Player';
import type { Carcass, ResourceNode } from '../game/WorldView';
import { WorldView } from '../game/WorldView';

const T = BALANCE.tile;

type KeyName =
  | 'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'SHIFT' | 'SPACE' | 'E' | 'F' | 'Q' | 'R' | 'M' | 'TAB' | 'ESC'
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
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private seed = '';

  private paused = false;
  private dead = false;
  private started = false;
  private attackQueued = false;
  private lastCombatAt = -99;
  private lastDamageCause = '';
  private autosaveT = 0;
  private hudT = 0;
  private minimapT = 0;
  private charT = 0;
  private exploreT = 0;
  private lastSector = -1;
  private lastTarget: Npc | null = null;
  private lastTargetAt = -99;
  private warned = { hunger: false, thirst: false };
  private prevRestMode = 'awake';
  private interaction: Interaction | null = null;
  private debug = { hitbox: false, god: false };
  private discovered = new Set<number>();

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
    this.started = false;
    this.attackQueued = false;
    this.lastCombatAt = -99;
    this.autosaveT = 0;
    this.lastSector = -1;
    this.lastTarget = null;
    this.warned = { hunger: false, thirst: false };
    this.prevRestMode = 'awake';
    this.interaction = null;
    this.debug = { hitbox: false, god: false };
  }

  create(data: GameStartData): void {
    const save: SaveData | undefined = data.mode === 'continue' ? data.save : undefined;
    this.seed = save ? save.seed : (data.seed as string);
    this.world = generateWorld(this.seed);
    this.wv = new WorldView(this, this.world);
    if (save) this.wv.applySave(save.world);

    const sx = this.world.spawn.tx * T + T / 2;
    const sy = this.world.spawn.ty * T + T / 2;
    const state: PlayerState = save ? save.player : createPlayerState(data.speciesId as string, sx, sy);
    this.clock = new WorldClock(save ? save.world.time : 0);
    this.weather = new WeatherSystem(this.seed);
    if (save) this.weather.restore(save.world.weather, save.world.weatherRemaining, save.world.weatherRolls);
    this.discovered = new Set(state.discoveredSectors);

    this.fx = new Effects(this);
    this.combat = new CombatSystem(this, this.fx, this.world, (x, y, r) => this.creaturesNear(x, y, r), (e) => this.onDamage(e));
    this.player = new Player(this, state);
    this.npcs = new NpcManager(this, this.wv, this.combat, this.fx, {
      now: () => this.clock.time,
      hour: () => this.clock.hour,
      isNight: () => this.clock.isNight,
      player: this.player,
      audio,
    });
    this.npcs.alphaDefeatedAt = save ? save.world.alphaDefeatedAt : null;
    this.npcs.onRemoved = (n) => {
      if (this.lastTarget === n) this.lastTarget = null;
    };
    this.npcs.initialPopulate();

    this.lighting = new Lighting(this);
    this.overlayG = this.add.graphics().setDepth(FX_DEPTH);

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.world.w * T, this.world.h * T);
    cam.startFollow(this.player.sprite, true, 0.14, 0.14);
    cam.setRoundPixels(true);
    cam.setBackgroundColor('#1b2a1b');

    this.setupInput();

    this.minimap = new Minimap(this.world, this.wv.shelters, this.wv.shrine);
    app.ui.hideScreens();
    app.ui.closeOverlay();
    app.ui.showHud(true);
    app.ui.mountMinimap(this.minimap.canvas);
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
    if (!save) {
      app.ui.toast(`Chào mừng, ${formOf(state).name}! Hãy tìm thức ăn và nước.`, 'good');
      this.saveNow(false);
    } else app.ui.toast('Đã tải bản lưu.', 'good');
    this.checkExploration(true);
    (document.getElementById('game-root') as HTMLElement).focus();
  }

  // ------------------------------------------------------------------ input

  private setupInput(): void {
    const kb = this.input.keyboard as Phaser.Input.Keyboard.KeyboardPlugin;
    this.keys = kb.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SHIFT,SPACE,E,F,Q,R,M,TAB,ESC,ONE,TWO,THREE,FOUR,FIVE,SIX,F6,F7,F8,F9', true) as Record<KeyName, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      audio.unlock();
      if (p.leftButtonDown() && !app.ui.modalOpen && !this.paused) this.attackQueued = true;
    });
  }

  private just(k: KeyName): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keys[k]);
  }

  private readInput(): PlayerInput {
    const k = this.keys;
    const blocked = app.ui.modalOpen || this.paused || this.dead;
    let mx = 0;
    let my = 0;
    if (!blocked) {
      if (k.A.isDown || k.LEFT.isDown) mx -= 1;
      if (k.D.isDown || k.RIGHT.isDown) mx += 1;
      if (k.W.isDown || k.UP.isDown) my -= 1;
      if (k.S.isDown || k.DOWN.isDown) my += 1;
    }
    const ptr = this.input.activePointer;
    const wp = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
    const aim = Math.atan2(wp.y - (this.player.y - this.player.radius * 0.6), wp.x - this.player.x);
    const inp: PlayerInput = {
      mx,
      my,
      sprint: !blocked && k.SHIFT.isDown,
      aim,
      attack: !blocked && this.attackQueued,
      q: !blocked && this.just('Q'),
      r: !blocked && this.just('R'),
      dodge: !blocked && this.just('SPACE'),
    };
    this.attackQueued = false;
    return inp;
  }

  private handleMenuKeys(): void {
    if (this.just('ESC')) {
      if (app.ui.openPanel === 'pause') this.resume();
      else if (app.ui.openPanel) app.ui.closeOverlay();
      else if (!app.ui.modalOpen && !this.dead) this.openPause();
    }
    if (this.just('TAB') && !this.paused && !this.dead) {
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
      this.drawOverlay();
      return;
    }

    const P = this.player;
    const S = P.state;

    // --- time & weather ---
    const dawns = this.clock.update(dt);
    for (let i = 0; i < dawns; i++) this.onDawn();
    if (this.weather.update(dt, this.clock.hour)) app.ui.toast(`Thời tiết: ${WEATHER_NAMES[this.weather.state]}`);

    // --- one-shot keys (gameplay) ---
    const blocked = app.ui.modalOpen || this.dead;
    if (!blocked && P.alive) this.handleActionKeys();

    // --- player ---
    const input = this.readInput();
    if (this.evo.active && input.dodge) {
      this.interruptEvolution('Bạn đã hủy tiến hóa.');
      input.dodge = false;
    }
    P.inShelter = !!this.wv.shelterAt(P.x, P.y);
    P.evolving = this.evo.active;
    P.update(dt, input, { world: this.world, combat: this.combat, fx: this.fx, audio, now: this.clock.time, weather: this.weather.state });

    if (P.alive) {
      P.rest.update(dt, S.fatigue);
      const inCombat = this.inCombat();
      const tick = tickSurvival(
        S,
        P.stats,
        P.form,
        dt,
        { moving: P.moving, sprinting: P.sprinting, inCombat, rest: P.rest, inShelter: P.inShelter, weather: this.weather.state, buffRegen: P.buff?.regen ?? 0 },
        P.stam,
      );
      if (tick.outOfStamina) P.exhaustSprint();
      if (tick.starving) this.lastDamageCause = 'Chết đói.';
      else if (tick.dehydrated) this.lastDamageCause = 'Chết khát.';
      decaySatiation(S, dt);
      this.passiveGrowth(dt);
      this.trackRest();
      this.warnNeeds();
      if (this.debug.god) S.hp = Math.max(S.hp, 1);
    }

    this.updateEvolution(dt);
    this.npcs.update(dt);
    this.combat.update(dt);
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

    this.lighting.update(dt, this.clock.hour, this.weather.state, P.x - this.cameras.main.worldView.x, P.y - this.player.radius - this.cameras.main.worldView.y, this.wv.biomeAt(P.x, P.y) === 1);
    audio.updateAmbient(dt, this.clock.isNight, this.weather.state === 'rain');
    audio.setRain(this.lighting.rainIntensity);
    this.drawOverlay();

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.1;
      app.ui.updateHud(this.hudData());
      if (DEBUG_ENABLED) app.ui.setDebug(this.debugText());
    }
    this.minimapT -= dt;
    if (this.minimapT <= 0) {
      this.minimapT = 0.25;
      this.drawMinimap();
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
  }

  private handleActionKeys(): void {
    const P = this.player;
    if (this.just('E') && this.interaction && !this.evo.active) this.interaction.run();
    if (this.just('F') && !this.evo.active && !P.busy) {
      if (P.rest.toggle()) {
        if (P.rest.mode === 'resting') app.ui.toast(P.inShelter ? 'Nằm nghỉ trong nơi trú ẩn.' : 'Nằm nghỉ ngoài trời — hãy cẩn thận!');
      }
    }
    const slotKeys: KeyName[] = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
    slotKeys.forEach((k, i) => {
      if (this.just(k) && i < P.state.slots && !this.evo.active) this.eatSlot(i);
    });
    if (this.just('M')) this.toggleMarker();
    if (DEBUG_ENABLED) {
      if (this.just('F6')) this.debug.hitbox = !this.debug.hitbox;
      if (this.just('F7')) this.toggleGod();
      if (this.just('F8')) this.debugQuickEvolve();
      if (this.just('F9')) this.clock.time += BALANCE.time.dayLengthSec / 8;
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
    return out;
  }

  // ------------------------------------------------------------------ survival helpers

  private passiveGrowth(dt: number): void {
    const S = this.player.state;
    const m = BALANCE.maturity;
    if (S.hunger >= m.passiveMinNeeds && S.thirst >= m.passiveMinNeeds) addMaturity(S, m.passivePerSec * dt);
  }

  private trackRest(): void {
    const P = this.player;
    const mode = P.rest.mode;
    if (mode !== this.prevRestMode) {
      if (mode === 'sleeping') {
        app.ui.toast(P.inShelter ? 'Bạn đã ngủ say trong nơi trú ẩn.' : 'Bạn ngủ ngoài trời — kẻ săn mồi có thể tấn công!', P.inShelter ? 'good' : 'bad');
        if (P.inShelter) this.milestone('safe_sleep');
      } else if (this.prevRestMode === 'sleeping' && mode === 'resting') app.ui.toast('Bạn đã ngủ đủ, hết mệt mỏi.', 'good');
      this.prevRestMode = mode;
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
    const exp = BALANCE.progression.expPerDay;
    const mat = addMaturity(S, BALANCE.maturity.perDay);
    this.gainExp(exp);
    app.ui.toast(`Bình minh ngày ${this.clock.day}: sống sót thêm một đêm (+${exp} EXP, +${mat.toFixed(0)} trưởng thành)`, 'good');
    if (S.stats.daysSurvived >= 3) this.milestone('day_3');
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
    }
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
      if (S.discoveredBiomes.length >= 4) this.milestone('all_biomes');
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
    if (this.wv.shrine && Math.hypot(this.wv.shrine.x - P.x, this.wv.shrine.y - P.y) < reach + 14) {
      return { html: '<kbd>E</kbd>Mở Đền Cổ (nâng cấp bằng tiền xu)', run: () => this.openShop() };
    }
    for (const st of this.wv.stones) {
      if (st.done) continue;
      if (Math.hypot(st.obj.x - P.x, st.obj.y - P.y) < reach + 6) return { html: '<kbd>E</kbd>Khám phá Đá Cổ', run: () => this.useStone(st) };
    }

    // Food
    let food: { label: string; dist: number; run: () => void } | null = null;
    const carcass = this.wv.carcGrid.nearest(P.x, P.y, reach, (c) => c.portions > 0);
    if (carcass && canEat(diet, 'thit')) {
      const d = Math.hypot(carcass.x - P.x, carcass.y - P.y);
      if (preferPick) food = { label: `<kbd>E</kbd>Nhặt Thịt vào túi`, dist: d, run: () => this.pickCarcass(carcass) };
      else if (!full) food = { label: `<kbd>E</kbd>Ăn Thịt <small>(+${Math.round(FOODS.thit.hunger * FOODS.thit.efficiency[diet])} no)</small>`, dist: d, run: () => this.eatCarcass(carcass) };
    }
    const node = this.wv.resGrid.nearest(P.x, P.y, reach, (n) => n.portions > 0 && canEat(diet, n.def.food));
    if (node) {
      const d = Math.hypot(node.x - P.x, node.y - P.y);
      if (!food || d < food.dist) {
        const f = FOODS[node.def.food];
        const eff = f.efficiency[diet];
        if (preferPick && f.carriable) food = { label: `<kbd>E</kbd>Hái ${esc(f.name)} vào túi`, dist: d, run: () => this.pickNode(node) };
        else if (!full || node.def.kind === 'crystal') {
          const effTxt = eff < 1 ? ` · hiệu quả ${Math.round(eff * 100)}%` : '';
          food = { label: `<kbd>E</kbd>${esc(node.def.verb)} ${esc(f.name)} <small>(+${Math.round(f.hunger * eff)} no${effTxt})</small>`, dist: d, run: () => this.eatNode(node) };
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
      const r = eatFood(P.state, P.diet, node.def.food);
      if (!r.ok) return;
      this.wv.consume(node, this.clock.time);
      this.afterEat(node.def.food, r.hunger, r.maturity, node.x, node.y);
    });
    audio.play('eat');
  }

  private eatCarcass(c: Carcass): void {
    const P = this.player;
    this.faceTo(c.x);
    P.startTimedAction('eat', BALANCE.actions.eatSec, () => {
      if (c.portions <= 0) return;
      const r = eatFood(P.state, P.diet, 'thit');
      if (!r.ok) return;
      this.wv.consumeCarcass(c);
      this.afterEat('thit', r.hunger, r.maturity, c.x, c.y);
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
    if (c.portions <= 0 || !addToInventory(S, 'thit')) return;
    this.wv.consumeCarcass(c);
    audio.play('pickup');
    app.ui.toast('Đã cất Thịt vào túi.');
  }

  private eatSlot(i: number): void {
    const P = this.player;
    const id = P.state.inventory[i];
    if (!id) return;
    if (!canEat(P.diet, id)) {
      app.ui.toast(`${FOODS[id].name} không hợp với chế độ ăn của bạn.`, 'bad');
      return;
    }
    if (P.state.hunger >= 99.5) {
      app.ui.toast('Bạn đã no.', '');
      return;
    }
    P.startTimedAction('eat', BALANCE.actions.eatSec, () => {
      const r = eatFromSlot(P.state, P.diet, i);
      if (r.ok) this.afterEat(id, r.hunger, r.maturity, P.x, P.y);
    });
    audio.play('eat');
  }

  private afterEat(foodId: string, hunger: number, maturity: number, x: number, y: number): void {
    this.fx.burst(x, y - 6, foodId === 'thit' ? 'blood' : 'leaf', 6, { speed: 60, life: 0.5, tint: foodId === 'thit' ? 0xc04040 : undefined });
    this.fx.text(this.player.x, this.player.y - this.player.radius * 2.6, `+${Math.round(hunger)} no${maturity > 0.05 ? ` · +${maturity.toFixed(1)} 🌱` : ''}`, '#9af07a', 14);
    if (maturity <= 0.05 && BALANCE.maturity.formGainMult[this.player.state.form] > 0 && foodId !== 'khoang') {
      if (Math.random() < 0.3) app.ui.toast('Ăn quá no hoặc ăn liên tục không giúp trưởng thành thêm.', '');
    }
    this.milestone('first_meal');
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
      this.milestone('first_drink');
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
    this.wv.useStone(st as never);
    this.gainExp(15);
    const mat = addMaturity(S, 3);
    audio.play('coin');
    this.fx.burst(st.obj.x, st.obj.y - 20, 'star', 14, { speed: 80, life: 0.8, tint: 0x5ef0d0 });
    app.ui.toast(`Đá Cổ tỏa sáng: +${coins} xu, +15 EXP, +${mat.toFixed(0)} trưởng thành`, 'good');
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

  // ------------------------------------------------------------------ combat events

  private onDamage(e: DamageEvent): void {
    const now = this.clock.time;
    if (e.target.isPlayer) {
      const P = this.player;
      this.lastCombatAt = now;
      P.hurtFlash = 0.22;
      P.stun(BALANCE.combat.hitStunSec);
      P.cancelAction();
      if (P.rest.mode !== 'awake') {
        if (P.rest.mode === 'sleeping') app.ui.toast('Bạn bị tấn công và bị đánh thức!', 'bad');
        P.rest.wake();
      }
      if (this.evo.active) this.interruptEvolution('Tiến hóa bị gián đoạn do bị tấn công! Thanh trưởng thành được giữ nguyên.');
      audio.play('hurt');
      this.cameras.main.shake(120, 0.004);
      if (e.attacker instanceof Npc) {
        this.lastTarget = e.attacker;
        this.lastTargetAt = now;
        this.lastDamageCause = `Bị ${e.attacker.def.name} hạ gục.`;
      }
      return;
    }
    const n = e.target as Npc;
    this.npcs.onDamaged(n, e.attacker);
    if (e.attacker.isPlayer) {
      this.lastCombatAt = now;
      this.lastTarget = n;
      this.lastTargetAt = now;
      audio.play('hit');
    }
    if (e.killed) {
      this.npcs.kill(n, e.attacker);
      if (n.sprite.visible) audio.play('npcDie');
      if (e.attacker.isPlayer) this.onPlayerKill(n);
    }
  }

  private onPlayerKill(n: Npc): void {
    const S = this.player.state;
    S.stats.kills++;
    const r = killReward(this.player.stats, n.def);
    const mat = addMaturity(S, r.maturity);
    this.gainExp(r.exp);
    this.fx.text(n.x, n.y - n.radius * 2 - 18, `+${r.exp} EXP`, '#ffe08a', 15);
    if (mat > 0.05) this.fx.text(n.x, n.y - n.radius * 2 - 34, `+${mat.toFixed(1)} 🌱`, '#9af07a', 13);
    else if (r.ratio < BALANCE.maturity.killMinPowerRatio) app.ui.toast('Con mồi quá yếu so với bạn — không giúp trưởng thành.', '');
    this.milestone('first_kill');
    if (S.stats.kills >= 10) this.milestone('hunter_10');
    if (n.def.unique) this.milestone('alpha');
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
        return { state: S, stats: this.player.stats, checks: evolutionChecks(S, ctx), canEvolve: canEvolve(S, ctx) && !this.evo.active, evoDuration: evolutionDuration(S.form) };
      },
      () => void this.requestEvolution(),
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
    const r = f.skillR ? SKILLS[f.skillR].name : null;
    app.ui.toast(`✨ Tiến hóa thành công: ${f.name}! ${r ? `Kỹ năng mới: ${r}.` : ''}`, 'evo');
    if (f.canClimbLedges) app.ui.toast('Bạn giờ có thể leo vách đá để lên cao nguyên đá.', 'good');
    this.milestone(S.form === 1 ? 'evolve_1' : 'evolve_2');
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
    if (S.form >= 2) return;
    S.maturity = BALANCE.maturity.max;
    while (S.level < BALANCE.evolution.requiredLevel[S.form]) addExp(S, expToNext(S.level));
    this.player.recomputeStats();
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
        alphaDefeatedAt: this.npcs.alphaDefeatedAt,
      },
    };
  }

  /** Writes a consistent snapshot of the whole run. Never saves a dead character. */
  saveNow(showToast: boolean): boolean {
    if (!this.started || this.dead || !this.player.alive) return false;
    const r = writeSave(localStorage, this.buildSave());
    if (!r.ok) app.ui.toast(`Không thể lưu: ${r.error}`, 'bad');
    else if (showToast) app.ui.toast('Đã tự động lưu.', 'good');
    return r.ok;
  }

  private onPlayerDeath(): void {
    const P = this.player;
    const S = P.state;
    P.alive = false;
    this.dead = true;
    if (this.evo.active) this.interruptEvolution('Tiến hóa thất bại.');
    audio.play('death');
    audio.setEvolveDrone(false);
    deleteSave(localStorage);
    this.combat.cancelOwner(P.uid);
    const summary = {
      name: formOf(S).name,
      cause: this.lastDamageCause || 'Kiệt sức.',
      days: S.stats.daysSurvived,
      time: formatDuration(S.stats.timeAlive),
      level: S.level,
      form: `${formOf(S).name} (dạng ${S.form + 1}/3)`,
      kills: S.stats.kills,
      coins: S.coins,
    };
    this.time.delayedCall(1400, () => app.ui.showDeath(summary, () => app.newRun(), () => app.showMenu(null)));
  }

  // ------------------------------------------------------------------ drawing

  private drawOverlay(): void {
    const g = this.overlayG;
    g.clear();
    this.combat.draw(g, this.debug.hitbox, this.time.now);
    this.combat.swingVisual(g);
    this.npcs.drawBars(g, this.player.score, this.debug.hitbox);
    this.fx.drawRings(g);
    const t = this.time.now / 1000;
    for (const m of this.player.state.markers) {
      const y = m.y - 26 + Math.sin(t * 3) * 3;
      g.fillStyle(0xc08aff, 0.9);
      g.fillTriangle(m.x - 7, y - 10, m.x + 7, y - 10, m.x, y + 2);
      g.fillStyle(0xffffff, 0.9);
      g.fillCircle(m.x, y - 7, 2.5);
    }
    if (this.debug.hitbox) {
      const P = this.player;
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
    const P = this.player;
    const vision = Lighting.visionRadius(this.clock.hour, this.wv.biomeAt(P.x, P.y) === 1);
    const hostiles = this.npcs
      .creaturesNear(P.x, P.y, Math.min(700, vision + 100))
      .filter((n) => n.alive && (n.def.temperament === 'predator' || n.def.temperament === 'apex' || n.def.temperament === 'territorial'))
      .map((n) => ({ x: n.x, y: n.y }));
    this.minimap.draw({ px: P.x, py: P.y, hostiles, markers: P.state.markers, discovered: this.discovered });
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
    else if (P.rest.mode === 'resting') status.push(P.rest.settled ? 'Đang nghỉ' : 'Nằm xuống...');
    if (inCombat) status.push('⚔ Chiến đấu');
    if (P.sprinting) status.push('Chạy nhanh');
    if (P.buff) status.push('Hiệu ứng kỹ năng');
    if (S.fatigue >= BALANCE.survival.fatigueExhaustedLevel) status.push('Kiệt sức');
    else if (S.fatigue >= BALANCE.survival.fatigueTiredLevel) status.push('Mệt mỏi (chậm hơn)');
    const warnings: string[] = [];
    if (S.hunger <= 0) warnings.push('ĐANG CHẾT ĐÓI');
    else if (S.hunger < BALANCE.survival.warnLevel) warnings.push('Đói');
    if (S.thirst <= 0) warnings.push('ĐANG CHẾT KHÁT');
    else if (S.thirst < BALANCE.survival.warnLevel) warnings.push('Khát');
    if (S.fatigue >= BALANCE.survival.fatigueExhaustedLevel) warnings.push('Cần ngủ');

    const q = P.skillQ();
    const r = P.skillR();
    const skills = [
      { key: 'Chuột', name: f.basic.name, cd: P.cds.fraction('basic'), cdLeft: P.cds.left('basic'), locked: false },
      { key: 'Q', name: q.name, cd: P.cds.fraction('skill_q'), cdLeft: P.cds.left('skill_q'), locked: false },
      { key: 'R', name: r ? r.name : 'Khóa', cd: P.cds.fraction('skill_r'), cdLeft: P.cds.left('skill_r'), locked: !r },
      { key: 'Space', name: 'Né', cd: P.cds.fraction('dodge'), cdLeft: P.cds.left('dodge'), locked: false },
      { key: 'F', name: P.rest.mode === 'awake' ? 'Nghỉ' : 'Dậy', cd: 0, cdLeft: 0, locked: false },
    ];

    let target: HudData['target'] = null;
    const lt = this.lastTarget;
    if (lt && lt.alive && this.clock.time - this.lastTargetAt < 8 && Math.hypot(lt.x - P.x, lt.y - P.y) < 700) {
      const ratio = lt.score / Math.max(1, P.score);
      target = {
        name: lt.def.name,
        level: lt.def.level,
        hp: lt.hp,
        maxHp: lt.maxHp,
        state: AI_STATE_NAMES[lt.state],
        danger: ratio > 1.3 ? '#ff6a5a' : ratio > 0.7 ? '#ffc04a' : '#8ae06a',
      };
    }
    const locked = BALANCE.maturity.formGainMult[S.form] <= 0;
    return {
      speciesName: getSpecies(S.speciesId).lineName,
      formName: f.name,
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
      biome: BIOME_NAMES[BIOME_IDS[this.wv.biomeAt(P.x, P.y)]],
      coins: S.coins,
      inventory: S.inventory,
      skills,
      status,
      warnings,
      target,
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
      `hitbox ${this.debug.hitbox ? 'BẬT' : 'tắt'} | bất tử ${this.debug.god ? 'BẬT' : 'tắt'} | aggro ${this.npcs.countAggroOnPlayer()}`,
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
    audio.stopLoops();
    this.combat?.destroy();
    this.npcs?.destroy();
    this.fx?.destroy();
    this.lighting?.destroy();
    this.player?.destroy();
    this.wv?.destroy();
    this.anims.resumeAll();
    this.tweens.killAll();
    this.time.removeAllEvents();
    app.ui.showHud(false);
    app.ui.evoProgress(false);
    app.ui.setPrompt(null);
    app.ui.setDebug(null);
  }
}
