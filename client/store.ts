import { BOT_LEVELS, type BotLevel } from '../shared/bot';
import { SKIN_IDS, type SkinId } from './game/skins';
import { MAX_PHOTO_CHARS, NAME_MAX } from '../shared/protocol';

export interface Profile {
  id: string;
  name: string;
  photo: string | null;
  /** preferência: entrar nas salas online já com câmera/microfone ligados */
  cam?: boolean;
  mic?: boolean;
}

const KEY = 'ramikami_profile_v1';

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    if (typeof p.id === 'string' && p.id.length >= 8 && typeof p.name === 'string') return { id: p.id, name: p.name.slice(0, NAME_MAX), photo: p.photo ?? null, cam: !!p.cam, mic: !!p.mic };
  } catch {
    /* navegador bloqueou o armazenamento */
  }
  return null;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}

export const newId = (): string => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** Recorta o centro, reduz para 128 px e comprime em JPEG até caber no limite do servidor. */
export async function photoFromFile(file: Blob, size = 128): Promise<string> {
  const bmp = await createImageBitmap(file);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!;
  const s = Math.min(bmp.width, bmp.height);
  c.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  bmp.close();
  for (const q of [0.78, 0.65, 0.5, 0.38]) {
    const url = cv.toDataURL('image/jpeg', q);
    if (url.length <= MAX_PHOTO_CHARS) return url;
  }
  return cv.toDataURL('image/jpeg', 0.3);
}

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 42%)`;
}

const OFFLINE_KEY = 'ramikami_offline_v1';
export interface OfflineSettings {
  bots: 1 | 2 | 3;
  level: BotLevel;
  turnSeconds: 0 | 30 | 60;
}
export function loadOfflineSettings(): OfflineSettings {
  try {
    const s = JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? '{}') as Partial<OfflineSettings>;
    return { bots: s.bots === 2 || s.bots === 3 ? s.bots : 1, level: BOT_LEVELS.includes(s.level as BotLevel) ? (s.level as BotLevel) : 'normal', turnSeconds: s.turnSeconds === 30 || s.turnSeconds === 0 ? s.turnSeconds : 60 };
  } catch {
    return { bots: 1, level: 'normal', turnSeconds: 60 };
  }
}
export function saveOfflineSettings(s: OfflineSettings): void {
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(s));
  } catch {
    /* ok */
  }
}

const A11Y_KEY = 'ramikami_a11y_v2';
export interface A11y {
  /** alto contraste: cores mais fortes e traços mais grossos nas pedras */
  contrast: boolean;
  /** tamanho da interface: 0 normal, 1 grande, 2 extra grande */
  size: 0 | 1 | 2;
  /** pano da mesa */
  skin: SkinId;
}
const SIZE_PCT = [100, 118, 136] as const;
let a11y: A11y | null = null;

export function loadA11y(): A11y {
  if (a11y) return a11y;
  a11y = { contrast: false, size: 0, skin: 'verde' };
  try {
    const p = JSON.parse(localStorage.getItem(A11Y_KEY) ?? 'null') as Partial<A11y> | null;
    if (p) a11y = { contrast: p.contrast === true, size: p.size === 1 || p.size === 2 ? p.size : 0, skin: SKIN_IDS.includes(p.skin as SkinId) ? (p.skin as SkinId) : 'verde' };
  } catch {
    /* sem armazenamento: usa o padrão */
  }
  return a11y;
}

export function saveA11y(next: A11y): void {
  a11y = next;
  try {
    localStorage.setItem(A11Y_KEY, JSON.stringify(next));
  } catch {
    /* vale só nesta sessão */
  }
  applyA11yToPage();
}

export function applyA11yToPage(): void {
  const a = loadA11y();
  document.documentElement.style.fontSize = `${SIZE_PCT[a.size]}%`;
  document.documentElement.dataset.contrast = a.contrast ? 'high' : 'normal';
}
