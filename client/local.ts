import type { Backend, BackendEvents } from './backend';
import { noopEvents } from './backend';
import { LEVEL_CFG, botMove, personaOfBotId, pickBots, thinkDelayMs } from '../shared/bot';
import { createGame, currentPlayer, drawTurn, playTurn, salvagePlay, type GameState } from '../shared/game';
import { mulberry32 } from '../shared/tiles';
import type { SetState } from '../shared/layout';
import type { RoomPlayer, RoomView, TurnSeconds } from '../shared/protocol';
import type { OfflineSettings, Profile } from './store';

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
  private draftTable: SetState[] | null = null;

  constructor(
    private profile: Profile,
    private cfg: OfflineSettings,
  ) {}

  connect(): void {
    const bots = pickBots(this.cfg.level, this.cfg.bots).map((p) => ({ id: p.id, name: p.name, isBot: true }));
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
      bestOf: 3,
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
    this.draftTable = null;
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
      const persona = personaOfBotId(cur.id) ?? LEVEL_CFG[this.cfg.level];
      this.timer = window.setTimeout(() => this.botTurn(), thinkDelayMs(persona, this.cfg.turnSeconds));
      return;
    }
    this.turnEndsAt = this.cfg.turnSeconds ? Date.now() + this.cfg.turnSeconds * 1000 : null;
    this.events.onView(this.view());
    if (this.turnEndsAt) this.timer = window.setTimeout(() => this.timeout(), this.cfg.turnSeconds * 1000);
  }

  private botTurn(): void {
    if (this.dead || this.game.phase !== 'playing') return;
    const cur = currentPlayer(this.game);
    const persona = personaOfBotId(cur.id) ?? LEVEL_CFG[this.cfg.level];
    const move = botMove(this.game, persona);
    const step = move ? playTurn(this.game, cur.id, move) : drawTurn(this.game, cur.id);
    this.game = step.ok ? step.state : (drawTurn(this.game, cur.id) as { ok: true; state: GameState }).state;
    this.afterChange();
  }

  private timeout(): void {
    if (this.dead || this.game.phase !== 'playing') return;
    const cur = currentPlayer(this.game);
    const kept = this.draftTable ? salvagePlay(this.game, cur.id, this.draftTable) : null;
    if (kept) {
      this.game = kept;
      this.events.onNotice('Tempo esgotado: ficaram na mesa só os conjuntos montados com pedras da sua mão.');
    } else {
      const step = drawTurn(this.game, cur.id, true);
      if (step.ok) this.game = step.state;
    }
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

  draft(table: SetState[]): void {
    this.draftTable = table;
  }
  start(): void {}
  seat(): void {}
  settings(): void {}
  next(): void {}
  more(): void {}
  confirm(): void {}
  endSession(): void {}
  kick(): void {}
  setBots(): void {}
  media(): void {}
  rtc(): void {}

  leave(): void {
    this.dead = true;
    window.clearTimeout(this.timer);
  }
}
