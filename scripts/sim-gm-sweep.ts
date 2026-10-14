// Varredura de parâmetros do Grão-mestre: variante x Grão-mestre de fábrica.
// npx tsx scripts/sim-gm-sweep.ts '<json de parâmetros da variante>' [partidas=400] [jogadores=2]   (SEED=<n>)
import { createGame, playTurn, drawTurn, currentPlayer, type GameState } from '../shared/game';
import { LEVEL_CFG } from '../shared/bot';
import { grandmasterMove, GM_TUNING, GM_DEFAULTS } from '../shared/grandmaster';
import { isJoker, mulberry32 } from '../shared/tiles';

const variant = JSON.parse(process.argv[2] ?? '{}') as Record<string, number | boolean>;
const N = Number(process.argv[3] ?? 400);
const PLAYERS = Number(process.argv[4] ?? 2);
const SEED0 = Number(process.env.SEED ?? 9000);
const CFG = LEVEL_CFG.grandmaster;
const use = (v: Record<string, number | boolean>) => { Object.assign(GM_TUNING, GM_DEFAULTS, v); };

let jokersLeftOnTable = 0;
function play(seat: number, seed: number) {
  const rng = mulberry32(seed);
  let g: GameState = createGame(Array.from({ length: PLAYERS }, (_, i) => ({ id: `p${i}`, name: `p${i}`, isBot: true })), rng);
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 700) {
    const cur = currentPlayer(g);
    use(Number(cur.id.slice(1)) === seat ? variant : {});
    const t = grandmasterMove(g, CFG, rng);
    let step = t ? playTurn(g, cur.id, t) : null;
    if (!step || !step.ok) step = drawTurn(g, cur.id);
    if (!step.ok) break;
    g = step.state;
  }
  return g;
}

let wins = 0, games = 0, ptsV = 0, ptsB = 0, turns = 0, jokTab = 0;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const seat = i % PLAYERS;
  const g = play(seat, SEED0 + i);
  if (g.phase !== 'ended' || !g.result) continue;
  games++;
  turns += g.turnNo;
  const vid = `p${seat}`;
  if (g.result.winners.includes(vid)) wins += 1 / g.result.winners.length;
  ptsV += g.result.points[vid]!;
  ptsB += g.players.filter((p) => p.id !== vid).reduce((a, p) => a + g.result!.points[p.id]!, 0) / (PLAYERS - 1);
  jokTab += g.table.reduce((a, s) => a + s.tiles.filter(isJoker).length, 0);
}
const p = wins / Math.max(games, 1), n = Math.max(games, 1), z = 1.96;
const c = (p + (z * z) / (2 * n)) / (1 + (z * z) / n), h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
console.log(JSON.stringify({
  variante: variant, jogadores: PLAYERS, partidas: games, vitorias: +(p * 100).toFixed(1), ic95: [+((c - h) * 100).toFixed(1), +((c + h) * 100).toFixed(1)],
  pontosVariante: +(ptsV / n).toFixed(1), pontosBase: +(ptsB / n).toFixed(1), turnos: +(turns / n).toFixed(0), coringasNaMesaAoFim: +(jokTab / n).toFixed(2),
  segundos: Math.round((performance.now() - t0) / 1000),
}));
