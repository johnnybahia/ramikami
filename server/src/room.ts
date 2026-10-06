import { BOT_LEVELS, LEVEL_CFG, MAX_BOTS, botMove, pickBots, personaOfBotId, thinkDelayMs, type BotLevel, type LevelCfg } from '../../shared/bot';
import { createGame, currentPlayer, drawTurn, playTurn, removePlayer, salvagePlay, MAX_TIMEOUTS, type GameState } from '../../shared/game';
import type { SetState } from '../../shared/layout';
import {
  MAX_PHOTO_CHARS,
  BEST_OF_OPTIONS,
  BOT_TURN_SECONDS,
  CONFIRM_SECONDS,
  MAX_ROOM_PLAYERS,
  NAME_MAX,
  TURN_SECONDS_OPTIONS,
  type ClientMsg,
  type RoomPlayer,
  type BestOf,
  type RoomView,
  type SeriesRow,
  type SeriesView,
  type ServerMsg,
  type TurnSeconds,
} from '../../shared/protocol';
import type { RecordEntry } from './ranking';
import type { Env } from './env';

interface Series {
  done: number;
  stats: Record<string, SeriesRow>;
  awaiting: { ids: string[]; confirmed: string[]; until: number } | null;
}

interface Stored {
  code: string;
  hostId: string;
  turnSeconds: TurnSeconds;
  bestOf: BestOf;
  /** true depois que o anfitrião mexe na ordem: para de sortear a cada entrada */
  orderLocked: boolean;
  series: Series | null;
  isPublic: boolean;
  phase: 'lobby' | 'playing' | 'ended';
  lobby: { id: string; name: string }[];
  seats: Record<string, number>;
  bots: Record<string, BotLevel>;
  /** jogadores do saguão desconectados: id → quando saem da sala se não voltarem */
  away: Record<string, number>;
  botAt: number | null;
  media: Record<string, { cam: boolean; mic: boolean }>;
  game: GameState | null;
  turnEndsAt: number | null;
  recorded: boolean;
}

