import * as THREE from 'three';

/**
 * The 3D view uses a tilted orthographic camera. Gameplay stays in 2D world pixels
 * (x, y); a point at height h is placed at Z = (y + h·cos) / sin so that every point
 * projects to exactly the same screen position as in the 2D game. That keeps the
 * Phaser overlay (bars, telegraphs, particles, text) aligned with the 3D scene.
 */
export const PITCH = (50 * Math.PI) / 180;
export const SIN = Math.sin(PITCH);
export const COS = Math.cos(PITCH);

export function toZ(y: number, h: number): number {
  return (y + h * COS) / SIN;
}

export function setPos(o: THREE.Object3D, x: number, y: number, h: number): void {
  o.position.set(x, h, toZ(y, h));
}

/** Converts a 2D screen-plane direction into a Y rotation for a model facing +X. */
export function headingToRotY(dx: number, dy: number): number {
  return Math.atan2(-dy / SIN, dx);
}

const tmpColor = new THREE.Color();
export function hexToColor(hex: string | number): THREE.Color {
  return typeof hex === 'number' ? new THREE.Color(hex) : new THREE.Color(hex);
}

export function shadeColor(hex: string | number, amt: number): THREE.Color {
  tmpColor.set(hex as THREE.ColorRepresentation);
  const c = tmpColor.clone();
  if (amt >= 0) c.lerp(new THREE.Color(1, 1, 1), amt);
  else c.multiplyScalar(1 + amt);
  return c;
}

let gradient: THREE.DataTexture | null = null;
/** Three-band ramp for cel shading. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}
