import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { isJoker, tileColor, tileNum } from '../../shared/tiles';

export const TILE_W = 1;
export const TILE_D = 1.4;
export const TILE_H = 0.34;
export const CELL_W = 1.1;
export const CELL_D = 1.55;
/** distância entre as fileiras da MESA (mais folgada que no cavalete, para as linhas ficarem bem separadas) */
export const ROW_D = 1.95;

export const TILE_COLORS = ['#17171c', '#0f52d6', '#d3202b', '#ee8700'];
/** alto contraste: quatro cores bem separadas (e cada uma tem um símbolo próprio) */
export const HC_COLORS = ['#000000', '#0033e6', '#e00000', '#ff7a00'];

let highContrast = false;
export const setHighContrast = (on: boolean): void => {
  highContrast = on;
};

const cache = new Map<string, THREE.CanvasTexture>();

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function drawJoker(c: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  const cy = h * 0.46;
  const g = c.createLinearGradient(cx - 80, cy - 80, cx + 80, cy + 80);
  g.addColorStop(0, '#7b2fbe');
  g.addColorStop(0.5, '#d12b7a');
  g.addColorStop(1, '#e58a1c');
  c.lineWidth = 12;
  c.strokeStyle = g;
  c.beginPath();
  c.arc(cx, cy, 78, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx - 28, cy - 18, 11, 0, Math.PI * 2);
  c.arc(cx + 28, cy - 18, 11, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 11;
  c.lineCap = 'round';
  c.beginPath();
  c.arc(cx, cy + 6, 40, 0.15 * Math.PI, 0.85 * Math.PI);
  c.stroke();
  // chapéu de bobo: três pontas
  c.fillStyle = g;
  for (const dx of [-46, 0, 46]) {
    c.beginPath();
    c.moveTo(cx + dx - 16, cy - 78);
    c.lineTo(cx + dx, cy - 118 + Math.abs(dx) * 0.3);
    c.lineTo(cx + dx + 16, cy - 78);
    c.closePath();
    c.fill();
  }
}

function drawShape(c: CanvasRenderingContext2D, kind: number, cx: number, cy: number, r: number): void {
  c.beginPath();
  if (kind === 0) c.arc(cx, cy, r, 0, Math.PI * 2); // ●
  else if (kind === 1) {
    c.moveTo(cx, cy - r); // ▲
    c.lineTo(cx + r, cy + r * 0.8);
    c.lineTo(cx - r, cy + r * 0.8);
    c.closePath();
  } else if (kind === 2) c.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7); // ■
  else {
    c.moveTo(cx, cy - r * 1.1); // ◆
    c.lineTo(cx + r * 0.9, cy);
    c.lineTo(cx, cy + r * 1.1);
    c.lineTo(cx - r * 0.9, cy);
    c.closePath();
  }
  c.fill();
}

