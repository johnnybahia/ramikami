import { BOT_LEVELS, type Persona } from '../shared/bot';

const eyes = (y = 50): string =>
  `<circle cx="38" cy="${y}" r="3.2" fill="#222"/><circle cx="58" cy="${y}" r="3.2" fill="#222"/><circle cx="39" cy="${y - 1}" r="1" fill="#fff"/><circle cx="59" cy="${y - 1}" r="1" fill="#fff"/>`;
const smile = (w = 9): string => `<path d="M${48 - w} 63 Q48 72 ${48 + w} 63" stroke="#7a2e2e" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
const brows = (c: string): string => `<path d="M32 43 h12 M52 43 h12" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
const glasses = (c: string): string => `<circle cx="38" cy="50" r="8" fill="#fff" fill-opacity=".25" stroke="${c}" stroke-width="2"/><circle cx="58" cy="50" r="8" fill="#fff" fill-opacity=".25" stroke="${c}" stroke-width="2"/><path d="M46 50 h4" stroke="${c}" stroke-width="2"/>`;

const SKINS = ['#f1c7a5', '#e3b78e', '#c98b66', '#8d5a3c'];
const HAIR_M = ['#2a1b14', '#5a3a22', '#1b1b1b', '#9a9a9a'];
const HAIR_F = ['#3b1f6b', '#2a1b14', '#a0522d', '#d9a441'];
const BODY = ['#2f7de1', '#8b5a2b', '#e5395f', '#264653', '#1d1d1d', '#6a4c93'];
const BG_HUE = [30, 150, 270, 5];

/** Cabelo e barba por estilo (0..3), para homens e mulheres. */
function hair(gender: 'm' | 'f', style: number, c: string): string {
  if (gender === 'm') {
    if (style === 0) return `<path d="M28 40 L32 24 L40 34 L47 20 L54 34 L63 24 L68 40 Q48 30 28 40Z" fill="${c}"/>`;
    if (style === 1) return `<path d="M27 42 Q27 22 48 22 Q69 22 69 42 Q58 30 40 34 Q32 36 27 42Z" fill="${c}"/>`;
    if (style === 2) return `<path d="M30 40 Q48 28 66 40 Q64 30 48 28 Q32 30 30 40Z" fill="${c}"/><path d="M30 58 Q48 84 66 58 Q60 70 48 70 Q36 70 30 58Z" fill="${c}"/>`;
    return `<ellipse cx="48" cy="16" rx="7" ry="8" fill="${c}"/><path d="M27 42 Q27 24 48 24 Q69 24 69 42 Q60 34 48 35 Q36 34 27 42Z" fill="${c}"/>`;
  }
  if (style === 0) return `<path d="M24 52 Q20 20 48 18 Q76 20 72 52 Q70 36 60 32 Q48 40 34 32 Q26 38 24 52Z" fill="${c}"/><path d="M22 54 Q24 78 34 80 Q30 66 30 50Z M74 54 Q72 78 62 80 Q66 66 66 50Z" fill="${c}"/>`;
  if (style === 1) return `<circle cx="48" cy="17" r="9" fill="${c}"/><path d="M26 46 Q24 22 48 22 Q72 22 70 46 Q64 32 48 32 Q32 32 26 46Z" fill="${c}"/>`;
  if (style === 2) return `<path d="M24 62 Q18 22 48 20 Q78 22 72 62 Q70 40 60 34 Q48 40 36 34 Q26 40 24 62Z" fill="${c}"/>`;
  return `<circle cx="22" cy="46" r="8" fill="${c}"/><circle cx="74" cy="46" r="8" fill="${c}"/><path d="M26 46 Q24 22 48 22 Q72 22 70 46 Q64 32 48 32 Q32 32 26 46Z" fill="${c}"/>`;
}

const cache = new Map<string, string>();

/** Rosto desenhado (SVG) do bot, variado por nível e posição do nome; devolve data URL. */
export function personaAvatar(p: Persona): string {
  const hit = cache.get(p.id);
  if (hit) return hit;
  const li = BOT_LEVELS.indexOf(p.level);
  const skin = SKINS[(li + p.slot * 2) % 4]!;
  const hairColor = (p.gender === 'm' ? HAIR_M : HAIR_F)[(li * 3 + p.slot) % 4]!;
  const style = (li + p.slot) % 4;
  const body = BODY[(li * 2 + p.slot) % BODY.length]!;
  const bg = `hsl(${(BG_HUE[li]! + p.slot * 16) % 360} 58% 46%)`;
  const withGlasses = (li + p.slot) % 2 === 0;
  const female = p.gender === 'f';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${bg}"/>` +
    `<path d="M10 96 Q14 72 48 72 Q82 72 86 96Z" fill="${body}"/>` +
    `<rect x="42" y="64" width="12" height="12" fill="${skin}"/>` +
    `<ellipse cx="48" cy="50" rx="21" ry="25" fill="${skin}"/>` +
    hair(p.gender, style, hairColor) +
    brows(hairColor) +
    eyes() +
    (withGlasses ? glasses('#3a2a1a') : '') +
    (female ? `<path d="M40 62 Q48 70 56 62 Q48 66 40 62Z" fill="#d6204a"/>` : smile(p.slot % 2 ? 7 : 10)) +
    `</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(p.id, url);
  return url;
}
