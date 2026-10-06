import type { Backend, BackendEvents } from './backend';
import { noopEvents } from './backend';
import { botMove } from '../shared/bot';
import { createGame, currentPlayer, drawTurn, playTurn, type GameState } from '../shared/game';
import { mulberry32 } from '../shared/tiles';
import type { SetState } from '../shared/layout';
import type { RoomPlayer, RoomView, TurnSeconds } from '../shared/protocol';
import type { OfflineSettings, Profile } from './store';

const BOT_NAMES = ['Takeo', 'Mika', 'Ryo'];
const BOT_SEATS: Record<number, number[]> = { 1: [2], 2: [1, 3], 3: [1, 2, 3] };

/** Partida contra bots, sem internet: roda a mesma engine do servidor no próprio aparelho. */
export class LocalBackend implements Backend {
  readonly mode = 'offline' as const;
  events: BackendEvents = noopEvents;
  private game!: GameState;
  private seats = new Map<string, number>();
  private turnEndsAt: number | null = null;
  private timer = 0;
  private dead = false;

  constructor(
    private profile: Profile,
    private cfg: OfflineSettings,
  ) {}

  connect(): void {
    const bots = Array.from({ length: this.cfg.bots }, (_, i) => ({ id: `bot${i + 1}`, name: BOT_NAMES[i]!, isBot: true }));
    const seatList = BOT_SEATS[this.cfg.bots]!;
    this.seats.set(this.profile.id, 0);
    bots.forEach((b, i) => this.seats.set(b.id, seatList[i]!));
    const order = [{ id: this.profile.id, name: this.profile.name }, ...bots].sort((a, b) => this.seats.get(a.id)! - this.seats.get(b.id)!);
    const seed = Number(new URLSearchParams(location.search).get('seed'));
    this.game = createGame(order, seed > 0 ? mulberry32(seed) : Math.random);
    this.events.onConn('open');
    this.afterChange();
  }

  private view(): RoomView {
    const g = this.game;
    const players: RoomPlayer[] = g.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: this.seats.get(p.id) ?? 0,
      connected: true,
      cam: false,
      mic: false,
      isHost: p.id === this.profile.id,
      rackCount: p.rack.length,
      melded: p.melded,
      left: p.left,
      bot: p.isBot,
    }));
    return {
      t: 'state',
      code: 'OFFLINE',
      phase: g.phase,
      hostId: this.profile.id,
      turnSeconds: (this.cfg.turnSeconds || 60) as TurnSeconds,
      isPublic: false,
      you: this.profile.id,
      players,
      rack: g.players.find((p) => p.id === this.profile.id)!.rack,
      table: g.table,
      poolCount: g.pool.length,
      turnId: g.phase === 'playing' ? currentPlayer(g).id : null,
      turnNo: g.turnNo,
      turnEndsAt: this.turnEndsAt,
      serverNow: Date.now(),
      result: g.result,
    };
  }

  private afterChange(): void {
    window.clearTimeout(this.timer);
    if (this.dead) return;
    const g = this.game;
    if (g.phase !== 'playing') {
      this.turnEndsAt = null;
      this.events.onView(this.view());
      return;
    }
    const cur = currentPlayer(g);
    if (cur.isBot) {
      this.turnEndsAt = null;
      this.events.onView(this.view());
      this.timer = window.setTimeout(() => this.botTurn(), 900 + Math.random() * 900);
      return;
    }
    this.turnEndsAt = this.cfg.turnSeconds ? Date.now() + this.cfg.turnSeconds * 1000 : null;
    this.events.onView(this.view());
    if (this.turnEndsAt) this.timer = window.setTimeout(() => this.timeout(), this.cfg.turnSeconds * 1000);
  }

  private botTurn(): void {
    if (this.dead || this.game.phase !== 'playing') return;
    const cur = currentPlayer(this.game);
    const move = botMove(this.game);
    const step = move ? playTurn(this.game, cur.id, move) : drawTurn(this.game, cur.id);
    this.game = step.ok ? step.state : (drawTurn(this.game, cur.id) as { ok: true; state: GameState }).state;
    this.afterChange();
  }

  private timeout(): void {
    if (this.dead || this.game.phase !== 'playing') return;
    const step = drawTurn(this.game, currentPlayer(this.game).id, true);
    if (step.ok) this.game = step.state;
    this.afterChange();
  }

  submit(table: SetState[]): void {
    const step = playTurn(this.game, this.profile.id, table);
    if (!step.ok) return this.events.onError(step.reason);
    this.game = step.state;
    this.afterChange();
  }

  draw(): void {
    const step = drawTurn(this.game, this.profile.id);
    if (!step.ok) return this.events.onError(step.reason);
    this.game = step.state;
    this.afterChange();
  }

  draft(): void {}
  start(): void {}
  seat(): void {}
  settings(): void {}
  kick(): void {}
  addBot(): void {}
  removeBot(): void {}
  media(): void {}
  rtc(): void {}

  leave(): void {
    this.dead = true;
    window.clearTimeout(this.timer);
  }
}