/** Textura da face (número colorido + anel, ou coringa), desenhada por código. */
export function faceTexture(id: number, maxAniso = 4): THREE.CanvasTexture {
  const key = `${highContrast ? 'h' : 'n'}${isJoker(id) ? -1 : tileColor(id) * 13 + tileNum(id)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const w = 256;
  const h = 358;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  const bg = c.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#fbf5e4');
  bg.addColorStop(1, '#efe4c8');
  c.fillStyle = bg;
  c.fillRect(0, 0, w, h);
  // borda gravada
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(120,95,50,0.28)';
  roundRect(c, 10, 10, w - 20, h - 20, 22);
  c.stroke();
  if (isJoker(id)) {
    drawJoker(c, w, h);
  } else {
    const palette = highContrast ? HC_COLORS : TILE_COLORS;
    const color = palette[tileColor(id)]!;
    const n = tileNum(id);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `900 ${n >= 10 ? 158 : 206}px Georgia, "Times New Roman", serif`;
    // relevo: sombra clara embaixo, número cheio por cima
    c.fillStyle = 'rgba(255,255,255,0.9)';
    c.fillText(String(n), w / 2 + 2, h * 0.43 + 4);
    c.fillStyle = color;
    c.strokeStyle = color;
    c.lineJoin = 'round';
    c.lineWidth = highContrast ? 10 : 6;
    c.strokeText(String(n), w / 2, h * 0.43);
    c.fillText(String(n), w / 2, h * 0.43);
    if (n === 6 || n === 9) c.fillRect(w / 2 - 38, h * 0.43 + 92, 76, 8);
    // anel com o símbolo da cor dentro (● ▲ ■ ◆): ajuda quem não distingue bem as cores
    c.lineWidth = highContrast ? 15 : 11;
    c.strokeStyle = color;
    c.beginPath();
    c.arc(w / 2, h * 0.83, 33, 0, Math.PI * 2);
    c.stroke();
    drawShape(c, tileColor(id), w / 2, h * 0.83, 17);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  cache.set(key, tex);
  return tex;
}

let bodyGeo: THREE.BufferGeometry | null = null;
let faceGeo: THREE.BufferGeometry | null = null;

export class Tile {
  readonly group = new THREE.Group();
  readonly body: THREE.Mesh;
  readonly face: THREE.Mesh;
  readonly bodyMat: THREE.MeshPhysicalMaterial;
  target = new THREE.Vector3();
  targetRotY = 0;
  targetScale = 1;
  present = false;
  /** pedra em arrasto: segue o ponteiro sem suavização */
  dragging = false;

  constructor(
    readonly id: number,
    aniso: number,
  ) {
    bodyGeo ??= new RoundedBoxGeometry(TILE_W, TILE_H, TILE_D, 3, 0.11);
    faceGeo ??= new THREE.PlaneGeometry(0.86, 1.24);
    this.bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xf6efdc, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35, emissive: 0x000000, emissiveIntensity: 0 });
    this.body = new THREE.Mesh(bodyGeo, this.bodyMat);
    this.body.position.y = TILE_H / 2;
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.userData.tileId = id;
    const faceMat = new THREE.MeshStandardMaterial({ map: faceTexture(id, aniso), roughness: 0.5, metalness: 0 });
    this.face = new THREE.Mesh(faceGeo, faceMat);
    this.face.rotation.x = -Math.PI / 2;
    this.face.position.y = TILE_H + 0.003;
    this.group.add(this.body, this.face);
    this.group.visible = false;
  }

  refreshFace(aniso: number): void {
    const mat = this.face.material as THREE.MeshStandardMaterial;
    mat.map = faceTexture(this.id, aniso);
    mat.needsUpdate = true;
  }

  setTint(hex: number, intensity: number): void {
    this.bodyMat.emissive.setHex(hex);
    this.bodyMat.emissiveIntensity = intensity;
  }

  /** @returns true enquanto ainda está se movendo */
  step(dt: number): boolean {
    const g = this.group;
    if (this.dragging) {
      g.position.copy(this.target);
      return true;
    }
    const k = 1 - Math.exp(-dt * 16);
    g.position.lerp(this.target, k);
    g.rotation.y += (this.targetRotY - g.rotation.y) * k;
    const s = g.scale.x + (this.targetScale - g.scale.x) * k;
    g.scale.setScalar(s);
    return g.position.distanceToSquared(this.target) > 1e-5 || Math.abs(s - this.targetScale) > 1e-3 || Math.abs(this.targetRotY - g.rotation.y) > 1e-3;
  }
}

/** Textura de feltro com ruído, para a mesa. */
export function feltTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#1d6a47';
  c.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 60000; i++) {
    const v = Math.random();
    c.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.02 + Math.random() * 0.04})` : `rgba(0,0,0,${0.03 + Math.random() * 0.06})`;
    c.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(7, 4);
  return t;
}

export function woodTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 128;
  const c = cv.getContext('2d')!;
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, '#5a3a22');
  g.addColorStop(1, '#3d2515');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 90; i++) {
    c.strokeStyle = `rgba(${i % 2 ? '20,10,5' : '150,100,60'},${0.05 + Math.random() * 0.12})`;
    c.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * 128;
    c.beginPath();
    c.moveTo(0, y);
    c.bezierCurveTo(170, y + (Math.random() - 0.5) * 14, 340, y + (Math.random() - 0.5) * 14, 512, y + (Math.random() - 0.5) * 10);
    c.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
