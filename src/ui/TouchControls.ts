export type TouchButton = 'attack' | 'q' | 'r' | 't' | 'dodge' | 'interact' | 'rest' | 'char' | 'pause' | 'marker';

export interface TouchSkillInfo {
  name: string;
  cd: number;
  cdLeft: number;
  locked: boolean;
}

const JOY_RADIUS = 58;
const DEADZONE = 0.16;
/** Stick past this magnitude sprints without needing the Chạy toggle. */
const SPRINT_MAG = 0.78;
const SKILL_BUTTONS: TouchButton[] = ['attack', 'q', 'r', 't', 'dodge', 'rest'];

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
  private pressed = new Set<TouchButton>();
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private base!: HTMLElement;
  private knob!: HTMLElement;
  private buttons = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.innerHTML = `
      <div class="joy-zone"><div class="joy-base"><div class="joy-knob"></div></div></div>
      <div class="tbtns">
        <button class="tb big" data-b="attack"><span>Đánh</span><i class="cd"></i></button>
        <button class="tb" data-b="q"><span>Q</span><i class="cd"></i></button>
        <button class="tb" data-b="r"><span>R</span><i class="cd"></i></button>
        <button class="tb" data-b="t"><span>T</span><i class="cd"></i></button>
        <button class="tb" data-b="dodge"><span>Né</span><i class="cd"></i></button>
        <button class="tb small" data-b="interact"><span>Dùng</span></button>
        <button class="tb small" data-b="rest"><span>Nghỉ</span><i class="cd"></i></button>
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
  }

  setMarkerVisible(v: boolean): void {
    this.buttons.get('marker')?.classList.toggle('hidden', !v);
  }

  /** Skills come in HUD order: basic attack, Q, R, T, dodge, rest. */
  updateSkills(skills: TouchSkillInfo[]): void {
    if (!this.enabled) return;
    skills.forEach((s, i) => {
      const id = SKILL_BUTTONS[i];
      const b = id && this.buttons.get(id);
      if (!b) return;
      const label = id === 'q' || id === 'r' || id === 't' ? (s.locked ? '🔒' : s.name) : id === 'rest' ? s.name : null;
      const span = b.querySelector('span') as HTMLElement;
      if (label !== null && span.textContent !== label) span.textContent = label;
      b.classList.toggle('locked', s.locked);
      (b.querySelector('.cd') as HTMLElement).style.height = `${s.locked ? 0 : Math.max(0, Math.min(1, s.cd)) * 100}%`;
    });
  }

  private bindButton(b: HTMLElement, id: string): void {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      capture(b, e.pointerId);
      b.classList.add('down');
      if (id === 'attack') {
        this.attackHeld = true;
        this.buzz(8);
      } else if (id === 'sprint') {
        this.sprint = !this.sprint;
        b.classList.toggle('on', this.sprint);
      } else if (id === 'fullscreen') this.toggleFullscreen();
      else {
        this.pressed.add(id as TouchButton);
        if (id === 'dodge' || id === 'interact') this.buzz(6);
      }
    });
    const up = () => {
      b.classList.remove('down');
      if (id === 'attack') this.attackHeld = false;
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

  private toggleFullscreen(): void {
    const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    if (document.fullscreenElement || doc.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen();
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else el.webkitRequestFullscreen?.();
  }
}
