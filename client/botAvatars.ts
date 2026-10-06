import type { PersonaId } from '../shared/bot';

interface Look {
  bg: string;
  skin: string;
  hair: string;
  body: string;
  art: string;
}

const eyes = (y = 50): string =>
  `<circle cx="38" cy="${y}" r="3.2" fill="#222"/><circle cx="58" cy="${y}" r="3.2" fill="#222"/><circle cx="39" cy="${y - 1}" r="1" fill="#fff"/><circle cx="59" cy="${y - 1}" r="1" fill="#fff"/>`;
const smile = (y = 63, w = 9): string => `<path d="M${48 - w} ${y} Q48 ${y + 9} ${48 + w} ${y}" stroke="#7a2e2e" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
const brows = (c: string, y = 43): string => `<path d="M32 ${y} h12 M52 ${y} h12" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`;
const glasses = (c: string): string => `<circle cx="38" cy="50" r="8" fill="#fff" fill-opacity=".25" stroke="${c}" stroke-width="2"/><circle cx="58" cy="50" r="8" fill="#fff" fill-opacity=".25" stroke="${c}" stroke-width="2"/><path d="M46 50 h4" stroke="${c}" stroke-width="2"/>`;

const LOOKS: Record<PersonaId, Look> = {
  davi: {
    bg: '#f59e42',
    skin: '#e8b48a',
    hair: '#5a3a22',
    body: '#2f7de1',
    art: `<path d="M28 40 L32 24 L40 34 L47 20 L54 34 L63 24 L68 40 Q48 30 28 40Z" fill="#5a3a22"/>${brows('#5a3a22', 44)}${eyes()}${smile(62, 10)}<circle cx="30" cy="58" r="4" fill="#f08a7a" fill-opacity=".5"/><circle cx="66" cy="58" r="4" fill="#f08a7a" fill-opacity=".5"/>`,
  },
  jorge: {
    bg: '#4c9f70',
    skin: '#d9a47c',
    hair: '#d8d8d8',
    body: '#8b5a2b',
    art: `<path d="M27 42 Q27 22 48 22 Q69 22 69 42 Q60 32 48 33 Q36 32 27 42Z" fill="#d8d8d8"/>${brows('#b9b9b9', 43)}${eyes()}${glasses('#4a3320')}<path d="M34 61 Q48 54 62 61 Q56 70 48 66 Q40 70 34 61Z" fill="#e9e9e9"/>${smile(70, 6)}`,
  },
  luna: {
    bg: '#9b5de5',
    skin: '#f1c7a5',
    hair: '#3b1f6b',
    body: '#e5395f',
    art: `<path d="M24 52 Q20 20 48 18 Q76 20 72 52 Q70 36 60 32 Q48 40 34 32 Q26 38 24 52Z" fill="#3b1f6b"/><path d="M22 54 Q24 78 34 80 Q30 66 30 50Z M74 54 Q72 78 62 80 Q66 66 66 50Z" fill="#3b1f6b"/>${brows('#3b1f6b', 43)}${eyes()}<path d="M40 62 Q48 70 56 62 Q48 66 40 62Z" fill="#d6204a"/><circle cx="27" cy="62" r="2.6" fill="#ffd166"/><circle cx="69" cy="62" r="2.6" fill="#ffd166"/>`,
  },
  marina: {
    bg: '#2ec4b6',
    skin: '#c98b66',
    hair: '#2a1b14',
    body: '#264653',
    art: `<circle cx="48" cy="17" r="9" fill="#2a1b14"/><path d="M26 46 Q24 22 48 22 Q72 22 70 46 Q64 32 48 32 Q32 32 26 46Z" fill="#2a1b14"/>${brows('#2a1b14', 43)}${eyes()}${glasses('#b8860b')}${smile(63, 8)}`,
  },
  mestre: {
    bg: '#b8322f',
    skin: '#e3b78e',
    hair: '#1b1b1b',
    body: '#1d1d1d',
    art: `<ellipse cx="48" cy="16" rx="7" ry="8" fill="#1b1b1b"/><path d="M27 42 Q27 24 48 24 Q69 24 69 42 Q60 34 48 35 Q36 34 27 42Z" fill="#1b1b1b"/><path d="M27 33 h42" stroke="#f2f2f2" stroke-width="4"/>${brows('#1b1b1b', 44)}${eyes(51)}<path d="M33 64 Q48 82 63 64 Q56 72 48 70 Q40 72 33 64Z" fill="#1b1b1b"/>${smile(63, 5)}`,
  },
};

const cache = new Map<string, string>();

/** Rosto desenhado (SVG) de cada bot, como data URL. */
export function personaAvatar(id: PersonaId): string {
  const hit = cache.get(id);
  if (hit) return hit;
  const l = LOOKS[id];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" fill="${l.bg}"/>` +
    `<path d="M10 96 Q14 72 48 72 Q82 72 86 96Z" fill="${l.body}"/>` +
    `<rect x="42" y="64" width="12" height="12" fill="${l.skin}"/>` +
    `<ellipse cx="48" cy="50" rx="21" ry="25" fill="${l.skin}"/>${l.art}</svg>`;
  const url = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  cache.set(id, url);
  return url;
}
