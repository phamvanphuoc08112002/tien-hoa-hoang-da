import { Rng } from './rng';

/** Seeded 2D value noise with fractal Brownian motion. */
export class ValueNoise {
  private perm: Uint8Array;
  private vals: Float32Array;

  constructor(rng: Rng) {
    this.perm = new Uint8Array(512);
    this.vals = new Float32Array(256);
    const p: number[] = [];
    for (let i = 0; i < 256; i++) {
      p.push(i);
      this.vals[i] = rng.next();
    }
    rng.shuffle(p);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private lattice(x: number, y: number): number {
    return this.vals[this.perm[(this.perm[x & 255] + y) & 511] & 255];
  }

  noise(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = this.lattice(xi, yi);
    const b = this.lattice(xi + 1, yi);
    const c = this.lattice(xi, yi + 1);
    const d = this.lattice(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  fbm(x: number, y: number, octaves = 4): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }
}
