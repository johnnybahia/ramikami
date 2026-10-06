// Teste de ponta a ponta da sessão "melhor de N". Rode `npm run server:dev` e depois `node scripts/e2e-series.mjs`.
const BASE = process.env.BASE ?? 'http://localhost:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };

class Client {
  constructor(code, id, name) {
    this.id = id; this.state = null; this.errors = []; this.kicked = false; this.notices = [];
    this.ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/${code}`);
    this.ws.onopen = () => this.send({ t: 'join', id, name });
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') this.state = m; else if (m.t === 'error') this.errors.push(m.msg); else if (m.t === 'kicked') this.kicked = true; else if (m.t === 'notice') this.notices.push(m.text); };
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async until(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (this.state && fn(this.state)) return true; await sleep(25); } return false; }
}

const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnSeconds: 60, isPublic: false }) })).json();
const A = new Client(code, 'player-aaaaaaaa', 'Ana');
await sleep(250);
const B = new Client(code, 'player-bbbbbbbb', 'Beto');
ok(await A.until((s) => s.players.length === 2), 'dois jogadores no saguão');
ok(A.state.bestOf === 3, 'padrão: melhor de 3');
B.send({ t: 'settings', bestOf: 5 });
await sleep(150);
ok(A.state.bestOf === 3, 'só o anfitrião muda o melhor de');
A.send({ t: 'settings', bestOf: 5 });
ok(await B.until((s) => s.bestOf === 5), 'anfitrião muda para melhor de 5');
A.send({ t: 'settings', bestOf: 3 });
await B.until((s) => s.bestOf === 3);

// termina a partida comprando até o pote acabar e todos passarem
async function playOut() {
  for (let i = 0; i < 400 && A.state.phase === 'playing'; i++) {
    const c = A.state.turnId === A.id ? A : B;
    const t = c.state.turnNo;
    c.send({ t: 'draw' });
    await c.until((s) => s.turnNo > t || s.phase !== 'playing', 3000);
  }
  return A.until((s) => s.phase === 'ended', 5000);
}

A.send({ t: 'start' });
ok(await A.until((s) => s.phase === 'playing'), 'partida 1 iniciada');
ok(A.state.series?.done === 0 && A.state.series.bestOf === 3, 'série criada, 0 partidas concluídas');
ok(await playOut(), 'partida 1 terminou');
ok(A.state.series.done === 1 && A.state.series.rows.length === 2, 'placar registra a partida 1');
B.send({ t: 'next' });
await sleep(200);
ok(A.state.phase === 'ended', 'só o anfitrião inicia a próxima partida');
const w1 = A.state.result.winners;
A.send({ t: 'next' });
ok(await A.until((s) => s.phase === 'playing' && s.series.done === 1), 'partida 2 iniciada, placar mantido');
ok(w1.includes(A.state.turnId), `quem venceu a partida 1 começa a 2 (${w1.join()} → ${A.state.turnId})`);
ok(await playOut(), 'partida 2 terminou');
const w2 = A.state.result.winners;
A.send({ t: 'next' });
ok(await A.until((s) => s.phase === 'playing' && s.series.done === 2), 'partida 3 iniciada');
ok(w2.includes(A.state.turnId), 'quem venceu a partida 2 começa a 3');
ok(await playOut(), 'partida 3 terminou');
ok(A.state.series.done === 3 && A.state.series.over, 'sessão concluída (3 de 3)');
const rows = A.state.series.rows;
ok(rows.reduce((a, r) => a + r.wins, 0) >= 3, `vitórias somadas no placar ${JSON.stringify(rows.map((r) => [r.name, r.wins, r.points]))}`);
ok(A.state.series.championIds.length >= 1, 'campeão definido');
A.send({ t: 'next' });
await sleep(200);
ok(A.state.phase === 'ended', 'não há "próxima" depois da última combinada');

A.send({ t: 'more' });
ok(await B.until((s) => !!s.series.awaiting && s.series.awaiting.ids.includes(B.id)), 'jogador recebe o pedido de "jogar mais uma"');
B.send({ t: 'confirm', yes: true });
ok(await A.until((s) => s.phase === 'playing' && s.series.done === 3), 'com a confirmação, a partida extra começa e o placar continua');
ok(await playOut(), 'partida extra terminou');
ok(A.state.series.done === 4 && A.state.series.rows.every((r) => r.games === 4), 'placar acumulou 4 partidas');

A.send({ t: 'more' });
ok(await B.until((s) => !!s.series.awaiting && s.series.awaiting.ids.includes(B.id)), 'segundo pedido de "mais uma" chega');
B.send({ t: 'confirm', yes: false });
await sleep(400);
ok(B.kicked, 'quem recusa sai da sessão');
ok(A.kicked, 'sem jogadores suficientes, a sessão encerra');
process.exit(process.exitCode ?? 0);