const IDLE_ROOM_MS = 10 * 60 * 1000;
/** No saguão, quem perde a conexão (ex.: saiu para mandar o convite) tem este tempo para voltar. */
const LOBBY_GRACE_MS = 5 * 60 * 1000;
const OFFLINE_TURN_SECONDS = 8;
/** Placar na tela depois do fim: a sala some se ninguém continuar. */
const ENDED_IDLE_MS = 30 * 60 * 1000;
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
  /** última mesa em rascunho do jogador da vez (só em memória: se o servidor reiniciar, vale o estado inicial) */
  private draftTable: SetState[] | null = null;
  private loaded: Promise<void>;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.loaded = ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<Stored>('s')) ?? null;
      if (this.s) {
        this.s.bots ??= {};
        this.s.away ??= {};
        this.s.bestOf ??= 3;
        this.s.orderLocked ??= false;
        this.s.series ??= null;
      }
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
      bestOf: s.bestOf,
      orderLocked: s.orderLocked,
      series: this.seriesView(),
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

  /** Ordem das jogadas no saguão: sorteada a cada entrada, até o anfitrião mexer. */
  private assignSeats(): void {
    const s = this.s!;
    const ids = s.lobby.map((p) => p.id);
    if (s.orderLocked) {
      for (const id of ids) {
        if (id in s.seats) continue;
        const used = new Set(Object.values(s.seats));
        s.seats[id] = [0, 1, 2, 3].find((x) => !used.has(x)) ?? 0;
      }
      return;
    }
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    s.seats = {};
    ids.forEach((id, i) => (s.seats[id] = i));
  }

  private seriesView(): SeriesView | undefined {
    const s = this.s!;
    if (!s.series) return undefined;
    const rows = Object.values(s.series.stats).sort((a, b) => b.wins - a.wins || a.points - b.points);
    const over = s.series.done >= s.bestOf;
    const top = rows[0];
    const championIds = over && top ? rows.filter((r) => r.wins === top.wins && r.points === top.points).map((r) => r.id) : [];
    return { bestOf: s.bestOf, done: s.series.done, over, rows, championIds, awaiting: s.series.awaiting };
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
      this.s = { code: body.code, hostId: '', turnSeconds, bestOf: 3, orderLocked: false, series: null, isPublic: !!body.isPublic, phase: 'lobby', lobby: [], seats: {}, bots: {}, away: {}, botAt: null, media: {}, game: null, turnEndsAt: null, recorded: false };
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
        const here = new Set(this.online().keys());
        const ready = s.lobby.filter((p) => s.bots[p.id] || here.has(p.id));
        if (ready.length < 2) return this.err(ws, 'São necessários pelo menos 2 jogadores conectados.');
        const order = [...ready].sort((a, b) => (s.seats[a.id] ?? 0) - (s.seats[b.id] ?? 0));
        s.series = { done: 0, stats: {}, awaiting: null };
        await this.beginGame(order);
        return;
      }
      case 'next': {
        if (me !== s.hostId || s.phase !== 'ended' || !s.series || s.series.done >= s.bestOf) return;
        const ok = await this.continueSeries(false);
        if (!ok) this.err(ws, 'São necessários pelo menos 2 jogadores conectados.');
        return;
      }
      case 'more': {
        if (me !== s.hostId || s.phase !== 'ended' || !s.series || s.series.done < s.bestOf || s.series.awaiting) return;
        await this.askMore();
        return;
      }
      case 'confirm': {
        const aw = s.series?.awaiting;
        if (!aw || s.phase !== 'ended' || !aw.ids.includes(me)) return;
        if (msg.yes) {
          if (!aw.confirmed.includes(me)) aw.confirmed.push(me);
        } else {
          aw.ids = aw.ids.filter((x) => x !== me);
          aw.confirmed = aw.confirmed.filter((x) => x !== me);
          const w = this.online().get(me);
          if (w) {
            this.send(w, { t: 'kicked' });
            w.close(4001, 'declined');
          }
        }
        if (aw.ids.every((id) => aw.confirmed.includes(id))) {
          await this.continueSeries(true);
        } else {
          await this.persist();
          this.broadcast();
        }
        return;
      }
      case 'endSession': {
        if (me !== s.hostId || s.phase !== 'ended') return;
        for (const w of this.online().values()) {
          this.send(w, { t: 'notice', text: 'A sessão foi encerrada pelo anfitrião.' });
          this.send(w, { t: 'kicked' });
        }
        await this.destroy();
        return;
      }
      case 'settings': {
        if (me !== s.hostId || s.phase !== 'lobby') return;
        if (typeof msg.turnSeconds === 'number' && (TURN_SECONDS_OPTIONS as readonly number[]).includes(msg.turnSeconds)) s.turnSeconds = msg.turnSeconds;
        if (msg.bestOf && (BEST_OF_OPTIONS as readonly number[]).includes(msg.bestOf)) s.bestOf = msg.bestOf;
        await this.persist();
        this.broadcast();
        await this.listing();
        return;
      }
      case 'bots': {
        if (me !== s.hostId || s.phase !== 'lobby') return;
        if (!BOT_LEVELS.includes(msg.level)) return;
        const humans = s.lobby.filter((p) => !s.bots[p.id]);
        const want = Math.round(Number(msg.count)) || 0;
        const count = Math.max(0, Math.min(MAX_BOTS, want, MAX_ROOM_PLAYERS - humans.length));
        for (const p of s.lobby) if (s.bots[p.id]) delete s.seats[p.id];
        s.bots = {};
        s.lobby = humans;
        for (const persona of pickBots(msg.level, count)) {
          s.lobby.push({ id: persona.id, name: persona.name });
          s.bots[persona.id] = persona.level;
        }
        this.assignSeats();
        await this.persist();
        this.broadcast();
        await this.listing();
        return;
      }
      case 'shuffle': {
        if (me !== s.hostId || s.phase !== 'lobby') return;
        s.orderLocked = false;
        this.assignSeats();
        await this.persist();
        this.broadcast();
        return;
      }
      case 'seat': {
        if (me !== s.hostId || s.phase === 'ended') return;
        const seat = Math.round(Number(msg.seat));
        if (!(seat >= 0 && seat <= 3) || !(msg.id in s.seats)) return;
        const other = Object.keys(s.seats).find((id) => id !== msg.id && s.seats[id] === seat);
        if (other) s.seats[other] = s.seats[msg.id]!;
        s.seats[msg.id] = seat;
        s.orderLocked = true;
        await this.persist();
        this.broadcast();
        return;
      }
      case 'submit': {
        if (s.phase === 'ended') {
      const aw = s.series?.awaiting;
      if (aw && Date.now() >= aw.until - 100) {
        // quem não respondeu no prazo conta como "não"
        aw.ids = aw.ids.filter((id) => aw.confirmed.includes(id));
        await this.continueSeries(true);
      } else if (aw) {
        await this.ctx.storage.setAlarm(aw.until);
      } else {
        await this.destroy();
      }
      return;
    }
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
        this.draftTable = table;
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
          const bot = [...s.lobby].reverse().find((p) => s.bots[p.id]);
          if (bot) {
            s.lobby = s.lobby.filter((p) => p.id !== bot.id);
            delete s.bots[bot.id];
            delete s.seats[bot.id];
          }
        }
        if (s.lobby.length >= MAX_ROOM_PLAYERS) {
          this.err(ws, 'Sala cheia.');
          return void ws.close(4003, 'full');
        }
        s.lobby.push({ id, name });
        this.assignSeats();
        if (!s.hostId) s.hostId = id;
      } else {
        inLobby.name = name;
      }
    } else if (!inGame || inGame.left) {
      this.err(ws, s.phase === 'ended' ? 'Esta partida já terminou.' : 'A partida já começou.');
      return void ws.close(4003, 'started');
    }

    delete s.away[id];
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
      // não derruba a sala: o jogador pode ter só trocado de app para mandar o convite
      s.away[id] = Date.now() + LOBBY_GRACE_MS;
      await this.persist();
      this.broadcast();
      await this.scheduleLobbyAlarm();
      return;
    }
    const gp = s.game?.players.find((p) => p.id === id);
    if (gp) gp.connected = false;
    // era a vez de quem caiu: o prazo encurta para ele não travar a mesa
    if (s.phase === 'playing' && s.game && currentPlayer(s.game).id === id) {
      const limit = Date.now() + OFFLINE_TURN_SECONDS * 1000;
      if (!s.turnEndsAt || s.turnEndsAt > limit) {
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
      delete s.away[id];
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
    this.draftTable = null;
    if (g.phase === 'ended') {
      s.phase = 'ended';
      s.turnEndsAt = null;
      if (s.series) s.series.awaiting = null;
      await this.ctx.storage.setAlarm(Date.now() + ENDED_IDLE_MS);
      await this.record(g);
      await this.listing();
    } else {
      const cur = currentPlayer(g);
      if (cur.isBot) {
        // o bot "pensa" uma parte do tempo do turno; o relógio mostrado é o do turno inteiro, como para humanos
        s.botAt = Date.now() + thinkDelayMs(this.botCfg(cur.id), BOT_TURN_SECONDS);
        s.turnEndsAt = Date.now() + BOT_TURN_SECONDS * 1000;
        await this.ctx.storage.setAlarm(s.botAt);
        await this.listing();
        await this.persist();
        this.broadcast();
        return;
      }
      s.botAt = null;
      const secs = cur.connected ? s.turnSeconds : s.turnSeconds === 0 ? OFFLINE_TURN_SECONDS : Math.min(s.turnSeconds, OFFLINE_TURN_SECONDS);
      if (secs === 0) {
        // sem limite de tempo para humanos conectados
        s.turnEndsAt = null;
        await this.ctx.storage.deleteAlarm();
      } else {
        s.turnEndsAt = Date.now() + secs * 1000;
        await this.ctx.storage.setAlarm(s.turnEndsAt);
      }
      await this.listing();
    }
    await this.persist();
    this.broadcast();
  }

  private async record(g: GameState): Promise<void> {
    const s = this.s!;
    if (s.recorded || !g.result) return;
    s.recorded = true;
    if (s.series) {
      s.series.done++;
      for (const p of g.players) {
        const row = (s.series.stats[p.id] ??= { id: p.id, name: p.name, wins: 0, points: 0, games: 0 });
        row.name = p.name;
        row.games++;
        row.points += g.result.points[p.id] ?? 0;
        if (g.result.winners.includes(p.id)) row.wins++;
      }
    }
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
      const now = Date.now();
      const gone = Object.entries(s.away).filter(([, at]) => at <= now).map(([id]) => id);
      for (const id of gone) {
        delete s.away[id];
        if (this.s) await this.dropPlayer(id);
        if (!this.s) return;
      }
      if (s.lobby.length === 0) return this.destroy();
      await this.scheduleLobbyAlarm();
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
    if (s.turnEndsAt === null) return; // sem limite de tempo: nada a fazer
    if (Date.now() < s.turnEndsAt - 100) {
      await this.ctx.storage.setAlarm(s.turnEndsAt);
      return;
    }
    const cur = currentPlayer(s.game);
    // tempo esgotado: ficam só os conjuntos feitos inteiramente com pedras da mão; o resto volta ao início do turno
    const kept = this.draftTable ? salvagePlay(s.game, cur.id, this.draftTable) : null;
    if (kept) {
      const ws = this.online().get(cur.id);
      if (ws) this.send(ws, { t: 'notice', text: 'Tempo esgotado: ficaram na mesa só os conjuntos montados com pedras da sua mão. O resto voltou ao início da jogada.' });
      await this.afterGameChange(kept);
      return;
    }
    const step = drawTurn(s.game, cur.id, true);
    if (!step.ok) return;
    let g = step.state;
    if (g.players.find((p) => p.id === cur.id)!.timeouts >= MAX_TIMEOUTS) g = removePlayer(g, cur.id);
    await this.afterGameChange(g);
  }

  /** Começa uma partida com estes jogadores (do saguão ou da sessão em andamento). */
  private async beginGame(order: { id: string; name: string }[]): Promise<void> {
    const s = this.s!;
    s.game = createGame(order.map((p) => ({ id: p.id, name: p.name, isBot: !!s.bots[p.id] })), Math.random);
    s.phase = 'playing';
    s.recorded = false;
    await this.afterGameChange(s.game);
  }

  /** Quem segue na próxima partida: bots + humanos conectados que ainda não saíram (e, se `onlyConfirmed`, os que aceitaram). */
  private async continueSeries(onlyConfirmed: boolean): Promise<boolean> {
    const s = this.s!;
    const g = s.game;
    if (!g || !s.series) return false;
    const here = new Set(this.online().keys());
    const confirmed = new Set(s.series.awaiting?.confirmed ?? []);
    const stay = g.players.filter((p) => !p.left && (p.isBot || (here.has(p.id) && (!onlyConfirmed || confirmed.has(p.id)))));
    if (stay.filter((p) => !p.isBot).length < 1 || stay.length < 2) {
      if (onlyConfirmed) await this.finishSession('Sessão encerrada: não há jogadores suficientes para continuar.');
      return false;
    }
    // quem não segue sai da sala (o placar dele já ficou registrado na sessão)
    const stayIds = new Set(stay.map((p) => p.id));
    for (const p of g.players) {
      if (stayIds.has(p.id)) continue;
      s.lobby = s.lobby.filter((x) => x.id !== p.id);
      delete s.seats[p.id];
      delete s.bots[p.id];
      delete this.photos[p.id];
      const w = this.online().get(p.id);
      if (w) {
        this.send(w, { t: 'kicked' });
        w.close(4001, 'not continuing');
      }
    }
    s.series.awaiting = null;
    if (!stayIds.has(s.hostId)) s.hostId = stay.find((p) => !p.isBot)?.id ?? s.hostId;
    const order = [...stay].sort((a, b) => (s.seats[a.id] ?? 0) - (s.seats[b.id] ?? 0));
    await this.beginGame(order);
    return true;
  }

  private async askMore(): Promise<void> {
    const s = this.s!;
    const g = s.game;
    if (!g || !s.series) return;
    const humans = g.players.filter((p) => !p.isBot && !p.left).map((p) => p.id);
    s.series.awaiting = { ids: humans, confirmed: [s.hostId], until: Date.now() + CONFIRM_SECONDS * 1000 };
    await this.ctx.storage.setAlarm(s.series.awaiting.until);
    if (humans.every((id) => s.series!.awaiting!.confirmed.includes(id))) return void (await this.continueSeries(true));
    await this.persist();
    this.broadcast();
  }

  private async finishSession(text: string): Promise<void> {
    for (const w of this.online().values()) {
      this.send(w, { t: 'notice', text });
      this.send(w, { t: 'kicked' });
    }
    await this.destroy();
  }

  private botCfg(id: string): LevelCfg {
    const lvl = this.s?.bots[id];
    return LEVEL_CFG[lvl ?? personaOfBotId(id)?.level ?? 'normal'];
  }

  private async scheduleLobbyAlarm(): Promise<void> {
    const s = this.s;
    if (!s) return;
    const next = Math.min(Date.now() + IDLE_ROOM_MS, ...Object.values(s.away));
    await this.ctx.storage.setAlarm(next);
  }

  private async botTurn(): Promise<void> {
    const s = this.s!;
    const g = s.game!;
    const cur = currentPlayer(g);
    const persona = this.botCfg(cur.id);
    const table = botMove(g, persona);
    let step = table ? playTurn(g, cur.id, table) : null;
    const played = !!step && step.ok;
    if (!step || !step.ok) step = drawTurn(g, cur.id);
    if (!step.ok) return;
    if (Math.random() < 0.4) {
      const pool = played ? persona.lines.play : persona.lines.draw;
      const text = pool[Math.floor(Math.random() * pool.length)]!;
      for (const ws of this.online().values()) this.send(ws, { t: 'say', id: cur.id, text });
    }
    await this.afterGameChange(step.state);
  }
}
