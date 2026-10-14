import type { Env } from './env';
import { TURN_SECONDS_OPTIONS } from '../../shared/protocol';

export { GameRoom } from './room';
export { Lobby } from './lobby';
export { Ranking } from './ranking';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = (): string => Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};
const json = (data: unknown, status = 200): Response => Response.json(data, { status, headers: cors });

/** Compara a chave de administrador sem parar no primeiro caractere diferente. */
const isAdmin = (req: Request, env: Env): boolean => {
  const key = req.headers.get('X-Admin-Key') ?? '';
  const want = env.ADMIN_KEY ?? '';
  if (!want || key.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= key.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
};

async function iceServers(env: Env): Promise<unknown[]> {
  const stun = { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] };
  if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return [stun];
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 6 * 3600 }),
    });
    if (!r.ok) return [stun];
    const data = (await r.json()) as { iceServers?: unknown[] };
    return data.iceServers?.length ? [stun, ...data.iceServers] : [stun];
  } catch {
    return [stun];
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    if (url.pathname.startsWith('/ws/')) {
      const code = url.pathname.slice(4).toUpperCase();
      if (!/^[A-Z0-9]{5}$/.test(code)) return new Response('bad code', { status: 400 });
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(req);
    }

    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      const body = (await req.json().catch(() => ({}))) as { turnSeconds?: number; isPublic?: boolean };
      const turnSeconds = typeof body.turnSeconds === 'number' && (TURN_SECONDS_OPTIONS as readonly number[]).includes(body.turnSeconds) ? body.turnSeconds : 60;
      for (let i = 0; i < 8; i++) {
        const code = newCode();
        const r = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, turnSeconds, isPublic: !!body.isPublic }) });
        if (r.ok) return json({ code });
      }
      return json({ error: 'não foi possível criar a sala' }, 503);
    }

    if (url.pathname === '/api/rooms' && req.method === 'GET') {
      const r = await env.LOBBY.get(env.LOBBY.idFromName('global')).fetch('https://lobby/list');
      return json(await r.json());
    }

    if (url.pathname === '/api/ranking' && req.method === 'GET') {
      const r = await env.RANKING.get(env.RANKING.idFromName('global')).fetch('https://ranking/top?limit=50');
      return json(await r.json());
    }

    if (url.pathname === '/api/title' && req.method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      const r = await env.RANKING.get(env.RANKING.idFromName('global')).fetch(`https://ranking/title?id=${encodeURIComponent(id)}`);
      return json(await r.json());
    }

    // dar (ou tirar) o título de um jogador: curl -X POST -H "X-Admin-Key: <senha>" -d '{"id":"<id do perfil>","wins":10}' https://SEU-SITE/api/title/grant
    if (url.pathname === '/api/title/grant' && req.method === 'POST') {
      const key = req.headers.get('X-Admin-Key') ?? '';
      if (!env.ADMIN_KEY || key.length !== env.ADMIN_KEY.length || key !== env.ADMIN_KEY) return json({ error: 'não autorizado' }, 401);
      const r = await env.RANKING.get(env.RANKING.idFromName('global')).fetch('https://ranking/gmgrant', { method: 'POST', body: await req.text() });
      return json(await r.json(), r.status);
    }

    if (url.pathname === '/api/name/claim' && req.method === 'POST') {
      const r = await env.RANKING.get(env.RANKING.idFromName('global')).fetch('https://ranking/claim', { method: 'POST', body: await req.text() });
      return json(await r.json(), r.status);
    }

    // liberar um nome reservado: curl -X POST -H "X-Admin-Key: <senha>" -d '{"name":"Fulano"}' https://SEU-SITE/api/name/release
    if (url.pathname === '/api/name/release' && req.method === 'POST') {
      const key = req.headers.get('X-Admin-Key') ?? '';
      if (!env.ADMIN_KEY || key.length !== env.ADMIN_KEY.length || key !== env.ADMIN_KEY) return json({ error: 'não autorizado' }, 401);
      await env.RANKING.get(env.RANKING.idFromName('global')).fetch('https://ranking/release', { method: 'POST', body: await req.text() });
      return json({ ok: true });
    }

    // zerar o ranking geral: curl -X POST -H "X-Admin-Key: <senha>" https://SEU-SITE/api/ranking/reset
    if (url.pathname === '/api/ranking/reset' && req.method === 'POST') {
      const key = req.headers.get('X-Admin-Key') ?? '';
      if (!env.ADMIN_KEY || key.length !== env.ADMIN_KEY.length || key !== env.ADMIN_KEY) return json({ error: 'não autorizado' }, 401);
      await env.RANKING.get(env.RANKING.idFromName('global')).fetch('https://ranking/reset', { method: 'POST' });
      return json({ ok: true });
    }

    // log de partidas online (anônimo). Tudo com a chave de administrador:
    //   baixar:   curl -H "X-Admin-Key: <senha>" "https://SEU-SITE/api/games?after=0&limit=200"  (NDJSON; o cabeçalho X-Next-After diz de onde continuar)
    //   resumo:   curl -H "X-Admin-Key: <senha>" https://SEU-SITE/api/stats
    //   apagar:   curl -X POST -H "X-Admin-Key: <senha>" https://SEU-SITE/api/games/clear
    if (url.pathname === '/api/games' && req.method === 'GET') {
      if (!isAdmin(req, env)) return json({ error: 'não autorizado' }, 401);
      const q = new URLSearchParams({ after: url.searchParams.get('after') ?? '0', limit: url.searchParams.get('limit') ?? '100' });
      const r = await env.RANKING.get(env.RANKING.idFromName('global')).fetch(`https://ranking/games?${q}`);
      return new Response(r.body, { status: r.status, headers: { ...cors, 'content-type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Next-After': r.headers.get('x-next-after') ?? '0', 'Access-Control-Expose-Headers': 'X-Next-After' } });
    }
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      if (!isAdmin(req, env)) return json({ error: 'não autorizado' }, 401);
      const r = await env.RANKING.get(env.RANKING.idFromName('global')).fetch('https://ranking/gamestats');
      return Response.json(await r.json(), { headers: { ...cors, 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/games/clear' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'não autorizado' }, 401);
      await env.RANKING.get(env.RANKING.idFromName('global')).fetch('https://ranking/gamesclear', { method: 'POST' });
      return json({ ok: true });
    }

    // erros do servidor das salas (travamentos de bot etc.): curl -H "X-Admin-Key: <senha>" https://SEU-SITE/api/errors
    if (url.pathname === '/api/errors' && req.method === 'GET') {
      if (!isAdmin(req, env)) return json({ error: 'não autorizado' }, 401);
      const r = await env.RANKING.get(env.RANKING.idFromName('global')).fetch('https://ranking/errors');
      return Response.json(await r.json(), { headers: { ...cors, 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/errors/clear' && req.method === 'POST') {
      if (!isAdmin(req, env)) return json({ error: 'não autorizado' }, 401);
      await env.RANKING.get(env.RANKING.idFromName('global')).fetch('https://ranking/errorsclear', { method: 'POST' });
      return json({ ok: true });
    }

    if (url.pathname === '/api/ice' && req.method === 'GET') return json({ iceServers: await iceServers(env) });

    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
