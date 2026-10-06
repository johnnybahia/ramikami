import { handPoints, newPool, type Rng } from './tiles';
import { relayout, type SetState } from './layout';
import { analyzeSet, validatePlay } from './rules';

export const HAND_SIZE = 14;
export const LEAVE_PENALTY = 50;
export const MAX_TIMEOUTS = 3;

export interface PlayerInit {
  id: string;
  name: string;
  isBot?: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  rack: number[];
  melded: boolean;
  connected: boolean;
  timeouts: number;
  left: boolean;
}

export interface GameResult {
  winners: string[];
  /** pontos na mão de cada jogador ao fim (quem saiu leva +50) */
  points: Record<string, number>;
  left: string[];
  reason: 'empty' | 'pool' | 'left';
}

export interface GameState {
  phase: 'playing' | 'ended';
  players: PlayerState[];
  pool: number[];
  table: SetState[];
  turn: number;
  turnNo: number;
  passStreak: number;
  result?: GameResult;
}

export type Step = { ok: true; state: GameState } | { ok: false; reason: string };

export function createGame(inits: readonly PlayerInit[], rng: Rng): GameState {
  const pool = newPool(rng);
  const players: PlayerState[] = inits.map((p) => ({
    id: p.id,
    name: p.name,
    isBot: !!p.isBot,
    rack: pool.splice(0, HAND_SIZE),
    melded: false,
    connected: true,
    timeouts: 0,
    left: false,
  }));
  return { phase: 'playing', players, pool, table: [], turn: Math.floor(rng() * players.length), turnNo: 1, passStreak: 0 };
}

export const activePlayers = (s: GameState): PlayerState[] => s.players.filter((p) => !p.left);
export const currentPlayer = (s: GameState): PlayerState => s.players[s.turn]!;

function advance(s: GameState): void {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (s.turn + i) % n;
    if (!s.players[idx]!.left) {
      s.turn = idx;
      break;
    }
  }
  s.turnNo++;
}

function finish(s: GameState, reason: GameResult['reason']): void {
  const points: Record<string, number> = {};
  const left: string[] = [];
  for (const p of s.players) {
    points[p.id] = handPoints(p.rack) + (p.left ? LEAVE_PENALTY : 0);
    if (p.left) left.push(p.id);
  }
  const contenders = s.players.filter((p) => !p.left);
  const min = Math.min(...contenders.map((p) => points[p.id]!));
  s.phase = 'ended';
  s.result = { winners: contenders.filter((p) => points[p.id] === min).map((p) => p.id), points, left, reason };
}

export function playTurn(state: GameState, playerId: string, newTable: readonly SetState[]): Step {
  if (state.phase !== 'playing') return { ok: false, reason: 'partida encerrada' };
  const cur = currentPlayer(state);
  if (cur.id !== playerId) return { ok: false, reason: 'não é a sua vez' };
  const v = validatePlay(state.table, cur.rack, cur.melded, newTable);
  if (!v.ok) return v;
  const s = structuredClone(state);
  const me = currentPlayer(s);
  const added = new Set(v.added);
  me.rack = me.rack.filter((t) => !added.has(t));
  me.melded = true;
  me.timeouts = 0;
  s.table = relayout(newTable);
  s.passStreak = 0;
  if (me.rack.length === 0) finish(s, 'empty');
  else advance(s);
  return { ok: true, state: s };
}

/**
 * Fim do tempo com a jogada incompleta: ficam na mesa só os conjuntos válidos montados inteiramente com pedras da
 * mão do jogador; tudo o que mexeu em jogos já prontos volta ao estado inicial (e as pedras voltam à mão).
 * Retorna null se nada sobrou (ou se na abertura os conjuntos não somam 30 pontos).
 */
export function salvagePlay(state: GameState, playerId: string, draft: readonly SetState[]): GameState | null {
  if (state.phase !== 'playing' || !Array.isArray(draft)) return null;
  const cur = currentPlayer(state);
  if (cur.id !== playerId) return null;
  const rack = new Set(cur.rack);
  const pure = draft.filter((s) => s && Array.isArray(s.tiles) && s.tiles.length >= 3 && s.tiles.every((t: number) => rack.has(t)) && analyzeSet(s.tiles).valid);
  if (pure.length === 0) return null;
  const next: SetState[] = [...state.table.map((s) => ({ ...s, tiles: s.tiles.slice() })), ...pure.map((s, i) => ({ id: state.table.length + i + 1, tiles: s.tiles.slice(), x: s.x, z: s.z }))];
  const step = playTurn(state, playerId, next);
  return step.ok ? step.state : null;
}

/** Compra 1 pedra (ou passa, se o pote acabou) e encerra o turno. A mesa volta ao estado do início do turno. */
export function drawTurn(state: GameState, playerId: string, timedOut = false): Step {
  if (state.phase !== 'playing') return { ok: false, reason: 'partida encerrada' };
  if (currentPlayer(state).id !== playerId) return { ok: false, reason: 'não é a sua vez' };
  const s = structuredClone(state);
  const me = currentPlayer(s);
  if (s.pool.length > 0) {
    me.rack.push(s.pool.pop()!);
    s.passStreak = 0;
  } else {
    s.passStreak++;
  }
  me.timeouts = timedOut ? me.timeouts + 1 : 0;
  if (s.pool.length === 0 && s.passStreak >= activePlayers(s).length) finish(s, 'pool');
  else advance(s);
  return { ok: true, state: s };
}

/** Jogador saiu (ou foi removido por inatividade). As pedras dele ficam fora de jogo; ele leva +50 pontos. */
export function removePlayer(state: GameState, playerId: string): GameState {
  if (state.phase !== 'playing') return state;
  const s = structuredClone(state);
  const idx = s.players.findIndex((p) => p.id === playerId);
  if (idx < 0 || s.players[idx]!.left) return state;
  s.players[idx]!.left = true;
  s.players[idx]!.connected = false;
  if (activePlayers(s).length <= 1 || activePlayers(s).every((p) => p.isBot)) {
    finish(s, 'left');
  } else if (s.turn === idx) {
    advance(s);
  }
  return s;
}
