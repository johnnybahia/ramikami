// Teste do log de partidas. Rode: npx wrangler dev -c server/wrangler.toml --var ADMIN_KEY:testkey  e depois  node scripts/e2e-gamelog.mjs
const BASE = process.env.BASE ?? 'http://localhost:8787';
const KEY = 'testkey';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const api = (path, init = {}, key = KEY) => fetch(`${BASE}${path}`, { ...init, headers: { ...(key ? { 'X-Admin-Key': key } : {}), ...(init.headers ?? {}) } });

class Client {
  constructor(code, id, name, nolog) {
    this.state = null;
    this.ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/${code}`);
    this.ws.onopen = () => this.send({ t: 'join', id, name, nolog });
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') this.state = m; };
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (this.state && fn(this.state)) return true; await sleep(30); } return false; }
}

/** Sala com 1 humano + 1 bot Fácil; o humano compra nas suas vezes `draws` vezes e sai. */
async function playOne(id, name, nolog, draws) {
  const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnSeconds: 60, isPublic: false }) })).json();
  const c = new Client(code, id, name, nolog);
  await c.until((s) => s.players.length === 1);
  c.send({ t: 'bots', count: 1, level: 'easy' });
  await c.until((s) => s.players.length === 2);
  c.send({ t: 'start' });
  await c.until((s) => s.phase === 'playing');
  let n = 0;
  while (n < draws) {
    if (!(await c.until((s) => s.phase === 'playing' && s.turnId === id, 60000))) break;
    c.send({ t: 'draw' });
    n++;
    await sleep(200);
  }
  c.send({ t: 'leave' });
  await c.until((s) => s.phase === 'ended', 8000);
  await sleep(400);
  return n;
}

const noKey = await api('/api/games', {}, '');
ok(noKey.status === 401, 'baixar o log sem a chave é recusado');
ok((await api('/api/stats', {}, 'errada')).status === 401, 'estatísticas com a chave errada são recusadas');
await api('/api/games/clear', { method: 'POST' });

const HUMAN = 'player-aaaaaaaa';
const drew = await playOne(HUMAN, 'Nome Secreto', false, 2);
ok(drew === 2, `o humano comprou 2 vezes (${drew})`);
const res = await api('/api/games?after=0&limit=10');
ok(res.status === 200 && (res.headers.get('content-type') ?? '').includes('ndjson'), 'GET /api/games devolve NDJSON');
const lines = (await res.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
ok(lines.length === 1, `1 partida registrada (${lines.length})`);
const g = lines[0];
ok(g.summary.partial === true && g.summary.reason === 'left', 'resumo: partida interrompida (humano saiu)');
ok(g.summary.humans === 1 && g.summary.levels === 'easy' && g.summary.players === 2, 'resumo: 1 humano contra 1 bot fácil');
const lg = g.log;
ok(lg && lg.v === 1 && lg.players.length === 2, 'registro completo presente');
ok(lg.players.filter((p) => p.kind === 'h').length === 1 && lg.players.some((p) => p.kind === 'b' && p.level === 'easy'), 'jogadores: humano e bot fácil');
ok(lg.deal.racks.length === 2 && lg.deal.racks.every((r) => r.length === 14) && lg.deal.pool.length === 106 - 28, 'mãos iniciais (14) e ordem do pote (78)');
const humanSeat = lg.players.find((p) => p.kind === 'h').seat;
ok(lg.turns.filter((t) => t.s === humanSeat && t.a === 'd').length === 2, 'as duas compras do humano estão no registro');
ok(lg.turns.some((t) => t.a === 'l' && t.s === humanSeat), 'a saída do humano está no registro');
ok(lg.turns.every((t) => Array.isArray(t.rk) && Array.isArray(t.rs) && typeof t.pool === 'number'), 'cada linha traz cavalete antes, tamanhos e pote');
const raw = JSON.stringify(g);
ok(!/Nome Secreto|player-aaaaaaaa/.test(raw), 'anônimo: nem nome nem identificador no registro');
const st = await (await api('/api/stats')).json();
ok(st.partidas === 1 && st.interrompidas === 1, 'GET /api/stats conta a partida (interrompida)');

await playOne('player-bbbbbbbb', 'Quem Não Quer', true, 1);
const again = (await (await api('/api/games?after=0&limit=10')).text()).trim().split('\n').filter(Boolean);
ok(again.length === 1, 'quem pediu para não guardar não gera registro (ainda 1 partida)');

if (!process.env.KEEP) {
  ok((await api('/api/games/clear', { method: 'POST' })).status === 200, 'apagar o log (administrador)');
  ok(((await (await api('/api/stats')).json()).partidas) === 0, 'log vazio depois de apagar');
}
setTimeout(() => process.exit(process.exitCode ?? 0), 100);
