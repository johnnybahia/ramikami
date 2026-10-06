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
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (data: unknown, status = 200): Response => Response.json(data, { status, headers: cors });

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
      const turnSeconds = (TURN_SECONDS_OPTIONS as readonly number[]).includes(body.turnSeconds ?? 0) ? body.turnSeconds! : 60;
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

    if (url.pathname === '/api/ice' && req.method === 'GET') return json({ iceServers: await iceServers(env) });

    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
