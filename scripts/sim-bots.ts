// Simula partidas bot x bot para medir a força de cada nível: npx vite-node scripts/sim-bots.ts [partidas]
import { createGame, playTurn, drawTurn, currentPlayer } from '../shared/game';
import { botMove, personaById, type PersonaId } from '../shared/bot';
import { mulberry32 } from '../shared/tiles';

const N = Number(process.argv[2] ?? 300);
const MAX_TURNS = 600;

function play(levels: PersonaId[], seed: number) {
  const rng = mulberry32(seed);
  let g = createGame(levels.map((_, i) => ({ id: `p${i}`, name: `p${i}`, isBot: true })), rng);
  let guard = 0;
  while (g.phase === 'playing' && guard++ < MAX_TURNS) {
    const cur = currentPlayer(g);
    const lvl = levels[Number(cur.id.slice(1))]!;
    const t = botMove(g, personaById(lvl)!, rng);
    let step = t ? playTurn(g, cur.id, t) : null;
    if (!step || !step.ok) step = drawTurn(g, cur.id);
    if (!step.ok) break;
    g = step.state;
  }
  return { g, ended: g.phase === 'ended', turns: g.turnNo };
}

const FILTER = process.argv[3] ?? '';
function run(label: string, levels: PersonaId[]) {
  if (FILTER && !label.includes(FILTER)) return;
  const wins = levels.map(() => 0);
  const pts = levels.map(() => 0);
  let ended = 0;
  let turns = 0;
  let maxMs = 0;
  for (let i = 0; i < N; i++) {
    // rotaciona quem senta em cada lugar para anular vantagem de posição
    const rot = i % levels.length;
    const order = levels.map((_, k) => (k + rot) % levels.length);
    const t0 = performance.now();
    const r = play(order.map((k) => levels[k]!), 1000 + i);
    maxMs = Math.max(maxMs, performance.now() - t0);
    if (!r.ended || !r.g.result) continue;
    ended++;
    turns += r.turns;
    r.g.players.forEach((p, seat) => {
      const k = order[seat]!;
      pts[k]! += r.g.result!.points[p.id]!;
      if (r.g.result!.winners.includes(p.id)) wins[k]! += 1 / r.g.result!.winners.length;
    });
  }
  console.log(`\n${label}  (${ended}/${N} terminaram, média ${(turns / Math.max(ended, 1)).toFixed(0)} turnos)`);
  levels.forEach((l, k) => console.log(`  ${l.padEnd(6)} vitórias ${((wins[k]! / Math.max(ended, 1)) * 100).toFixed(1)}%  pontos médios na mão ${(pts[k]! / Math.max(ended, 1)).toFixed(1)}`));
}

run('Davi x Mestre', ['davi', 'mestre']);
run('Jorge x Mestre', ['jorge', 'mestre']);
run('Luna x Mestre', ['luna', 'mestre']);
run('Marina x Mestre', ['marina', 'mestre']);
run('Luna x Marina', ['luna', 'marina']);
run('Mesa de 4', ['davi', 'jorge', 'luna', 'marina']);
run('Controle: Mestre x Mestre', ['mestre', 'mestre']);
