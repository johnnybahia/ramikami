// Confronto candidato x Mestre atual: npx tsx scripts/sim-vs.ts <modulo-do-candidato|baseline> [partidas=200] [jogadores=2]
// O módulo do candidato exporta: botMove(state, persona, rng) => SetState[] | null  (mesma assinatura de shared/bot.ts)
// "baseline" = Mestre contra Mestre (controle: deve dar ~50%).
import { resolve } from 'node:path';
import { createGame, playTurn, drawTurn, currentPlayer, type GameState } from '../shared/game';
import { botMove as masterMove, LEVEL_CFG } from '../shared/bot';
import { isJoker, mulberry32 } from '../shared/tiles';

type MoveFn = typeof masterMove;
const arg = process.argv[2] ?? 'baseline';
const N = Number(process.argv[3] ?? 200);
const PLAYERS = Number(process.argv[4] ?? 2);
const MAX_TURNS = 700;

const cand: MoveFn = arg === 'baseline' ? masterMove : ((await import(resolve(arg))) as { botMove: MoveFn }).botMove;

function play(candSeat: number, seed: number) {
  const rng = mulberry32(seed);
  let g: GameState = createGame(Array.from({ length: PLAYERS }, (_, i) => ({ id: `p${i}`, name: `p${i}`, isBot: true })), rng);
  let guard = 0;
  while (g.phase === 'playing' && guard++ < MAX_TURNS) {
    const cur = currentPlayer(g);
    const mine = Number(cur.id.slice(1)) === candSeat;
    const t = (mine ? cand : masterMove)(g, LEVEL_CFG.master, rng);
    let step = t ? playTurn(g, cur.id, t) : null;
    if (!step || !step.ok) step = drawTurn(g, cur.id);
    if (!step.ok) break;
    g = step.state;
  }
  return g;
}

let wins = 0, games = 0, ptsC = 0, ptsM = 0, turns = 0, jokersOnTable = 0, emptied = 0, candEmptied = 0, maxMs = 0;
for (let i = 0; i < N; i++) {
  const seat = i % PLAYERS; // alterna o lugar do candidato
  const t0 = performance.now();
  const g = play(seat, 5000 + i);
  maxMs = Math.max(maxMs, performance.now() - t0);
  if (g.phase !== 'ended' || !g.result) continue;
  games++;
  turns += g.turnNo;
  const cid = `p${seat}`;
  if (g.result.winners.includes(cid)) wins += 1 / g.result.winners.length;
  ptsC += g.result.points[cid]!;
  ptsM += g.players.filter((p) => p.id !== cid).reduce((a, p) => a + g.result!.points[p.id]!, 0) / (PLAYERS - 1);
  jokersOnTable += g.table.reduce((a, s) => a + s.tiles.filter(isJoker).length, 0);
  if (g.result.reason === 'empty') {
    emptied++;
    if (g.result.winners.includes(cid)) candEmptied++;
  }
}
const p = wins / Math.max(games, 1);
const z = 1.96, n = Math.max(games, 1);
const lo = (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
const hi = (p + (z * z) / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
console.log(JSON.stringify({
  candidato: arg, jogadores: PLAYERS, partidas: games,
  vitoriasCandidato: +(p * 100).toFixed(1), ic95: [+(lo * 100).toFixed(1), +(hi * 100).toFixed(1)],
  pontosMediosCandidato: +(ptsC / n).toFixed(1), pontosMediosMestre: +(ptsM / n).toFixed(1),
  turnosMedios: +(turns / n).toFixed(0), coringasNaMesaAoFim: +(jokersOnTable / n).toFixed(2),
  fimPorMaoVazia: emptied, mãoVaziaDoCandidato: candEmptied, maiorPartidaMs: Math.round(maxMs),
}));
