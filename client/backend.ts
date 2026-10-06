import type { SetState } from '../shared/layout';
import type { BestOf, BotLevel, RoomView, TurnSeconds } from '../shared/protocol';

export interface BackendEvents {
  onView(v: RoomView): void;
  onDraft(from: string, table: SetState[]): void;
  onPhoto(id: string, data: string): void;
  onSay(id: string, text: string): void;
  onNotice(text: string): void;
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
  draft(table: SetState[], ok?: SetState[] | null): void;
  start(): void;
  seat(id: string, seat: number): void;
  settings(opts: { turnSeconds?: TurnSeconds; bestOf?: BestOf }): void;
  shuffle(): void;
  next(): void;
  more(): void;
  confirm(yes: boolean): void;
  endSession(): void;
  kick(id: string): void;
  setBots(count: number, level: BotLevel): void;
  media(cam: boolean, mic: boolean): void;
  rtc(to: string, data: unknown): void;
  leave(): void;
}

export const noopEvents: BackendEvents = {
  onView() {},
  onDraft() {},
  onPhoto() {},
  onSay() {},
  onNotice() {},
  onError() {},
  onKicked() {},
  onRtc() {},
  onConn() {},
};
