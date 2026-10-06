import type { SetState } from '../shared/layout';
import type { BotLevel, RoomView, TurnSeconds } from '../shared/protocol';

export interface BackendEvents {
  onView(v: RoomView): void;
  onDraft(from: string, table: SetState[]): void;
  onPhoto(id: string, data: string): void;
  onError(msg: string): void;
  onKicked(): void;
  onRtc(from: string, data: unknown): void;
  onConn(state: 'connecting' | 'open' | 'closed'): void;
}

/** Mesma interface para jogo online (servidor) e offline (bots locais). */
export interface Backend {
  readonly mode: 'online' | 'offline';
  events: BackendEvents;
  connect(): void;
  submit(table: SetState[]): void;
  draw(): void;
  draft(table: SetState[]): void;
  start(): void;
  seat(id: string, seat: number): void;
  settings(turnSeconds: TurnSeconds): void;
  kick(id: string): void;
  addBot(level: BotLevel): void;
  removeBot(id: string): void;
  media(cam: boolean, mic: boolean): void;
  rtc(to: string, data: unknown): void;
  leave(): void;
}

export const noopEvents: BackendEvents = {
  onView() {},
  onDraft() {},
  onPhoto() {},
  onError() {},
  onKicked() {},
  onRtc() {},
  onConn() {},
};
