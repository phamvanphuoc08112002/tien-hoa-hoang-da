import type { Palette } from './types';

export interface ColorVariant {
  id: string;
  name: string;
  cost: number;
  override: Partial<Palette> | null;
}

export const COLOR_VARIANTS: ColorVariant[] = [
  { id: 'goc', name: 'Màu gốc', cost: 0, override: null },
  { id: 'trang', name: 'Ánh Trăng', cost: 14, override: { dark: '#6c7b98', base: '#b7c4dc', light: '#eef3ff', belly: '#ffffff' } },
  { id: 'dem', name: 'Bóng Đêm', cost: 18, override: { dark: '#2a1e44', base: '#4c3a7a', light: '#8a70c2', belly: '#c9b8f0' } },
  { id: 'kim', name: 'Hoàng Kim', cost: 26, override: { dark: '#a3701a', base: '#e6b13a', light: '#ffe48a', belly: '#fff6d0' } },
];

export const SHOP = {
  slotUpgradeCosts: [8, 12, 16, 22],
  markerUnlockCost: 10,
  maxMarkers: 6,
  /** Consumable stock at the shrine (ids from consumables.ts). */
  consumableIds: ['binh_giai_doc', 'cao_lam_lanh', 'tonic_suc_manh', 'tonic_giap', 'moi_thit', 'banh_phuc_hoi'] as const,
};

export function applyVariant(pal: Palette, variantId: string): Palette {
  const v = COLOR_VARIANTS.find((c) => c.id === variantId);
  if (!v || !v.override) return pal;
  return { ...pal, ...v.override };
}
