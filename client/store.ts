import { MAX_PHOTO_CHARS, NAME_MAX } from '../shared/protocol';

export interface Profile {
  id: string;
  name: string;
  photo: string | null;
}

const KEY = 'ramikami_profile_v1';

export function loadProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Profile;
    if (typeof p.id === 'string' && p.id.length >= 8 && typeof p.name === 'string') return { id: p.id, name: p.name.slice(0, NAME_MAX), photo: p.photo ?? null };
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
  turnSeconds: 0 | 30 | 60;
}
export function loadOfflineSettings(): OfflineSettings {
  try {
    const s = JSON.parse(localStorage.getItem(OFFLINE_KEY) ?? '{}') as Partial<OfflineSettings>;
    return { bots: s.bots === 2 || s.bots === 3 ? s.bots : 1, turnSeconds: s.turnSeconds === 30 || s.turnSeconds === 0 ? s.turnSeconds : 60 };
  } catch {
    return { bots: 1, turnSeconds: 60 };
  }
}
export function saveOfflineSettings(s: OfflineSettings): void {
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(s));
  } catch {
    /* ok */
  }
}
