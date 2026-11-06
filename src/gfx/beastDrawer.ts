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
  return upscale(c);
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
  return upscale(c);
}

function drawBeast(g: CanvasRenderingContext2D, a: BeastArt, pal: Palette, p: Pose, ox: number): void {
  const S = a.size;
  const gy = S - 2.5;
  const has = (f: string) => (a.features as string[]).includes(f);

  // Horizontal centring so head+snout and tail fit the frame.
  const front = a.bodyW * 0.2 + a.headDx + a.headR + a.snout;
  const back = a.bodyW + a.tailLen * 0.75;
  const baseCx = ox + (S - front - back) / 2 + back;

  const lieDrop = p.lying ? a.legLen * 0.85 : 0;
  const cx = baseCx + p.shift;
  const cy = gy - a.legLen - a.bodyH * 0.72 + lieDrop + p.bob * 0.5;
  const hx = cx + a.headDx + p.headDx;
  const hy = cy + a.headDy + p.headDy + p.bob * 0.3 + (p.lying ? a.headR * 0.35 : 0);

  if (p.tilt) {
    g.translate(cx, gy);
    g.rotate(-0.12);
    g.translate(-cx, -gy);
  }

  // Ground contact shadow is drawn in-game; here only the creature.

  // ---- far legs ----
  const legY = cy + a.bodyH * 0.35;
  const legX = [cx - a.bodyW * 0.55, cx + a.bodyW * 0.5];
  const drawLeg = (x: number, phase: number, color: string, footColor: string) => {
    if (p.lying) {
      ellipse(g, x + 1, gy - a.legW * 0.4, a.legW * 0.9, a.legW * 0.5, color);
      return;
    }
    const sw = p.walking ? Math.sin(p.phase + phase) * a.legLen * 0.5 : 0;
    const lift = p.walking ? Math.max(0, Math.cos(p.phase + phase)) * Math.min(2, a.legLen * 0.3) : 0;
    line(g, x, legY, x + sw, gy - a.legW * 0.4 - lift, a.legW, color);
    ellipse(g, x + sw + a.legW * 0.15, gy - a.legW * 0.35 - lift, a.legW * 0.6, a.legW * 0.4, footColor);
  };
  drawLeg(legX[0] + 1.5, Math.PI, pal.dark, shade(pal.dark, -0.15));
  drawLeg(legX[1] + 1.5, 0, pal.dark, shade(pal.dark, -0.15));

  // ---- tail ----
  const tx0 = cx - a.bodyW * 0.85;
  const ty0 = cy - a.bodyH * 0.15;
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
      const ly = cy + a.bodyH * 0.35 + wag * 0.4;
      poly(g, [tx0 + 2, cy - a.bodyH * 0.45, tx0 - a.tailLen, ly + 1, tx0 + 2, cy + a.bodyH * 0.6], pal.base);
      poly(g, [tx0 + 2, cy + a.bodyH * 0.15, tx0 - a.tailLen * 0.9, ly + 1, tx0 + 2, cy + a.bodyH * 0.6], pal.dark);
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

  // ---- body ----
  ellipse(g, cx, cy, a.bodyW, a.bodyH, pal.base);
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, a.bodyW, a.bodyH, 0, 0, Math.PI * 2);
  g.clip();
  ellipse(g, cx, cy + a.bodyH * 0.95, a.bodyW * 1.15, a.bodyH * 0.6, pal.dark);
  ellipse(g, cx + a.bodyW * 0.2, cy + a.bodyH * 0.55, a.bodyW * 0.62, a.bodyH * 0.42, pal.belly);
  ellipse(g, cx - a.bodyW * 0.2, cy - a.bodyH * 0.55, a.bodyW * 0.55, a.bodyH * 0.3, pal.light);
  if (has('stripes')) {
    for (let k = 0; k < 3; k++) {
      const sx = cx - a.bodyW * 0.5 + k * a.bodyW * 0.42;
      poly(g, [sx, cy - a.bodyH, sx + a.bodyW * 0.16, cy - a.bodyH, sx + a.bodyW * 0.05, cy - a.bodyH * 0.1], pal.dark);
    }
  }
  if (has('spots')) {
    ellipse(g, cx - a.bodyW * 0.4, cy - a.bodyH * 0.2, 1.2, 1, pal.light);
    ellipse(g, cx + a.bodyW * 0.05, cy - a.bodyH * 0.45, 1.2, 1, pal.light);
    ellipse(g, cx - a.bodyW * 0.1, cy + a.bodyH * 0.1, 1, 0.9, pal.light);
  }
  g.restore();

  // ---- back features ----
  const topY = cy - a.bodyH;
  if (has('shell')) {
    ellipse(g, cx - a.bodyW * 0.05, cy - a.bodyH * 0.25, a.bodyW * 0.95, a.bodyH * 1.05, pal.accent);
    g.save();
    g.beginPath();
    g.ellipse(cx - a.bodyW * 0.05, cy - a.bodyH * 0.25, a.bodyW * 0.95, a.bodyH * 1.05, 0, 0, Math.PI * 2);
    g.clip();
    ellipse(g, cx - a.bodyW * 0.3, cy - a.bodyH * 0.9, a.bodyW * 0.5, a.bodyH * 0.35, pal.accent2);
    for (let k = -1; k <= 1; k++) line(g, cx + k * a.bodyW * 0.45, cy - a.bodyH * 1.3, cx + k * a.bodyW * 0.55, cy + a.bodyH * 0.5, 0.9, shade(pal.accent, -0.3));
    line(g, cx - a.bodyW, cy - a.bodyH * 0.1, cx + a.bodyW, cy - a.bodyH * 0.1, 0.9, shade(pal.accent, -0.3));
    g.restore();
    ellipse(g, cx - a.bodyW * 0.05, cy + a.bodyH * 0.55, a.bodyW * 0.95, a.bodyH * 0.22, pal.belly);
  }
  if (has('moss')) {
    for (let k = 0; k < 4; k++) {
      const mx = cx - a.bodyW * 0.7 + k * a.bodyW * 0.45;
      ellipse(g, mx, topY + a.bodyH * 0.2, a.bodyW * 0.22, a.bodyH * 0.28, pal.dark);
    }
    ellipse(g, cx - a.bodyW * 0.25, topY + a.bodyH * 0.05, 1, 1, pal.accent2);
    ellipse(g, cx + a.bodyW * 0.35, topY + a.bodyH * 0.1, 1, 1, '#ff9ec4');
  }
  if (has('back_leaves')) {
    const n = a.bodyW > 9 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const lx = cx - a.bodyW * 0.35 + k * a.bodyW * 0.4;
      const ang = -1.2 + k * 0.5;
      ellipse(g, lx, topY - a.bodyH * 0.15, a.bodyH * 0.75, a.bodyH * 0.32, pal.light, ang);
      line(g, lx - Math.cos(ang) * a.bodyH * 0.5, topY - a.bodyH * 0.15 - Math.sin(ang) * a.bodyH * 0.5, lx + Math.cos(ang) * a.bodyH * 0.5, topY - a.bodyH * 0.15 + Math.sin(ang) * a.bodyH * 0.5, 0.8, pal.dark);
    }
  }
  if (has('tree_crown')) {
    const trunkX = cx - a.bodyW * 0.15;
    line(g, trunkX, topY + 2, trunkX - 1, topY - a.bodyH * 0.9, a.bodyW * 0.16, pal.accent);
    const crY = topY - a.bodyH * 1.25;
    ellipse(g, trunkX - a.bodyW * 0.35, crY + 2, a.bodyW * 0.4, a.bodyH * 0.45, pal.dark);
    ellipse(g, trunkX + a.bodyW * 0.3, crY + 2, a.bodyW * 0.4, a.bodyH * 0.45, pal.dark);
    ellipse(g, trunkX, crY - 1, a.bodyW * 0.5, a.bodyH * 0.55, pal.base);
    ellipse(g, trunkX - a.bodyW * 0.15, crY - 3, a.bodyW * 0.28, a.bodyH * 0.25, pal.light);
    ellipse(g, trunkX + a.bodyW * 0.32, crY + 1, 1.3, 1.3, pal.accent2);
    ellipse(g, trunkX - a.bodyW * 0.3, crY - 1, 1.3, 1.3, '#ff9ec4');
  }
  if (has('spikes')) {
    const n = Math.max(3, Math.round(a.bodyW / 3));
    for (let k = 0; k < n; k++) {
      const sx = cx - a.bodyW * 0.75 + (k * a.bodyW * 1.4) / (n - 1);
      const sh = a.bodyH * 0.55;
      poly(g, [sx - 1.6, topY + 1.5, sx, topY - sh, sx + 1.6, topY + 1.5], k % 2 ? pal.accent2 : pal.dark);
    }
  }
  if (has('crystals')) {
    const n = Math.max(2, Math.round(a.bodyW / 5));
    for (let k = 0; k < n; k++) {
      const sx = cx - a.bodyW * 0.45 + (k * a.bodyW * 0.9) / Math.max(1, n - 1);
      const h = a.bodyH * (0.8 + (k % 2) * 0.4);
      poly(g, [sx - 1.8, topY + 2, sx - 0.4, topY - h, sx + 1.8, topY + 2], pal.accent);
      line(g, sx - 0.3, topY - h * 0.7, sx - 0.3, topY + 1, 0.6, pal.accent2);
    }
  }
  if (has('back_fin')) {
    poly(g, [cx - a.bodyW * 0.55, topY + 2, cx - a.bodyW * 0.1, topY - a.bodyH * 0.9, cx + a.bodyW * 0.35, topY + 2], pal.accent);
    line(g, cx - a.bodyW * 0.15, topY - a.bodyH * 0.6, cx - a.bodyW * 0.15, topY + 1, 0.7, shade(pal.accent, -0.3));
  }

  // ---- near legs ----
  drawLeg(legX[0], 0, pal.base, pal.dark);
  drawLeg(legX[1], Math.PI, pal.base, pal.dark);

  // ---- neck / mane ----
  if (has('flame_mane')) {
    const mx = cx + a.bodyW * 0.6;
    const my = cy - a.bodyH * 0.4;
    const fl = p.flame ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      const fx = mx - k * a.bodyW * 0.18;
      const h = a.headR * (1.2 + ((k + fl) % 2) * 0.35);
      poly(g, [fx - 2.2, my + 2, fx - 0.5 - k * 0.5, my - h, fx + 2.2, my + 1], pal.accent2);
      poly(g, [fx - 1.2, my + 1.5, fx - 0.3 - k * 0.3, my - h * 0.6, fx + 1.2, my + 1], pal.accent);
    }
  } else {
    ellipse(g, cx + a.bodyW * 0.62, cy - a.bodyH * 0.35, a.headR * 0.65, a.bodyH * 0.55, pal.base);
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

  // eye
  const ex = hx + a.headR * 0.32;
  const ey = hy - a.headR * 0.12;
  const er = Math.max(1.6, a.headR * 0.3);
  if (p.eyes === 'closed') {
    line(g, ex - er, ey + 0.5, ex + er, ey + 0.5, 0.9, pal.outline);
  } else if (p.eyes === 'x') {
    line(g, ex - er * 0.8, ey - er * 0.8, ex + er * 0.8, ey + er * 0.8, 0.8, pal.outline);
    line(g, ex - er * 0.8, ey + er * 0.8, ex + er * 0.8, ey - er * 0.8, 0.8, pal.outline);
  } else {
    ellipse(g, ex, ey, er, er * 1.1, '#ffffff');
    ellipse(g, ex + er * 0.3, ey + er * 0.1, er * 0.68, er * 0.85, pal.eye);
    ellipse(g, ex + er * 0.05, ey - er * 0.35, Math.max(0.6, er * 0.28), Math.max(0.6, er * 0.28), '#ffffff');
    if (p.eyes === 'fierce') line(g, ex - er * 1.1, ey - er * 1.4, ex + er * 1.1, ey - er * 0.7, 0.9, pal.outline);
  }
}
