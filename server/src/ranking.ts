import type { RankingRow } from '../../shared/protocol';
import { GM_TITLE_WINS } from '../../shared/progress';
import { summarize, type GameLog } from '../../shared/gamelog';

export interface RecordEntry {
  id: string;
  name: string;
  points: number;
  won: boolean;
}

type Row = {
  id: string;
  name: string;
  games: number;
  wins: number;
  total: number;
  best: number;
};

const MAX_RECORDS = 2000;
const MAX_GAMES = 50000;
const MAX_ERRORS = 300;

type GameRow = { id: number; gid: string; t: number; dur: number; players: number; humans: number; levels: string; human_won: number; turns: number; reason: string; human_pts: number; bot_pts: number; partial: number };

async function gzip(text: string): Promise<ArrayBuffer> {
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
}

async function gunzip(data: ArrayBuffer): Promise<string> {
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

/** Ranking global: quem tem a MENOR média de pontos na mão por partida fica em cima (mínimo de 3 partidas para o ranking principal). */
export class Ranking implements DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState) {
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, games INTEGER NOT NULL, wins INTEGER NOT NULL,
        total INTEGER NOT NULL, best INTEGER NOT NULL, updated INTEGER NOT NULL)`,
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS gm (id TEXT PRIMARY KEY, wins INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS names (id TEXT PRIMARY KEY, norm TEXT NOT NULL UNIQUE, name TEXT NOT NULL)');
    // log de partidas online (anônimo): uma linha de resumo por partida e o registro completo comprimido
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT, gid TEXT NOT NULL, t INTEGER NOT NULL, dur INTEGER NOT NULL, players INTEGER NOT NULL,
        humans INTEGER NOT NULL, levels TEXT NOT NULL, human_won INTEGER NOT NULL, turns INTEGER NOT NULL, reason TEXT NOT NULL,
        human_pts INTEGER NOT NULL, bot_pts INTEGER NOT NULL, partial INTEGER NOT NULL)`,
    );
    this.sql.exec('CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, data BLOB NOT NULL)');
    // erros do servidor das salas (só os últimos 300): sem isso um travamento em produção não deixa rastro
    this.sql.exec('CREATE TABLE IF NOT EXISTS errors (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, w TEXT NOT NULL, msg TEXT NOT NULL, extra TEXT NOT NULL)');
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/record') {
      const entries = (await req.json()) as RecordEntry[];
      for (const e of entries.slice(0, 4)) {
        const name = String(e.name ?? '').slice(0, 16) || 'Jogador';
        const points = Math.max(0, Math.min(999, Math.round(Number(e.points) || 0)));
        this.sql.exec(
          `INSERT INTO players (id, name, games, wins, total, best, updated) VALUES (?, ?, 1, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, games = games + 1, wins = wins + excluded.wins,
             total = total + excluded.total, best = MIN(best, excluded.best), updated = excluded.updated`,
          String(e.id).slice(0, 64),
          name,
          e.won ? 1 : 0,
          points,
          points,
          Date.now(),
        );
      }
      return new Response('ok');
    }
    // título de Grão-mestre: vitórias online contra Grão-mestres, contadas aqui (não dá para forjar pelo aparelho)
    if (req.method === 'POST' && url.pathname === '/gmwin') {
      const b = (await req.json()) as { id?: string };
      const id = String(b.id ?? '').slice(0, 64);
      if (id.length < 8) return Response.json({ wins: 0, title: false }, { status: 400 });
      this.sql.exec('INSERT INTO gm (id, wins) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET wins = wins + 1', id);
      const wins = this.sql.exec<{ wins: number }>('SELECT wins FROM gm WHERE id = ?', id).toArray()[0]?.wins ?? 0;
      return Response.json({ wins, title: wins >= GM_TITLE_WINS });
    }
    if (req.method === 'POST' && url.pathname === '/gmgrant') {
      const b = (await req.json()) as { id?: string; wins?: number };
      const id = String(b.id ?? '').slice(0, 64);
      const wins = Math.max(0, Math.min(1000, Math.floor(Number(b.wins) || 0)));
      if (id.length < 8) return Response.json({ ok: false }, { status: 400 });
      this.sql.exec('INSERT INTO gm (id, wins) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET wins = excluded.wins', id, wins);
      return Response.json({ wins, title: wins >= GM_TITLE_WINS });
    }
    if (req.method === 'GET' && url.pathname === '/title') {
      const id = String(url.searchParams.get('id') ?? '').slice(0, 64);
      const wins = id.length >= 8 ? (this.sql.exec<{ wins: number }>('SELECT wins FROM gm WHERE id = ?', id).toArray()[0]?.wins ?? 0) : 0;
      return Response.json({ wins, title: wins >= GM_TITLE_WINS });
    }
    // reserva de nome: um nome pertence a um id; trocar de nome libera o anterior
    if (req.method === 'POST' && url.pathname === '/claim') {
      const b = (await req.json()) as { id?: string; name?: string };
      const id = String(b.id ?? '').slice(0, 64);
      const name = String(b.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 16);
      const norm = name.toLowerCase();
      if (id.length < 8 || name.length < 2) return Response.json({ ok: false, error: 'inválido' }, { status: 400 });
      const owner = this.sql.exec<{ id: string }>('SELECT id FROM names WHERE norm = ?', norm).toArray()[0];
      if (owner && owner.id !== id) return Response.json({ ok: false, error: 'em uso' }, { status: 409 });
      this.sql.exec('INSERT INTO names (id, norm, name) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET norm = excluded.norm, name = excluded.name', id, norm, name);
      return Response.json({ ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/release') {
      const b = (await req.json()) as { name?: string };
      this.sql.exec('DELETE FROM names WHERE norm = ?', String(b.name ?? '').trim().replace(/\s+/g, ' ').toLowerCase());
      return new Response('ok');
    }
    if (req.method === 'GET' && url.pathname === '/top') {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      const rows = this.sql
        .exec<Row>(
          `SELECT id, name, games, wins, total, best FROM players
           ORDER BY (games < 3), CAST(total AS REAL) / games ASC, wins DESC, games DESC LIMIT ?`,
          limit,
        )
        .toArray();
      const out: RankingRow[] = rows.map((r) => ({ id: r.id, name: r.name, games: r.games, wins: r.wins, avg: Math.round((r.total / r.games) * 10) / 10, best: r.best }));
      return Response.json(out);
    }
    // log de partidas: o servidor da sala manda o registro pronto; guardamos o resumo e o registro comprimido
    if (req.method === 'POST' && url.pathname === '/gamelog') {
      const log = (await req.json().catch(() => null)) as GameLog | null;
      if (!log || !Array.isArray(log.turns) || !Array.isArray(log.players) || typeof log.id !== 'string') return Response.json({ ok: false }, { status: 400 });
      const sm = summarize(log);
      const row = this.sql
        .exec<{ id: number }>(
          `INSERT INTO games (gid, t, dur, players, humans, levels, human_won, turns, reason, human_pts, bot_pts, partial)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          sm.id.slice(0, 16),
          sm.t,
          sm.dur,
          sm.players,
          sm.humans,
          sm.levels,
          sm.humanWon ? 1 : 0,
          sm.turns,
          sm.reason,
          sm.humanPts,
          sm.botPts,
          sm.partial ? 1 : 0,
        )
        .one();
      this.sql.exec('INSERT INTO records (id, data) VALUES (?, ?)', row.id, await gzip(JSON.stringify(log)));
      // limites: os 2.000 registros mais recentes e os 50.000 resumos mais recentes
      this.sql.exec('DELETE FROM records WHERE id <= ?', row.id - MAX_RECORDS);
      this.sql.exec('DELETE FROM games WHERE id <= ?', row.id - MAX_GAMES);
      return Response.json({ ok: true, id: row.id });
    }
    // exporta (NDJSON): uma linha por partida com o resumo e o registro completo, a partir do id `after`
    if (req.method === 'GET' && url.pathname === '/games') {
      const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
      const limit = Math.min(500, Math.max(1, Math.floor(Number(url.searchParams.get('limit')) || 100)));
      const rows = this.sql
        .exec<GameRow & { data: ArrayBuffer | null }>(
          `SELECT g.*, r.data FROM games g LEFT JOIN records r ON r.id = g.id WHERE g.id > ? ORDER BY g.id LIMIT ?`,
          after,
          limit,
        )
        .toArray();
      const lines: string[] = [];
      for (const r of rows) {
        const log = r.data ? JSON.parse(await gunzip(r.data)) : null;
        lines.push(JSON.stringify({ n: r.id, summary: { id: r.gid, t: r.t, dur: r.dur, players: r.players, humans: r.humans, levels: r.levels, humanWon: !!r.human_won, turns: r.turns, reason: r.reason, humanPts: r.human_pts, botPts: r.bot_pts, partial: !!r.partial }, log }));
      }
      return new Response(lines.join('\n') + (lines.length ? '\n' : ''), { headers: { 'content-type': 'application/x-ndjson', 'x-next-after': String(rows.length ? rows[rows.length - 1]!.id : after) } });
    }
    // resumo agregado por combinação de bots (partidas interrompidas ficam fora das taxas)
    if (req.method === 'GET' && url.pathname === '/gamestats') {
      const rows = this.sql
        .exec<{ levels: string; humans: number; games: number; human_wins: number; turns: number; human_pts: number; bot_pts: number; dur: number }>(
          `SELECT levels, humans, COUNT(*) AS games, SUM(human_won) AS human_wins, AVG(turns) AS turns,
                  AVG(NULLIF(human_pts, -1)) AS human_pts, AVG(NULLIF(bot_pts, -1)) AS bot_pts, AVG(dur) AS dur
           FROM games WHERE partial = 0 GROUP BY levels, humans ORDER BY games DESC`,
        )
        .toArray();
      const total = this.sql.exec<{ n: number; p: number }>('SELECT COUNT(*) AS n, COALESCE(SUM(partial), 0) AS p FROM games').one();
      const r1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10);
      return Response.json({
        partidas: total.n,
        interrompidas: total.p,
        porNivel: rows.map((r) => ({ bots: r.levels || '(só humanos)', humanos: r.humans, partidas: r.games, humanoVenceu: r.human_wins, taxaHumano: Math.round((100 * r.human_wins) / r.games), turnosMedios: r1(r.turns), pontosHumano: r1(r.human_pts), pontosBot: r1(r.bot_pts), duracaoMediaS: r1(r.dur) })),
      });
    }
    if (req.method === 'POST' && url.pathname === '/err') {
      const b = (await req.json().catch(() => null)) as { w?: string; msg?: string; extra?: unknown } | null;
      if (!b) return Response.json({ ok: false }, { status: 400 });
      const row = this.sql
        .exec<{ id: number }>('INSERT INTO errors (t, w, msg, extra) VALUES (?, ?, ?, ?) RETURNING id', Date.now(), String(b.w ?? '').slice(0, 40), String(b.msg ?? '').slice(0, 600), JSON.stringify(b.extra ?? null).slice(0, 600))
        .one();
      this.sql.exec('DELETE FROM errors WHERE id <= ?', row.id - MAX_ERRORS);
      return Response.json({ ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/errors') {
      const rows = this.sql.exec<{ id: number; t: number; w: string; msg: string; extra: string }>('SELECT id, t, w, msg, extra FROM errors ORDER BY id DESC LIMIT 100').toArray();
      return Response.json(rows.map((r) => ({ n: r.id, quando: new Date(r.t).toISOString(), onde: r.w, erro: r.msg, detalhe: JSON.parse(r.extra) })));
    }
    if (req.method === 'POST' && url.pathname === '/errorsclear') {
      this.sql.exec('DELETE FROM errors');
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/gamesclear') {
      this.sql.exec('DELETE FROM records');
      this.sql.exec('DELETE FROM games');
      return new Response('ok');
    }
    if (req.method === 'POST' && url.pathname === '/reset') {
      this.sql.exec('DELETE FROM players');
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }
}
