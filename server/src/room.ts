import { botMove, BOT_LEVELS, type BotLevel } from '../../shared/bot';
import { createGame, currentPlayer, drawTurn, playTurn, removePlayer, MAX_TIMEOUTS, type GameState } from '../../shared/game';
import type { SetState } from '../../shared/layout';
import {
  MAX_PHOTO_CHARS,
  MAX_ROOM_PLAYERS,
  NAME_MAX,
  SEAT_PREFERENCE,
  TURN_SECONDS_OPTIONS,
  type ClientMsg,
  type RoomPlayer,
  type RoomView,
  type ServerMsg,
  type TurnSeconds,
} from '../../shared/protocol';
import type { RecordEntry } from './ranking';
import type { Env } from './env';

interface Stored {
  code: string;
  hostId: string;
  turnSeconds: TurnSeconds;
  isPublic: boolean;
  phase: 'lobby' | 'playing' | 'ended';
  lobby: { id: string; name: string }[];
  seats: Record<string, number>;
  bots: Record<string, BotLevel>;
  botAt: number | null;
  media: Record<string, { cam: boolean; mic: boolean }>;
  game: GameState | null;
  turnEndsAt: number | null;
  recorded: boolean;
}

const IDLE_ROOM_MS = 10 * 60 * 1000;
const OFFLINE_TURN_SECONDS = 8;
const MAX_MSG = 100_000;

const cleanName = (n: unknown): string => String(n ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX) || 'Jogador';
const validPhoto = (p: unknown): p is string => typeof p === 'string' && p.length <= MAX_PHOTO_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p);

function sanitizeTable(raw: unknown): SetState[] | null {
  if (!Array.isArray(raw) || raw.length > 60) return null;
  const out: SetState[] = [];
  for (const s of raw) {
    if (!s || !Array.isArray(s.tiles) || s.tiles.length > 13) return null;
    out.push({ id: Number(s.id) || 0, tiles: s.tiles.map(Number), x: Number(s.x) || 0, z: Number(s.z) || 0 });
  }
  return out;
}

