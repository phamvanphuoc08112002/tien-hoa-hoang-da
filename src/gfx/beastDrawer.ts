import type { BeastArt, Palette } from '../data/types';
import { ellipse, line, makeCanvas, pixelize, poly, shade, upscale } from './pixel';

interface Pose {
  phase: number;
  walking: boolean;
  bob: number;
  shift: number;
  headDx: number;
  headDy: number;
  mouth: number;
  lying: boolean;
  eyes: 'open' | 'closed' | 'x' | 'fierce';
  tail: number;
  flame: number;
  tilt: number;
}

const P = (o: Partial<Pose>): Pose => ({
  phase: 0,
  walking: false,
  bob: 0,
  shift: 0,
  headDx: 0,
  headDy: 0,
  mouth: 0,
  lying: false,
  eyes: 'open',
  tail: 0,
  flame: 0,
  tilt: 0,
  ...o,
});

/** Frame order shared by every creature sheet. */
export const FRAME = {
  idle: [0, 1],
  walk: [2, 3, 4, 5],
  attack: [6, 7, 8],
  eat: [9, 10],
  rest: [11],
  sleep: [12],
  hurt: [13],
  dead: [14],
} as const;
export const FRAME_COUNT = 15;

const POSES: Pose[] = [
  P({ bob: 0, tail: 0, flame: 0 }),
  P({ bob: 0.6, tail: 1, flame: 1 }),
  P({ walking: true, phase: 0, bob: 0, tail: -1, flame: 0 }),
  P({ walking: true, phase: Math.PI / 2, bob: -0.8, tail: 0, flame: 1 }),
  P({ walking: true, phase: Math.PI, bob: 0, tail: 1, flame: 0 }),
  P({ walking: true, phase: (3 * Math.PI) / 2, bob: -0.8, tail: 0, flame: 1 }),
  P({ shift: -1.5, headDy: 1, mouth: 0.3, eyes: 'fierce', tail: 1, flame: 1 }),
  P({ shift: 2.5, headDx: 1.5, headDy: 0.5, mouth: 1, eyes: 'fierce', tail: -1, flame: 0, walking: true, phase: Math.PI / 2 }),
  P({ shift: 1, headDx: 0.5, mouth: 0.4, eyes: 'fierce', tail: 0, flame: 1 }),
  P({ headDx: 1.5, headDy: 4, mouth: 0.6, tail: 1, flame: 0 }),
  P({ headDx: 1.5, headDy: 4.5, mouth: 0, eyes: 'closed', tail: 0, flame: 1 }),
  P({ lying: true, tail: 0, flame: 0 }),
  P({ lying: true, eyes: 'closed', headDy: 1, tail: 0, flame: 1 }),
  P({ shift: -2, headDy: -1, mouth: 0.6, eyes: 'closed', tail: 1, flame: 0 }),
  P({ lying: true, eyes: 'x', headDy: 2, mouth: 0.3, tilt: 1, flame: 0 }),
];

export function paletteList(p: Palette): string[] {
  return [p.outline, p.dark, p.base, p.light, p.belly, p.accent, p.accent2, p.eye, '#ffffff', '#5a1a24', shade(p.accent, -0.3), shade(p.belly, -0.18)];
}

function wantsAuraGlow(art: BeastArt): boolean {
  return (art.features as string[]).includes('aura') || (art.features as string[]).includes('aura_burst');
}

/** Soft outer bloom so mega forms read as glowing even after pixelization. */
function withAuraGlow(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width, src.height);
  g.shadowColor = color;
  g.shadowBlur = Math.max(6, src.height * 0.06);
  g.drawImage(src, 0, 0);
  g.shadowBlur = 0;
  g.drawImage(src, 0, 0);
  return c;
}

/** Renders one creature sheet (FRAME_COUNT frames, laid out horizontally) at 2x scale. */
export function renderBeastSheet(art: BeastArt, pal: Palette): HTMLCanvasElement {
  const S = art.size;
  const { c, g } = makeCanvas(S * FRAME_COUNT, S);
  for (let f = 0; f < FRAME_COUNT; f++) {
    g.save();
    g.beginPath();
    g.rect(f * S, 0, S, S);
    g.clip();
    drawBeast(g, art, pal, POSES[f], f * S);
    g.restore();
  }
  const regions = Array.from({ length: FRAME_COUNT }, (_, f) => ({ x: f * S, y: 0, w: S, h: S }));
  pixelize(c, regions, paletteList(pal), pal.outline);
  const out = upscale(c);
  return wantsAuraGlow(art) ? withAuraGlow(out, pal.accent2) : out;
}

