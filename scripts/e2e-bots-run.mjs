// Humano + N bots de um nível jogam algumas rodadas na sala real (wrangler dev): o humano só compra; confere que a mesa não trava.
//   npx wrangler dev -c server/wrangler.toml --var ADMIN_KEY:testkey  e depois  LEVEL=master BOTS=3 ROUNDS=5 node scripts/e2e-bots-run.mjs
//   Vigia: com --var DEBUG_BOT:skip (o bot não joga) ou DEBUG_BOT:throw (o cálculo falha), EXPECT_ERRORS=botTimeout|botMove confere que a mesa não trava e o erro é registrado.
const BASE = process.env.BASE ?? 'http://localhost:8787';
const LEVEL = process.env.LEVEL ?? 'master';
const BOTS = Number(process.env.BOTS ?? 3);
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { console.log(c ? 'OK  ' : 'FAIL', m); if (!c) process.exitCode = 1; };
const ID = 'player-stress01';
const { code } = await (await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnSeconds: 60, isPublic: false }) })).json();
let state = null;
const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/${code}`);
ws.onopen = () => ws.send(JSON.stringify({ t: 'join', id: ID, name: 'Estresse', nolog: true }));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'state') state = m; };
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (state && fn(state)) return true; await sleep(100); } return false; };
await until((s) => s.players.length === 1, 4000);
ws.send(JSON.stringify({ t: 'bots', count: BOTS, level: LEVEL }));
ok(await until((s) => s.players.length === BOTS + 1, 4000), `${BOTS} bots ${LEVEL} na sala`);
ws.send(JSON.stringify({ t: 'start' }));
ok(await until((s) => s.phase === 'playing', 4000), 'partida iniciada');
let maxWait = 0, humanTurns = 0, botTurnsSeen = new Set();
let lastTurnNo = state.turnNo, lastChange = Date.now();
const t0 = Date.now();
while (humanTurns < ROUNDS && Date.now() - t0 < 12 * 60 * 1000) {
  if (state.phase !== 'playing') break;
  if (state.turnNo !== lastTurnNo) { maxWait = Math.max(maxWait, Date.now() - lastChange); lastTurnNo = state.turnNo; lastChange = Date.now(); }
  if (state.turnId === ID) { ws.send(JSON.stringify({ t: 'draw' })); humanTurns++; console.log(`  rodada ${humanTurns} (turno ${state.turnNo}) após ${Math.round((Date.now() - t0) / 1000)}s`); await sleep(500); }
  else botTurnsSeen.add(state.turnId);
  if (Date.now() - lastChange > 90000) { ok(false, `TRAVOU: a vez de ${state.turnId} não mudou em 90 s (turno ${state.turnNo})`); break; }
  await sleep(150);
}
ok(humanTurns >= ROUNDS, `o humano jogou ${humanTurns}/${ROUNDS} rodadas sem travar`);
console.log(`maior espera entre turnos: ${Math.round(maxWait / 1000)}s; bots que jogaram: ${botTurnsSeen.size}`);
if (process.env.EXPECT_ERRORS) {
  const errs = await (await fetch(`${BASE}/api/errors`, { headers: { 'X-Admin-Key': 'testkey' } })).json();
  console.log('erros registrados:', JSON.stringify(errs.slice(0, 2)));
  ok(errs.some((e) => e.onde === process.env.EXPECT_ERRORS), `o registro de erros tem "${process.env.EXPECT_ERRORS}"`);
}
setTimeout(() => process.exit(process.exitCode ?? 0), 100);
