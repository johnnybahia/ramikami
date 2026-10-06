import type { Backend, BackendEvents } from '../backend';
import { noopEvents } from '../backend';
import { wsUrl } from '../api';
import type { SetState } from '../../shared/layout';
import type { BestOf, BotLevel, ClientMsg, ServerMsg, TurnSeconds } from '../../shared/protocol';
import type { Profile } from '../store';

export class OnlineBackend implements Backend {
  readonly mode = 'online' as const;
  events: BackendEvents = noopEvents;
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private retry = 0;
  private pingTimer = 0;
  private reconnectTimer = 0;

  constructor(
    private code: string,
    private profile: Profile,
  ) {
    // voltou para o jogo (ex.: depois de mandar o convite): reconecta já, sem esperar o próximo ciclo
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || this.closedByUs) return;
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        window.clearTimeout(this.reconnectTimer);
        this.retry = 0;
        this.connect();
      }
    });
  }

  connect(): void {
    this.closedByUs = false;
    this.events.onConn('connecting');
    const ws = new WebSocket(wsUrl(this.code));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.events.onConn('open');
      this.send({ t: 'join', id: this.profile.id, name: this.profile.name, photo: this.profile.photo ?? undefined });
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 20000);
    };
    ws.onmessage = (e) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      switch (m.t) {
        case 'state':
          this.events.onView(m);
          break;
        case 'photo':
          this.events.onPhoto(m.id, m.data);
          break;
        case 'notice':
          this.events.onNotice(m.text);
          break;
        case 'say':
          this.events.onSay(m.id, m.text);
          break;
        case 'draft':
          this.events.onDraft(m.from, m.table);
          break;
        case 'rtc':
          this.events.onRtc(m.from, m.data);
          break;
        case 'error':
          this.events.onError(m.msg);
          break;
        case 'kicked':
          this.closedByUs = true;
          this.events.onKicked();
          break;
      }
    };
    ws.onclose = (e) => {
      window.clearInterval(this.pingTimer);
      this.events.onConn('closed');
      // 4404/4003: sala inexistente, cheia ou já iniciada — não adianta tentar de novo
      if (this.closedByUs || e.code === 4404 || e.code === 4003 || e.code === 4001) {
        if (e.code === 4404 || e.code === 4003) this.events.onKicked();
        return;
      }
      const delay = Math.min(8000, 800 * 2 ** this.retry++);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  submit(table: SetState[]): void {
    this.send({ t: 'submit', table });
  }
  draw(): void {
    this.send({ t: 'draw' });
  }
  draft(table: SetState[]): void {
    this.send({ t: 'draft', table });
  }
  start(): void {
    this.send({ t: 'start' });
  }
  seat(id: string, seat: number): void {
    this.send({ t: 'seat', id, seat });
  }
  settings(opts: { turnSeconds?: TurnSeconds; bestOf?: BestOf }): void {
    this.send({ t: 'settings', ...opts });
  }
  shuffle(): void {
    this.send({ t: 'shuffle' });
  }
  next(): void {
    this.send({ t: 'next' });
  }
  more(): void {
    this.send({ t: 'more' });
  }
  confirm(yes: boolean): void {
    this.send({ t: 'confirm', yes });
  }
  endSession(): void {
    this.send({ t: 'endSession' });
  }
  setBots(count: number, level: BotLevel): void {
    this.send({ t: 'bots', count, level });
  }
  kick(id: string): void {
    this.send({ t: 'kick', id });
  }
  media(cam: boolean, mic: boolean): void {
    this.send({ t: 'media', cam, mic });
  }
  rtc(to: string, data: unknown): void {
    this.send({ t: 'rtc', to, data });
  }
  leave(): void {
    this.closedByUs = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.send({ t: 'leave' });
    this.ws?.close(1000, 'leave');
  }
}