/** Single idle frame (2x) for UI previews. */
export function renderBeastPreview(art: BeastArt, pal: Palette, silhouette = false): HTMLCanvasElement {
  const S = art.size;
  const { c, g } = makeCanvas(S, S);
  drawBeast(g, art, pal, POSES[0], 0);
  pixelize(c, [{ x: 0, y: 0, w: S, h: S }], paletteList(pal), pal.outline);
  if (silhouette) {
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#0d1018';
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'source-over';
  }
  const out = upscale(c);
  return !silhouette && wantsAuraGlow(art) ? withAuraGlow(out, pal.accent2) : out;
}

function drawBeast(g: CanvasRenderingContext2D, a: BeastArt, pal: Palette, p: Pose, ox: number): void {
  const S = a.size;
  const gy = S - 2.5;
  const has = (f: string) => (a.features as string[]).includes(f);
  const biped = has('biped') || has('fly');
  const flying = has('fly');

  // Horizontal centring — bipeds stand tall/centered; quads leave room for snout+tail.
  let baseCx: number;
  if (biped) {
    baseCx = ox + S * 0.54;
  } else {
    const front = a.bodyW * 0.2 + a.headDx + a.headR + a.snout;
    const back = a.bodyW + a.tailLen * 0.75;
    baseCx = ox + (S - front - back) / 2 + back;
  }

  const lieDrop = p.lying ? a.legLen * 0.85 : 0;
  const hover = flying && !p.lying ? a.legLen * 0.45 + (p.flame ? 2.2 : 1.2) + p.bob * 0.45 : 0;
  const cx = baseCx + p.shift;
  // Stocky animal biped (Blaziken/Tyranitar vibe): wide chest, not a lanky stick.
  const stance = biped && !p.lying ? a.legLen * 0.7 : 0;
  const bw = biped && !p.lying ? a.bodyW * (flying ? 0.88 : 0.95) : a.bodyW;
  const bh = biped && !p.lying ? a.bodyH * (flying ? 0.95 : 1.05) : a.bodyH;
  const cy = gy - a.legLen * (flying ? 0.55 : 0.85) - bh * 0.5 + lieDrop + p.bob * 0.5 - hover - stance * 0.1;
  // Flying: lean forward like a soaring beast; standing biped: head stacked with big chibi head.
  const flyLean = flying && !p.lying ? bw * 0.35 : 0;
  const hx = cx + (biped && !p.lying ? bw * 0.18 + flyLean + a.headDx * 0.05 : a.headDx) + p.headDx;
  const hy =
    cy +
    (biped && !p.lying ? -bh * (flying ? 0.55 : 0.78) - a.headR * 0.2 : a.headDy) +
    p.headDy +
    p.bob * 0.3 +
    (p.lying ? a.headR * 0.35 : 0);

  if (p.tilt) {
    g.translate(cx, gy);
    g.rotate(-0.12);
    g.translate(-cx, -gy);
  }

  // ---- aura (behind) — underglow + crescent so silhouette stays readable ----
  if (has('aura') || has('aura_burst')) {
    const pulse = p.flame ? 1.05 : 1;
    // Soft ground / belly bloom (does not cover the body).
    g.globalAlpha = 0.28;
    ellipse(g, cx, gy - (flying ? a.legLen * 0.35 : 1.5), bw * 1.35 * pulse, Math.max(3, a.legW * 0.7), pal.accent2);
    g.globalAlpha = 0.22;
    ellipse(g, cx - bw * 0.05, cy + bh * 0.15, bw * 1.15, bh * 1.05, pal.accent);
    g.globalAlpha = 1;
    // Shoulder crescent ring (open at the front).
    g.strokeStyle = pal.accent2;
    g.lineWidth = Math.max(1.1, bw * 0.07);
    g.beginPath();
    g.ellipse(cx - bw * 0.1, cy - bh * 0.05, bw * 1.35 * pulse, bh * 1.15 * pulse, -0.2, Math.PI * 0.55, Math.PI * 1.85);
    g.stroke();
    g.strokeStyle = pal.accent;
    g.lineWidth = Math.max(0.7, bw * 0.04);
    g.beginPath();
    g.ellipse(cx - bw * 0.1, cy - bh * 0.05, bw * 1.55 * pulse, bh * 1.32 * pulse, -0.2, Math.PI * 0.6, Math.PI * 1.8);
    g.stroke();
  }
  if (has('aura_burst')) {
    // Elegant rays from the back only (Charizard/mega-style flare), not a full star blob.
    const n = 7;
    const r0 = Math.max(bw, bh) * 0.85;
    const r1 = r0 * (1.45 + (p.flame ? 0.12 : 0));
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const ang = -Math.PI * 0.85 + t * Math.PI * 1.1;
      const c0 = Math.cos(ang);
      const s0 = Math.sin(ang);
      const c1 = Math.cos(ang + 0.1);
      const s1 = Math.sin(ang + 0.1);
      const ox0 = cx - bw * 0.15;
      const oy0 = cy - bh * 0.2;
      poly(
        g,
        [ox0 + c0 * r0 * 0.55, oy0 + s0 * r0 * 0.55, ox0 + c0 * r1, oy0 + s0 * r1, ox0 + c1 * r0 * 0.7, oy0 + s1 * r0 * 0.7],
        k % 2 ? pal.accent2 : pal.accent,
      );
    }
    // Floating mote accents.
    for (let k = 0; k < 4; k++) {
      const ang = -0.9 + k * 0.55 + (p.flame ? 0.08 : 0);
      ellipse(g, cx + Math.cos(ang) * bw * 1.5, cy + Math.sin(ang) * bh * 1.1 - bh * 0.2, 1.4, 1.4, k % 2 ? pal.accent2 : '#ffffff');
    }
  }
  if (has('wings')) {
    // Wide dragon sails — span matters more than height for a majestic read.
    const flap = (flying ? (p.flame ? 1.08 : 0.96) : 0.85) + (p.walking ? Math.sin(p.phase) * 0.08 : 0);
    const wy = cy - bh * (flying ? 0.05 : 0.2);
    const drawWing = (side: number, outer: string, inner: string) => {
      const sx = cx + side * bw * 0.2;
      const tipX = cx + side * bw * (flying ? 2.55 : 1.85) * flap;
      const tipY = wy - bh * (flying ? 0.85 : 0.95) * flap;
      const midX = cx + side * bw * (flying ? 1.85 : 1.35) * flap;
      const midY = wy + bh * 0.25;
      const lowX = cx + side * bw * (flying ? 1.45 : 1.05) * flap;
      const lowY = wy + bh * (flying ? 0.85 : 0.7);
      poly(g, [sx, wy, tipX, tipY, midX, midY, lowX, lowY, sx + side * bw * 0.08, wy + bh * 0.4], outer);
      const inTipX = sx + side * bw * (flying ? 1.65 : 1.15) * flap;
      const inTipY = wy - bh * (flying ? 0.5 : 0.55) * flap;
      poly(g, [sx + side, wy - 1, inTipX, inTipY, (midX + sx) * 0.5, (midY + wy) * 0.5], inner);
      line(g, sx, wy, tipX, tipY, Math.max(0.9, a.legW * 0.2), shade(outer, -0.25));
      line(g, sx, wy, midX, midY, Math.max(0.75, a.legW * 0.15), shade(outer, -0.2));
      line(g, sx, wy, lowX, lowY, Math.max(0.75, a.legW * 0.15), shade(outer, -0.2));
    };
    drawWing(-1, pal.accent, pal.light);
    drawWing(1, pal.accent2, pal.light);
  }

  // ---- far legs (quadruped only; biped limbs are drawn after the body) ----
  const legY = cy + bh * (biped ? 0.55 : 0.35);
  const legX = [cx - bw * 0.55, cx + bw * 0.5];
  const drawLeg = (x: number, phase: number, color: string, footColor: string, lenMult = 1) => {
    if (p.lying) {
      ellipse(g, x + 1, gy - a.legW * 0.4, a.legW * 0.9, a.legW * 0.5, color);
      return;
    }
    const sw = p.walking ? Math.sin(p.phase + phase) * a.legLen * 0.5 * lenMult : 0;
    const lift = p.walking ? Math.max(0, Math.cos(p.phase + phase)) * Math.min(2.5, a.legLen * 0.35) * lenMult : 0;
    const fy = flying ? cy + bh * 0.85 : gy - a.legW * 0.4 - lift;
    line(g, x, legY, x + sw, fy, a.legW * (biped ? 1.15 : 1), color);
    ellipse(g, x + sw + a.legW * 0.15, fy + (flying ? a.legW * 0.2 : 0), a.legW * 0.65, a.legW * 0.4, footColor);
  };
  if (!biped) {
    drawLeg(legX[0] + 1.5, Math.PI, pal.dark, shade(pal.dark, -0.15));
    drawLeg(legX[1] + 1.5, 0, pal.dark, shade(pal.dark, -0.15));
  }

  // ---- tail ----
  const tx0 = cx - bw * (biped ? 0.55 : 0.85);
  const ty0 = cy + (biped ? bh * 0.25 : -bh * 0.15);
  const wag = p.tail * 1.2;
  const tipX = tx0 - a.tailLen;
  let tipY = ty0 - a.tailLen * 0.55 + wag;
  switch (a.tailKind) {
    case 'thin':
      g.strokeStyle = pal.base;
      g.lineWidth = a.tailW;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(tx0, ty0);
      g.quadraticCurveTo(tx0 - a.tailLen * 0.6, ty0 + 1, tipX, tipY);
      g.stroke();
      break;
    case 'bushy': {
      const mx = (tx0 + tipX) / 2;
      const my = (ty0 + tipY) / 2;
      const ang = Math.atan2(tipY - ty0, tipX - tx0);
      ellipse(g, mx, my, a.tailLen * 0.62, a.tailW, pal.base, ang);
      ellipse(g, tipX + 1.5, tipY + 0.5, a.tailW * 0.9, a.tailW * 0.75, pal.light, ang);
      break;
    }
    case 'leaf': {
      const ang = Math.atan2(tipY - ty0, tipX - tx0);
      ellipse(g, (tx0 + tipX) / 2, (ty0 + tipY) / 2, a.tailLen * 0.7, a.tailW, pal.light, ang);
      line(g, tx0, ty0, tipX, tipY, 0.8, pal.dark);
      break;
    }
    case 'fin': {
      tipY = ty0 - a.tailLen * 0.25 + wag;
      poly(g, [tx0 + 1, ty0 - a.tailW * 0.4, tipX, tipY - a.tailW * 1.2, tipX + a.tailLen * 0.25, tipY, tipX, tipY + a.tailW * 1.1, tx0 + 1, ty0 + a.tailW * 0.4], pal.accent);
      line(g, tx0, ty0, tipX + 1, tipY, 0.8, shade(pal.accent, -0.3));
      break;
    }
    case 'stub':
      ellipse(g, tx0 + 0.5, ty0 - 0.5 + wag * 0.3, a.tailW, a.tailW * 0.9, pal.light);
      break;
    case 'lizard': {
      const ly = cy + bh * 0.35 + wag * 0.4;
      poly(g, [tx0 + 2, cy - bh * 0.45, tx0 - a.tailLen, ly + 1, tx0 + 2, cy + bh * 0.6], pal.base);
      poly(g, [tx0 + 2, cy + bh * 0.15, tx0 - a.tailLen * 0.9, ly + 1, tx0 + 2, cy + bh * 0.6], pal.dark);
      tipY = ly;
      break;
    }
  }
  if (has('flame_tail')) {
    const fx = a.tailKind === 'lizard' ? tx0 - a.tailLen : tipX;
    const fy = tipY;
    const fl = p.flame ? 1 : 0;
    const fs = Math.max(2.5, a.tailW * 1.3);
    poly(g, [fx - fs * 0.9, fy + fs * 0.4, fx - fs * 0.3, fy - fs * (2 + fl * 0.5), fx + fs * 0.3, fy - fs * 0.9, fx + fs * 0.8, fy + fs * 0.4], pal.accent2);
    poly(g, [fx - fs * 0.45, fy + fs * 0.3, fx - fs * 0.15, fy - fs * (1.2 + fl * 0.3), fx + fs * 0.4, fy + fs * 0.3], pal.accent);
  }

  // ---- body (biped = stocky upright torso + shoulder mass; quad = horizontal) ----
  if (biped && !p.lying) {
    // Hip / pelvis mass.
    ellipse(g, cx, cy + bh * 0.35, bw * 0.85, bh * 0.55, pal.dark);
    // Main torso.
    ellipse(g, cx, cy - bh * 0.05, bw, bh * 0.95, pal.base);
    // Broad chest / shoulders.
    ellipse(g, cx + bw * 0.05, cy - bh * 0.35, bw * 1.15, bh * 0.55, pal.base);
    ellipse(g, cx + bw * 0.1, cy - bh * 0.15, bw * 0.7, bh * 0.5, pal.belly);
    ellipse(g, cx - bw * 0.15, cy - bh * 0.55, bw * 0.45, bh * 0.25, pal.light);
  } else {
    ellipse(g, cx, cy, bw, bh, pal.base);
  }
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, bw * (biped ? 1.1 : 1), bh * (biped ? 1.05 : 1), 0, 0, Math.PI * 2);
  g.clip();
  if (!biped || p.lying) {
    ellipse(g, cx, cy + bh * 0.95, bw * 1.15, bh * 0.6, pal.dark);
    ellipse(g, cx + bw * 0.2, cy + bh * 0.55, bw * 0.62, bh * 0.42, pal.belly);
    ellipse(g, cx - bw * 0.15, cy - bh * 0.55, bw * 0.5, bh * 0.28, pal.light);
  }
  if (has('stripes')) {
    for (let k = 0; k < 3; k++) {
      const sx = cx - bw * 0.45 + k * bw * 0.38;
      poly(g, [sx, cy - bh, sx + bw * 0.14, cy - bh, sx + bw * 0.04, cy - bh * 0.1], pal.dark);
    }
  }
  if (has('spots')) {
    ellipse(g, cx - bw * 0.35, cy - bh * 0.2, 1.2, 1, pal.light);
    ellipse(g, cx + bw * 0.05, cy - bh * 0.45, 1.2, 1, pal.light);
    ellipse(g, cx - bw * 0.1, cy + bh * 0.1, 1, 0.9, pal.light);
  }
  g.restore();

  // ---- back features (scaled down on biped so silhouette stays clean) ----
  const topY = cy - bh;
  const feat = biped ? 0.72 : 1;
  if (has('shell')) {
    ellipse(g, cx - bw * 0.05, cy - bh * 0.2, bw * 0.95 * feat, bh * 1.0 * feat, pal.accent);
    g.save();
    g.beginPath();
    g.ellipse(cx - bw * 0.05, cy - bh * 0.2, bw * 0.95 * feat, bh * 1.0 * feat, 0, 0, Math.PI * 2);
    g.clip();
    ellipse(g, cx - bw * 0.25, cy - bh * 0.75, bw * 0.45, bh * 0.3, pal.accent2);
    for (let k = -1; k <= 1; k++) line(g, cx + k * bw * 0.4, cy - bh * 1.1, cx + k * bw * 0.5, cy + bh * 0.4, 0.9, shade(pal.accent, -0.3));
    line(g, cx - bw, cy - bh * 0.1, cx + bw, cy - bh * 0.1, 0.9, shade(pal.accent, -0.3));
    g.restore();
  }
  if (has('moss')) {
    for (let k = 0; k < (biped ? 3 : 4); k++) {
      const mx = cx - bw * 0.55 + k * bw * 0.4;
      ellipse(g, mx, topY + bh * 0.15, bw * 0.18, bh * 0.22, pal.dark);
    }
    ellipse(g, cx - bw * 0.2, topY + bh * 0.05, 1, 1, pal.accent2);
    ellipse(g, cx + bw * 0.28, topY + bh * 0.08, 1, 1, '#ff9ec4');
  }
  if (has('back_leaves')) {
    const n = bw > 9 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const lx = cx - bw * 0.3 + k * bw * 0.35;
      const ang = -1.2 + k * 0.5;
      ellipse(g, lx, topY - bh * 0.12 * feat, bh * 0.65 * feat, bh * 0.28 * feat, pal.light, ang);
    }
  }
  if (has('tree_crown')) {
    // Biped: compact shoulder grove (not a giant tree blocking the head).
    const trunkX = cx - bw * (biped ? 0.05 : 0.15);
    const trunkH = bh * (biped ? 0.55 : 0.9);
    line(g, trunkX, topY + 2, trunkX - 1, topY - trunkH, bw * (biped ? 0.12 : 0.16), pal.accent);
    const crY = topY - trunkH * (biped ? 1.15 : 1.35);
    const cr = feat;
    ellipse(g, trunkX - bw * 0.28 * cr, crY + 2, bw * 0.32 * cr, bh * 0.35 * cr, pal.dark);
    ellipse(g, trunkX + bw * 0.26 * cr, crY + 2, bw * 0.32 * cr, bh * 0.35 * cr, pal.dark);
    ellipse(g, trunkX, crY - 1, bw * 0.4 * cr, bh * 0.42 * cr, pal.base);
    ellipse(g, trunkX - bw * 0.1, crY - 3, bw * 0.22 * cr, bh * 0.2 * cr, pal.light);
    ellipse(g, trunkX + bw * 0.25, crY + 1, 1.2, 1.2, pal.accent2);
    ellipse(g, trunkX - bw * 0.22, crY - 1, 1.2, 1.2, '#ff9ec4');
  }
  if (has('spikes')) {
    const n = Math.max(3, Math.round(bw / 3.5));
    for (let k = 0; k < n; k++) {
      const sx = cx - bw * 0.65 + (k * bw * 1.25) / (n - 1);
      const sh = bh * (biped ? 0.38 : 0.55);
      poly(g, [sx - 1.5, topY + 1.5, sx, topY - sh, sx + 1.5, topY + 1.5], k % 2 ? pal.accent2 : pal.dark);
    }
  }
  if (has('crystals')) {
    const n = Math.max(2, Math.round(bw / 5));
    for (let k = 0; k < n; k++) {
      const sx = cx - bw * 0.4 + (k * bw * 0.8) / Math.max(1, n - 1);
      const h = bh * (0.55 + (k % 2) * 0.3) * feat;
      poly(g, [sx - 1.6, topY + 2, sx - 0.3, topY - h, sx + 1.6, topY + 2], pal.accent);
      line(g, sx - 0.2, topY - h * 0.7, sx - 0.2, topY + 1, 0.6, pal.accent2);
    }
  }
  if (has('back_fin')) {
    poly(g, [cx - bw * 0.45, topY + 2, cx - bw * 0.05, topY - bh * 0.75 * feat, cx + bw * 0.3, topY + 2], pal.accent);
    line(g, cx - bw * 0.1, topY - bh * 0.5 * feat, cx - bw * 0.1, topY + 1, 0.7, shade(pal.accent, -0.3));
  }

  // ---- near legs / biped limbs (digitigrade animal stance, not stick-person) ----
  if (biped && !p.lying) {
    const drawDigitigrade = (hipX: number, phase: number, color: string, footColor: string) => {
      const swing = p.walking ? Math.sin(p.phase + phase) : flying ? Math.sin(p.phase + phase) * 0.35 : 0.12;
      const lift = p.walking && !flying ? Math.max(0, Math.cos(p.phase + phase)) * a.legLen * 0.22 : 0;
      const thighLen = a.legLen * (flying ? 0.55 : 0.7);
      const kneeX = hipX + swing * a.legLen * 0.28;
      const kneeY = cy + bh * 0.55 + thighLen * 0.15 - lift * 0.3;
      const ankleX = kneeX + swing * a.legLen * 0.18 - a.legW * 0.15;
      const ankleY = flying ? cy + bh * 0.95 : gy - a.legW * 0.35 - lift;
      // Thigh (thick) → shin (thinner) → paw.
      line(g, hipX, cy + bh * 0.5, kneeX, kneeY, a.legW * 1.35, color);
      line(g, kneeX, kneeY, ankleX, ankleY, a.legW * 0.95, shade(color, -0.08));
      ellipse(g, ankleX + a.legW * 0.2, ankleY + (flying ? a.legW * 0.15 : 0), a.legW * 0.75, a.legW * 0.42, footColor);
      // Toe claws.
      for (let t = 0; t < 3; t++) {
        const tx = ankleX + a.legW * (0.15 + t * 0.35);
        line(g, tx, ankleY, tx + 0.8, ankleY + a.legW * 0.35, 0.7, pal.outline);
      }
    };
    drawDigitigrade(cx - bw * 0.32, Math.PI, pal.dark, shade(pal.dark, -0.15));
    drawDigitigrade(cx + bw * 0.28, 0, pal.base, shade(pal.dark, -0.1));

    // Short muscular arms with claws (held forward like Blaziken/Lucario).
    const shY = cy - bh * 0.2;
    const armLen = a.legLen * (flying ? 0.55 : 0.62);
    for (const [side, phase, col] of [
      [-1, 0, pal.dark],
      [1, Math.PI, pal.base],
    ] as const) {
      const ax = cx + side * bw * 0.72;
      const swing = (p.walking || flying ? Math.sin(p.phase + phase) : 0.2) * armLen * 0.4;
      const elbowX = ax + side * a.legW * 0.4 + swing * 0.2;
      const elbowY = shY + armLen * 0.45;
      const handX = elbowX + side * a.legW * 0.2 + swing * 0.35;
      const handY = elbowY + armLen * (flying ? 0.35 : 0.55);
      line(g, ax, shY, elbowX, elbowY, a.legW * 0.95, col);
      line(g, elbowX, elbowY, handX, handY, a.legW * 0.75, shade(col, -0.08));
      ellipse(g, handX, handY + 1, a.legW * 0.5, a.legW * 0.38, shade(col, -0.12));
      for (let t = 0; t < 3; t++) {
        line(g, handX - 1 + t * 1.2, handY + 1, handX - 1 + t * 1.2 + side * 0.5, handY + a.legW * 0.55, 0.65, pal.outline);
      }
    }
  } else {
    drawLeg(legX[0], 0, pal.base, pal.dark);
    drawLeg(legX[1], Math.PI, pal.base, pal.dark);
  }

  // ---- neck / mane ----
  if (has('flame_mane')) {
    const mx = biped ? cx + bw * 0.15 : cx + bw * 0.6;
    const my = biped ? cy - bh * 0.85 : cy - bh * 0.4;
    const fl = p.flame ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      const fx = mx - k * bw * 0.16;
      const h = a.headR * (1.15 + ((k + fl) % 2) * 0.35);
      poly(g, [fx - 2.2, my + 2, fx - 0.5 - k * 0.5, my - h, fx + 2.2, my + 1], pal.accent2);
      poly(g, [fx - 1.2, my + 1.5, fx - 0.3 - k * 0.3, my - h * 0.6, fx + 1.2, my + 1], pal.accent);
    }
  } else if (!biped) {
    ellipse(g, cx + bw * 0.62, cy - bh * 0.35, a.headR * 0.65, bh * 0.55, pal.base);
  } else {
    // Short neck bridge into the head.
    ellipse(g, cx + bw * 0.08, cy - bh * 0.78, a.headR * 0.55, bh * 0.28, pal.base);
  }

  // ---- ears (behind head) ----
  const earX = hx - a.headR * 0.35;
  const earY = hy - a.headR * 0.75;
  if (has('leaf_ears')) {
    ellipse(g, earX - 1, earY - a.headR * 0.25, a.headR * 0.85, a.headR * 0.38, pal.light, -0.9);
    line(g, earX + 0.5, earY + 0.5, earX - a.headR * 0.7, earY - a.headR * 0.9, 0.7, pal.dark);
  }
  if (has('pointy_ears')) {
    poly(g, [earX - a.headR * 0.4, earY + 1.5, earX - a.headR * 0.1, earY - a.headR * 0.95, earX + a.headR * 0.45, earY + 1], pal.dark);
    poly(g, [earX + a.headR * 0.05, earY + 1.5, earX + a.headR * 0.35, earY - a.headR * 0.9, earX + a.headR * 0.85, earY + 1.5], pal.base);
    poly(g, [earX + a.headR * 0.25, earY + 1, earX + a.headR * 0.37, earY - a.headR * 0.45, earX + a.headR * 0.6, earY + 1], pal.belly);
  }
  if (has('round_ears')) {
    ellipse(g, earX - a.headR * 0.1, earY, a.headR * 0.4, a.headR * 0.32, pal.dark, -0.4);
  }
  if (has('long_ears')) {
    ellipse(g, earX - a.headR * 0.5, earY - a.headR * 0.8, a.headR * 0.35, a.headR * 1.05, pal.dark, -0.35);
    ellipse(g, earX + a.headR * 0.05, earY - a.headR * 0.9, a.headR * 0.38, a.headR * 1.1, pal.base, -0.2);
    ellipse(g, earX + a.headR * 0.08, earY - a.headR * 0.85, a.headR * 0.16, a.headR * 0.75, pal.accent2, -0.2);
  }
  if (has('fin_ears')) {
    poly(g, [earX + 1, earY + 2, earX - a.headR * 1.1, earY - a.headR * 0.55, earX - a.headR * 0.6, earY + a.headR * 0.4], pal.accent);
    line(g, earX, earY + 1.5, earX - a.headR * 0.85, earY - a.headR * 0.3, 0.7, shade(pal.accent, -0.3));
  }

  // ---- head ----
  ellipse(g, hx, hy, a.headR, a.headR * 0.92, pal.base);
  g.save();
  g.beginPath();
  g.ellipse(hx, hy, a.headR, a.headR * 0.92, 0, 0, Math.PI * 2);
  g.clip();
  ellipse(g, hx - a.headR * 0.1, hy + a.headR * 0.95, a.headR * 1.1, a.headR * 0.45, pal.dark);
  ellipse(g, hx - a.headR * 0.3, hy - a.headR * 0.55, a.headR * 0.5, a.headR * 0.3, pal.light);
  g.restore();

  // snout / muzzle
  const snX = hx + a.headR * 0.62;
  const snY = hy + a.headR * 0.28;
  if (a.snout > 0) {
    ellipse(g, snX + a.snout * 0.45, snY, a.snout * 0.7 + a.headR * 0.32, a.headR * 0.42, pal.belly);
    ellipse(g, snX + a.snout * 0.45, snY + a.headR * 0.25, a.snout * 0.6 + a.headR * 0.25, a.headR * 0.2, shade(pal.belly, -0.18));
  }
  const noseX = snX + a.snout * 0.45 + a.snout * 0.7 + a.headR * 0.25;
  ellipse(g, noseX, snY - a.headR * 0.12, 1, 0.9, pal.outline);

  // mouth
  if (p.mouth > 0.05) {
    const mw = a.snout * 0.8 + a.headR * 0.45;
    const mh = 1 + p.mouth * a.headR * 0.45;
    poly(g, [noseX - 0.5, snY + a.headR * 0.18, noseX - mw, snY + a.headR * 0.12, noseX - 0.5, snY + a.headR * 0.18 + mh], '#5a1a24');
    if (p.mouth > 0.5) poly(g, [noseX - 1, snY + a.headR * 0.18, noseX - 2.2, snY + a.headR * 0.18, noseX - 1.5, snY + a.headR * 0.18 + 1.6], '#ffffff');
  }

  if (has('tusks')) {
    poly(g, [noseX - 2.5, snY + a.headR * 0.3, noseX - 0.5, snY - a.headR * 0.35, noseX - 1.2, snY + a.headR * 0.4], pal.accent);
  }
  if (has('beard')) {
    poly(g, [hx + a.headR * 0.1, hy + a.headR * 0.7, hx + a.headR * 0.9, hy + a.headR * 0.7, hx + a.headR * 0.35, hy + a.headR * 1.5], pal.light);
  }
  if (has('whiskers')) {
    line(g, noseX - 1, snY + 0.5, noseX + 2.5, snY - 0.5, 0.6, pal.outline);
    line(g, noseX - 1, snY + 1.2, noseX + 2.5, snY + 1.8, 0.6, pal.outline);
  }

  // horns
  const hornX = hx + a.headR * 0.05;
  const hornY = hy - a.headR * 0.75;
  if (has('horns')) {
    poly(g, [hornX - 1.4, hornY + 1.5, hornX - 0.6, hornY - a.headR * 0.65, hornX + 1.2, hornY + 1.5], pal.accent);
  }
  if (has('big_horns')) {
    g.strokeStyle = pal.accent;
    g.lineWidth = Math.max(1.8, a.headR * 0.32);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(hornX, hornY + 1);
    g.quadraticCurveTo(hornX - a.headR * 0.2, hornY - a.headR * 1.1, hornX - a.headR * 1.1, hornY - a.headR * 0.9);
    g.stroke();
    g.strokeStyle = shade(pal.accent, 0.3);
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(hornX - 0.3, hornY);
    g.quadraticCurveTo(hornX - a.headR * 0.25, hornY - a.headR * 0.95, hornX - a.headR * 0.9, hornY - a.headR * 0.95);
    g.stroke();
  }
  if (has('curled_horns')) {
    g.strokeStyle = pal.accent;
    g.lineWidth = Math.max(1.6, a.headR * 0.3);
    g.beginPath();
    g.arc(hx - a.headR * 0.25, hy - a.headR * 0.35, a.headR * 0.55, Math.PI * 1.05, Math.PI * 2.2);
    g.stroke();
  }
  if (has('antlers')) {
    const ax = hx - a.headR * 0.1;
    const ay = hy - a.headR * 0.8;
    line(g, ax, ay, ax - a.headR * 0.4, ay - a.headR * 1.6, 1, pal.accent);
    line(g, ax - a.headR * 0.25, ay - a.headR * 0.9, ax - a.headR * 1.1, ay - a.headR * 1.2, 1, pal.accent);
    line(g, ax - a.headR * 0.35, ay - a.headR * 1.35, ax + a.headR * 0.4, ay - a.headR * 1.9, 1, pal.accent);
  }
  if (has('flame_crest')) {
    const fl = p.flame ? 1 : 0;
    poly(g, [hx - a.headR * 0.7, hy - a.headR * 0.6, hx - a.headR * (0.4 + fl * 0.2), hy - a.headR * 1.9, hx + a.headR * 0.3, hy - a.headR * 0.7], pal.accent2);
    poly(g, [hx - a.headR * 0.45, hy - a.headR * 0.65, hx - a.headR * 0.35, hy - a.headR * 1.35, hx + a.headR * 0.1, hy - a.headR * 0.7], pal.accent);
  }
  if (has('gem')) {
    const gx = hx + a.headR * 0.15;
    const gyy = hy - a.headR * 0.5;
    poly(g, [gx, gyy - 2, gx + 1.6, gyy, gx, gyy + 2, gx - 1.6, gyy], pal.accent);
    ellipse(g, gx - 0.4, gyy - 0.6, 0.6, 0.6, '#ffffff');
  }
  if (has('halo')) {
    const hx0 = hx + a.headR * 0.05;
    const hy0 = hy - a.headR * 1.55;
    g.strokeStyle = pal.accent2;
    g.lineWidth = Math.max(1.4, a.headR * 0.22);
    g.beginPath();
    g.ellipse(hx0, hy0, a.headR * 0.95, a.headR * 0.28, -0.15, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = pal.accent;
    g.lineWidth = Math.max(0.7, a.headR * 0.1);
    g.beginPath();
    g.ellipse(hx0, hy0, a.headR * 0.7, a.headR * 0.18, -0.15, 0, Math.PI * 2);
    g.stroke();
  }

  // eye
  const ex = hx + a.headR * 0.32;
  const ey = hy - a.headR * 0.12;
  const er = Math.max(1.6, a.headR * 0.3);
  const fierce = p.eyes === 'fierce' || has('fierce_eyes');
  if (p.eyes === 'closed') {
    line(g, ex - er, ey + 0.5, ex + er, ey + 0.5, 0.9, pal.outline);
  } else if (p.eyes === 'x') {
    line(g, ex - er * 0.8, ey - er * 0.8, ex + er * 0.8, ey + er * 0.8, 0.8, pal.outline);
    line(g, ex - er * 0.8, ey + er * 0.8, ex + er * 0.8, ey - er * 0.8, 0.8, pal.outline);
  } else {
    ellipse(g, ex, ey, er, er * 1.1, '#ffffff');
    ellipse(g, ex + er * 0.3, ey + er * 0.1, er * 0.68, er * 0.85, pal.eye);
    ellipse(g, ex + er * 0.05, ey - er * 0.35, Math.max(0.6, er * 0.28), Math.max(0.6, er * 0.28), '#ffffff');
    if (fierce) {
      line(g, ex - er * 1.15, ey - er * 1.45, ex + er * 1.15, ey - er * 0.55, 1.1, pal.outline);
      ellipse(g, ex + er * 0.15, ey - er * 0.05, er * 0.35, er * 0.25, pal.accent2);
    }
  }
}
