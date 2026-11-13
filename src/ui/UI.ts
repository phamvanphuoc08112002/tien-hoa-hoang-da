import { BALANCE } from '../config/balance';
import { formatDuration } from '../core/math';
import { CONSUMABLES, isConsumable } from '../data/consumables';
import { FOODS } from '../data/foods';
import { listQuests } from '../data/quests';
import { COLOR_VARIANTS, SHOP } from '../data/shop';
import { SKILLS, skillRoot } from '../data/skills';
import { SLOT_KEYS, reqLabel, slotUnlocked } from '../systems/skills';
import { SPECIES, getSpecies } from '../data/species';
import type { Weather } from '../data/types';
import { skillIconUrl, formatSkillTip } from '../gfx/skillIcons';
import { foodIconUrl, speciesPreviewUrl } from '../gfx/textures';
import { bestiaryCatalog, bestiaryStats } from '../systems/bestiary';
import type { EvoCheck } from '../systems/evolution';
import { displayName, isFinalForm, type PlayerState } from '../systems/playerState';
import type { Settings } from '../systems/settings';
import { WEATHER_NAMES } from '../systems/timeWeather';
import { bindFullscreenButton } from './fullscreen';
import { NameTags } from './NameTags';
import { TouchControls } from './TouchControls';
import type { Minimap, MinimapDots } from './Minimap';

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export interface SkillSlotData {
  key: string;
  name: string;
  cd: number;
  cdLeft: number;
  locked: boolean;
  /** Data-URL icon for the button (skills / attack / dodge / rest). */
  icon?: string;
  /** Long-press tip content. */
  tip?: { title: string; body: string; meta: string; icon: string } | null;
}

export interface HudData {
  speciesName: string;
  formName: string;
  /** Custom name or form name shown in the vitals header. */
  playerName: string;
  hp: number;
  maxHp: number;
  hunger: number;
  thirst: number;
  stamina: number;
  maxStamina: number;
  fatigue: number;
  level: number;
  exp: number;
  expNext: number;
  maturity: number;
  maturityMax: number;
  maturityLocked: boolean;
  evoReady: boolean;
  clock: string;
  day: number;
  weather: Weather;
  night: boolean;
  biome: string;
  coins: number;
  inventory: (string | null)[];
  skills: SkillSlotData[];
  status: string[];
  warnings: string[];
  target: { name: string; level: number; hp: number; maxHp: number; state: string; danger: string } | null;
  quest: { title: string; progress: number; target: number; done: boolean } | null;
}

export interface CharPanelData {
  state: PlayerState;
  stats: { maxHp: number; speed: number; power: number; defense: number; stamina: number };
  checks: EvoCheck[];
  canEvolve: boolean;
  evoDuration: number;
  guardianDown: boolean;
}

export interface ShopCallbacks {
  buySlot(): void;
  buyMarkers(): void;
  buyColor(id: string): void;
  equipColor(id: string): void;
  buyConsumable(id: string): void;
}

export interface PauseCallbacks {
  resume(): void;
  save(): void;
  quit(): void;
  settings(s: Settings): void;
  debug?: { toggleHitbox(): void; toggleGod(): void; quickEvolve(): void; skipTime(): void; flags(): string };
}

const WEATHER_ICON: Record<Weather, string> = { clear: '☀', rain: '🌧', heat: '🔥' };

const TOUCH_HELP: [string, string][] = [
  ['Cần trái', 'Kéo để di chuyển — đẩy hết cỡ sẽ tự chạy'],
  ['Đánh', 'Giữ nút Đánh để đánh liên tục, tự nhắm con gần nhất'],
  ['Q / R / T / Né', 'Chiêu thức và né tránh (nút tròn bên phải)'],
  ['Giữ chiêu', 'Đè lâu lên nút chiêu để đọc mô tả'],
  ['Nhân vật', 'Chỉ số, xu, túi đồ, chiêu thức và tiến hóa'],
  ['Chạy', 'Khóa chạy nhanh (không cần đẩy hết cần)'],
  ['Dùng', 'Ăn / uống / trụ hồi máu — nút sáng khi có việc gần đó'],
  ['Bản đồ nhỏ', 'Chạm để mở bản đồ lớn — đánh dấu và xem đường đi'],
  ['Nghỉ', 'Nằm nghỉ để hồi máu từng chút'],
  ['⛶', 'Toàn màn hình'],
];

export class UI {
  readonly root: HTMLElement;
  private menu!: HTMLElement;
  private select!: HTMLElement;
  private hud!: HTMLElement;
  private loading!: HTMLElement;
  private death!: HTMLElement;
  private overlay: HTMLElement | null = null;
  private overlayKind: 'char' | 'pause' | 'shop' | 'map' | null = null;
  private dialogOpen = false;
  private mapRefresh: (() => void) | null = null;
  private toastBox!: HTMLElement;
  private els: Record<string, HTMLElement> = {};
  private charRefresh: (() => CharPanelData) | null = null;
  private charEvolve: (() => void) | null = null;
  private charEquip: ((skillId: string, slot: number) => void) | null = null;
  private skillTipEl: HTMLElement | null = null;
  private skillTipHideT = 0;
  private lastSkillTips: (SkillSlotData['tip'] | null)[] = [];
  touch!: TouchControls;
  nameTags!: NameTags;
  onInvTap: ((slot: number) => void) | null = null;
  onPromptTap: (() => void) | null = null;

  constructor() {
    this.root = document.getElementById('ui') as HTMLElement;
    this.root.innerHTML = '';
    this.build();
  }

  get modalOpen(): boolean {
    return this.overlay !== null || this.dialogOpen || !this.death.classList.contains('hidden');
  }

  get openPanel(): 'char' | 'pause' | 'shop' | 'map' | null {
    return this.overlayKind;
  }

  private build(): void {
    this.menu = this.div('screen hidden', 'menu');
    this.select = this.div('screen hidden', 'select');
    this.loading = this.div('screen hidden', 'loading');
    this.death = this.div('screen hidden', 'death');
    this.hud = this.div('hidden', 'hud');
    this.root.append(this.menu, this.select, this.loading, this.hud, this.death);
    this.buildHud();
    // After buildHud — it replaces hud.innerHTML and would wipe an earlier mount.
    this.nameTags = new NameTags(this.hud);
    this.mountFullscreenButton();
  }

  /** Always-visible corner control (menu + game). Hidden on touch — that layout already has ⛶. */
  private mountFullscreenButton(): void {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'fs-btn';
    btn.className = 'fs-btn';
    this.root.append(btn);
    bindFullscreenButton(btn, { enter: '⛶', exit: '⛶' });
  }

  private div(cls: string, id?: string): HTMLElement {
    const d = document.createElement('div');
    d.className = cls;
    if (id) d.id = id;
    return d;
  }

