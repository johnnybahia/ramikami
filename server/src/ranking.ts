import type { RankingRow } from '../../shared/protocol';
import { GM_TITLE_WINS } from '../../shared/progress';

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
    if (req.method === 'POST' && url.pathname === '/reset') {
      this.sql.exec('DELETE FROM players');
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }
}
