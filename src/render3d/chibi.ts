import * as THREE from 'three';
import type { BeastArt, Palette } from '../data/types';
import { shadeColor, toonGradient } from './space';

const SPHERE = new THREE.SphereGeometry(1, 18, 14);
const LOW_SPHERE = new THREE.SphereGeometry(1, 10, 8);
const CONE = new THREE.ConeGeometry(1, 1, 10);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 10);
const OCTA = new THREE.OctahedronGeometry(1, 0);
/** Bat wing in the XY plane, wrist at the origin, tip toward +Y. */
function batWingGeometry(): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.05, 0.45, 0.28, 0.95, 0.72, 1.22);
  s.lineTo(1.28, 0.62);
  s.lineTo(1.08, 0.08);
  s.lineTo(0.62, -0.42);
  s.quadraticCurveTo(0.22, -0.16, 0, 0);
  const g = new THREE.ShapeGeometry(s, 8);
  g.computeBoundingSphere();
  return g;
}
const BAT_WING = batWingGeometry();
for (const g of [SPHERE, LOW_SPHERE, CONE, CYL, OCTA, BAT_WING]) g.computeBoundingSphere();

/** Animation names shared with the 2D sprite sheets. */
export type ChibiAnim = 'idle' | 'walk' | 'attack' | 'eat' | 'rest' | 'sleep' | 'hurt' | 'dead';

interface Flame {
  mesh: THREE.Object3D;
  base: THREE.Vector3;
  seed: number;
}

/**
 * A procedurally built, cel-shaded chibi creature (big head, round body, stubby legs)
 * generated from the same BeastArt description the 2D sprites use. Faces +X.
 */
export class ChibiModel {
  readonly root = new THREE.Group();
  private rig = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private legs: THREE.Group[] = [];
  /** Authored rest pose for each limb — update() animates relative to these. */
  private legBases: THREE.Vector3[] = [];
  private eyes: THREE.Object3D[] = [];
  private mouth: THREE.Mesh | null = null;
  private flames: Flame[] = [];
  private mats = new Map<string, THREE.MeshToonMaterial>();
  private glowMats: THREE.MeshBasicMaterial[] = [];
  private auraMats: THREE.MeshBasicMaterial[] = [];
  private auraMeshes: THREE.Object3D[] = [];
  private wingMeshes: THREE.Object3D[] = [];
  private wingBases: { y: number; z: number; x: number }[] = [];
  private fierceEyes = false;
  private biped = false;
  private flies = false;
  /** Stylized standing dragon (evolution lines): neck, belly plates, membrane wings, curled tail. */
  private dragon = false;
  private outlineMat: THREE.MeshBasicMaterial;
  private allMats: THREE.Material[] = [];

  /** Overall height of the model in world px (for UI/effects placement). */
  readonly height: number;
  private hipY: number;
  private bodyY: number;
  private bw: number;
  private bh: number;
  private bd: number;
  private headR: number;

  private phase = 0;
  private anim: ChibiAnim = 'idle';
  private animT = 0;
  private blinkT = 2;
  private lie = 0;
  private pitch = 0;
  private lunge = 0;
  private lean = 0;
  private roll = 0;