  hideScreens(): void {
    for (const s of [this.menu, this.select, this.loading, this.death]) s.classList.add('hidden');
  }

  // ---------------------------------------------------------------- menus

  showLoading(text: string): void {
    this.hideScreens();
    this.loading.textContent = text;
    this.loading.classList.remove('hidden');
  }

  showMainMenu(o: {
    saveInfo: string | null;
    error: string | null;
    settings: Settings;
    onContinue: () => void;
    onNew: () => void;
    onMulti: () => void;
    onDeleteSave: () => void;
    onSettings: (s: Settings) => void;
  }): void {
    this.hideScreens();
    this.showHud(false);
    this.closeOverlay();
    this.setMultiBanner(null);
    const imgs = SPECIES.map((s) => `<img src="${speciesPreviewUrl(s.id, 0, false)}" alt="${esc(s.forms[0].name)}">`).join('');
    this.menu.innerHTML = `
      <div class="creatures">${imgs}</div>
      <h1>Tiến Hóa Hoang Dã</h1>
      <div class="sub">Sinh tồn • Săn mồi • Trưởng thành • Tiến hóa</div>
      ${o.error ? `<div class="error"><b>Không thể tải bản lưu:</b> ${esc(o.error)}<br><small>Bạn có thể xóa bản lưu hỏng và bắt đầu lượt mới.</small></div>` : ''}
      <div class="buttons">
        <button class="primary" data-a="continue" ${o.saveInfo ? '' : 'disabled'}>Tiếp tục</button>
        <button data-a="new">Chơi mới</button>
        <button data-a="multi">Chơi mạng</button>
        <button data-a="settings">Cài đặt</button>
        <button data-a="fullscreen">⛶ Toàn màn hình</button>
        ${o.saveInfo || o.error ? '<button class="danger" data-a="delete">Xóa bản lưu</button>' : ''}
      </div>
      <div class="save-info">${o.saveInfo ? esc(o.saveInfo) : 'Chưa có bản lưu'}</div>
      <div class="save-info">Âm thanh bắt đầu sau lần bấm đầu tiên.</div>`;
    this.menu.querySelector('[data-a=continue]')?.addEventListener('click', o.onContinue);
    const fsMenu = this.menu.querySelector<HTMLElement>('[data-a=fullscreen]');
    if (fsMenu) bindFullscreenButton(fsMenu);
    this.menu.querySelector('[data-a=new]')?.addEventListener('click', o.onNew);
    this.menu.querySelector('[data-a=multi]')?.addEventListener('click', o.onMulti);
    this.menu.querySelector('[data-a=delete]')?.addEventListener('click', o.onDeleteSave);
    this.menu.querySelector('[data-a=settings]')?.addEventListener('click', () => this.settingsDialog(o.settings, o.onSettings));
    this.menu.classList.remove('hidden');
  }

  /** Create / join multiplayer room dialog. */
  multiplayerDialog(): Promise<{ action: 'create' } | { action: 'join'; code: string } | null> {
    return new Promise((resolve) => {
      const m = this.div('modal');
      m.innerHTML = `<div class="panel">
        <h2>Chơi mạng</h2>
        <p style="margin:0 0 10px;color:var(--muted);font-size:13px;line-height:1.45">
          Cùng loài hỗ trợ nhau khi đứng gần. Bảo vệ đồng đội khi họ tiến hóa hoặc triệu hồi Boss Giữ Cổng.<br>
          Khác loài có thể tấn công lẫn nhau.
        </p>
        <div class="row" style="flex-wrap:wrap;gap:8px">
          <button class="primary" data-a="create">Tạo phòng</button>
          <button data-a="join">Vào phòng</button>
          <button data-a="cancel">Hủy</button>
        </div>
        <div class="seed-row" style="margin-top:12px;display:none" data-joinrow>
          <span>Mã phòng:</span>
          <input maxlength="8" placeholder="VD: AB3K7P" data-code style="text-transform:uppercase;letter-spacing:0.08em">
          <button class="primary" data-a="go">Vào</button>
        </div>
      </div>`;
      this.dialogOpen = true;
      const done = (v: { action: 'create' } | { action: 'join'; code: string } | null) => {
        m.remove();
        this.dialogOpen = false;
        resolve(v);
      };
      m.querySelector('[data-a=create]')?.addEventListener('click', () => done({ action: 'create' }));
      m.querySelector('[data-a=cancel]')?.addEventListener('click', () => done(null));
      m.querySelector('[data-a=join]')?.addEventListener('click', () => {
        const row = m.querySelector('[data-joinrow]') as HTMLElement;
        row.style.display = 'flex';
        (m.querySelector('[data-code]') as HTMLInputElement).focus();
      });
      m.querySelector('[data-a=go]')?.addEventListener('click', () => {
        const code = ((m.querySelector('[data-code]') as HTMLInputElement).value || '').trim();
        if (!code) return;
        done({ action: 'join', code });
      });
      this.root.append(m);
    });
  }

  /** Shows the room code while connecting / waiting. */
  multiStatus(title: string, bodyHtml: string): HTMLElement {
    const m = this.div('modal');
    m.innerHTML = `<div class="panel"><h2>${esc(title)}</h2><div data-body>${bodyHtml}</div><div class="row"><button data-a="cancel">Hủy</button></div></div>`;
    this.dialogOpen = true;
    this.root.append(m);
    return m;
  }

  closeMultiStatus(el: HTMLElement | null): void {
    el?.remove();
    this.dialogOpen = false;
  }

