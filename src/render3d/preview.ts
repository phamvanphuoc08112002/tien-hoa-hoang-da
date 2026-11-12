import * as THREE from 'three';
import type { BeastArt, Palette } from '../data/types';
import { ChibiModel } from './chibi';

const SIZE = 192;
let renderer: THREE.WebGLRenderer | null = null;
let failed = false;

function getRenderer(): THREE.WebGLRenderer | null {
  if (renderer || failed) return renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);
  } catch {
    failed = true;
    renderer = null;
  }
  return renderer;
}

const silhouetteMat = new THREE.MeshBasicMaterial({ color: '#0d1018' });

/** Portrait of a chibi creature as a data URL (null when WebGL is unavailable). */
export function chibiPreviewUrl(art: BeastArt, pal: Palette, silhouette: boolean): string | null {
  const r = getRenderer();
  if (!r) return null;
  const scene = new THREE.Scene();
  const model = new ChibiModel(art, pal);
  model.update('idle', 0, 0.4);
  model.root.rotation.y = -0.65;
  scene.add(model.root);
  scene.add(new THREE.HemisphereLight('#eef6ff', '#5a6048', 1.2));
  const sun = new THREE.DirectionalLight('#fff2d6', 2.1);
  sun.position.set(-3, 6, 5);
  scene.add(sun);
  if (silhouette) scene.overrideMaterial = silhouetteMat;

  const pitch = (24 * Math.PI) / 180;
  const box = new THREE.Box3().setFromObject(model.root);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const cam = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 1, radius * 20);
  cam.position.set(center.x, center.y + Math.sin(pitch) * radius * 8, center.z + Math.cos(pitch) * radius * 8);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  // Fit the frame to the projected bounding box (square, small margin).
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  const v = new THREE.Vector3();
  model.root.updateMatrixWorld(true);
  model.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox as THREE.Box3;
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
      x0 = Math.min(x0, v.x);
      x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y);
      y1 = Math.max(y1, v.y);
    }
  });
  const half = (Math.max(x1 - x0, y1 - y0) / 2) * 1.06;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  cam.left = mx - half;
  cam.right = mx + half;
  cam.top = my + half;
  cam.bottom = my - half;
  cam.updateProjectionMatrix();

  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  model.dispose();
  return url;
}
