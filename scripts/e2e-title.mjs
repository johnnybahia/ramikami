// Teste do título de Grão-mestre no servidor. Rode: npx wrangler dev -c server/wrangler.toml --var ADMIN_KEY:testkey  e depois  node scripts/e2e-title.mjs
const BASE = process.env.BASE ?? 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const post = (path, body, key) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'X-Admin-Key': key } : {}) }, body: JSON.stringify(body) });
const title = async (id) => (await fetch(`${BASE}/api/title?id=${id}`)).json();

class Client {
  constructor(code, id, name) {
    this.state = null;
    this.ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/${code}`);
    this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'join', id, name }));
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') this.state = m; };
  }
  async until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (this.state && fn(this.state)) return true; await sleep(30); } return false; }
}

const A = 'player-aaaaaaaa', B = 'player-bbbbbbbb';
ok((await post('/api/title/grant', { id: A, wins: 10 }, 'errada')).status === 401, 'conceder título sem a chave certa é recusado');
ok((await post('/api/title/grant', { id: A, wins: 10 }, 'testkey')).status === 200, 'conceder título com a chave');
await post('/api/title/grant', { id: B, wins: 3 }, 'testkey');
let t = await title(A);
ok(t.title === true && t.wins === 10, 'GET /api/title: A tem o título (10 vitórias)');
t = await title(B);
ok(t.title === false && t.wins === 3, 'GET /api/title: B não tem (3/10)');
ok((await title('curto')).title === false, 'id curto não quebra');

const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnSeconds: 120, isPublic: false }) })).json();
const ca = new Client(code, A, 'Ana');
await sleep(250);
const cb = new Client(code, B, 'Beto');
ok(await ca.until((s) => s.players.length === 2), '2 jogadores na sala');
const pa = ca.state.players.find((p) => p.id === A), pb = ca.state.players.find((p) => p.id === B);
ok(pa.title === true, 'a sala mostra o título de A');
ok(!pb.title, 'a sala não mostra título para B');
ok(cb.state.players.find((p) => p.id === A)?.title === true, 'B também vê o título de A');
await post('/api/title/grant', { id: A, wins: 0 }, 'testkey');
ok((await title(A)).title === false, 'título removido pelo administrador');
setTimeout(() => process.exit(process.exitCode ?? 0), 100);
