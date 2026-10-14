// Bates que o Grão-mestre perde: joga G (padrão) x Mestre e, em cada vez do G com cavalete <= MAXR em que ele NÃO bateu,
// roda várias configurações da busca de bater e registra se acharam saída e o custo (nós, ms).
// uso: [SEED=5000] [MAXR=4] npx tsx scripts/sim-gm-out.ts <partidas> <saida.jsonl>
import { writeFileSync, appendFileSync } from 'node:fs';
import { createGame, playTurn, drawTurn, currentPlayer, type GameState } from '../shared/game';
import { botMove as masterMove, LEVEL_CFG } from '../shared/bot';
import { relayout, type SetState } from '../shared/layout';
import { validatePlay } from '../shared/rules';
import { mulberry32 } from '../shared/tiles';
import { grandmasterMove, solveOut, GM_TUNING, GM_DEFAULTS } from '../shared/grandmaster';

const N = Number(process.argv[2] ?? 100);
const OUT = process.argv[3] ?? '/tmp/gm-out.jsonl';
const SEED0 = Number(process.env.SEED ?? 5000);
const MAXR = Number(process.env.MAXR ?? 4);
Object.assign(GM_TUNING, GM_DEFAULTS);

const CONFIGS: Record<string, { budget: number; ms: number; all: boolean }> = {
  padrao: { budget: 30000, ms: 120, all: false },
  noMais100k: { budget: 100000, ms: 500, all: false },
  noMais300k: { budget: 300000, ms: 2500, all: false },
  todos30k: { budget: 30000, ms: 120, all: true },
  todos100k: { budget: 100000, ms: 500, all: true },
  todos300k: { budget: 300000, ms: 2500, all: true },
};

writeFileSync(OUT, '');
for (let i = 0; i < N; i++) {
  const seed = SEED0 + i;
  const rng = mulberry32(seed);
  const gSeat = i % 2;
  let g: GameState = createGame(Array.from({ length: 2 }, (_, k) => ({ id: `p${k}`, name: `p${k}`, isBot: true })), rng);
  const events: any[] = [];
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 700) {
    const cur = currentPlayer(g);
    const seat = Number(cur.id.slice(1));
    const t = seat === gSeat ? grandmasterMove(g, LEVEL_CFG.grandmaster, rng) : masterMove(g, LEVEL_CFG.master, rng);
    let step = t ? playTurn(g, cur.id, t) : null;
    if (seat === gSeat && cur.melded && cur.rack.length <= MAXR && !(step && step.ok && step.state.players[seat]!.rack.length === 0)) {
      const ev: any = { rackLen: cur.rack.length, nJ: cur.rack.filter((x) => x >= 104).length, tableSets: g.table.length, oppRack: g.players[1 - seat]!.rack.length, turnNo: g.turnNo };
      for (const [name, c] of Object.entries(CONFIGS)) {
        const stats = { nodes: 0, aborted: false };
        const t0 = performance.now();
        const sol = solveOut(g.table, cur.rack, c.budget, c.ms, 99, c.all, stats);
        const ms = performance.now() - t0;
        let found = false;
        if (sol) {
          const tb = relayout(sol as SetState[]);
          const v = validatePlay(g.table, cur.rack, cur.melded, tb);
          found = v.ok && v.added.length === cur.rack.length;
        }
        ev[name] = { found, nodes: stats.nodes, aborted: stats.aborted, ms: Math.round(ms) };
      }
      events.push(ev);
    }
    if (!step || !step.ok) step = drawTurn(g, cur.id);
    if (!step.ok) break;
    g = step.state;
  }
  if (g.phase !== 'ended' || !g.result) continue;
  appendFileSync(OUT, JSON.stringify({ seed, gSeat, win: g.result.winners.includes(`p${gSeat}`), events }) + '\n');
}
