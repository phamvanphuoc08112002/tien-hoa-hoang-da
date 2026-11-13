const KEY = 'tien-hoa-hoang-da.settings';

export interface Settings {
  music: number;
  sfx: number;
  muted: boolean;
  /** Always on — kept on the type for save compatibility / WebGL fallback. */
  graphics3d: boolean;
}

const DEFAULTS: Settings = { music: 0.5, sfx: 0.7, muted: false, graphics3d: true };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const o = JSON.parse(raw);
    return {
      music: typeof o.music === 'number' ? Math.max(0, Math.min(1, o.music)) : DEFAULTS.music,
      sfx: typeof o.sfx === 'number' ? Math.max(0, Math.min(1, o.sfx)) : DEFAULTS.sfx,
      muted: typeof o.muted === 'boolean' ? o.muted : DEFAULTS.muted,
      // 3D is the fixed default — ignore older saves that turned it off.
      graphics3d: true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, graphics3d: true }));
  } catch {
    /* ignore quota / privacy mode errors */
  }
}

export const DEBUG_ENABLED = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