export class GameRoom implements DurableObject {
  private s: Stored | null = null;
  private photos: Record<string, string> = {};
  private loaded: Promise<void>;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.loaded = ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<Stored>('s')) ?? null;
      if (this.s) this.s.bots ??= {};
      this.photos = (await ctx.storage.get<Record<string, string>>('photos')) ?? {};
    });
  }

  // ---------- infra ----------
  private async persist(): Promise<void> {
    if (this.s) await this.ctx.storage.put('s', this.s);
  }

  private online(): Map<string, WebSocket> {
    const m = new Map<string, WebSocket>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as { id?: string } | null;
      if (a?.id) m.set(a.id, ws);
    }
    return m;
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket já fechado */
    }
  }

  private err(ws: WebSocket, msg: string): void {
    this.send(ws, { t: 'error', msg });
  }

  private view(forId: string): RoomView {
    const s = this.s!;
    const online = this.online();
    const g = s.game;
    const mk = (id: string, name: string, extra: Partial<RoomPlayer>): RoomPlayer => ({
      id,
      name,
      seat: s.seats[id] ?? 0,
      connected: online.has(id) || !!s.bots[id],
      cam: !!s.media[id]?.cam,
      mic: !!s.media[id]?.mic,
      isHost: s.hostId === id,
      rackCount: 0,
      melded: false,
      left: false,
      bot: !!s.bots[id],
      botLevel: s.bots[id],
      ...extra,
    });
    const players: RoomPlayer[] =
      s.phase === 'lobby' || !g
        ? s.lobby.map((p) => mk(p.id, p.name, {}))
        : g.players.map((p) => mk(p.id, p.name, { rackCount: p.rack.length, melded: p.melded, left: p.left, connected: !p.left && (p.connected || p.isBot) }));
    return {
      t: 'state',
      code: s.code,
      phase: s.phase,
      hostId: s.hostId,
      turnSeconds: s.turnSeconds,
      isPublic: s.isPublic,
      you: forId,
      players,
      rack: g?.players.find((p) => p.id === forId)?.rack ?? [],
      table: g?.table ?? [],
      poolCount: g?.pool.length ?? 0,
      turnId: s.phase === 'playing' && g ? currentPlayer(g).id : null,
      turnNo: g?.turnNo ?? 0,
      turnEndsAt: s.turnEndsAt,
      serverNow: Date.now(),
      result: g?.result,
    };
  }

  private broadcast(): void {
    if (!this.s) return;
    for (const [id, ws] of this.online()) this.send(ws, this.view(id));
  }

  private async listing(): Promise<void> {
    const s = this.s;
    if (!s) return;
    const stub = this.env.LOBBY.get(this.env.LOBBY.idFromName('global'));
    try {
      if (s.isPublic && s.phase === 'lobby' && s.lobby.length > 0) {
        const host = s.lobby.find((p) => p.id === s.hostId);
        await stub.fetch('https://lobby/upsert', {
          method: 'POST',
          body: JSON.stringify({ code: s.code, hostName: host?.name ?? '', count: s.lobby.length, turnSeconds: s.turnSeconds }),
        });
      } else {
        await stub.fetch('https://lobby/remove', { method: 'POST', body: JSON.stringify({ code: s.code }) });
      }
    } catch {
      /* listagem é opcional */
    }
  }

  private async destroy(): Promise<void> {
    const code = this.s?.code;
    this.s = null;
    this.photos = {};
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (code) {
      try {
        await this.env.LOBBY.get(this.env.LOBBY.idFromName('global')).fetch('https://lobby/remove', { method: 'POST', body: JSON.stringify({ code }) });
      } catch {
        /* ok */
      }
    }
  }

  // ---------- HTTP / WebSocket ----------
  async fetch(req: Request): Promise<Response> {
    await this.loaded;
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/init') {
      if (this.s) return new Response('exists', { status: 409 });
      const body = (await req.json()) as { code: string; turnSeconds: number; isPublic: boolean };
      const turnSeconds = (TURN_SECONDS_OPTIONS as readonly number[]).includes(body.turnSeconds) ? (body.turnSeconds as TurnSeconds) : 60;
      this.s = { code: body.code, hostId: '', turnSeconds, isPublic: !!body.isPublic, phase: 'lobby', lobby: [], seats: {}, bots: {}, botAt: null, media: {}, game: null, turnEndsAt: null, recorded: false };
      await this.persist();
      await this.ctx.storage.setAlarm(Date.now() + IDLE_ROOM_MS);
      return new Response('ok');
    }
    if (req.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      if (!this.s) {
        this.send(pair[1], { t: 'error', msg: 'Sala não existe ou já terminou.' });
        pair[1].close(4404, 'no room');
      }
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.loaded;
    if (typeof raw !== 'string' || raw.length > MAX_MSG || !this.s) return;
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      return;
    }
    if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
    if (msg.t === 'join') return this.onJoin(ws, msg);
    const me = (ws.deserializeAttachment() as { id?: string } | null)?.id;
    if (!me) return;
    const s = this.s;

    switch (msg.t) {
      case 'start': {
        if (me !== s.hostId || s.phase !== 'lobby') return;
        if (s.lobby.length < 2) return this.err(ws, 'São necessários pelo menos 2 jogadores.');
        const order = [...s.lobby].sort((a, b) => (s.seats[a.id] ?? 0) - (s.seats[b.id] ?? 0));
        s.game = createGame(order.map((p) => ({ id: p.id, name: p.name, isBot: !!s.bots[p.id] })), Math.random);
        s.phase = 'playing';
        await this.afterGameChange(s.game);
        return;
      }
      case 'settings': {
        if (me !== s.hostId || s.phase !== 'lobby') return;
        if (msg.turnSeconds && (TURN_SECONDS_OPTIONS as readonly number[]).includes(msg.turnSeconds)) s.turnSeconds = msg.turnSeconds;
        await this.persist();
        this.broadcast();
        await this.listing();
        return;
      }
      case 'addBot': {
        if (me !== s.hostId || s.phase !== 'lobby') return;
        if (!BOT_LEVELS.includes(msg.level)) return;
        if (s.lobby.length >= MAX_ROOM_PLAYERS) return this.err(ws, 'Sala cheia.');
        const id = `bot-${crypto.randomUUID().slice(0, 8)}`;
        const n = Object.keys(s.bots).length + 1;
        const label = { easy: 'Fácil', normal: 'Médio', hard: 'Difícil' }[msg.level];
        s.lobby.push({ id, name: `Bot ${n} ${label}`.slice(0, NAME_MAX) });
        s.bots[id] = msg.level;
        const used = new Set(Object.values(s.seats));
        s.seats[id] = SEAT_PREFERENCE.find((x) => !used.has(x)) ?? 0;
        await this.persist();
        this.broadcast();
        await this.listing();
        return;
      }
      case 'removeBot': {
        if (me !== s.hostId || s.phase !== 'lobby' || !s.bots[msg.id]) return;
        await this.dropPlayer(msg.id);
        return;
      }
      case 'seat': {
        if (me !== s.hostId || s.phase === 'ended') return;
        const seat = Math.round(Number(msg.seat));
        if (!(seat >= 0 && seat <= 3) || !(msg.id in s.seats)) return;
        const other = Object.keys(s.seats).find((id) => id !== msg.id && s.seats[id] === seat);
        if (other) s.seats[other] = s.seats[msg.id]!;
        s.seats[msg.id] = seat;
        await this.persist();
        this.broadcast();
        return;
      }
      case 'submit': {
        if (s.phase !== 'playing' || !s.game) return;
        const table = sanitizeTable(msg.table);
        if (!table) return this.err(ws, 'Mesa inválida.');
        const step = playTurn(s.game, me, table);
        if (!step.ok) return this.err(ws, step.reason);
        await this.afterGameChange(step.state);
        return;
      }
      case 'draw': {
        if (s.phase !== 'playing' || !s.game) return;
        const step = drawTurn(s.game, me);
        if (!step.ok) return this.err(ws, step.reason);
        await this.afterGameChange(step.state);
        return;
      }
      case 'draft': {
        if (s.phase !== 'playing' || !s.game || currentPlayer(s.game).id !== me) return;
        const table = sanitizeTable(msg.table);
        if (!table) return;
        for (const [id, other] of this.online()) if (id !== me) this.send(other, { t: 'draft', from: me, table });
        return;
      }
      case 'media': {
        s.media[me] = { cam: !!msg.cam, mic: !!msg.mic };
        await this.persist();
        this.broadcast();
        return;
      }
      case 'rtc': {
        const target = this.online().get(String(msg.to));
        if (target && JSON.stringify(msg.data ?? null).length < 20000) this.send(target, { t: 'rtc', from: me, data: msg.data });
        return;
      }
      case 'kick': {
        if (me !== s.hostId || msg.id === me) return;
        const target = this.online().get(msg.id);
        if (target) {
          this.send(target, { t: 'kicked' });
          target.close(4001, 'kicked');
        }
        await this.dropPlayer(msg.id);
        return;
      }
      case 'leave': {
        await this.dropPlayer(me);
        ws.close(1000, 'left');
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.loaded;
    const id = (ws.deserializeAttachment() as { id?: string } | null)?.id;
    if (!id || !this.s) return;
    // reconexão já aconteceu em outro socket: nada a fazer
    if (this.online().get(id) && this.online().get(id) !== ws) return;
    await this.onDisconnect(id);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ---------- eventos ----------
  private async onJoin(ws: WebSocket, msg: Extract<ClientMsg, { t: 'join' }>): Promise<void> {
    const s = this.s!;
    const id = String(msg.id ?? '');
    if (id.length < 8 || id.length > 64) return this.err(ws, 'Identificador inválido.');
    const name = cleanName(msg.name);
    const inLobby = s.lobby.find((p) => p.id === id);
    const inGame = s.game?.players.find((p) => p.id === id);

    if (s.phase === 'lobby') {
      if (!inLobby) {
        if (s.lobby.length >= MAX_ROOM_PLAYERS) {
          this.err(ws, 'Sala cheia.');
          return void ws.close(4003, 'full');
        }
        s.lobby.push({ id, name });
        const used = new Set(Object.values(s.seats));
        s.seats[id] = SEAT_PREFERENCE.find((x) => !used.has(x)) ?? 0;
        if (!s.hostId) s.hostId = id;
      } else {
        inLobby.name = name;
      }
    } else if (!inGame || inGame.left) {
      this.err(ws, s.phase === 'ended' ? 'Esta partida já terminou.' : 'A partida já começou.');
      return void ws.close(4003, 'started');
    }

    const old = this.online().get(id);
    ws.serializeAttachment({ id });
    if (old && old !== ws) {
      this.send(old, { t: 'kicked' });
      old.close(4000, 'replaced');
    }
    if (inGame) {
      inGame.connected = true;
      inGame.name = name;
    }
    if (validPhoto(msg.photo)) {
      this.photos[id] = msg.photo;
      await this.ctx.storage.put('photos', this.photos);
      for (const [oid, ows] of this.online()) if (oid !== id) this.send(ows, { t: 'photo', id, data: msg.photo });
    }
    for (const [pid, data] of Object.entries(this.photos)) if (pid !== id) this.send(ws, { t: 'photo', id: pid, data });
    await this.persist();
    this.broadcast();
    await this.listing();
  }

  private async onDisconnect(id: string): Promise<void> {
    const s = this.s;
    if (!s) return;
    delete s.media[id];
    if (s.phase === 'lobby') {
      await this.dropPlayer(id);
      return;
    }
    const gp = s.game?.players.find((p) => p.id === id);
    if (gp) gp.connected = false;
    // era a vez de quem caiu: o prazo encurta para ele não travar a mesa
    if (s.phase === 'playing' && s.game && currentPlayer(s.game).id === id && s.turnEndsAt) {
      const limit = Date.now() + OFFLINE_TURN_SECONDS * 1000;
      if (s.turnEndsAt > limit) {
        s.turnEndsAt = limit;
        await this.ctx.storage.setAlarm(limit);
      }
    }
    if (s.hostId === id) s.hostId = s.game?.players.find((p) => !p.left && !p.isBot && p.connected)?.id ?? s.hostId;
    if (this.online().size === 0 && s.phase === 'ended') return this.destroy();
    await this.persist();
    this.broadcast();
  }

  /** Tira o jogador da sala (saguão) ou da partida (leva +50 pontos). */
  private async dropPlayer(id: string): Promise<void> {
    const s = this.s;
    if (!s) return;
    delete s.media[id];
    if (s.phase === 'lobby') {
      s.lobby = s.lobby.filter((p) => p.id !== id);
      delete s.seats[id];
      delete s.bots[id];
      delete this.photos[id];
      if (s.hostId === id) s.hostId = s.lobby.find((p) => !s.bots[p.id])?.id ?? '';
      if (!s.lobby.some((p) => !s.bots[p.id])) return this.destroy();
      await this.ctx.storage.put('photos', this.photos);
      await this.persist();
      this.broadcast();
      await this.listing();
      return;
    }
    if (s.phase === 'playing' && s.game) {
      if (s.hostId === id) s.hostId = s.game.players.find((p) => !p.left && !p.isBot && p.id !== id && this.online().has(p.id))?.id ?? s.hostId;
      await this.afterGameChange(removePlayer(s.game, id));
    }
  }

  private async afterGameChange(g: GameState): Promise<void> {
    const s = this.s!;
    s.game = g;
    if (g.phase === 'ended') {
      s.phase = 'ended';
      s.turnEndsAt = null;
      await this.ctx.storage.deleteAlarm();
      await this.record(g);
      await this.listing();
    } else {
      const cur = currentPlayer(g);
      if (cur.isBot) {
        s.botAt = Date.now() + 1500 + Math.floor(Math.random() * 1500);
        s.turnEndsAt = s.botAt;
        await this.ctx.storage.setAlarm(s.botAt);
        await this.listing();
        await this.persist();
        this.broadcast();
        return;
      }
      s.botAt = null;
      const secs = cur.connected ? s.turnSeconds : Math.min(s.turnSeconds, OFFLINE_TURN_SECONDS);
      s.turnEndsAt = Date.now() + secs * 1000;
      await this.ctx.storage.setAlarm(s.turnEndsAt);
      await this.listing();
    }
    await this.persist();
    this.broadcast();
  }

  private async record(g: GameState): Promise<void> {
    const s = this.s!;
    if (s.recorded || !g.result) return;
    s.recorded = true;
    // anti-farm: partidas relâmpago (alguém saiu logo no começo) não entram no ranking
    if (g.turnNo < g.players.length * 3 && g.result.reason !== 'empty') return;
    const entries: RecordEntry[] = g.players.filter((p) => !p.isBot).map((p) => ({ id: p.id, name: p.name, points: g.result!.points[p.id] ?? 0, won: g.result!.winners.includes(p.id) }));
    try {
      await this.env.RANKING.get(this.env.RANKING.idFromName('global')).fetch('https://ranking/record', { method: 'POST', body: JSON.stringify(entries) });
    } catch {
      /* ranking é best-effort */
    }
  }

  async alarm(): Promise<void> {
    await this.loaded;
    const s = this.s;
    if (!s) return;
    if (s.phase === 'lobby') {
      if (s.lobby.length === 0) await this.destroy();
      return;
    }
    if (s.phase !== 'playing' || !s.game) return;
    if (currentPlayer(s.game).isBot) {
      const at = s.botAt ?? 0;
      if (Date.now() < at - 100) {
        await this.ctx.storage.setAlarm(at);
        return;
      }
      return this.botTurn();
    }
    if (Date.now() < (s.turnEndsAt ?? 0) - 100) {
      await this.ctx.storage.setAlarm(s.turnEndsAt!);
      return;
    }
    const cur = currentPlayer(s.game);
    const step = drawTurn(s.game, cur.id, true);
    if (!step.ok) return;
    let g = step.state;
    if (g.players.find((p) => p.id === cur.id)!.timeouts >= MAX_TIMEOUTS) g = removePlayer(g, cur.id);
    await this.afterGameChange(g);
  }

  private async botTurn(): Promise<void> {
    const s = this.s!;
    const g = s.game!;
    const cur = currentPlayer(g);
    const table = botMove(g, s.bots[cur.id] ?? 'normal');
    let step = table ? playTurn(g, cur.id, table) : null;
    if (!step || !step.ok) step = drawTurn(g, cur.id);
    if (step.ok) await this.afterGameChange(step.state);
  }
}
