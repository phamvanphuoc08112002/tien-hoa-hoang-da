/** Browser fullscreen helpers (incl. Safari webkit prefixes). */

type DocFs = Document & {
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type ElFs = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FsLabels = { enter: string; exit: string };

const bound = new WeakMap<HTMLElement, FsLabels>();
let listening = false;

export function isFullscreen(): boolean {
  const doc = document as DocFs;
  return !!(document.fullscreenElement || doc.webkitFullscreenElement);
}

export function toggleFullscreen(): void {
  const doc = document as DocFs;
  const el = document.documentElement as ElFs;
  if (isFullscreen()) {
    if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    else doc.webkitExitFullscreen?.();
    return;
  }
  if (el.requestFullscreen) void el.requestFullscreen().catch(() => {});
  else el.webkitRequestFullscreen?.();
}

function syncButton(btn: HTMLElement, labels: FsLabels): void {
  const on = isFullscreen();
  btn.textContent = on ? labels.exit : labels.enter;
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.title = on ? 'Thoát toàn màn hình' : 'Toàn màn hình';
}

function syncAll(): void {
  document.querySelectorAll<HTMLElement>('[data-fs-btn]').forEach((btn) => {
    const labels = bound.get(btn);
    if (labels) syncButton(btn, labels);
  });
}

/** Keeps a button's label/icon in sync with the current fullscreen state. */
export function bindFullscreenButton(btn: HTMLElement, opts?: { enter?: string; exit?: string }): void {
  const labels: FsLabels = {
    enter: opts?.enter ?? '⛶ Toàn màn hình',
    exit: opts?.exit ?? '⛶ Thu nhỏ',
  };
  btn.dataset.fsBtn = '1';
  bound.set(btn, labels);
  syncButton(btn, labels);
  if (!btn.dataset.fsBound) {
    btn.dataset.fsBound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFullscreen();
    });
  }
  if (!listening) {
    listening = true;
    document.addEventListener('fullscreenchange', syncAll);
    document.addEventListener('webkitfullscreenchange', syncAll);
  }
}