  setMultiBanner(text: string | null): void {
    let el = document.getElementById('multi-banner');
    if (!text) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'multi-banner';
      this.hud.append(el);
    }
    el.textContent = text;
  }

  private settingsHtml(s: Settings): string {
    return `
      <div class="settings-row"><label>Nhạc nền</label><input type="range" min="0" max="100" value="${Math.round(s.music * 100)}" data-s="music"><span>${Math.round(s.music * 100)}</span></div>
      <div class="settings-row"><label>Hiệu ứng</label><input type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}" data-s="sfx"><span>${Math.round(s.sfx * 100)}</span></div>
      <div class="settings-row"><label>Tắt tiếng</label><input type="checkbox" data-s="muted" ${s.muted ? 'checked' : ''}></div>`;
  }

  private bindSettings(el: HTMLElement, s: Settings, onChange: (s: Settings) => void): void {
    el.querySelectorAll<HTMLInputElement>('input[data-s]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.s as keyof Settings;
        if (k === 'muted') s[k] = inp.checked;
        else if (k === 'music' || k === 'sfx') {
          s[k] = Number(inp.value) / 100;
          const span = inp.nextElementSibling as HTMLElement | null;
          if (span) span.textContent = inp.value;
        }
        s.graphics3d = true;
        onChange({ ...s });
      });
    });
  }

  private settingsDialog(s: Settings, onChange: (s: Settings) => void): void {
    const m = this.div('modal');
    m.innerHTML = `<div class="panel"><h2>Cài đặt</h2>${this.settingsHtml(s)}<div class="row"><button class="primary" data-a="ok">Xong</button></div></div>`;
    this.bindSettings(m, s, onChange);
    this.dialogOpen = true;
    m.querySelector('[data-a=ok]')?.addEventListener('click', () => {
      m.remove();
      this.dialogOpen = false;
    });
    this.root.append(m);
  }

  showSelect(defaultSeed: string, onPick: (speciesId: string, seed: string, name: string) => void, onBack: () => void): void {
    this.hideScreens();
    let chosen = SPECIES[0].id;
    const storedName = (() => {
      try {
        return localStorage.getItem('thhd.playerName') || '';
      } catch {
        return '';
      }
    })();
    const statMax = { maxHp: 130, speed: 195, power: 16, defense: 14, stamina: 130 };
    const stat = (label: string, v: number, max: number, color: string) =>
      `<div class="statbar"><span>${label}</span><div class="bar"><div style="width:${Math.min(100, (v / max) * 100)}%;background:${color}"></div></div><span>${v}</span></div>`;
    const cards = SPECIES.map((s) => {
      const f = s.forms[0];
      const q = SKILLS[s.learnset[0].skill];
      return `
      <div class="card" data-id="${s.id}">
        <div class="portrait"><img src="${speciesPreviewUrl(s.id, 0, false)}" alt=""></div>
        <h3>${esc(f.name)}</h3>
        <div class="tags">
          <span class="tag" style="border-color:${s.elementColor};color:${s.elementColor}">Hệ ${esc(s.element)}</span>
          <span class="tag">${esc(s.dietLabel)}</span>
          <span class="tag">${esc(s.lineName)}</span>
        </div>
        <div class="blurb">${esc(s.blurb)}</div>
        ${stat('Máu', f.stats.maxHp, statMax.maxHp, '#e0524a')}
        ${stat('Tốc độ', f.stats.speed, statMax.speed, '#5ac8ff')}
        ${stat('Sức mạnh', f.stats.power, statMax.power, '#ffa040')}
        ${stat('Phòng thủ', f.stats.defense, statMax.defense, '#9aa8ff')}
        ${stat('Sức bền', f.stats.stamina, statMax.stamina, '#c8e05a')}
        <div class="skill"><b>Đòn cơ bản:</b> ${esc(f.basic.name)}<br><b>Chiêu khởi đầu [Q]:</b> ${esc(q.name)} — ${esc(q.desc)}<br><small>Học thêm ${s.learnset.length - 1} chiêu khi lên cấp, sinh tồn và tiến hóa.</small></div>
        <div class="evos">
          ${s.forms
            .map((ff, i) => {
              const h = 28 + i * 8;
              return i === 0
                ? `<div><img style="height:${h}px;width:auto" src="${speciesPreviewUrl(s.id, 0, false)}" alt="">${esc(ff.name)}</div>`
                : `<div><img style="height:${h}px;width:auto" src="${speciesPreviewUrl(s.id, i, true)}" alt="">Dạng ${i + 1}: ???</div>`;
            })
            .join('')}
        </div>
        <button data-pick="${s.id}">Chọn ${esc(f.name)}</button>
      </div>`;
    }).join('');
    this.select.innerHTML = `
      <h2>Chọn sinh vật của bạn</h2>
      <div class="cards">${cards}</div>
      <div class="select-bar">
        <div class="name-row">
          <span>Tên của bạn:</span>
          <input maxlength="16" value="${esc(storedName)}" placeholder="VD: Lá Nhí" data-name autocomplete="nickname">
        </div>
        <div class="seed-row">
          <span>Seed bản đồ:</span><input maxlength="24" value="${esc(defaultSeed)}" data-seed>
          <button data-a="back">Quay lại</button>
          <button class="primary" data-a="start">Bắt đầu</button>
        </div>
      </div>`;
    const mark = () => this.select.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', (c as HTMLElement).dataset.id === chosen));
    mark();
    this.select.querySelectorAll<HTMLElement>('.card').forEach((c) => c.addEventListener('click', () => {
      chosen = c.dataset.id as string;
      mark();
    }));
    const seedInput = this.select.querySelector('[data-seed]') as HTMLInputElement;
    const nameInput = this.select.querySelector('[data-name]') as HTMLInputElement;
    const start = () => {
      const seed = (seedInput.value || defaultSeed).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || defaultSeed;
      const name = (nameInput.value || '').trim();
      try {
        localStorage.setItem('thhd.playerName', name);
      } catch {
        /* ignore */
      }
      onPick(chosen, seed, name);
    };
    this.select.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      chosen = b.dataset.pick as string;
      mark();
      start();
    }));
    this.select.querySelector('[data-a=start]')?.addEventListener('click', start);
    this.select.querySelector('[data-a=back]')?.addEventListener('click', onBack);
    this.select.classList.remove('hidden');
  }

  confirm(title: string, bodyHtml: string, ok = 'Đồng ý', cancel = 'Hủy'): Promise<boolean> {
    return new Promise((resolve) => {
      const m = this.div('modal');
      m.innerHTML = `<div class="panel"><h2>${esc(title)}</h2><div>${bodyHtml}</div><div class="row"><button data-a="no">${esc(cancel)}</button><button class="primary" data-a="ok">${esc(ok)}</button></div></div>`;
      this.dialogOpen = true;
      const done = (v: boolean) => {
        m.remove();
        this.dialogOpen = false;
        resolve(v);
      };
      m.querySelector('[data-a=ok]')?.addEventListener('click', () => done(true));
      m.querySelector('[data-a=no]')?.addEventListener('click', () => done(false));
      this.root.append(m);
    });
  }

  // ---------------------------------------------------------------- HUD

  private buildHud(): void {
    this.hud.innerHTML = `
      <div class="vitals hud-box">
        <div class="name"><span data-e="name"></span><span data-e="lv"></span></div>
        ${['hp:Máu:#e0524a', 'hunger:Độ no:#ff9a3a', 'thirst:Nước:#4aa8ff', 'stamina:Thể lực:#c8e05a', 'fatigue:Mệt mỏi:#b07aff']
          .map((s) => {
            const [k, l, c] = s.split(':');
            return `<div class="vbar" data-e="${k}-row"><span>${l}</span><div class="track"><div class="fill" data-e="${k}" style="background:${c}"></div></div><span class="val" data-e="${k}-v"></span></div>`;
          })
          .join('')}
        <div class="status" data-e="status"></div>
        <div class="quest" data-e="quest"></div>
      </div>
      <div class="target hud-box hidden" data-e="target"></div>
      <div class="topright">
        <div class="hud-box minimap-wrap" data-e="minimap"></div>
        <div class="hud-box clock"><span data-e="clock"></span><span data-e="weather"></span></div>
        <div class="hud-box clock"><span data-e="biome"></span></div>
      </div>
      <div class="warnings" data-e="warnings"></div>
      <div class="toasts" data-e="toasts"></div>
      <div class="evo hud-box hidden" data-e="evo"></div>
      <div class="bottom">
        <div class="prompt hidden" data-e="prompt"></div>
        <div class="skillbar" data-e="skills"></div>
        <div class="xpbars">
          <div class="vbar"><span>EXP</span><div class="track"><div class="fill" data-e="exp" style="background:#ffd84a"></div></div><span class="val" data-e="exp-v"></span></div>
          <div class="vbar"><span>Trưởng thành</span><div class="track"><div class="fill" data-e="mat" style="background:linear-gradient(90deg,#5ad08a,#c08aff)"></div></div><span class="val" data-e="mat-v"></span></div>
        </div>
      </div>
      <div class="hint" data-e="hint"><kbd>Tab</kbd>Nhân vật (xu & túi) &nbsp; <kbd>Esc</kbd>Tạm dừng &nbsp; <kbd>⛶</kbd>Toàn màn hình</div>
      <div class="debug hidden" data-e="debug"></div>`;
    this.hud.querySelectorAll<HTMLElement>('[data-e]').forEach((e) => (this.els[e.dataset.e as string] = e));
    this.toastBox = this.els.toasts;
    this.touch = new TouchControls(this.hud);
    this.touch.onSkillTip = (tip, anchor) => {
      if (tip) this.showSkillTip(tip, anchor);
      else this.hideSkillTip();
    };
    this.els.prompt.addEventListener('click', () => this.onPromptTap?.());
  }

  showSkillTip(tip: { title: string; body: string; meta: string; icon: string }, anchor?: DOMRect | null): void {
    this.hideSkillTip();
    const el = this.div('skill-tip');
    el.innerHTML = `
      <img src="${tip.icon}" alt="">
      <div class="skill-tip-body">
        <b>${esc(tip.title)}</b>
        <p>${esc(tip.body)}</p>
        <small>${esc(tip.meta)}</small>
      </div>
      <button type="button" class="skill-tip-x" aria-label="Đóng">✕</button>`;
    el.querySelector('.skill-tip-x')?.addEventListener('click', () => this.hideSkillTip());
    this.hud.append(el);
    this.skillTipEl = el;
    if (anchor) {
      const pad = 8;
      const maxL = Math.max(pad, Math.min(anchor.left + anchor.width / 2 - 140, window.innerWidth - 292 - pad));
      const top = Math.max(pad, anchor.top - 12 - 120);
      el.style.left = `${maxL}px`;
      el.style.top = `${Math.min(top, window.innerHeight - 140)}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = 'none';
    }
    window.clearTimeout(this.skillTipHideT);
    this.skillTipHideT = window.setTimeout(() => this.hideSkillTip(), 4500);
  }

  hideSkillTip(): void {
    window.clearTimeout(this.skillTipHideT);
    this.skillTipEl?.remove();
    this.skillTipEl = null;
  }

  private bindSkillTip(el: HTMLElement, getTip: () => SkillSlotData['tip'] | null | undefined): void {
    let t = 0;
    let fired = false;
    const clear = () => {
      window.clearTimeout(t);
      t = 0;
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      fired = false;
      clear();
      t = window.setTimeout(() => {
        fired = true;
        const tip = getTip();
        if (tip) this.showSkillTip(tip, el.getBoundingClientRect());
      }, 420);
    });
    const up = () => clear();
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Swallow click if tip just opened so the slot doesn't feel "used".
    el.addEventListener('click', (e) => {
      if (fired) e.stopPropagation();
    });
  }

  showHud(v: boolean): void {
    this.hud.classList.toggle('hidden', !v);
    if (!v) this.nameTags.clear();
  }

  /** Vertical band (in px, relative to the HUD) left uncovered by HUD panels around the screen's centre column. */
  clearBand(): { top: number; bottom: number } {
    const box = this.hud.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    let top = 0;
    let bottom = box.height;
    this.hud.querySelectorAll<HTMLElement>('.vitals, .topright, .target, .ttop, .bottom > :not(.prompt), #multi-banner').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right < cx - 40 || r.left > cx + 40) return;
      const mid = (r.top + r.bottom) / 2 - box.top;
      if (mid < box.height / 2) top = Math.max(top, r.bottom - box.top);
      else bottom = Math.min(bottom, r.top - box.top);
    });
    // Touch clusters sit in the corners but still steal vertical room — keep the player above them.
    if (this.touch.enabled) {
      const tbtns = this.touch.el.querySelector('.tbtns') as HTMLElement | null;
      const joy = this.touch.el.querySelector('.joy-zone') as HTMLElement | null;
      for (const el of [tbtns, joy]) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0) bottom = Math.min(bottom, r.top - box.top + r.height * 0.22);
      }
    }
    return { top, bottom };
  }

  mountMinimap(c: HTMLCanvasElement): void {
    this.els.minimap.innerHTML = '';
    this.els.minimap.append(c);
  }

  private lastSkills = '';

  updateHud(d: HudData): void {
    const E = this.els;
    E.name.textContent = d.playerName === d.formName ? d.formName : `${d.playerName} · ${d.formName}`;
    E.lv.textContent = `Cấp ${d.level}`;
    const bar = (k: string, v: number, max: number, label: string, warn: boolean) => {
      E[k].style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
      E[`${k}-v`].textContent = label;
      E[`${k}-row`].classList.toggle('warn', warn);
    };
    bar('hp', d.hp, d.maxHp, `${Math.ceil(d.hp)}`, d.hp < d.maxHp * 0.25);
    bar('hunger', d.hunger, 100, `${Math.floor(d.hunger)}%`, d.hunger < BALANCE.survival.warnLevel);
    bar('thirst', d.thirst, 100, `${Math.floor(d.thirst)}%`, d.thirst < BALANCE.survival.warnLevel);
    bar('stamina', d.stamina, d.maxStamina, `${Math.floor(d.stamina)}`, false);
    bar('fatigue', d.fatigue, 100, `${Math.floor(d.fatigue)}%`, d.fatigue >= BALANCE.survival.fatigueTiredLevel);
    E.status.textContent = d.status.join(' • ');
    if (E.quest) {
      if (d.quest) {
        const pct = Math.min(100, (d.quest.progress / Math.max(1, d.quest.target)) * 100);
        E.quest.innerHTML = `<span class="q-ico">${d.quest.done ? '✓' : '◉'}</span><span class="q-title">${esc(d.quest.title)}</span><span class="q-prog">${d.quest.progress}/${d.quest.target}</span><div class="q-bar"><div style="width:${pct}%"></div></div>`;
        E.quest.classList.toggle('done', d.quest.done);
      } else E.quest.textContent = '';
    }
    E.exp.style.width = `${(d.exp / Math.max(1, d.expNext)) * 100}%`;
    E['exp-v'].textContent = `${Math.floor(d.exp)}/${d.expNext}`;
    E.mat.style.width = `${(d.maturity / d.maturityMax) * 100}%`;
    E['mat-v'].textContent = d.maturityLocked ? 'Tối đa' : d.evoReady ? 'ĐẦY!' : `${Math.floor(d.maturity)}%`;
    E.clock.textContent = `Ngày ${d.day} — ${d.clock} ${d.night ? '🌙' : ''}`;
    E.weather.textContent = `${WEATHER_ICON[d.weather]} ${WEATHER_NAMES[d.weather]}`;
    E.biome.textContent = d.biome;
    E.warnings.innerHTML = d.warnings.map((w) => `<div class="warning">${esc(w)}</div>`).join('');

    this.lastSkillTips = d.skills.map((s) => s.tip ?? null);
    const skKey = d.skills.map((s) => `${s.key}${s.name}${s.locked}${s.icon ?? ''}`).join('|');
    if (skKey !== this.lastSkills) {
      this.lastSkills = skKey;
      E.skills.innerHTML = d.skills
        .map((s, i) => {
          const ico = s.icon
            ? `<img class="sk-ico" src="${s.icon}" alt="${esc(s.name)}">`
            : `<span class="sk-name">${esc(s.name)}</span>`;
          return `<div class="slot ${s.locked ? 'locked' : ''}" data-sk="${i}" title="${esc(s.tip?.title ?? s.name)} — đè lâu để xem"><span class="key">${esc(s.key)}</span>${ico}<div class="cd"></div><div class="cdtxt"></div></div>`;
        })
        .join('');
      E.skills.querySelectorAll<HTMLElement>('[data-sk]').forEach((el) => {
        const i = Number(el.dataset.sk);
        this.bindSkillTip(el, () => this.lastSkillTips[i] ?? null);
      });
    }
    d.skills.forEach((s, i) => {
      const el = E.skills.children[i] as HTMLElement | undefined;
      if (!el) return;
      (el.querySelector('.cd') as HTMLElement).style.height = `${s.locked ? 0 : s.cd * 100}%`;
      const left = s.cdLeft > 0.05 && !s.locked ? (s.cdLeft >= 10 ? String(Math.ceil(s.cdLeft)) : s.cdLeft.toFixed(1)) : '';
      (el.querySelector('.cdtxt') as HTMLElement).textContent = left;
      el.classList.toggle('on-cd', !!left);
      el.classList.toggle('ready', !s.locked && s.cd <= 0);
    });
    this.touch.updateSkills(d.skills);

    if (d.target) {
      E.target.classList.remove('hidden');
      E.target.innerHTML = `<b style="color:${d.target.danger}">${esc(d.target.name)}</b> · Cấp ${d.target.level} · <i>${esc(d.target.state)}</i><div class="track"><div style="width:${(d.target.hp / d.target.maxHp) * 100}%"></div></div>`;
    } else E.target.classList.add('hidden');
  }

  setPrompt(html: string | null): void {
    const p = this.els.prompt;
    if (!html) {
      p.classList.add('hidden');
      this.touch.setInteractReady(false);
      return;
    }
    if (p.innerHTML !== html) p.innerHTML = html;
    p.classList.remove('hidden');
    this.touch.setInteractReady(true);
  }

  setDebug(text: string | null): void {
    this.els.debug.classList.toggle('hidden', !text);
    if (text) this.els.debug.textContent = text;
  }

  toast(msg: string, kind: '' | 'good' | 'bad' | 'evo' = ''): void {
    const t = this.div(`toast ${kind}`);
    t.textContent = msg;
    this.toastBox.append(t);
    while (this.toastBox.children.length > 5) this.toastBox.firstElementChild?.remove();
    window.setTimeout(() => t.remove(), 3600);
  }

  evoProgress(show: boolean, title = '', progress = 0, left = 0): void {
    const e = this.els.evo;
    if (!show) {
      e.classList.add('hidden');
      return;
    }
    e.classList.remove('hidden');
    e.innerHTML = `<b>${esc(title)}</b><br><small>Còn ${formatDuration(left)} — đừng để bị tấn công!</small><div class="track"><div style="width:${progress * 100}%"></div></div>`;
  }

  // ---------------------------------------------------------------- overlays

  closeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.overlayKind = null;
    this.charRefresh = null;
    this.charEvolve = null;
    this.mapRefresh = null;
    this.hideSkillTip();
  }

  private openOverlay(kind: 'char' | 'pause' | 'shop' | 'map', html: string, onClose: () => void = () => this.closeOverlay(), panelClass = ''): HTMLElement {
    this.closeOverlay();
    const o = this.div('overlay');
    o.innerHTML = `<div class="panel${panelClass ? ` ${panelClass}` : ''}"><button class="panel-x" data-a="x" aria-label="Đóng">✕</button>${html}</div>`;
    o.querySelector('[data-a=x]')?.addEventListener('click', onClose);
    o.addEventListener('click', (e) => {
      if (e.target === o) onClose();
    });
    this.root.append(o);
    this.overlay = o;
    this.overlayKind = kind;
    return o;
  }

  /** Full-world map: tap to place a navigation mark and show a walkable path. */
  openWorldMap(opts: {
    minimap: Minimap;
    getDots: () => MinimapDots;
    onMark: (wx: number, wy: number) => void;
    onClear: () => void;
  }): void {
    const html = `
      <h2>Bản đồ thế giới</h2>
      <p class="map-hint">Chạm bản đồ để đánh dấu. Mũi tên trên mặt đất sẽ dẫn bạn tới điểm đó.</p>
      <div class="map-stage"><canvas class="worldmap" aria-label="Bản đồ đầy đủ"></canvas></div>
      <div class="row">
        <button type="button" data-a="clear">Xóa dấu đường đi</button>
        <button type="button" class="primary" data-a="close">Đóng</button>
      </div>`;
    const o = this.openOverlay('map', html, () => this.closeOverlay(), 'map-panel');
    const canvas = o.querySelector('canvas.worldmap') as HTMLCanvasElement;
    const src = opts.minimap.canvas;
    canvas.width = src.width;
    canvas.height = src.height;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const paint = () => {
      opts.minimap.draw(opts.getDots());
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.drawImage(src, 0, 0);
    };
    paint();
    this.mapRefresh = paint;
    const markAt = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const tx = ((clientX - r.left) / r.width) * canvas.width;
      const ty = ((clientY - r.top) / r.height) * canvas.height;
      const T = BALANCE.tile;
      opts.onMark(tx * T + T / 2, ty * T + T / 2);
      paint();
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      markAt(e.clientX, e.clientY);
    });
    o.querySelector('[data-a=clear]')?.addEventListener('click', () => {
      opts.onClear();
      paint();
    });
    o.querySelector('[data-a=close]')?.addEventListener('click', () => this.closeOverlay());
  }

  refreshWorldMap(): void {
    this.mapRefresh?.();
  }

  openChar(getData: () => CharPanelData, onEvolve: () => void, onEquip: (skillId: string, slot: number) => void): void {
    this.charEquip = onEquip;
    const d = getData();
    const s = d.state;
    const sp = getSpecies(s.speciesId);
    const f = sp.forms[s.form];
    const evoLine = sp.forms
      .map((ff, i) => {
        const h = 32 + i * 10;
        return `<div class="${i === s.form ? 'current' : ''}"><img style="height:${h}px;width:auto" src="${speciesPreviewUrl(sp.id, i, i > s.form, i === s.form ? s.colorVariant : 'goc')}" alt="">${i <= s.form ? esc(ff.name) : '???'}</div>`;
      })
      .join('<div>➜</div>');
    const html = `
      <h2>${esc(displayName(s))} <small style="font-size:14px;color:#a9b0bd">— ${esc(f.name)} · ${esc(f.title)} • Hệ ${esc(sp.element)} • ${esc(sp.dietLabel)}</small></h2>
      <div class="char-grid">
        <div><img class="big" src="${speciesPreviewUrl(sp.id, s.form, false, s.colorVariant)}" alt=""><p style="font-size:12px;color:#a9b0bd">${esc(f.desc)}</p></div>
        <div>
          <table class="stat-table">
            <tr><td>Cấp độ</td><td><b>${s.level}</b></td><td>Máu tối đa</td><td><b>${Math.round(d.stats.maxHp)}</b></td></tr>
            <tr><td>Sức mạnh</td><td><b>${d.stats.power.toFixed(1)}</b></td><td>Phòng thủ</td><td><b>${d.stats.defense.toFixed(1)}</b></td></tr>
            <tr><td>Tốc độ</td><td><b>${d.stats.speed}</b></td><td>Sức bền</td><td><b>${d.stats.stamina}</b></td></tr>
            <tr><td>Nhu cầu ăn</td><td><b>x${f.hungerMult.toFixed(2)}</b></td><td>Leo vách đá</td><td><b>${f.canClimbLedges ? 'Có' : 'Không'}</b></td></tr>
            <tr><td>Hạ gục</td><td>${s.stats.kills}</td><td>Ngày sống sót</td><td>${s.stats.daysSurvived}</td></tr>
            <tr><td>Tinh anh ★</td><td>${s.stats.elites}</td><td>Chúa tể</td><td>${s.stats.bosses}</td></tr>
          </table>
          <h3>Xu & túi đồ</h3>
          <div class="char-bag" data-e="char-bag"></div>
          <h3>Mục tiêu</h3>
          <div data-e="quest-area"></div>
          <h3>Sổ sinh vật</h3>
          <div data-e="bestiary-area"></div>
          <h3>Chiêu thức</h3>
          <div style="font-size:13px"><div><kbd>${this.touch.enabled ? 'Đánh' : 'Chuột'}</kbd><b>${esc(f.basic.name)}</b> — đòn cơ bản ${this.touch.enabled ? '(tự nhắm con gần nhất)' : 'về hướng con trỏ'}</div></div>
          <div data-e="skill-area" style="font-size:13px"></div>
        </div>
      </div>
      <h3>Tiến hóa</h3>
      <div class="evo-line">${evoLine}</div>
      <div data-e="evo-area"></div>
      <div class="row"><button data-a="close">${this.touch.enabled ? 'Đóng' : 'Đóng (Tab)'}</button></div>`;
    const o = this.openOverlay('char', html);
    o.querySelector('[data-a=close]')?.addEventListener('click', () => this.closeOverlay());
    this.charRefresh = getData;
    this.charEvolve = onEvolve;
    this.refreshChar();
  }

  /** Re-renders the live evolution checklist while the panel is open. */
  refreshChar(): void {
    if (this.overlayKind !== 'char' || !this.overlay || !this.charRefresh) return;
    const d = this.charRefresh();
    this.renderCharBag(d.state);
    this.renderQuests(d.state, d.guardianDown);
    this.renderBestiary(d.state);
    this.renderSkills(d.state);
    const area = this.overlay.querySelector('[data-e=evo-area]') as HTMLElement;
    if (isFinalForm(d.state)) {
      area.innerHTML = '<p>Bạn đã đạt dạng thần thoại tối thượng!</p>';
      return;
    }
    const html = `
      <ul class="checklist">${d.checks.map((c) => `<li class="${c.ok ? 'ok' : 'no'}">${esc(c.label)}</li>`).join('')}</ul>
      <button class="primary" data-a="evolve" ${d.canEvolve ? '' : 'disabled'}>Bắt đầu tiến hóa (${d.evoDuration} giây)</button>`;
    if (area.dataset.last === html) return;
    area.dataset.last = html;
    area.innerHTML = html;
    area.querySelector('[data-a=evolve]')?.addEventListener('click', () => this.charEvolve?.());
  }

  /** Coins + food/consumable bag inside the character panel. */
  private renderCharBag(s: PlayerState): void {
    const box = this.overlay?.querySelector('[data-e=char-bag]') as HTMLElement | null;
    if (!box) return;
    const filled = s.inventory.filter(Boolean).length;
    const slots = s.inventory
      .map((it, i) => {
        const name = it ? (FOODS[it]?.name ?? CONSUMABLES[it]?.name ?? it) : 'Trống';
        const tip = it && isConsumable(it) ? ' — chạm để dùng' : it ? ' — chạm để ăn' : '';
        return `<button type="button" class="slot ${it ? 'filled' : 'empty'}" data-inv="${i}" title="${esc(name)}${tip}" ${it ? '' : 'disabled'}>
          <span class="key">${i + 1}</span>
          ${it ? `<img src="${foodIconUrl(it)}" alt="${esc(name)}">` : '<span class="empty-mark">·</span>'}
        </button>`;
      })
      .join('');
    const html = `
      <div class="char-bag-head">
        <span class="coin-badge">🪙 ${s.coins}</span>
        <span class="bag-meta">Túi đồ <b>${filled}/${s.inventory.length}</b></span>
      </div>
      <div class="inventory char-inv">${slots}</div>
      <small class="bag-hint">Chạm ô để ăn / dùng vật phẩm. Ngoài bảng: phím 1–6.</small>`;
    if (box.dataset.last === html) return;
    box.dataset.last = html;
    box.innerHTML = html;
    box.querySelectorAll<HTMLButtonElement>('[data-inv]').forEach((b) => {
      b.addEventListener('click', () => this.onInvTap?.(Number(b.dataset.inv)));
    });
  }

  private renderQuests(s: PlayerState, guardianDown: boolean): void {
    const box = this.overlay?.querySelector('[data-e=quest-area]') as HTMLElement | null;
    if (!box) return;
    const rows = listQuests(s, guardianDown)
      .slice(0, 8)
      .map((q) => `<li class="${q.done ? 'ok' : 'no'}"><b>${esc(q.title)}</b> <small>${q.progress}/${q.target}</small><br><small>${esc(q.desc)}</small></li>`)
      .join('');
    const html = `<ul class="checklist quest-list">${rows}</ul>`;
    if (box.dataset.last === html) return;
    box.dataset.last = html;
    box.innerHTML = html;
  }

  private renderBestiary(s: PlayerState): void {
    const box = this.overlay?.querySelector('[data-e=bestiary-area]') as HTMLElement | null;
    if (!box) return;
    const st = bestiaryStats(s);
    const rows = bestiaryCatalog()
      .map((n) => {
        const e = s.bestiary?.[n.id];
        if (!e?.seen) return `<div class="best-row locked">??? · chưa gặp</div>`;
        const mark = e.killed ? '✓' : '👁';
        return `<div class="best-row"><span>${mark}</span><b>${esc(n.name)}</b> <small>${esc(n.temperament)} · ${esc(n.diet)}</small></div>`;
      })
      .join('');
    const html = `<p class="best-meta">Đã gặp <b>${st.seen}</b> / hạ <b>${st.killed}</b> / tổng ${st.total}</p><div class="best-grid">${rows}</div>`;
    if (box.dataset.last === html) return;
    box.dataset.last = html;
    box.innerHTML = html;
  }

  /** Learnset with mastery bars and Q/R/T equip buttons. */
  private renderSkills(s: PlayerState): void {
    const area = this.overlay?.querySelector('[data-e=skill-area]') as HTMLElement | null;
    if (!area) return;
    const sp = getSpecies(s.speciesId);
    const rows = sp.learnset.map((entry) => {
      const id = s.skills.find((k) => skillRoot(k) === entry.skill);
      if (!id) {
        const root = SKILLS[entry.skill];
        return `<div class="skill-row locked"><img class="sk-ico" src="${skillIconUrl(root.id)}" alt=""><div><b>🔒 ${esc(root.name)}</b><br><small>Mở khóa: ${esc(reqLabel(s, entry.req))}</small></div></div>`;
      }
      const sk = SKILLS[id];
      const tip = formatSkillTip(sk);
      const slot = s.equipped.indexOf(id);
      const btns = SLOT_KEYS.map((k, i) => {
        const open = slotUnlocked(s, i);
        return `<button class="slot-btn${slot === i ? ' on' : ''}" data-equip="${id}" data-slot="${i}" ${open ? '' : 'disabled title="Mở ở dạng 2"'}>${k}</button>`;
      }).join('');
      let mastery = '';
      if (sk.evolvesTo && sk.mastery) {
        const m = Math.min(sk.mastery, s.mastery[id] ?? 0);
        const next = SKILLS[sk.evolvesTo];
        const formOk = s.form >= (sk.evolveForm ?? 0);
        mastery = `<div class="mastery"><div class="bar"><div style="width:${(m / sk.mastery) * 100}%"></div></div>
          <small>Thành thạo ${m}/${sk.mastery} ➜ <b>${esc(next.name)}</b>${formOk ? '' : ` (cần dạng ${(sk.evolveForm ?? 0) + 1})`}</small></div>`;
      } else if (id !== entry.skill) mastery = '<small style="color:#ffd84a">⚡ Đã tiến hóa</small>';
      const tier = id !== entry.skill ? ' ⚡' : '';
      return `<div class="skill-row"><img class="sk-ico" src="${tip.icon}" alt="${esc(sk.name)}"><div class="skill-row-main"><div class="slot-btns">${btns}</div><b style="color:#${sk.color.toString(16).padStart(6, '0')}">${esc(sk.name)}${tier}</b> — ${esc(sk.desc)}
        <small>(${esc(tip.meta)})</small>${mastery}</div></div>`;
    });
    const html = `<p style="font-size:12px;color:#a9b0bd;margin:4px 0">Chiêu gắn vào ${SLOT_KEYS.join('/')} — ô ${SLOT_KEYS[2]} mở ở dạng 2. Đè lâu nút chiêu trên màn hình để xem mô tả. Dùng chiêu trúng địch để tăng thành thạo.</p>${rows.join('')}`;
    if (area.dataset.last === html) return;
    area.dataset.last = html;
    area.innerHTML = html;
    area.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((b) =>
      b.addEventListener('click', () => {
        this.charEquip?.(b.dataset.equip as string, Number(b.dataset.slot));
        this.refreshChar();
      }),
    );
  }

  openPause(settings: Settings, cb: PauseCallbacks): void {
    const s = { ...settings };
    const controls = [
      ['WASD / Mũi tên', 'Di chuyển'],
      ['Shift', 'Chạy nhanh (tốn thể lực)'],
      ['Chuột trái', 'Tấn công về hướng con trỏ'],
      ['Q / R / T', 'Chiêu thức (gắn chiêu trong bảng Tab)'],
      ['Space', 'Né tránh'],
      ['E', 'Ăn / uống / nhặt / trụ hồi máu'],
      ['F', 'Nằm nghỉ (hồi máu dần, ngủ khi mệt)'],
      ['1-6', 'Ăn đồ trong túi (ăn cũng hồi máu)'],
      ['M', 'Đặt dấu bản đồ (khi đã mở)'],
      ['Tab', 'Nhân vật — xu, túi đồ, chiêu & tiến hóa'],
      ['Esc', 'Tạm dừng'],
      ['⛶', 'Toàn màn hình'],
    ];
    const html = `
      <h2>Tạm dừng</h2>
      <div class="row" style="justify-content:flex-start">
        <button class="primary" data-a="resume">Tiếp tục</button>
        <button data-a="save">Lưu game</button>
        <button data-a="fullscreen">⛶ Toàn màn hình</button>
        <button class="danger" data-a="quit">Lưu & thoát</button>
      </div>
      <h3>Âm thanh & đồ họa</h3>
      ${this.settingsHtml(s)}
      <h3>Điều khiển</h3>
      ${this.touch.enabled ? `<div class="controls-list">${TOUCH_HELP.map(([k, v]) => `<div><kbd>${esc(k)}</kbd>${esc(v)}</div>`).join('')}</div>` : `<div class="controls-list">${controls.map(([k, v]) => `<div><kbd>${esc(k)}</kbd>${esc(v)}</div>`).join('')}</div>`}
      ${cb.debug ? `<h3>Debug</h3><div class="row" style="justify-content:flex-start"><button data-d="hit">Hitbox</button><button data-d="god">Bất tử</button><button data-d="evo">Đủ điều kiện tiến hóa</button><button data-d="time">+3 giờ</button></div><div style="font-size:12px" data-d="flags">${esc(cb.debug.flags())}</div>` : ''}`;
    const o = this.openOverlay('pause', html, cb.resume);
    this.bindSettings(o, s, cb.settings);
    o.querySelector('[data-a=resume]')?.addEventListener('click', cb.resume);
    o.querySelector('[data-a=save]')?.addEventListener('click', cb.save);
    o.querySelector('[data-a=quit]')?.addEventListener('click', cb.quit);
    const fsPause = o.querySelector<HTMLElement>('[data-a=fullscreen]');
    if (fsPause) bindFullscreenButton(fsPause);
    if (cb.debug) {
      const dbg = cb.debug;
      const flags = o.querySelector('[data-d=flags]') as HTMLElement;
      const upd = () => (flags.textContent = dbg.flags());
      o.querySelector('[data-d=hit]')?.addEventListener('click', () => (dbg.toggleHitbox(), upd()));
      o.querySelector('[data-d=god]')?.addEventListener('click', () => (dbg.toggleGod(), upd()));
      o.querySelector('[data-d=evo]')?.addEventListener('click', () => (dbg.quickEvolve(), upd()));
      o.querySelector('[data-d=time]')?.addEventListener('click', () => (dbg.skipTime(), upd()));
    }
  }

  openShop(s: PlayerState, cb: ShopCallbacks): void {
    const slotIdx = s.slots - BALANCE.inventory.startSlots;
    const slotCost = SHOP.slotUpgradeCosts[slotIdx];
    const slotMax = s.slots >= BALANCE.inventory.maxSlots || slotCost === undefined;
    const colors = COLOR_VARIANTS.map((v) => {
      const owned = s.unlockedColors.includes(v.id);
      const eq = s.colorVariant === v.id;
      const btn = eq
        ? '<button disabled>Đang dùng</button>'
        : owned
          ? `<button data-eq="${v.id}">Trang bị</button>`
          : `<button data-buy="${v.id}" ${s.coins >= v.cost ? '' : 'disabled'}>Mua 🪙${v.cost}</button>`;
      return `<div class="swatch ${eq ? 'equipped' : ''}"><img src="${speciesPreviewUrl(s.speciesId, s.form, false, v.id)}" alt="">${esc(v.name)}${btn}</div>`;
    }).join('');
    const bagFull = !s.inventory.includes(null);
    const consumables = SHOP.consumableIds
      .map((id) => {
        const c = CONSUMABLES[id];
        if (!c) return '';
        const afford = s.coins >= c.cost && !bagFull;
        return `<div class="shop-item"><div><b>${esc(c.icon)} ${esc(c.name)}</b><div class="desc">${esc(c.desc)}</div></div>
          <button data-con="${c.id}" ${afford ? '' : 'disabled'}>Mua 🪙${c.cost}</button></div>`;
      })
      .join('');
    const html = `
      <h2>Đền Cổ — Trạm nâng cấp</h2>
      <div>Tiền xu hiện có: <b style="color:#ffcf4a">🪙 ${s.coins}</b></div>
      <div class="shop-item"><div><b>Túi mang thêm</b><div class="desc">Thêm 1 ô chứa thức ăn / vật phẩm (hiện ${s.slots}/${BALANCE.inventory.maxSlots}).</div></div>
        ${slotMax ? '<button disabled>Tối đa</button>' : `<button data-a="slot" ${s.coins >= slotCost ? '' : 'disabled'}>Mua 🪙${slotCost}</button>`}</div>
      <div class="shop-item"><div><b>Dấu đánh dấu bản đồ</b><div class="desc">${this.touch.enabled ? 'Bấm nút <kbd>Dấu</kbd>' : 'Nhấn <kbd>M</kbd>'} để đặt/xóa dấu tại vị trí hiện tại (tối đa ${SHOP.maxMarkers}). Hiện trên bản đồ nhỏ và trong thế giới.</div></div>
        ${s.markersUnlocked ? '<button disabled>Đã mở</button>' : `<button data-a="markers" ${s.coins >= SHOP.markerUnlockCost ? '' : 'disabled'}>Mua 🪙${SHOP.markerUnlockCost}</button>`}</div>
      <h3>Vật phẩm tiêu hao</h3>
      ${bagFull ? '<p class="desc">Túi đầy — không mua thêm được.</p>' : ''}
      ${consumables}
      <h3>Màu ngoại hình</h3>
      <div class="color-swatches">${colors}</div>
      <div class="row"><button data-a="close">Đóng</button></div>`;
    const o = this.openOverlay('shop', html);
    o.querySelector('[data-a=close]')?.addEventListener('click', () => this.closeOverlay());
    o.querySelector('[data-a=slot]')?.addEventListener('click', cb.buySlot);
    o.querySelector('[data-a=markers]')?.addEventListener('click', cb.buyMarkers);
    o.querySelectorAll<HTMLElement>('[data-buy]').forEach((b) => b.addEventListener('click', () => cb.buyColor(b.dataset.buy as string)));
    o.querySelectorAll<HTMLElement>('[data-eq]').forEach((b) => b.addEventListener('click', () => cb.equipColor(b.dataset.eq as string)));
    o.querySelectorAll<HTMLElement>('[data-con]').forEach((b) => b.addEventListener('click', () => cb.buyConsumable(b.dataset.con as string)));
  }

  showDeath(summary: { name: string; cause: string; days: number; time: string; level: number; form: string; kills: number; coins: number }, onRestart: () => void, onMenu: () => void): void {
    this.closeOverlay();
    this.death.innerHTML = `
      <div class="panel" style="text-align:center">
        <h2>${esc(summary.name)} đã gục ngã</h2>
        <p style="color:#ff9a8a">${esc(summary.cause)}</p>
        <table class="stat-table" style="margin:0 auto">
          <tr><td>Dạng tiến hóa</td><td><b>${esc(summary.form)}</b></td></tr>
          <tr><td>Cấp độ</td><td><b>${summary.level}</b></td></tr>
          <tr><td>Thời gian sống</td><td><b>${esc(summary.time)}</b> (${summary.days} bình minh)</td></tr>
          <tr><td>Số lần hạ gục</td><td><b>${summary.kills}</b></td></tr>
          <tr><td>Tiền xu</td><td><b>${summary.coins}</b></td></tr>
        </table>
        <div class="row" style="justify-content:center">
          <button data-a="menu">Về menu</button>
          <button class="primary" data-a="restart">Bắt đầu lượt mới</button>
        </div>
      </div>`;
    this.death.querySelector('[data-a=restart]')?.addEventListener('click', onRestart);
    this.death.querySelector('[data-a=menu]')?.addEventListener('click', onMenu);
    this.death.classList.remove('hidden');
  }
}