  constructor(art: BeastArt, pal: Palette, scale = 1.9) {
    const F = scale;
    const a = art;
    const has = (f: string) => (a.features as string[]).includes(f);
    this.fierceEyes = has('fierce_eyes');
    this.dragon = has('scales');
    this.biped = has('biped') || has('fly') || this.dragon;
    this.flies = has('fly');
    this.outlineMat = new THREE.MeshBasicMaterial({ color: pal.outline, side: THREE.BackSide });
    this.allMats.push(this.outlineMat);

    // Mega / boss forms: mature beast proportions (smaller head, bulkier body) — not a baby on stilts.
    const menacing = this.fierceEyes || has('aura') || has('aura_burst');
    this.hipY = Math.max(3, a.legLen * F * (this.dragon ? 1.4 : this.biped ? 1.15 : menacing ? 0.85 : 0.7));
    this.bw = a.bodyW * F * (this.dragon ? 0.68 : this.biped ? 0.78 : menacing ? 0.92 : 0.8);
    this.bh = a.bodyH * F * (this.dragon ? 1.02 : this.biped ? 1.22 : menacing ? 1.08 : 0.95);
    this.bd = Math.max(a.bodyH, a.bodyW * 0.62) * F * (this.dragon ? 0.82 : this.biped ? 0.92 : menacing ? 1.05 : 0.95);
    const { bw, bh, bd } = this;
    this.bodyY = this.hipY + bh * (this.biped ? 1.15 : 0.82);
    const R = a.headR * F * (this.dragon ? 0.78 : this.biped ? 1.02 : menacing ? 1.15 : 1.45);
    this.headR = R;

    this.root.add(this.rig);
    this.rig.add(this.body);
    this.body.position.set(0, this.bodyY, 0);

    // ---- aura (underglow + back crescent — never a full body blob) ----
    if (has('aura') || has('aura_burst')) {
      const floor = this.glowPart(this.rig, SPHERE, pal.accent2, [0, 1.2, 0], [bw * 1.4, 1.2, bd * 1.4]);
      (floor.material as THREE.MeshBasicMaterial).transparent = true;
      (floor.material as THREE.MeshBasicMaterial).opacity = 0.35;
      (floor.material as THREE.MeshBasicMaterial).depthWrite = false;
      this.auraMats.push(floor.material as THREE.MeshBasicMaterial);
      this.auraMeshes.push(floor);
      const tor = new THREE.TorusGeometry(Math.max(bw, bh) * 1.15, Math.max(bw, bh) * 0.055, 8, 28, Math.PI * 1.35);
      const ring = this.glowPart(this.body, tor, pal.accent2, [-bw * 0.15, bh * 0.1, 0], [1, 1, 1]);
      ring.rotation.set(Math.PI / 2.2, 0, -0.25);
      (ring.material as THREE.MeshBasicMaterial).transparent = true;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.6;
      (ring.material as THREE.MeshBasicMaterial).depthWrite = false;
      this.auraMats.push(ring.material as THREE.MeshBasicMaterial);
      this.auraMeshes.push(ring);
      const haze = this.glowPart(this.body, SPHERE, pal.accent, [-bw * 0.2, 0, 0], [bw * 0.9, bh * 1.05, bd * 0.9]);
      (haze.material as THREE.MeshBasicMaterial).transparent = true;
      (haze.material as THREE.MeshBasicMaterial).opacity = 0.12;
      (haze.material as THREE.MeshBasicMaterial).depthWrite = false;
      this.auraMats.push(haze.material as THREE.MeshBasicMaterial);
      this.auraMeshes.push(haze);
    }
    if (has('aura_burst')) {
      for (let k = 0; k < 6; k++) {
        const t = k / 5;
        const ang = -Math.PI * 0.7 + t * Math.PI * 0.9;
        const ray = this.glowPart(
          this.body,
          CONE,
          k % 2 ? pal.accent2 : pal.accent,
          [Math.cos(ang) * bw * 0.2 - bw * 0.35, Math.sin(ang) * bh * 0.35 + bh * 0.15, Math.sin(ang * 0.5) * bd * 0.2],
          [bw * 0.16, bh * 1.15, bw * 0.16],
        );
        ray.rotation.z = ang + Math.PI / 2;
        (ray.material as THREE.MeshBasicMaterial).transparent = true;
        (ray.material as THREE.MeshBasicMaterial).opacity = 0.48;
        this.auraMats.push(ray.material as THREE.MeshBasicMaterial);
        this.auraMeshes.push(ray);
      }
    }
    if (has('wings') || this.dragon) {
      // Hinge turns the XY sail out to ±Z. Keep the 90° yaw on the hinge only, so the sheet is not edge-on.
      const span = bh * (has('wings') ? (this.flies ? 3.1 : 2.6) : 2.05);
      for (const s of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.position.set(-bw * 0.08, bh * 0.28, s * bd * 0.15);
        hinge.rotation.y = -s * (Math.PI / 2);
        hinge.rotation.z = s * 0.55;
        this.body.add(hinge);
        const sail = this.part(hinge, BAT_WING, pal.light, [0, 0, 0], [span, span * 0.95, Math.max(0.8, bh * 0.045)], 0.4);
        const membrane = this.part(hinge, BAT_WING, pal.accent2, [span * 0.08, span * 0.02, s * bh * 0.02], [span * 0.62, span * 0.58, Math.max(0.4, bh * 0.02)], 0);
        for (let f = 0; f < 3; f++) {
          const bone = this.part(sail, CYL, pal.belly, [0.22 + f * 0.28, 0.28 + f * 0.22, 0.05], [0.04, 0.7, 0.04], 0);
          bone.rotation.z = -0.85 + f * 0.5;
        }
        this.wingMeshes.push(hinge, sail, membrane);
        this.wingBases.push(
          { x: hinge.rotation.x, y: hinge.rotation.y, z: hinge.rotation.z },
          { x: sail.rotation.x, y: sail.rotation.y, z: sail.rotation.z },
          { x: membrane.rotation.x, y: membrane.rotation.y, z: membrane.rotation.z },
        );
      }
    }

    // ---- body ----
    this.part(this.body, SPHERE, pal.base, [0, 0, 0], [bw, bh * (this.dragon ? 0.92 : 1), bd]);
    if (this.dragon) {
      for (let k = 0; k < 5; k++) {
        const y = bh * (0.28 - k * 0.2);
        this.part(this.body, SPHERE, pal.belly, [bw * 0.48, y, 0], [bw * 0.26, bh * 0.15, bd * (0.46 - k * 0.03)], 0.3);
      }
      for (let k = 0; k < 4; k++) {
        const t = (k + 1) / 4;
        this.part(
          this.body,
          SPHERE,
          pal.base,
          [bw * (0.18 + t * 0.28), bh * (0.35 + t * 1.05), 0],
          [bw * (0.36 - t * 0.1), bh * 0.3, bd * (0.34 - t * 0.06)],
          0.45,
        );
        if (k < 3) {
          const spike = this.part(this.body, CONE, pal.light, [bw * (0.02 + t * 0.08), bh * (0.55 + t * 0.85), 0], [bw * 0.07, bh * 0.32, bw * 0.07], 0.2);
          spike.rotation.z = -0.35;
        }
      }
    }
    if (this.biped && !this.dragon) {
      // Broad shoulders / chest mass so mega forms read as powerful, not lanky.
      this.part(this.body, SPHERE, pal.base, [bw * 0.05, bh * 0.35, 0], [bw * 1.15, bh * 0.55, bd * 1.15]);
      this.part(this.body, SPHERE, shadeColor(pal.dark, -0.05).getStyle(), [0, -bh * 0.35, 0], [bw * 0.9, bh * 0.45, bd * 0.95], 0.6);
      for (const s of [-1, 1]) {
        this.part(this.body, SPHERE, pal.dark, [bw * 0.15, bh * 0.45, s * bd * 0.85], [bw * 0.38, bh * 0.32, bd * 0.35]);
      }
    }
    if (!this.dragon) this.part(this.body, SPHERE, pal.belly, [bw * 0.3, -bh * 0.28, 0], [bw * 0.68, bh * 0.66, bd * 0.8], 0.8);
    if (has('stripes')) for (const k of [-0.45, -0.05, 0.35]) this.part(this.body, LOW_SPHERE, pal.dark, [bw * k, bh * 0.12, 0], [bw * 0.11, bh * 0.96, bd * 0.97], 0);
    if (has('spots')) {
      const sp: [number, number, number][] = [[-0.45, 0.7, 0.4], [0.05, 0.85, -0.3], [-0.15, 0.6, -0.6], [-0.6, 0.45, -0.5]];
      for (const [x, y, z] of sp) this.part(this.body, LOW_SPHERE, pal.light, [bw * x, bh * y, bd * z], [bw * 0.14, bh * 0.12, bw * 0.14], 0);
    }
    if (has('scales')) {
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 5; c++) {
          const x = -0.55 + (c + (r % 2) * 0.45) * 0.28;
          const y = -0.15 + r * 0.35;
          this.part(this.body, LOW_SPHERE, r % 2 ? pal.light : shadeColor(pal.base, 0.1).getStyle(), [bw * x, bh * y, bd * 0.72], [bw * 0.12, bh * 0.1, bw * 0.08], 0);
        }
      }
    }
    const top = bh * 0.92;
    if (has('ridge')) {
      const n = Math.max(4, Math.round(a.bodyW / 2.5));
      for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        const h = bh * (0.35 + Math.sin(t * Math.PI) * 0.35);
        this.part(this.body, CONE, k % 2 ? pal.accent : pal.dark, [-bw * 0.75 + t * bw * 1.4, top + h * 0.35, 0], [bh * 0.14, h, bh * 0.14]);
      }
    }
    if (has('shell') && !this.dragon) {
      this.part(this.body, SPHERE, pal.accent, [-bw * 0.05, bh * 0.2, 0], [bw * 0.98, bh * 0.92, bd * 1.04]);
      this.part(this.body, SPHERE, pal.accent2, [-bw * 0.15, bh * 0.75, 0], [bw * 0.5, bh * 0.35, bd * 0.55]);
    }
    if (has('moss') && !this.dragon) {
      const ms: [number, number][] = [[-0.6, 0.15], [-0.2, -0.3], [0.2, 0.25], [-0.35, 0.45], [0.05, -0.05]];
      for (const [x, z] of ms) this.part(this.body, LOW_SPHERE, pal.dark, [bw * x, top * 0.92, bd * z], [bw * 0.28, bh * 0.26, bw * 0.28]);
      this.part(this.body, LOW_SPHERE, pal.accent2, [-bw * 0.3, top * 1.1, bd * 0.3], [1.6, 1.6, 1.6], 0);
      this.part(this.body, LOW_SPHERE, '#ff9ec4', [bw * 0.15, top * 1.08, -bd * 0.2], [1.6, 1.6, 1.6], 0);
    }
    if (has('back_leaves') && !this.dragon) {
      const n = a.bodyW > 9 ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const x = -bw * 0.45 + (k * bw * 0.7) / Math.max(1, n - 1);
        const m = this.part(this.body, SPHERE, pal.light, [x, top + bh * 0.35, (k % 2 ? 1 : -1) * bd * 0.12], [bh * 0.28, bh * 0.75, bh * 0.14]);
        m.rotation.set((k % 2 ? 1 : -1) * 0.35, 0, 0.45);
      }
    }
    if (has('spikes')) {
      const n = Math.max(3, Math.round(a.bodyW / 3));
      for (let k = 0; k < n; k++) this.part(this.body, CONE, k % 2 ? pal.accent2 : pal.dark, [-bw * 0.7 + (k * bw * 1.3) / (n - 1), top + bh * 0.22, 0], [bh * 0.2, bh * 0.6, bh * 0.2]);
    }
    if (has('crystals')) {
      const n = Math.max(2, Math.round(a.bodyW / 5));
      for (let k = 0; k < n; k++) this.glowPart(this.body, OCTA, pal.accent, [-bw * 0.4 + (k * bw * 0.8) / Math.max(1, n - 1), top + bh * 0.4, (k % 2 ? 1 : -1) * bd * 0.15], [bh * 0.22, bh * 0.6, bh * 0.22]);
    }
    if (has('back_fin')) {
      const m = this.part(this.body, CONE, pal.accent, [-bw * 0.1, top + bh * 0.35, 0], [bw * 0.45, bh * 0.95, bw * 0.1]);
      m.rotation.z = 0.35;
    }
    if (has('tree_crown') && !this.dragon) {
      // Compact shoulder grove for biped; full canopy for quads.
      const sc = this.biped ? 0.85 : 1;
      const tx = -bw * (this.biped ? 0.12 : 0.15);
      this.part(this.body, CYL, pal.accent, [tx, top + bh * 0.4 * sc, 0], [bw * 0.11, bh * (this.biped ? 0.85 : 1.2), bw * 0.11]);
      const cy = top + bh * (this.biped ? 1.15 : 1.45);
      this.part(this.body, SPHERE, pal.dark, [tx - bw * 0.32 * sc, cy - bh * 0.08, bd * 0.15], [bw * 0.4 * sc, bh * 0.45 * sc, bw * 0.4 * sc]);
      this.part(this.body, SPHERE, pal.dark, [tx + bw * 0.3 * sc, cy - bh * 0.05, -bd * 0.15], [bw * 0.38 * sc, bh * 0.42 * sc, bw * 0.38 * sc]);
      this.part(this.body, SPHERE, pal.base, [tx, cy + bh * 0.22 * sc, 0], [bw * 0.48 * sc, bh * 0.48 * sc, bw * 0.48 * sc]);
      this.part(this.body, LOW_SPHERE, pal.light, [tx - bw * 0.1, cy + bh * 0.5 * sc, bd * 0.1], [bw * 0.25 * sc, bh * 0.22 * sc, bw * 0.25 * sc], 0);
      this.part(this.body, LOW_SPHERE, pal.accent2, [tx + bw * 0.3 * sc, cy + bh * 0.18 * sc, bd * 0.3], [2.2, 2.2, 2.2], 0);
      this.part(this.body, LOW_SPHERE, '#ff9ec4', [tx - bw * 0.32 * sc, cy + bh * 0.1 * sc, -bd * 0.25], [2.2, 2.2, 2.2], 0);
    }

    // ---- tail ----
    this.body.add(this.tail);
    this.tail.position.set(-bw * 0.88, bh * 0.15, 0);
    const tl = a.tailLen * F;
    const tw = a.tailW * F;
    let tip = new THREE.Vector3(-tl * 0.6, tl * 0.5, 0);
    if (this.dragon) {
      const segs = 8;
      const rad = tl * 0.62;
      for (let k = 0; k < segs; k++) {
        const t = k / (segs - 1);
        const ang = -0.2 + t * Math.PI * 1.45;
        const x = -Math.sin(ang) * rad;
        const y = (1 - Math.cos(ang)) * rad * 1.05;
        const z = Math.sin(t * Math.PI) * rad * 0.45;
        const thick = tw * (0.62 - t * 0.36);
        this.part(this.tail, SPHERE, t > 0.72 ? pal.light : pal.base, [x, y, z], [thick, thick * 0.82, thick], 0.3);
        if (k % 2 === 0) {
          const spike = this.part(this.tail, CONE, pal.belly, [x * 0.92, y + thick * 0.85, z], [thick * 0.28, thick * 0.9, thick * 0.28], 0.15);
          spike.rotation.z = -0.4;
        }
        tip = new THREE.Vector3(x, y, z);
      }
    } else switch (a.tailKind) {
      case 'thin':
        for (let k = 0; k < 4; k++) {
          const t = (k + 1) / 4;
          this.part(this.tail, LOW_SPHERE, pal.base, [-tl * 0.65 * t, tl * 0.55 * t * t, 0], [tw * 0.42, tw * 0.42, tw * 0.42], k === 3 ? 1 : 0);
        }
        tip = new THREE.Vector3(-tl * 0.65, tl * 0.55, 0);
        break;
      case 'bushy': {
        const m = this.part(this.tail, SPHERE, pal.base, [-tl * 0.4, tl * 0.32, 0], [tl * 0.48, tw * 0.75, tw * 0.75]);
        m.rotation.z = -0.65;
        this.part(this.tail, SPHERE, pal.light, [-tl * 0.72, tl * 0.62, 0], [tw * 0.6, tw * 0.6, tw * 0.6]);
        tip = new THREE.Vector3(-tl * 0.8, tl * 0.7, 0);
        break;
      }
      case 'leaf': {
        const m = this.part(this.tail, SPHERE, pal.light, [-tl * 0.35, tl * 0.4, 0], [tl * 0.5, tw * 0.55, tw * 0.2]);
        m.rotation.z = -0.8;
        break;
      }
      case 'fin': {
        const m = this.part(this.tail, CONE, pal.accent, [-tl * 0.45, tl * 0.15, 0], [tw * 0.9, tl * 0.9, tw * 0.28]);
        m.rotation.z = Math.PI / 2 + 0.25;
        tip = new THREE.Vector3(-tl * 0.85, tl * 0.25, 0);
        break;
      }
      case 'stub':
        this.part(this.tail, SPHERE, pal.light, [-tw * 0.2, tw * 0.15, 0], [tw * 0.6, tw * 0.55, tw * 0.6]);
        tip = new THREE.Vector3(-tw * 0.5, tw * 0.4, 0);
        break;
      case 'lizard': {
        const m = this.part(this.tail, CONE, pal.base, [-tl * 0.5, -bh * 0.1, 0], [bh * 0.45, tl, bh * 0.45]);
        m.rotation.z = Math.PI / 2 + 0.15;
        tip = new THREE.Vector3(-tl, -bh * 0.2, 0);
        break;
      }
    }
    if (has('flame_tail')) this.flame(this.tail, tip, Math.max(4, tw * 1.25), pal);

    // ---- legs (biped = digitigrade thighs + shins + short arms) ----
    const legR = Math.max(1.8, a.legW * F * 0.5);
    const legLen = this.bodyY - bh * 0.35;
    if (this.biped) {
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(bw * 0.08, this.bodyY - bh * 0.38, s * bd * 0.5);
        this.rig.add(g);
        const thigh = legLen * (this.flies ? 0.36 : 0.52);
        const shin = legLen * (this.flies ? 0.28 : 0.5);
        this.part(g, CYL, s < 0 ? pal.dark : pal.base, [0, -thigh * 0.4, 0], [legR * 1.45, thigh, legR * 1.45], 0.8);
        this.part(g, CYL, shadeColor(s < 0 ? pal.dark : pal.base, -0.08).getStyle(), [legR * 0.2, -thigh - shin * 0.3, 0], [legR * 1.05, shin, legR * 1.05], 0.8);
        this.part(g, SPHERE, shadeColor(pal.dark, -0.15).getStyle(), [legR * 0.4, -thigh - shin + legR * 0.15, 0], [legR * 1.4, legR * 0.75, legR * 1.25]);
        if (this.dragon) {
          for (const cz of [-0.45, 0, 0.45]) {
            const claw = this.part(g, CONE, pal.belly, [legR * 0.85, -thigh - shin + legR * 0.05, cz * legR * 0.55], [legR * 0.16, legR * 0.55, legR * 0.14], 0);
            claw.rotation.z = -Math.PI / 2.15;
          }
        }
        this.legs.push(g);
        this.legBases.push(g.position.clone());
      }
      for (const s of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(bw * 0.55, this.bodyY + bh * 0.25, s * bd * 0.8);
        this.rig.add(g);
        const armLen = legLen * (this.flies ? 0.4 : 0.5);
        this.part(g, CYL, s < 0 ? pal.dark : pal.base, [0, -armLen * 0.35, 0], [legR * 1.05, armLen * 0.65, legR * 1.05], 0.8);
        this.part(g, CYL, shadeColor(s < 0 ? pal.dark : pal.base, -0.08).getStyle(), [0, -armLen * 0.9, 0], [legR * 0.8, armLen * 0.5, legR * 0.8], 0.8);
        this.part(g, SPHERE, shadeColor(pal.dark, -0.1).getStyle(), [0, -armLen * 1.2, 0], [legR * 1.05, legR * 0.7, legR * 1.05]);
        // Claw tips.
        for (const cz of [-0.35, 0, 0.35]) {
          const claw = this.part(g, CONE, this.dragon ? pal.belly : pal.outline, [legR * 0.15, -armLen * 1.45, cz * legR], [legR * 0.18, legR * 0.45, legR * 0.18], 0);
          if (this.dragon) claw.rotation.z = -0.6;
        }
        this.legs.push(g);
        this.legBases.push(g.position.clone());
      }
    } else {
      for (const [lx, lz] of [
        [0.55, 0.55],
        [0.55, -0.55],
        [-0.55, 0.55],
        [-0.55, -0.55],
      ] as const) {
        const g = new THREE.Group();
        g.position.set(bw * lx, this.bodyY - bh * 0.35, bd * lz * 0.85);
        this.rig.add(g);
        this.part(g, CYL, lx > 0 ? pal.base : pal.dark, [0, -legLen / 2, 0], [legR, legLen, legR], 0.8);
        this.part(g, SPHERE, shadeColor(pal.dark, -0.15).getStyle(), [legR * 0.3, -legLen + legR * 0.35, 0], [legR * 1.25, legR * 0.75, legR * 1.1]);
        this.legs.push(g);
        this.legBases.push(g.position.clone());
      }
    }

    // ---- neck mane ----
    const neck = new THREE.Vector3(bw * (this.biped ? 0.15 : 0.62), bh * (this.biped ? 0.9 : 0.55), 0);
    if (has('flame_mane')) {
      for (let k = 0; k < 5; k++) {
        const ang = (k / 4 - 0.5) * 2.2;
        this.flame(this.body, new THREE.Vector3(neck.x - bw * 0.15, neck.y + Math.cos(ang) * bh * 0.2, Math.sin(ang) * bd * 0.75), R * 0.7, pal);
      }
    }

    // ---- head ----
    this.body.add(this.head);
    this.head.position.set(
      this.dragon ? bw * 0.55 : this.biped ? bw * 0.12 + a.headDx * F * 0.02 : bw * 0.72 + a.headDx * F * 0.12,
      this.dragon ? bh * 1.25 + R * 0.15 : this.biped ? bh * 1.12 + R * 0.62 : bh * 0.5 + R * 0.72,
      0,
    );
    const muz = new THREE.Vector3(R * 0.72, -R * 0.3, 0);
    if (this.dragon) {
      this.part(this.head, SPHERE, pal.base, [-R * 0.05, R * 0.05, 0], [R * 0.88, R * 0.7, R * 0.8]);
      this.part(this.head, SPHERE, pal.base, [R * 1.35, -R * 0.08, 0], [R * 1.45, R * 0.36, R * 0.4]);
      this.part(this.head, SPHERE, pal.belly, [R * 1.25, -R * 0.38, 0], [R * 1.05, R * 0.24, R * 0.34]);
      muz.set(R * 2.15, -R * 0.08, 0);
      for (const s of [-1, 1]) this.part(this.head, LOW_SPHERE, pal.outline, [R * 2.35, R * 0.02, s * R * 0.12], [R * 0.08, R * 0.06, R * 0.07], 0);
      this.mouth = this.part(this.head, LOW_SPHERE, '#5a1a24', [R * 1.35, -R * 0.42, 0], [R * 0.42, R * 0.05, R * 0.22], 0);
    } else {
      this.part(this.head, SPHERE, pal.base, [0, 0, 0], [R, R * 0.92, R * 0.98]);
      if (a.snout > 0) {
        const sl = a.snout * F * 0.32 + R * 0.3;
        this.part(this.head, SPHERE, pal.belly, [muz.x, muz.y, 0], [sl, R * 0.32, R * 0.42], 0.8);
        muz.x += sl * 0.85;
      } else muz.x = R * 0.95;
      this.part(this.head, LOW_SPHERE, pal.outline, [muz.x, muz.y + R * 0.12, 0], [R * 0.11, R * 0.09, R * 0.13], 0);
      this.mouth = this.part(this.head, LOW_SPHERE, '#5a1a24', [muz.x - R * 0.12, muz.y - R * 0.18, 0], [R * 0.16, R * 0.02, R * 0.22], 0);
    }
    // cheeks — skip blush on mega / boss forms (reads too babyish)
    if (!this.biped && !this.fierceEyes && !has('aura') && !has('aura_burst'))
      for (const s of [-1, 1]) this.part(this.head, LOW_SPHERE, '#ff8fa8', [R * 0.55, -R * 0.32, s * R * 0.72], [R * 0.16, R * 0.1, R * 0.1], 0).material = this.mat('#ff9fb4', 0.75);
    // eyes — mega forms get fierce glowing slits + brow ridges
    for (const s of [-1, 1]) {
      const n = this.dragon ? new THREE.Vector3(0.35, 0.22, s * 0.85).normalize() : new THREE.Vector3(0.68, 0.18, s * 0.6).normalize();
      const e = R * (this.dragon ? 0.22 : this.biped ? 0.3 : 0.34);
      const g = new THREE.Group();
      g.position.copy(n.clone().multiplyScalar(R * 0.9));
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const eye = new THREE.Mesh(SPHERE, this.mat(this.fierceEyes ? pal.accent2 : pal.eye));
      eye.scale.set(e * 0.85, e * (this.fierceEyes ? 0.95 : 1.15), e * 0.5);
      g.add(eye);
      if (this.fierceEyes) {
        const slit = new THREE.Mesh(LOW_SPHERE, this.mat(pal.outline));
        slit.scale.set(e * 0.18, e * 0.7, e * 0.15);
        slit.position.z = e * 0.35;
        g.add(slit);
        const brow = this.part(this.head, CONE, pal.outline, [R * 0.55, R * 0.42, s * R * 0.55], [R * 0.12, R * 0.35, R * 0.08], 0);
        brow.rotation.set(s * 0.4, 0, s * 0.9 - 0.3);
      }
      const hl = new THREE.Mesh(LOW_SPHERE, this.mat('#ffffff'));
      hl.scale.set(e * 0.28, e * 0.28, e * 0.18);
      hl.position.set(s * e * 0.25, e * 0.4, e * 0.32);
      g.add(hl);
      this.head.add(g);
      this.eyes.push(g);
    }
    // ears
    if (!this.dragon && has('leaf_ears'))
      for (const s of [-1, 1]) {
        const m = this.part(this.head, SPHERE, pal.light, [-R * 0.15, R * 0.7, s * R * 0.62], [R * 0.32, R * 0.6, R * 0.12]);
        m.rotation.set(s * 0.75, 0, 0.25);
      }
    if (has('pointy_ears'))
      for (const s of [-1, 1]) {
        const m = this.part(this.head, CONE, pal.base, [-R * 0.08, R * 0.95, s * R * 0.5], [R * 0.34, R * 0.75, R * 0.3]);
        m.rotation.x = s * 0.4;
        const inner = this.part(this.head, CONE, pal.belly, [R * 0.06, R * 0.9, s * R * 0.48], [R * 0.18, R * 0.48, R * 0.12], 0);
        inner.rotation.x = s * 0.4;
      }
    if (has('round_ears')) for (const s of [-1, 1]) this.part(this.head, SPHERE, pal.dark, [-R * 0.1, R * 0.78, s * R * 0.6], [R * 0.3, R * 0.3, R * 0.2]);
    if (!this.dragon && has('long_ears'))
      for (const s of [-1, 1]) {
        const m = this.part(this.head, SPHERE, pal.base, [-R * 0.2, R * 1.25, s * R * 0.38], [R * 0.2, R * 0.72, R * 0.26]);
        m.rotation.x = s * 0.25;
      }
    if (has('fin_ears'))
      for (const s of [-1, 1]) {
        const m = this.part(this.head, CONE, pal.accent, [-R * 0.25, R * 0.3, s * R * 0.95], [R * 0.32, R * 0.85, R * 0.12]);
        m.rotation.set(s * 1.1, 0, 0.7);
      }
    if (this.dragon) {
      const hornR = R * (has('big_horns') || has('curled_horns') || has('antlers') ? 0.7 : 0.5);
      for (const s of [-1, 1]) {
        const tor = new THREE.TorusGeometry(hornR, R * 0.11, 8, 20, Math.PI * 1.35);
        const m = this.part(this.head, tor, pal.belly, [-R * 0.2, R * 1.15, s * R * 0.16], [1, 1, 1], 0.35);
        m.rotation.set(0.4, s * 0.9, s * 1.15);
        const brow = this.part(this.head, CONE, pal.light, [R * 0.35, R * 0.62, s * R * 0.28], [R * 0.1, R * 0.48, R * 0.1], 0.2);
        brow.rotation.set(s * 0.35, 0, -0.7);
      }
    }
    if (!this.dragon && has('horns')) for (const s of [-1, 1]) this.part(this.head, CONE, pal.accent, [R * 0.2, R * 1.0, s * R * 0.32], [R * 0.2, R * 0.7, R * 0.2]).rotation.set(s * 0.25, 0, -0.3);
    if (!this.dragon && has('big_horns'))
      for (const s of [-1, 1]) {
        const hs = this.biped ? 1.25 : 1;
        const tor = new THREE.TorusGeometry(R * 0.55 * hs, R * 0.14 * hs, 8, 14, Math.PI * 0.85);
        const m = this.part(this.head, tor, pal.accent, [-R * 0.25, R * 0.8 * hs, s * R * 0.42], [1, 1, 1]);
        m.rotation.set(0, s * 0.35, 0.2);
      }
    if (!this.dragon && has('curled_horns'))
      for (const s of [-1, 1]) {
        const tor = new THREE.TorusGeometry(R * 0.32, R * 0.12, 8, 14, Math.PI * 1.6);
        const m = this.part(this.head, tor, pal.accent, [-R * 0.1, R * 0.5, s * R * 0.85], [1, 1, 1]);
        m.rotation.set(0, 0, 0.6);
      }
    if (!this.dragon && has('antlers'))
      for (const s of [-1, 1]) {
        const m = this.part(this.head, CYL, pal.accent, [-R * 0.1, R * 1.3, s * R * 0.4], [R * 0.07, R * 0.9, R * 0.07]);
        m.rotation.x = s * 0.35;
        const b = this.part(this.head, CYL, pal.accent, [R * 0.1, R * 1.45, s * R * 0.5], [R * 0.06, R * 0.5, R * 0.06]);
        b.rotation.set(s * 0.2, 0, -0.7);
      }
    if (has('flame_crest')) {
      this.flame(this.head, new THREE.Vector3(-R * 0.1, R * 0.85, 0), R * 0.75, pal);
      this.flame(this.head, new THREE.Vector3(-R * 0.45, R * 0.7, 0), R * 0.55, pal);
    }
    if (has('gem')) this.glowPart(this.head, OCTA, pal.accent, [R * 0.78, R * 0.45, 0], [R * 0.16, R * 0.22, R * 0.16]);
    if (has('halo')) {
      const tor = new THREE.TorusGeometry(R * 0.95, R * 0.08, 8, 24);
      const halo = this.glowPart(this.head, tor, pal.accent2, [0, R * 1.35, 0], [1, 1, 1]);
      halo.rotation.x = Math.PI / 2.4;
      this.auraMeshes.push(halo);
    }
    if (has('beard')) {
      const m = this.part(this.head, CONE, pal.light, [R * 0.6, -R * 0.85, 0], [R * 0.3, R * 0.6, R * 0.35]);
      m.rotation.z = Math.PI;
    }
    if (has('whiskers'))
      for (const s of [-1, 1])
        for (const dy of [0, -0.12]) {
          const m = this.part(this.head, CYL, pal.outline, [muz.x - R * 0.15, muz.y + R * dy, s * R * 0.42], [R * 0.025, R * 0.55, R * 0.025], 0);
          m.rotation.set(Math.PI / 2 + s * 0.15, 0, 0);
        }
    if (has('tusks')) for (const s of [-1, 1]) this.part(this.head, CONE, pal.accent, [muz.x - R * 0.2, muz.y + R * 0.05, s * R * 0.3], [R * 0.08, R * 0.35, R * 0.08]);

    const box = new THREE.Box3().setFromObject(this.root);
    this.height = box.max.y;
  }

  private mat(color: THREE.ColorRepresentation, k = 1): THREE.MeshToonMaterial {
    const key = `${new THREE.Color(color).getHexString()}:${k}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.MeshToonMaterial({ color: new THREE.Color(color).multiplyScalar(k), gradientMap: toonGradient() });
      this.mats.set(key, m);
      this.allMats.push(m);
    }
    return m;
  }

  /** Adds a scaled primitive with an inverted-hull outline (width in world px, 0 = none). */
  private part(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, pos: number[], scale: number[], outline = 1): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.mat(color));
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(scale[0], scale[1], scale[2]);
    m.castShadow = true;
    parent.add(m);
    if (outline > 0) {
      const o = new THREE.Mesh(geo, this.outlineMat);
      const w = outline * 0.9;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const r = geo.boundingSphere?.radius ?? 1;
      o.scale.set(1 + w / Math.max(0.5, scale[0] * r), 1 + w / Math.max(0.5, scale[1] * r), 1 + w / Math.max(0.5, scale[2] * r));
      m.add(o);
    }
    return m;
  }

  private glowPart(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: string, pos: number[], scale: number[]): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ color });
    this.glowMats.push(mat);
    this.allMats.push(mat);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.scale.set(scale[0], scale[1], scale[2]);
    parent.add(m);
    const o = new THREE.Mesh(geo, this.outlineMat);
    o.scale.setScalar(1.15);
    m.add(o);
    return m;
  }

  private flame(parent: THREE.Object3D, at: THREE.Vector3, size: number, pal: Palette): void {
    const g = new THREE.Group();
    g.position.copy(at);
    parent.add(g);
    const outer = new THREE.MeshBasicMaterial({ color: pal.accent2 });
    const inner = new THREE.MeshBasicMaterial({ color: pal.accent });
    const core = new THREE.MeshBasicMaterial({ color: '#fff6c8' });
    this.glowMats.push(outer, inner, core);
    this.allMats.push(outer, inner, core);
    const o = new THREE.Mesh(CONE, outer);
    o.scale.set(size * 0.5, size * 1.5, size * 0.5);
    o.position.y = size * 0.55;
    const i = new THREE.Mesh(CONE, inner);
    i.scale.set(size * 0.32, size * 1.0, size * 0.32);
    i.position.y = size * 0.42;
    const c = new THREE.Mesh(LOW_SPHERE, core);
    c.scale.setScalar(size * 0.2);
    c.position.y = size * 0.1;
    const b = new THREE.Mesh(LOW_SPHERE, outer);
    b.scale.set(size * 0.5, size * 0.4, size * 0.5);
    g.add(b, o, i, c);
    this.flames.push({ mesh: g, base: at.clone(), seed: Math.random() * 10 });
  }

  /**
   * Advances the procedural animation.
   * @param speed walk cycle multiplier (sprint / creature speed)
   */
  update(anim: ChibiAnim, dt: number, t: number, speed = 1): void {
    if (anim !== this.anim) {
      this.anim = anim;
      this.animT = 0;
    }
    this.animT += dt;
    const k = Math.min(1, dt * 12);
    const lying = anim === 'rest' || anim === 'sleep';
    const dead = anim === 'dead';
    this.lie += ((lying || dead ? 1 : 0) - this.lie) * k;
    this.roll += ((dead ? 1 : 0) - this.roll) * Math.min(1, dt * 6);

    let pitch = 0;
    let lunge = 0;
    let lean = 0;
    let bob = 0;
    let breathe = Math.sin(t * 2.6) * 0.03;
    let wag = Math.sin(t * 3) * 0.25;
    let mouth = 0;
    let legSwing = 0;

    if (anim === 'walk') {
      this.phase += dt * 11 * speed;
      legSwing = Math.sin(this.phase) * 0.75;
      bob = Math.abs(Math.sin(this.phase)) * this.bh * 0.18;
      wag = Math.sin(this.phase * 0.5) * 0.45;
      breathe = 0;
      pitch = Math.sin(this.phase * 2) * 0.04;
    } else if (anim === 'attack') {
      const p = Math.min(1, this.animT / 0.28);
      lunge = Math.sin(p * Math.PI);
      pitch = -0.25 * lunge;
      mouth = lunge;
      wag = 0.5;
    } else if (anim === 'eat') {
      pitch = -0.55 - Math.abs(Math.sin(t * 7)) * 0.2;
      mouth = Math.abs(Math.sin(t * 7));
    } else if (anim === 'hurt') {
      lean = 0.3;
      breathe = -0.06;
    } else if (lying) {
      breathe = Math.sin(t * (anim === 'sleep' ? 1.4 : 2)) * 0.04;
      pitch = anim === 'sleep' ? -0.25 : 0;
      wag = Math.sin(t * 1.2) * 0.1;
    } else if (dead) {
      breathe = 0;
      wag = 0;
    }
    this.pitch += (pitch - this.pitch) * k;
    this.lunge += (lunge - this.lunge) * Math.min(1, dt * 20);
    this.lean += (lean - this.lean) * k;

    // body
    const drop = this.lie * (this.bodyY - this.bd * 0.75);
    this.body.position.set(this.lunge * this.bw * 0.45, this.bodyY - drop + bob, 0);
    this.body.scale.set(1 - breathe * 0.5, 1 + breathe, 1 - breathe * 0.5);
    // Flying beasts lean forward (soar), standing bipeds stay upright with a slight predator tilt.
    const flyPitch = this.flies && !lying && !dead ? -0.32 : this.biped && !lying ? -0.08 : 0;
    this.body.rotation.z = this.lean - this.lunge * 0.12 + flyPitch;
    this.rig.rotation.x = this.roll * 1.45;
    const flyHover = this.flies ? 8 + Math.sin(t * 3.2) * 2.4 + (anim === 'walk' ? 1.8 : 0) : 0;
    this.rig.position.y = this.roll * this.bd * 0.3 + flyHover;

    // head
    this.head.rotation.z = this.pitch;
    this.head.rotation.x = anim === 'idle' ? Math.sin(t * 0.9) * 0.08 : 0;

    // legs / arms — keep authored rest pose, only swing/bob
    for (let i = 0; i < this.legs.length; i++) {
      const L = this.legs[i];
      const base = this.legBases[i] ?? L.position;
      const s = i % 2 === 0 ? 1 : -1;
      const isArm = this.biped && i >= 2;
      const swingAmt = isArm ? 0.55 : this.flies ? 0.25 : 1;
      L.rotation.z = legSwing * s * swingAmt;
      L.rotation.x = isArm ? (this.dragon ? -1.05 : -0.35) + (this.flies ? 0.2 : 0) : this.flies ? 0.45 : 0;
      L.scale.y = 1 - this.lie * 0.75;
      L.position.set(
        base.x + this.lunge * this.bw * (isArm ? 0.15 : 0.28),
        base.y - drop * (isArm ? 0.35 : 0.95) + bob * (isArm ? 0.4 : 1),
        base.z,
      );
    }

    // tail
    this.tail.rotation.y = wag;
    this.tail.rotation.z = anim === 'walk' ? Math.sin(this.phase) * 0.08 : 0;

    // flames
    for (const f of this.flames) {
      const fl = 1 + Math.sin(t * 18 + f.seed) * 0.15 + Math.sin(t * 31 + f.seed * 2) * 0.08;
      f.mesh.scale.set(1 / Math.sqrt(fl), fl, 1 / Math.sqrt(fl));
    }

    // aura pulse (opacity only — meshes keep authored non-uniform scale)
    for (let i = 0; i < this.auraMats.length; i++) {
      this.auraMats[i].opacity = 0.22 + (i === 0 ? 0.12 : 0.18) + Math.sin(t * 4 + i) * 0.07;
    }

    // wing flap — full beat in flight, a slow idle sway otherwise
    if (this.wingMeshes.length) {
      const flap = this.flies ? Math.sin(t * 9) * 0.22 : Math.sin(t * 2.1) * 0.06;
      for (let i = 0; i < this.wingMeshes.length; i++) {
        const w = this.wingMeshes[i];
        const b = this.wingBases[i];
        if (!b) continue;
        w.rotation.x = b.x + Math.sign(b.x || 1) * flap;
        w.rotation.y = b.y + Math.sign(b.y || 1) * flap * 0.35;
      }
    }

    // eyes & mouth
    this.blinkT -= dt;
    if (this.blinkT < -0.12) this.blinkT = 2 + Math.random() * 3;
    const closed = anim === 'sleep' || dead || this.blinkT < 0;
    const squint = anim === 'attack' || anim === 'hurt' || this.fierceEyes ? 0.65 : 1;
    for (const e of this.eyes) e.scale.y = closed ? 0.12 : squint;
    if (this.mouth) this.mouth.scale.y = this.headR * (0.02 + mouth * 0.14);
  }

  /** Emissive tint (status colours) and white hit flash. */
  setTint(tint: number | null, flash: boolean, alpha: number): void {
    for (const m of this.mats.values()) {
      if (flash) m.emissive.setRGB(1, 1, 1);
      else if (tint !== null) m.emissive.setHex(tint).multiplyScalar(0.45);
      else m.emissive.setRGB(0, 0, 0);
    }
    const transparent = alpha < 0.999;
    for (const m of this.allMats) {
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = alpha;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.allMats) m.dispose();
    this.root.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g && g !== SPHERE && g !== LOW_SPHERE && g !== CONE && g !== CYL && g !== OCTA) g.dispose();
    });
  }
}
