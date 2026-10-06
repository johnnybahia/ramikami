import * as THREE from 'three';

export type SkinId = 'verde' | 'bahia' | 'vitoria' | 'corinthians' | 'palmeiras' | 'natal' | 'anonovo';

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
  { id: 'palmeiras', name: 'Palmeiras', swatch: ['#0b4a2a', '#f2f2f2'], bg: '#04170d' },
  { id: 'natal', name: 'Natal', swatch: ['#14452e', '#b3202a'], bg: '#0a1f15' },
  { id: 'anonovo', name: 'Ano Novo', swatch: ['#0e1a3a', '#d9b45a'], bg: '#060b1c' },
];

export const SKIN_IDS: readonly SkinId[] = SKINS.map((s) => s.id);
/** mesas de time: o escudo é uma imagem que o próprio jogador escolhe (ou um arquivo public/skins/<id>.png) */
export const LOGO_SKINS: readonly SkinId[] = ['bahia', 'vitoria', 'corinthians', 'palmeiras'];
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
  palmeiras: {
    base: '#0b4a2a',
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

/** Árvore de Natal discreta no centro do pano. */
function emblemTree(c: CanvasRenderingContext2D): void {
  const cx = W / 2;
  const cy = H / 2;
  c.save();
  c.globalAlpha = 0.2;
  c.fillStyle = '#e8f3ea';
  for (let k = 0; k < 3; k++) {
    const top = cy - 150 + k * 80;
    const half = 70 + k * 42;
    c.beginPath();
    c.moveTo(cx, top);
    c.lineTo(cx + half, top + 110);
    c.lineTo(cx - half, top + 110);
    c.closePath();
    c.fill();
  }
  c.fillRect(cx - 18, cy + 100, 36, 44);
  c.fillStyle = '#d9b45a';
  c.globalAlpha = 0.32;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 34 : 14;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    c.lineTo(cx + Math.cos(a) * r, cy - 168 + Math.sin(a) * r);
  }
  c.closePath();
  c.fill();
  c.restore();
}

/** Ano que vem em dourado discreto, com brilhos. */
function emblemYear(c: CanvasRenderingContext2D): void {
  c.save();
  c.globalAlpha = 0.22;
  c.fillStyle = '#d9b45a';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '900 210px Georgia, "Times New Roman", serif';
  c.fillText(String(new Date().getFullYear() + (new Date().getMonth() >= 6 ? 1 : 0)), W / 2, H / 2);
  c.font = '700 44px system-ui, sans-serif';
  c.globalAlpha = 0.3;
  c.fillText('FELIZ ANO NOVO', W / 2, H / 2 + 150);
  c.restore();
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
  if (id === 'natal') emblemTree(c);
  if (id === 'anonovo') emblemYear(c);
  for (const l of look.lines) {
    c.strokeStyle = l.color;
    c.lineWidth = l.width;
    c.strokeRect(l.inset, l.inset, W - l.inset * 2, H - l.inset * 2);
  }
  return cv;
}

interface Entry {
  tex: THREE.CanvasTexture;
  base: HTMLCanvasElement;
  out: HTMLCanvasElement;
  logo: HTMLImageElement | null;
}
const cache = new Map<SkinId, Entry>();
const listeners = new Set<() => void>();
/** avisa a cena para redesenhar quando o escudo termina de carregar */
export const onSkinChange = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const LOGO_KEY = (id: SkinId): string => `ramikami_logo_${id}`;
export const getUserLogo = (id: SkinId): string | null => {
  try {
    return localStorage.getItem(LOGO_KEY(id));
  } catch {
    return null;
  }
};

function paint(e: Entry): void {
  const c = e.out.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  c.drawImage(e.base, 0, 0);
  if (e.logo && e.logo.naturalWidth > 0) {
    const maxH = H * 0.4;
    const maxW = W * 0.3;
    const k = Math.min(maxW / e.logo.naturalWidth, maxH / e.logo.naturalHeight);
    const w = e.logo.naturalWidth * k;
    const h = e.logo.naturalHeight * k;
    c.save();
    c.globalAlpha = 0.3; // marca d'água: discreta, sem atrapalhar as pedras
    c.drawImage(e.logo, (W - w) / 2, (H - h) / 2, w, h);
    c.restore();
  }
  e.tex.needsUpdate = true;
  listeners.forEach((l) => l());
}

function loadLogo(id: SkinId, e: Entry): void {
  const user = getUserLogo(id);
  const src = user ?? `${import.meta.env.BASE_URL}skins/${id}.png`;
  const img = new Image();
  img.onload = () => {
    e.logo = img;
    paint(e);
  };
  img.onerror = () => {
    if (user) return;
    e.logo = null;
  };
  img.src = src;
}

/** Textura do pano da mesa (a mesa inteira, sem repetição); mesas de time ganham o escudo escolhido. */
export function skinTexture(id: SkinId, aniso = 4): THREE.CanvasTexture {
  const hit = cache.get(id);
  if (hit) return hit.tex;
  const base = drawSkin(id);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  out.getContext('2d')!.drawImage(base, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  const e: Entry = { tex, base, out, logo: null };
  cache.set(id, e);
  if (LOGO_SKINS.includes(id)) loadLogo(id, e);
  return tex;
}

/** Guarda a imagem escolhida (reduzida) como escudo da mesa e atualiza a textura. */
export async function setUserLogo(id: SkinId, file: Blob): Promise<void> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * k));
  cv.height = Math.max(1, Math.round(bmp.height * k));
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close();
  localStorage.setItem(LOGO_KEY(id), cv.toDataURL('image/png'));
  const e = cache.get(id);
  if (e) loadLogo(id, e);
}

export function clearUserLogo(id: SkinId): void {
  try {
    localStorage.removeItem(LOGO_KEY(id));
  } catch {
    /* sem armazenamento */
  }
  const e = cache.get(id);
  if (e) {
    e.logo = null;
    paint(e);
    loadLogo(id, e);
  }
}
