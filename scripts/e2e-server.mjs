// Teste de ponta a ponta do servidor (2 clientes WebSocket). Rode `npm run server:dev` e depois `node scripts/e2e-server.mjs`.
const BASE = process.env.BASE ?? "http://localhost:8787";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };

class Client {
  constructor(code, id, name, photo) {
    this.id = id; this.state = null; this.errors = []; this.rtc = []; this.photos = [];
    this.ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/ws/${code}`);
    this.ws.onopen = () => this.send({ t: 'join', id, name, photo });
    this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') this.state = m; else if (m.t === 'error') this.errors.push(m.msg); else if (m.t === 'rtc') this.rtc.push(m); else if (m.t === 'photo') this.photos.push(m); else if (m.t === 'kicked') this.kicked = true; };
    this.closed = new Promise((r) => (this.ws.onclose = (e) => r(e.code)));
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  async until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (this.state && fn(this.state)) return true; await sleep(30); } return false; }
}

const create = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnSeconds: 120, isPublic: true }) })).json();
const code = create.code;
ok(/^[A-Z0-9]{5}$/.test(code), `sala criada ${code}`);
const tiny = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
const A = new Client(code, 'player-aaaaaaaa', 'Ana', tiny);
await sleep(250);
const B = new Client(code, 'player-bbbbbbbb', 'Beto');
ok(await A.until((s) => s.players.length === 2), '2 jogadores no saguão');
ok(A.state.hostId === 'player-aaaaaaaa', 'primeiro a entrar é o anfitrião');
const seats = A.state.players.map((p) => p.seat).sort();
ok(seats.join() === '0,1', `ordem sorteada ocupa as posições 0 e 1 (${seats})`);
ok(B.photos.some((p) => p.id === 'player-aaaaaaaa'), 'B recebeu a foto de A');
const list = await (await fetch(`${BASE}/api/rooms`)).json();
ok(list.some((r) => r.code === code && r.count === 2), 'sala pública listada');

const seatOf = (id) => A.state.players.find((p) => p.id === id).seat;
const aId = 'player-aaaaaaaa';
const bId = 'player-bbbbbbbb';
const [a0, b0] = [seatOf(aId), seatOf(bId)];
ok(A.state.orderLocked === false, 'ordem começa sorteada (não travada)');
B.send({ t: 'seat', id: bId, seat: a0 });
await sleep(200);
ok(seatOf(bId) === b0, 'não-anfitrião não muda a ordem');
A.send({ t: 'seat', id: bId, seat: a0 });
ok(await A.until((s) => s.players.find((p) => p.id === bId).seat === a0 && s.players.find((p) => p.id === aId).seat === b0 && s.orderLocked), 'anfitrião troca a ordem e ela fica travada');
A.send({ t: 'shuffle' });
ok(await A.until((s) => s.orderLocked === false), 'anfitrião pode sortear de novo');
A.send({ t: 'settings', turnSeconds: 60 });
ok(await B.until((s) => s.turnSeconds === 60), 'anfitrião muda tempo para 60s');
A.send({ t: 'settings', turnSeconds: 120 });
await B.until((s) => s.turnSeconds === 120);

B.send({ t: 'media', cam: true, mic: false });
ok(await A.until((s) => s.players.find((p) => p.id === 'player-bbbbbbbb').cam === true), 'estado de câmera de B chega para A');
A.send({ t: 'rtc', to: 'player-bbbbbbbb', data: { description: { type: 'offer', sdp: 'x' } } });
await sleep(250);
ok(B.rtc.length === 1 && B.rtc[0].from === 'player-aaaaaaaa', 'sinal WebRTC encaminhado A -> B');

B.send({ t: 'start' });
await sleep(200);
ok(A.state.phase === 'lobby', 'não-anfitrião não inicia');
A.send({ t: 'start' });
ok(await A.until((s) => s.phase === 'playing'), 'partida iniciada');
ok(A.state.rack.length === 14 && B.state.rack.length === 14, 'cada um recebe 14 pedras');
ok(A.state.rack.every((t) => !B.state.rack.includes(t)), 'cavaletes distintos');
ok(A.state.players.every((p) => p.rackCount === 14), 'contagem de pedras pública');
ok(!JSON.stringify(A.state).includes(JSON.stringify(B.state.rack)), 'cavalete do oponente não vaza no estado de A');
ok(A.state.turnEndsAt - A.state.serverNow > 118000, 'prazo do turno ~120s definido pelo servidor');
ok(A.state.players.every((p, i, arr) => i === 0 || arr[i - 1].seat < p.seat), 'ordem do jogo segue a sequência definida');

const cur = () => (A.state.turnId === A.id ? A : B);
const other = () => (A.state.turnId === A.id ? B : A);
other().send({ t: 'draw' });
await sleep(200);
ok(other().errors.includes('não é a sua vez'), 'compra fora da vez recusada');
cur().send({ t: 'submit', table: [{ id: 1, tiles: [0, 1], x: 0, z: 0 }] });
await sleep(200);
ok(cur().errors.length > 0, `mesa inválida recusada (${cur().errors.at(-1)})`);
const o = other().state.rack;
cur().send({ t: 'submit', table: [{ id: 1, tiles: [o[0], o[1], o[2]], x: 0, z: 0 }] });
await sleep(200);
ok(A.state.table.length === 0, 'pedras alheias não entram na mesa');

const first = cur();
const n0 = first.state.rack.length;
first.send({ t: 'draw' });
ok(await A.until((s) => s.turnId !== first.id), 'comprar passa a vez');
ok(first.state.rack.length === n0 + 1 && A.state.poolCount === 78 - 1, 'cavalete +1 e pote -1');

for (let i = 0; i < 8; i++) { const c = cur(); const t = c.state.turnNo; c.send({ t: 'draw' }); await c.until((s) => s.turnNo > t); }
ok(A.state.turnNo >= 9, `turnos corridos (${A.state.turnNo})`);

// desconexão do jogador da vez: o turno dele expira em ~8s e compra sozinho
const dropper = cur();
const stay = other();
const tNo = stay.state.turnNo;
dropper.ws.close();
await dropper.closed;
ok(await stay.until((s) => s.players.find((p) => p.id === dropper.id).connected === false), 'desconexão marcada');
ok(await stay.until((s) => s.turnNo > tNo, 12000), 'turno do jogador offline expira em ~8s e compra automaticamente');

const R = new Client(code, dropper.id, dropper.id === A.id ? 'Ana' : 'Beto');
ok(await R.until((s) => s.phase === 'playing' && s.rack.length >= 14), 'reconexão recupera o cavalete');
const X = new Client(code, 'player-intruso1', 'Intruso');
ok((await X.closed) === 4003, 'estranho não entra em partida em andamento');

R.send({ t: 'leave' });
ok(await stay.until((s) => s.phase === 'ended'), 'ao sair, a partida termina');
ok(stay.state.result.winners.join() === stay.id, 'o jogador que ficou vence');
ok(stay.state.result.points[R.id] >= 50, 'quem saiu leva +50 pontos');
await sleep(600);
const rank = await (await fetch(`${BASE}/api/ranking`)).json();
ok(rank.length === 2, `ranking com 2 jogadores ${JSON.stringify(rank.map((r) => [r.name, r.games, r.avg, r.wins]))}`);
ok(rank[0].wins === 1, 'primeiro do ranking é quem venceu (menos pontos)');
process.exit(process.exitCode ?? 0);
