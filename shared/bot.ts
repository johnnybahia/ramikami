import { isJoker, tileValue } from './tiles';
import { analyzeSet, validatePlay } from './rules';
import { findCompactSpot, relayout, type SetState } from './layout';
import type { GameState } from './game';
import { key, packCounts, type Cand } from './pack';
import { solveTable } from './solver';

export type BotLevel = 'easy' | 'normal' | 'hard' | 'master';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard', 'master'];
export const MAX_BOTS = 3;

export interface LevelCfg {
  label: string;
  /** como jogam, em uma frase */
  blurb: string;
  /** nós de busca para montar conjuntos só com o cavalete */
  budget: number;
  /** encaixa pedras em conjuntos que já estão na mesa */
  extend: boolean;
  /** usa coringa ao encaixar */
  jokers: boolean;
  /** chance de comprar mesmo tendo jogada (depois de abrir) */
  skip: number;
  /** nós de busca para rearranjar a mesa (0 = nunca mexe na mesa) */
  rearrange: number;
  /** chance de tentar rearranjar a mesa em cada turno */
  rearrangeChance: number;
  /** guarda coringas no cavalete até o fim da partida */
  holdJokers: boolean;
  /** fração do tempo do turno que levam "pensando" (min, max): nunca jogam de imediato */
  think: [number, number];
  lines: { play: string[]; draw: string[] };
}

export const LEVEL_CFG: Record<BotLevel, LevelCfg> = {
  easy: {
    label: 'Fácil',
    blurb: 'Joga rápido, às vezes compra sem pensar e nunca mexe na mesa.',
    budget: 2500,
    extend: false,
    jokers: false,
    skip: 0.2,
    rearrange: 0,
    rearrangeChance: 0,
    holdJokers: false,
    think: [0.12, 0.25],
    lines: { play: ['Bora!', 'Rapidinho!', 'Já foi!'], draw: ['Ah, vou comprar...', 'Sem jogada.', 'Compra logo!'] },
  },
  normal: {
    label: 'Médio',
    blurb: 'Encaixa pedras na mesa e às vezes reorganiza.',
    budget: 8000,
    extend: true,
    jokers: false,
    skip: 0.1,
    rearrange: 3000,
    rearrangeChance: 0.25,
    holdJokers: true,
    think: [0.35, 0.6],
    lines: { play: ['Devagar e sempre.', 'Com calma...', 'Pronto.'], draw: ['Hmm, nada por ora.', 'Guardo o resto.', 'Vamos esperar.'] },
  },
  hard: {
    label: 'Difícil',
    blurb: 'Reorganiza a mesa quase sempre e aproveita bem as pedras.',
    budget: 15000,
    extend: true,
    jokers: true,
    skip: 0,
    rearrange: 10000,
    rearrangeChance: 0.7,
    holdJokers: false,
    think: [0.3, 0.5],
    lines: { play: ['Olha isso!', 'Tudo no lugar.', 'Ousadia!'], draw: ['Droga!', 'Próxima eu pego.', 'Paciência.'] },
  },
  master: {
    label: 'Mestre',
    blurb: 'Busca máxima, reorganiza a mesa inteira e não perde jogada.',
    budget: 20000,
    extend: true,
    jokers: true,
    skip: 0,
    rearrange: 40000,
    rearrangeChance: 1,
    holdJokers: false,
    think: [0.35, 0.55],
    lines: { play: ['Xeque.', 'O caminho é este.', 'Previsível.'], draw: ['Uma pausa estratégica.', 'Interessante...', 'Sem jogada ótima.'] },
  },
};

/** Quatro nomes por nível (dois homens, duas mulheres). O jogador não escolhe nomes: sorteamos entre eles. */
const NAMES: Record<BotLevel, { name: string; gender: 'm' | 'f' }[]> = {
  easy: [
    { name: 'Davi', gender: 'm' },
    { name: 'Bia', gender: 'f' },
    { name: 'Tadeu', gender: 'm' },
    { name: 'Lia', gender: 'f' },
  ],
  normal: [
    { name: 'Seu Jorge', gender: 'm' },
    { name: 'Dona Nair', gender: 'f' },
    { name: 'Paulo', gender: 'm' },
    { name: 'Rita', gender: 'f' },
  ],
  hard: [
    { name: 'Rafael', gender: 'm' },
    { name: 'Luna', gender: 'f' },
    { name: 'Caio', gender: 'm' },
    { name: 'Marina', gender: 'f' },
  ],
  master: [
    { name: 'Mestre Kaito', gender: 'm' },
    { name: 'Sensei Aiko', gender: 'f' },
    { name: 'Mestre Otávio', gender: 'm' },
    { name: 'Mestra Yara', gender: 'f' },
  ],
};

export interface Persona extends LevelCfg {
  /** id do jogador: "bot-<nível>-<n>" */
  id: string;
  name: string;
  gender: 'm' | 'f';
  level: BotLevel;
  /** posição (0..3) entre os nomes do nível, usada para variar o rosto */
  slot: number;
}

