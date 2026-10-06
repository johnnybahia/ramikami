import { isJoker, tileValue } from './tiles';
import { analyzeSet, validatePlay } from './rules';
import { COLS, ROWS, findSpot, relayout, type SetState } from './layout';
import type { GameState } from './game';
import { key, packCounts, type Cand } from './pack';
import { solveTable } from './solver';

export type PersonaId = 'davi' | 'jorge' | 'luna' | 'marina' | 'mestre';

export interface Persona {
  id: PersonaId;
  name: string;
  gender: 'm' | 'f';
  level: 'Fácil' | 'Médio' | 'Difícil' | 'Mestre';
  /** como joga, em uma frase (mostrado ao anfitrião) */
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
  /** joga só um conjunto por turno (depois de abrir) */
  oneSet: boolean;
  /** guarda coringas no cavalete até o fim da partida */
  holdJokers: boolean;
  /** fração do tempo do turno que ele leva "pensando" (min, max): nunca joga de imediato */
  think: [number, number];
  lines: { play: string[]; draw: string[] };
}

export const PERSONAS: readonly Persona[] = [
  {
    id: 'davi',
    name: 'Davi',
    gender: 'm',
    level: 'Fácil',
    blurb: 'Apressado: joga rápido, às vezes compra sem pensar e nunca mexe na mesa.',
    budget: 2500,
    extend: false,
    jokers: false,
    skip: 0.2,
    rearrange: 0,
    rearrangeChance: 0,
    oneSet: false,
    holdJokers: false,
    think: [0.1, 0.22],
    lines: { play: ['Bora, bora!', 'Rapidinho!', 'Já foi!'], draw: ['Ah, vou comprar...', 'Sem pressa... ou com.', 'Compra logo!'] },
  },
  {
    id: 'jorge',
    name: 'Seu Jorge',
    gender: 'm',
    level: 'Médio',
    blurb: 'Cauteloso: joga um conjunto por vez, pensa devagar e só encaixa na mesa.',
    budget: 8000,
    extend: true,
    jokers: false,
    skip: 0.2,
    rearrange: 0,
    rearrangeChance: 0,
    oneSet: true,
    holdJokers: true,
    think: [0.55, 0.8],
    lines: { play: ['Devagar e sempre.', 'Um de cada vez.', 'Com calma...'], draw: ['Hmm, nada por ora.', 'Guardo o resto.', 'Vamos esperar.'] },
  },
  {
    id: 'luna',
    name: 'Luna',
    gender: 'f',
    level: 'Difícil',
    blurb: 'Ousada: despeja tudo de uma vez, mexe na mesa e gasta coringa sem medo.',
    budget: 10000,
    extend: true,
    jokers: true,
    skip: 0,
    rearrange: 5000,
    rearrangeChance: 0.5,
    oneSet: false,
    holdJokers: false,
    think: [0.2, 0.4],
    lines: { play: ['Olha isso!', 'Tudo na mesa!', 'Ousadia!'], draw: ['Droga!', 'Próxima eu pego.', 'Ai, ai.'] },
  },
  {
    id: 'marina',
    name: 'Marina',
    gender: 'f',
    level: 'Difícil',
    blurb: 'Estrategista: reorganiza a mesa e guarda o coringa para o fim.',
    budget: 20000,
    extend: true,
    jokers: false,
    skip: 0,
    rearrange: 15000,
    rearrangeChance: 0.85,
    oneSet: false,
    holdJokers: true,
    think: [0.5, 0.75],
    lines: { play: ['Calculado.', 'Tudo no lugar.', 'Mais uma peça do quebra-cabeça.'], draw: ['Paciência.', 'Ainda não é a hora.', 'Guardando o coringa.'] },
  },
  {
    id: 'mestre',
    name: 'Mestre Kaito',
    gender: 'm',
    level: 'Mestre',
    blurb: 'Mestre: busca máxima, reorganiza a mesa inteira e não erra jogada.',
    budget: 20000,
    extend: true,
    jokers: true,
    skip: 0,
    rearrange: 40000,
    rearrangeChance: 1,
    oneSet: false,
    holdJokers: false,
    think: [0.35, 0.55],
    lines: { play: ['Xeque.', 'O caminho é este.', 'Previsível.'], draw: ['Uma pausa estratégica.', 'Interessante...', 'Sem jogada ótima.'] },
  },
];

export const MIN_THINK_MS = 2500;
/** Quanto o bot espera antes de jogar: fração do tempo do turno (ou 30s se não houver limite). */
export function thinkDelayMs(p: Persona, turnSeconds: number, rng: () => number = Math.random): number {
  const base = (turnSeconds > 0 ? turnSeconds : 30) * 1000;
  const [lo, hi] = p.think;
  return Math.max(MIN_THINK_MS, Math.min(base - 1500, base * (lo + (hi - lo) * rng())));
}

export const PERSONA_IDS: readonly PersonaId[] = PERSONAS.map((p) => p.id);
export const personaById = (id: string): Persona | undefined => PERSONAS.find((p) => p.id === id);
export const botIdOf = (p: PersonaId): string => `bot-${p}`;
export const personaOfBotId = (id: string): Persona | undefined => personaById(id.replace(/^bot-/, ''));

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
export function botMove(state: GameState, persona: Persona = PERSONAS[4]!, rng: () => number = Math.random): SetState[] | null {
  const me = state.players[state.turn]!;
  if (me.melded && rng() < persona.skip) return null;

  const cnt = new Int8Array(52);
  let jokers = 0;
  for (const id of me.rack) {
    if (isJoker(id)) jokers++;
    else cnt[key(id)]!++;
  }
  if (persona.holdJokers && me.rack.length > 6) jokers = 0;

  let chosen = packCounts(cnt, jokers, !me.melded, persona.budget);
  if (chosen && persona.oneSet && me.melded) chosen = [chosen[0]!];

  let table: SetState[] = state.table.map((s) => ({ ...s, tiles: s.tiles.slice() }));
  let rest = me.rack.slice();
  let ok = true;
  if (chosen) {
    const r = realize(me.rack, chosen);
    rest = r.rest;
    for (const tiles of r.sets) {
      const spot = findSpot(table, -1, Math.floor((COLS - tiles.length) / 2), Math.floor(ROWS / 2), tiles.length);
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
  if (me.melded && persona.rearrange > 0 && !persona.oneSet && rng() < persona.rearrangeChance) {
    const r = solveTable(state.table, me.rack, persona.rearrange);
    if (r) consider(relayout(r.table));
  }
  return bestMove;
}

