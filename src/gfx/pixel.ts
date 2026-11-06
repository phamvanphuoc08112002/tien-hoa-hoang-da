export const ART_SCALE = 2;

export function makeCanvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.imageSmoothingEnabled = false;
  return { c, g };
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pixel-art cleanup on a low-res canvas region:
 * hard alpha, optional palette quantization, and a 1px outline around opaque shapes.
 */
export function pixelize(c: HTMLCanvasElement, regions: Region[], palette: string[] | null, outline: string | null, alphaCut = 110): void {
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const W = c.width;
  const pal = palette ? palette.map(hexToRgb) : null;
  const ol = outline ? hexToRgb(outline) : null;

  for (const R of regions) {
    for (let y = R.y; y < R.y + R.h; y++) {
      for (let x = R.x; x < R.x + R.w; x++) {
        const i = (y * W + x) * 4;
        if (d[i + 3] < alphaCut) {
          d[i + 3] = 0;
          continue;
        }
        d[i + 3] = 255;
        if (pal) {
          let best = 0;
          let bd = Infinity;
          for (let k = 0; k < pal.length; k++) {
            const dr = d[i] - pal[k][0];
            const dg = d[i + 1] - pal[k][1];
            const db = d[i + 2] - pal[k][2];
            const dd = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
            if (dd < bd) {
              bd = dd;
              best = k;
            }
          }
          d[i] = pal[best][0];
          d[i + 1] = pal[best][1];
          d[i + 2] = pal[best][2];
        }
      }
    }
    if (ol) {
      const mark: number[] = [];
      for (let y = R.y; y < R.y + R.h; y++) {
        for (let x = R.x; x < R.x + R.w; x++) {
          const i = (y * W + x) * 4;
          if (d[i + 3] !== 0) continue;
          const nb = [
            [x + 1, y],
            [x - 1, y],
            [x, y + 1],
            [x, y - 1],
          ];
          for (const [nx, ny] of nb) {
            if (nx < R.x || ny < R.y || nx >= R.x + R.w || ny >= R.y + R.h) continue;
            if (d[(ny * W + nx) * 4 + 3] === 255) {
              mark.push(i);
              break;
            }
          }
        }
      }
      for (const i of mark) {
        d[i] = ol[0];
        d[i + 1] = ol[1];
        d[i + 2] = ol[2];
        d[i + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
}

export function upscale(src: HTMLCanvasElement, scale = ART_SCALE): HTMLCanvasElement {
  const { c, g } = makeCanvas(src.width * scale, src.height * scale);
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Draws a filled ellipse. */
export function ellipse(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, rot = 0): void {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, Math.PI * 2);
  g.fill();
}

export function poly(g: CanvasRenderingContext2D, pts: number[], color: string): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fill();
}

export function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, color: string): void {
  g.strokeStyle = color;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

export function rect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Small deterministic hash rng for art variation. */
export function artRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}