export const PERSONAS: readonly Persona[] = BOT_LEVELS.flatMap((level) =>
  NAMES[level].map((n, slot) => ({ ...LEVEL_CFG[level], id: `bot-${level}-${slot}`, name: n.name, gender: n.gender, level, slot })),
);

export const personaOfBotId = (id: string): Persona | undefined => PERSONAS.find((p) => p.id === id);
export const isBotId = (id: string): boolean => id.startsWith('bot-');

/** Sorteia `count` bots diferentes do nível (sem repetir nome). */
export function pickBots(level: BotLevel, count: number, rng: () => number = Math.random): Persona[] {
  const pool = PERSONAS.filter((p) => p.level === level);
  const out: Persona[] = [];
  const n = Math.min(count, pool.length);
  while (out.length < n) {
    const i = Math.floor(rng() * pool.length);
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}

export const MIN_THINK_MS = 2500;
/** Quanto o bot espera antes de jogar: fração do tempo do turno (ou 30s se não houver limite). */
export function thinkDelayMs(p: LevelCfg, turnSeconds: number, rng: () => number = Math.random): number {
  const base = (turnSeconds > 0 ? turnSeconds : 30) * 1000;
  const [lo, hi] = p.think;
  return Math.max(MIN_THINK_MS, Math.min(base - 1500, base * (lo + (hi - lo) * rng())));
}

function realize(rack: readonly number[], chosen: readonly Cand[]): { sets: number[][]; rest: number[] } {
  const stacks = new Map<number, number[]>();
  const jokers: number[] = [];
  for (const id of rack) {
    if (isJoker(id)) jokers.push(id);
    else {
      const k = key(id);
      if (!stacks.has(k)) stacks.set(k, []);
      stacks.get(k)!.push(id);
    }
  }
  const sets = chosen.map((c) => c.slots.map((k) => (k === -1 ? jokers.pop()! : stacks.get(k)!.pop()!)));
  const rest = [...jokers, ...[...stacks.values()].flat()];
  return { sets, rest };
}

function extend(table: SetState[], rest: number[], allowJokers: boolean): number[] {
  let remaining = rest.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of remaining.slice()) {
      if (isJoker(t) && !allowJokers) continue;
      let done = false;
      for (const s of table) {
        for (let pos = 0; pos <= s.tiles.length && !done; pos++) {
          const cand = [...s.tiles.slice(0, pos), t, ...s.tiles.slice(pos)];
          if (analyzeSet(cand).valid) {
            s.tiles = cand;
            done = true;
          }
        }
        if (done) break;
      }
      if (done) {
        remaining = remaining.filter((r) => r !== t);
        changed = true;
      }
    }
  }
  return remaining;
}

/** Jogada do bot segundo a personalidade: nova mesa, ou null para comprar uma pedra. */
export function botMove(state: GameState, persona: LevelCfg = LEVEL_CFG.master, rng: () => number = Math.random): SetState[] | null {
  const me = state.players[state.turn]!;
  if (me.melded && rng() < persona.skip) return null;

  const cnt = new Int8Array(52);
  let jokers = 0;
  for (const id of me.rack) {
    if (isJoker(id)) jokers++;
    else cnt[key(id)]!++;
  }
  if (persona.holdJokers && me.rack.length > 6) jokers = 0;

  const chosen = packCounts(cnt, jokers, !me.melded, persona.budget);

  let table: SetState[] = state.table.map((s) => ({ ...s, tiles: s.tiles.slice() }));
  let rest = me.rack.slice();
  let ok = true;
  if (chosen) {
    const r = realize(me.rack, chosen);
    rest = r.rest;
    for (const tiles of r.sets) {
      const spot = findCompactSpot(table, tiles.length);
      if (!spot) {
        ok = false;
        break;
      }
      table.push({ id: table.length + 1, tiles, x: spot.x, z: spot.z });
    }
  }
  let simple: SetState[] | null = null;
  if (ok) {
    if (me.melded) {
      if (persona.extend) rest = extend(table, rest, false);
      if (persona.jokers && rest.length > 0 && rest.every(isJoker)) rest = extend(table, rest, true);
      simple = relayout(table);
    } else if (chosen) {
      simple = relayout(table);
    }
  }
  let bestMove: SetState[] | null = null;
  let bestRelief = -1;
  const consider = (t: SetState[] | null): void => {
    if (!t) return;
    const check = validatePlay(state.table, me.rack, me.melded, t);
    if (!check.ok) return;
    const relief = check.added.reduce((a, id) => a + tileValue(id), 0);
    if (relief > bestRelief) {
      bestRelief = relief;
      bestMove = t;
    }
  };
  consider(simple);
  if (me.melded && persona.rearrange > 0 && rng() < persona.rearrangeChance) {
    const r = solveTable(state.table, me.rack, persona.rearrange);
    if (r) consider(relayout(r.table));
  }
  return bestMove;
}

