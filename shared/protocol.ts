import type { GameResult } from './game';
import type { SetState } from './layout';
import type { BotLevel } from './bot';

export type { BotLevel };

export const MAX_ROOM_PLAYERS = 4;
export const TURN_SECONDS_OPTIONS = [30, 60] as const;
export type TurnSeconds = (typeof TURN_SECONDS_OPTIONS)[number];
/** Ordem de preferência ao sentar: com 2 jogadores ficam frente a frente. */
export const SEAT_PREFERENCE = [0, 2, 1, 3] as const;
export const MAX_PHOTO_CHARS = 30000;
export const NAME_MAX = 16;
export const BEST_OF_OPTIONS = [3, 5, 7] as const;
export type BestOf = (typeof BEST_OF_OPTIONS)[number];
/** tempo para os jogadores aceitarem "jogar mais uma" */
export const CONFIRM_SECONDS = 30;

export interface SeriesRow {
  id: string;
  name: string;
  wins: number;
  /** soma dos pontos na mão em todas as partidas da sessão (menos é melhor) */
  points: number;
  games: number;
}

/** Placar da sessão (melhor de N). Vale só enquanto a sala existir. */
export interface SeriesView {
  bestOf: BestOf;
  /** partidas já concluídas */
  done: number;
  /** todas as partidas combinadas foram jogadas */
  over: boolean;
  rows: SeriesRow[];
  championIds: string[];
  /** "jogar mais uma" pedido pelo anfitrião: quem precisa responder */
  awaiting: { ids: string[]; confirmed: string[]; until: number } | null;
}

export interface RoomPlayer {
  id: string;
  name: string;
  /** 0..3 em volta da mesa, no sentido do jogo (0 → 1 → 2 → 3). Cada cliente gira a vista para ficar em baixo. */
  seat: number;
  connected: boolean;
  cam: boolean;
  mic: boolean;
  isHost: boolean;
  rackCount: number;
  melded: boolean;
  left: boolean;
  bot: boolean;
  /** só para bots: nível */
  botLevel?: BotLevel;
}

export interface RoomView {
  t: 'state';
  code: string;
  phase: 'lobby' | 'playing' | 'ended';
  hostId: string;
  turnSeconds: TurnSeconds;
  bestOf: BestOf;
  series?: SeriesView;
  isPublic: boolean;
  you: string;
  players: RoomPlayer[];
  rack: number[];
  table: SetState[];
  poolCount: number;
  turnId: string | null;
  turnNo: number;
  turnEndsAt: number | null;
  serverNow: number;
  result?: GameResult;
}

export type ClientMsg =
  | { t: 'join'; id: string; name: string; photo?: string }
  | { t: 'start' }
  | { t: 'seat'; id: string; seat: number }
  | { t: 'settings'; turnSeconds?: TurnSeconds; bestOf?: BestOf }
  | { t: 'next' }
  | { t: 'more' }
  | { t: 'confirm'; yes: boolean }
  | { t: 'endSession' }
  | { t: 'submit'; table: SetState[] }
  | { t: 'draw' }
  | { t: 'draft'; table: SetState[] }
  | { t: 'media'; cam: boolean; mic: boolean }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'kick'; id: string }
  | { t: 'bots'; count: number; level: BotLevel }
  | { t: 'leave' }
  | { t: 'ping' };

export type ServerMsg =
  | RoomView
  | { t: 'photo'; id: string; data: string }
  | { t: 'say'; id: string; text: string }
  | { t: 'notice'; text: string }
  | { t: 'draft'; from: string; table: SetState[] }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'error'; msg: string }
  | { t: 'kicked' }
  | { t: 'pong' };

export interface RankingRow {
  id: string;
  name: string;
  games: number;
  wins: number;
  avg: number;
  best: number;
}

export interface LobbyRoom {
  code: string;
  hostName: string;
  count: number;
  turnSeconds: TurnSeconds;
}
