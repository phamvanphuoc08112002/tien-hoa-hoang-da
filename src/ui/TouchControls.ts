import { isFullscreen, toggleFullscreen } from './fullscreen';

export type TouchButton = 'attack' | 'q' | 'r' | 't' | 'dodge' | 'interact' | 'rest' | 'char' | 'pause' | 'marker';

export interface TouchSkillInfo {
  name: string;
  cd: number;
  cdLeft: number;
  locked: boolean;
  icon?: string;
  tip?: { title: string; body: string; meta: string; icon: string } | null;
}

const JOY_RADIUS = 58;
const DEADZONE = 0.16;
/** Stick past this magnitude sprints without needing the Chạy toggle. */
const SPRINT_MAG = 0.78;
const SKILL_BUTTONS: TouchButton[] = ['attack', 'q', 'r', 't', 'dodge', 'rest'];
/** Buttons that cast on release and support long-press tip (not hold-to-fire). */
const TIP_CAST_ON_RELEASE = new Set<string>(['q', 'r', 't']);
const LONG_MS = 420;

function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Pointer already gone (e.g. released before the handler ran); events still bubble normally.
  }
}

/** On-screen joystick + buttons for phones/tablets. Enabled on coarse pointers or the first touch. */
export class TouchControls {
  readonly el: HTMLElement;
  enabled = false;
  mx = 0;
  my = 0;
  sprint = false;
  attackHeld = false;
  /** Called when a long-press tip should open/close. */
  onSkillTip: ((tip: TouchSkillInfo['tip'] | null, anchor?: DOMRect | null) => void) | null = null;
  private pressed = new Set<TouchButton>();
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private base!: HTMLElement;
  private knob!: HTMLElement;
  private buttons = new Map<string, HTMLElement>();
  private skillTips: (TouchSkillInfo['tip'] | null)[] = [];
  private longT = 0;
  private longFired = false;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.innerHTML = `
      <div class="joy-zone"><div class="joy-base"><div class="joy-knob"></div></div></div>
      <div class="tbtns">
        <button class="tb big" data-b="attack"><img class="tb-ico" alt=""><span>Đánh</span><i class="cd"></i><b class="cdtxt"></b></button>
        <button class="tb" data-b="q"><img class="tb-ico" alt=""><span class="tb-key">Q</span><i class="cd"></i><b class="cdtxt"></b></button>
        <button class="tb" data-b="r"><img class="tb-ico" alt=""><span class="tb-key">R</span><i class="cd"></i><b class="cdtxt"></b></button>
        <button class="tb" data-b="t"><img class="tb-ico" alt=""><span class="tb-key">T</span><i class="cd"></i><b class="cdtxt"></b></button>
        <button class="tb" data-b="dodge"><img class="tb-ico" alt=""><span>Né</span><i class="cd"></i><b class="cdtxt"></b></button>
        <button class="tb small" data-b="interact"><span>Dùng</span></button>
        <button class="tb small" data-b="rest"><img class="tb-ico" alt=""><span>Nghỉ</span><i class="cd"></i><b class="cdtxt"></b></button>
        <button class="tb small toggle" data-b="sprint" title="Giữ chạy (hoặc đẩy cần hết cỡ)"><span>Chạy</span></button>
      </div>
      <div class="ttop">
        <button class="tpill" data-b="char">Nhân vật</button>
        <button class="tpill hidden" data-b="marker">Dấu</button>
        <button class="tpill" data-b="fullscreen" title="Toàn màn hình">⛶</button>
        <button class="tpill" data-b="pause">❚❚</button>
      </div>`;
    parent.append(this.el);
    this.base = this.el.querySelector('.joy-base') as HTMLElement;
    this.knob = this.el.querySelector('.joy-knob') as HTMLElement;
    this.el.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => this.buttons.set(b.dataset.b as string, b));
    this.bindJoystick(this.el.querySelector('.joy-zone') as HTMLElement);
    this.buttons.forEach((b, id) => this.bindButton(b, id));
    const syncFs = () => {
      const b = this.buttons.get('fullscreen');
      if (b) b.title = isFullscreen() ? 'Thoát toàn màn hình' : 'Toàn màn hình';
    };
    document.addEventListener('fullscreenchange', syncFs);
    document.addEventListener('webkitfullscreenchange', syncFs);
    // iOS ignores user-scalable=no and pointer-event preventDefault: a long press opens the text
    // magnifier and a quick double tap zooms. Only cancelling the raw touch events stops both.
    const block = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    for (const type of ['touchstart', 'touchmove', 'touchend']) this.el.addEventListener(type, block, { passive: false });
    document.addEventListener('gesturestart', block);
    document.addEventListener('dblclick', block);

    const forced = new URLSearchParams(location.search).has('touch');
    if (forced || window.matchMedia('(pointer: coarse)').matches) this.enable();
    else window.addEventListener('touchstart', () => this.enable(), { once: true, passive: true });
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch');
    // iOS Safari still double-tap-zooms even with user-scalable=no.
    let lastEnd = 0;
    document.addEventListener(
      'touchend',
      (e) => {
        const now = performance.now();
        if (now - lastEnd < 320 && e.cancelable) e.preventDefault();
        lastEnd = now;
      },
      { passive: false },
    );
  }

  /** Sprint toggle locked on, or stick pushed near the rim. */
  get sprinting(): boolean {
    return this.sprint || Math.hypot(this.mx, this.my) >= SPRINT_MAG;
  }

  /** Returns true once per press. */
  take(b: TouchButton): boolean {
    return this.pressed.delete(b);
  }

  /** Soft pulse on Dùng when an interaction is available. */
  setInteractReady(v: boolean): void {
    this.buttons.get('interact')?.classList.toggle('ready', v);
  }

  /** Short haptic for attack / hit feedback (no-op if unsupported). */
  buzz(ms = 12): void {
    try {
      navigator.vibrate?.(ms);
    } catch {
      /* ignore */
    }
  }

  /** Drops presses that were not consumed this frame (e.g. while a menu was open). */
  endFrame(): void {
    this.pressed.clear();
  }

  reset(): void {
    this.pressed.clear();
    this.attackHeld = false;
    this.sprint = false;
    this.buttons.get('sprint')?.classList.remove('on');
    this.releaseJoystick();
    this.clearLong();
  }

  setMarkerVisible(v: boolean): void {
    this.buttons.get('marker')?.classList.toggle('hidden', !v);
  }

  /** Skills come in HUD order: basic attack, Q, R, T, dodge, rest. */
  updateSkills(skills: TouchSkillInfo[]): void {
    if (!this.enabled) return;
    this.skillTips = skills.map((s) => s.tip ?? null);
    skills.forEach((s, i) => {
      const id = SKILL_BUTTONS[i];
      const b = id && this.buttons.get(id);
      if (!b) return;
      const img = b.querySelector('.tb-ico') as HTMLImageElement | null;
      if (img) {
        if (s.icon) {
          if (img.getAttribute('src') !== s.icon) img.src = s.icon;
          img.classList.remove('hidden');
          img.alt = s.name;
        } else {
          img.removeAttribute('src');
          img.classList.add('hidden');
        }
      }
      const span = b.querySelector('span:not(.tb-key)') as HTMLElement | null;
      const key = b.querySelector('.tb-key') as HTMLElement | null;
      if (id === 'q' || id === 'r' || id === 't') {
        if (key) key.textContent = s.locked ? '🔒' : id.toUpperCase();
        b.title = s.locked ? s.name : `${s.name} — đè lâu để xem`;
      } else if (span) {
        if (id === 'rest' || id === 'attack' || id === 'dodge') {
          // Keep short label under the icon.
          const label = id === 'attack' ? 'Đánh' : id === 'dodge' ? 'Né' : s.name;
          if (span.textContent !== label) span.textContent = label;
        }
        b.title = s.tip ? `${s.tip.title} — đè lâu để xem` : s.name;
      }
      b.classList.toggle('locked', s.locked);
      b.classList.toggle('has-ico', !!s.icon);
      b.classList.toggle('on-cd', !s.locked && s.cdLeft > 0.05);
      (b.querySelector('.cd') as HTMLElement).style.height = `${s.locked ? 0 : Math.max(0, Math.min(1, s.cd)) * 100}%`;
      const cdtxt = b.querySelector('.cdtxt') as HTMLElement | null;
      if (cdtxt) {
        cdtxt.textContent = !s.locked && s.cdLeft > 0.05 ? (s.cdLeft >= 10 ? String(Math.ceil(s.cdLeft)) : s.cdLeft.toFixed(1)) : '';
      }
    });
  }

  private clearLong(): void {
    window.clearTimeout(this.longT);
    this.longT = 0;
  }

  private tipIndex(id: string): number {
    return SKILL_BUTTONS.indexOf(id as TouchButton);
  }

  private bindButton(b: HTMLElement, id: string): void {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      capture(b, e.pointerId);
      b.classList.add('down');
      this.longFired = false;
      this.clearLong();

      if (id === 'attack') {
        this.attackHeld = true;
        this.buzz(8);
        // Tip only if held without wanting to interrupt continuous attack too early —
        // open tip after long press but keep attacking.
        this.longT = window.setTimeout(() => {
          this.longFired = true;
          const tip = this.skillTips[this.tipIndex(id)];
          if (tip) {
            this.buzz(10);
            this.onSkillTip?.(tip, b.getBoundingClientRect());
          }
        }, LONG_MS);
        return;
      }
      if (id === 'sprint') {
        this.sprint = !this.sprint;
        b.classList.toggle('on', this.sprint);
        return;
      }
      if (id === 'fullscreen') {
        toggleFullscreen();
        return;
      }

      if (TIP_CAST_ON_RELEASE.has(id) || id === 'dodge' || id === 'rest') {
        this.longT = window.setTimeout(() => {
          this.longFired = true;
          const tip = this.skillTips[this.tipIndex(id)];
          if (tip) {
            this.buzz(10);
            this.onSkillTip?.(tip, b.getBoundingClientRect());
          }
        }, LONG_MS);
        return;
      }

      this.pressed.add(id as TouchButton);
      if (id === 'interact') this.buzz(6);
    });
    const up = () => {
      b.classList.remove('down');
      if (id === 'attack') this.attackHeld = false;
      const wasLong = this.longFired;
      this.clearLong();
      if (TIP_CAST_ON_RELEASE.has(id) || id === 'dodge' || id === 'rest') {
        if (!wasLong) {
          this.pressed.add(id as TouchButton);
          if (id === 'dodge') this.buzz(6);
        }
      }
      this.longFired = false;
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindJoystick(zone: HTMLElement): void {
    zone.addEventListener('pointerdown', (e) => {
      if (this.joyId !== null) return;
      e.preventDefault();
      capture(zone, e.pointerId);
      this.joyId = e.pointerId;
      const r = zone.getBoundingClientRect();
      this.joyOrigin = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.base.style.left = `${this.joyOrigin.x}px`;
      this.base.style.top = `${this.joyOrigin.y}px`;
      this.base.classList.add('active');
      this.moveKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joyId) return;
      const r = zone.getBoundingClientRect();
      this.moveKnob(e.clientX - r.left - this.joyOrigin.x, e.clientY - r.top - this.joyOrigin.y);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.joyId) this.releaseJoystick();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  private moveKnob(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    const k = len > JOY_RADIUS ? JOY_RADIUS / len : 1;
    dx *= k;
    dy *= k;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const mag = Math.min(1, len / JOY_RADIUS);
    if (mag < DEADZONE) {
      this.mx = 0;
      this.my = 0;
    } else {
      this.mx = dx / JOY_RADIUS;
      this.my = dy / JOY_RADIUS;
    }
  }

  private releaseJoystick(): void {
    this.joyId = null;
    this.mx = 0;
    this.my = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('active');
    this.base.style.left = '';
    this.base.style.top = '';
  }
}
