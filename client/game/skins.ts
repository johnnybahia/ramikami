import * as THREE from 'three';

export type SkinId = 'verde' | 'bahia' | 'vitoria' | 'corinthians' | 'natal' | 'anonovo';

export interface Skin {
  id: SkinId;
  name: string;
  /** duas cores para a miniatura no seletor */
  swatch: [string, string];
  /** cor de fora da mesa (fundo da cena) */
  bg: string;
}

export const SKINS: readonly Skin[] = [
  { id: 'verde', name: 'Pano verde', swatch: ['#1d6a47', '#0b1410'], bg: '#0b1410' },
  { id: 'bahia', name: 'Bahia', swatch: ['#0f2c66', '#c8102e'], bg: '#08142e' },
  { id: 'vitoria', name: 'Vitória', swatch: ['#1c0e10', '#c4161c'], bg: '#0d0607' },
  { id: 'corinthians', name: 'Corinthians', swatch: ['#161616', '#f2f2f2'], bg: '#070707' },
  { id: 'natal', name: 'Natal', swatch: ['#14452e', '#b3202a'], bg: '#0a1f15' },
  { id: 'anonovo', name: 'Ano Novo', swatch: ['#0e1a3a', '#d9b45a'], bg: '#060b1c' },
];

export const SKIN_IDS: readonly SkinId[] = SKINS.map((s) => s.id);
export const skinById = (id: SkinId): Skin => SKINS.find((s) => s.id === id) ?? SKINS[0]!;

const W = 1600;
const H = 920;

interface Look {
  base: string;
  /** moldura em linhas finas, de fora para dentro */
  lines: { color: string; width: number; inset: number }[];
  /** salpicos opcionais sobre o pano */
  speckle?: { color: string; count: number; size: number };
  /** luz suave no centro */
  glow: string;
  sparkles?: { color: string; count: number };
  stripes?: { color: string; alpha: number; step: number };
}

const LOOKS: Record<Exclude<SkinId, 'verde'>, Look> = {
  bahia: {
    base: '#0f2c66',
    lines: [
      { color: '#c8102e', width: 7, inset: 26 },
      { color: '#f4f4f4', width: 3, inset: 44 },
    ],
    glow: 'rgba(120,160,255,0.16)',
    stripes: { color: '#ffffff', alpha: 0.025, step: 46 },
  },
  vitoria: {
    base: '#1c0e10',
    lines: [
      { color: '#c4161c', width: 7, inset: 26 },
      { color: '#e8e8e8', width: 2.5, inset: 44 },
    ],
    glow: 'rgba(196,22,28,0.16)',
    stripes: { color: '#c4161c', alpha: 0.05, step: 46 },
  },
  corinthians: {
    base: '#161616',
    lines: [
      { color: '#f2f2f2', width: 6, inset: 26 },
      { color: '#f2f2f2', width: 2, inset: 42 },
    ],
    glow: 'rgba(255,255,255,0.09)',
  },
  natal: {
    base: '#14452e',
    lines: [
      { color: '#b3202a', width: 7, inset: 26 },
      { color: '#d9b45a', width: 2.5, inset: 44 },
    ],
    glow: 'rgba(255,255,255,0.08)',
    speckle: { color: 'rgba(255,255,255,0.55)', count: 220, size: 2.4 },
  },
  anonovo: {
    base: '#0e1a3a',
    lines: [
      { color: '#d9b45a', width: 6, inset: 26 },
      { color: '#d9b45a', width: 2, inset: 42 },
    ],
    glow: 'rgba(217,180,90,0.10)',
    sparkles: { color: '#d9b45a', count: 70 },
  },
};

function felt(c: CanvasRenderingContext2D, base: string): void {
  c.fillStyle = base;
  c.fillRect(0, 0, W, H);
  for (let i = 0; i < 230000; i++) {
    const v = Math.random();
    c.fillStyle = v > 0.5 ? `rgba(255,255,255,${0.02 + Math.random() * 0.04})` : `rgba(0,0,0,${0.03 + Math.random() * 0.06})`;
    c.fillRect(Math.random() * W, Math.random() * H, 1.6, 1.6);
  }
}

function sparkle(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  c.moveTo(x, y - r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.quadraticCurveTo(x, y, x, y + r);
  c.quadraticCurveTo(x, y, x - r, y);
  c.quadraticCurveTo(x, y, x, y - r);
  c.fill();
}

function drawSkin(id: SkinId): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d')!;
  if (id === 'verde') {
    felt(c, '#1d6a47');
    return cv;
  }
  const look = LOOKS[id];
  felt(c, look.base);
  if (look.stripes) {
    c.fillStyle = look.stripes.color;
    c.globalAlpha = look.stripes.alpha;
    for (let x = -H; x < W; x += look.stripes.step) {
      c.save();
      c.translate(x, 0);
      c.rotate(Math.PI / 4);
      c.fillRect(0, 0, 14, H * 2);
      c.restore();
    }
    c.globalAlpha = 1;
  }
  const g = c.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.55);
  g.addColorStop(0, look.glow);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  if (look.speckle) {
    c.fillStyle = look.speckle.color;
    for (let i = 0; i < look.speckle.count; i++) {
      c.beginPath();
      c.arc(Math.random() * W, Math.random() * H, 0.8 + Math.random() * look.speckle.size, 0, Math.PI * 2);
      c.fill();
    }
  }
  if (look.sparkles) {
    c.fillStyle = look.sparkles.color;
    for (let i = 0; i < look.sparkles.count; i++) {
      c.globalAlpha = 0.18 + Math.random() * 0.3;
      sparkle(c, Math.random() * W, Math.random() * H, 5 + Math.random() * 10);
    }
    c.globalAlpha = 1;
  }
  for (const l of look.lines) {
    c.strokeStyle = l.color;
    c.lineWidth = l.width;
    c.strokeRect(l.inset, l.inset, W - l.inset * 2, H - l.inset * 2);
  }
  return cv;
}

const cache = new Map<SkinId, THREE.CanvasTexture>();

/** Textura do pano da mesa; a mesma mesa inteira (sem repetição). */
export function skinTexture(id: SkinId, aniso = 4): THREE.CanvasTexture {
  const hit = cache.get(id);
  if (hit) return hit;
  const t = new THREE.CanvasTexture(drawSkin(id));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  cache.set(id, t);
  return t;
}
