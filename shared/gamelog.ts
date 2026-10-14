// Log de partidas online: guarda cada jogada (cavalete de quem jogou, ação, mesa resultante) para depois estudar onde os
// bots erram e como a dificuldade se comporta com humanos. É ANÔNIMO: só lugar na mesa, "humano ou bot" e o nível do bot;
// nada de nome, foto ou identificador do jogador.
//
// Reconstrução: mãos iniciais + ordem do pote (`deal`) + `turns` bastam para refazer a partida; cada jogada também traz o
// cavalete de quem jogou ANTES dela, então dá para analisar uma jogada isolada sem refazer tudo.
import type { GameState } from './game';
import type { BotLevel } from './bot';

export const GAMELOG_VERSION = 1;

export interface LogPlayer {
  seat: number;
  /** h = humano, b = bot */
  kind: 'h' | 'b';
  level?: BotLevel;
  /** id do personagem do bot (ex.: bot-master-2); humanos nunca têm */
  persona?: string;
}

export interface LogTurn {
  /** turno (turnNo) em que a ação aconteceu */
  n: number;
  /** lugar de quem agiu */
  s: number;
  /** p = jogou, d = comprou, x = passou (pote vazio), l = saiu da partida */
  a: 'p' | 'd' | 'x' | 'l';
  /** cavalete de quem agiu ANTES da ação (ordenado) */
  rk: number[];
  /** já tinha aberto antes da ação */
  mel: boolean;
  /** mesa depois da jogada: cada conjunto é a lista de pedras na ordem em que aparece (só quando a === 'p') */
  tb?: number[][];
  /** o tempo esgotou e o servidor agiu */
  to?: true;
  /** milissegundos desde o começo da vez */
  ms?: number;
  /** pedras no pote depois da ação */
  pool: number;
  /** pedras no cavalete de cada lugar depois da ação */
  rs: number[];
}

export interface LogResult {
  /** lugares vencedores */
  winners: number[];
  /** pontos na mão de cada lugar ao fim (quem saiu leva +50) */
  points: number[];
  left: number[];
  reason: 'empty' | 'pool' | 'left';
  turnNo: number;
}

export interface GameLogHead {
  v: number;
  /** identificador aleatório da partida */
  id: string;
  /** começo (ms desde 1970) */
  t: number;
  turnSeconds: number;
  players: LogPlayer[];
  /** lugar que começou */
  first: number;
  deal: { racks: number[][]; pool: number[] };
}

export interface GameLog extends GameLogHead {
  /** fim (ms desde 1970) */
  end: number;
  turns: LogTurn[];
  result: LogResult | null;
}

/** Linha resumida de uma partida (a camada leve, para calibrar a dificuldade). */
export interface GameSummary {
  id: string;
  t: number;
  /** duração em segundos */
  dur: number;
  players: number;
  humans: number;
  /** níveis dos bots ordenados e separados por vírgula ('' = só humanos) */
  levels: string;
  /** algum humano está entre os vencedores */
  humanWon: boolean;
  turns: number;
  reason: string;
  /** menor pontuação na mão entre os humanos / entre os bots (-1 se não há) */
  humanPts: number;
  botPts: number;
  /** partida interrompida (alguém saiu) ou relâmpago: fica fora das taxas de vitória */
  partial: boolean;
}

export function logHead(game: GameState, players: LogPlayer[], meta: { id: string; t: number; turnSeconds: number }): GameLogHead {
  return {
    v: GAMELOG_VERSION,
    id: meta.id,
    t: meta.t,
    turnSeconds: meta.turnSeconds,
    players,
    first: game.turn,
    deal: { racks: game.players.map((p) => p.rack.slice().sort((a, b) => a - b)), pool: game.pool.slice() },
  };
}

/**
 * O que mudou entre dois estados: a ação de quem estava na vez e, se alguém saiu, uma linha para cada saída.
 * Estados iguais (nada aconteceu) não geram nada.
 */
export function logTurn(prev: GameState, next: GameState, info: { ms?: number; timeout?: boolean } = {}): LogTurn[] {
  if (prev === next) return [];
  const out: LogTurn[] = [];
  const rs = next.players.map((p) => p.rack.length);
  const base = { pool: next.pool.length, rs };
  const mover = prev.turn;
  const mp = prev.players[mover]!;
  const np = next.players[mover]!;
  const moverLeft = !mp.left && np.left;

  prev.players.forEach((p, seat) => {
    if (!p.left && next.players[seat]!.left) {
      out.push({ n: prev.turnNo, s: seat, a: 'l', rk: p.rack.slice().sort((a, b) => a - b), mel: p.melded, ...base });
    }
  });

  const acted = next.turnNo !== prev.turnNo || np.rack.length !== mp.rack.length || next.phase !== prev.phase;
  if (acted && !moverLeft && !mp.left) {
    const a: LogTurn['a'] = np.rack.length < mp.rack.length ? 'p' : np.rack.length > mp.rack.length ? 'd' : 'x';
    const t: LogTurn = { n: prev.turnNo, s: mover, a, rk: mp.rack.slice().sort((x, y) => x - y), mel: mp.melded, ...base };
    if (a === 'p') t.tb = next.table.map((s) => s.tiles.slice());
    if (info.timeout) t.to = true;
    if (info.ms !== undefined) t.ms = Math.max(0, Math.round(info.ms));
    out.unshift(t);
  }
  return out;
}

export function logResult(game: GameState): LogResult | null {
  const r = game.result;
  if (!r) return null;
  const seatOf = (id: string): number => game.players.findIndex((p) => p.id === id);
  return {
    winners: r.winners.map(seatOf),
    points: game.players.map((p) => r.points[p.id] ?? 0),
    left: r.left.map(seatOf),
    reason: r.reason,
    turnNo: game.turnNo,
  };
}

export function summarize(log: GameLog): GameSummary {
  const res = log.result;
  const humans = log.players.filter((p) => p.kind === 'h');
  const bots = log.players.filter((p) => p.kind === 'b');
  const pts = (list: LogPlayer[]): number => (res && list.length ? Math.min(...list.map((p) => res.points[p.seat] ?? 0)) : -1);
  const turns = res?.turnNo ?? log.turns.length;
  return {
    id: log.id,
    t: log.t,
    dur: Math.max(0, Math.round((log.end - log.t) / 1000)),
    players: log.players.length,
    humans: humans.length,
    levels: bots
      .map((p) => p.level ?? '?')
      .sort()
      .join(','),
    humanWon: !!res && humans.some((p) => res.winners.includes(p.seat)),
    turns,
    reason: res?.reason ?? 'none',
    humanPts: pts(humans),
    botPts: pts(bots),
    partial: !res || res.reason === 'left' || turns < log.players.length * 3,
  };
}
