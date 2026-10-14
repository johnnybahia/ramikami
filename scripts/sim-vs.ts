// Confronto candidato x Mestre atual: npx tsx scripts/sim-vs.ts <modulo-do-candidato|baseline> [partidas=200] [jogadores=2]
// O módulo do candidato exporta: botMove(state, persona, rng) => SetState[] | null  (mesma assinatura de shared/bot.ts)
// "baseline" = espelho do adversário (controle: deve dar ~50%). Variáveis: SEED=<n>, OPP=grandmaster.
import { resolve } from 'node:path';
import { createGame, playTurn, drawTurn, currentPlayer, type GameState } from '../shared/game';
import { botMove as masterMove, LEVEL_CFG } from '../shared/bot';
import { isJoker, mulberry32 } from '../shared/tiles';

type MoveFn = typeof masterMove;
const arg = process.argv[2] ?? 'baseline';
const N = Number(process.argv[3] ?? 200);
const PLAYERS = Number(process.argv[4] ?? 2);
const MAX_TURNS = 700;
const SEED0 = Number(process.env.SEED ?? 5000); // outra semente para confirmar resultados

// OPP=grandmaster: o adversário é o Grão-mestre atual (padrão: Mestre). "baseline" = espelho do adversário (controle ~50%).
const OPP_CFG = process.env.OPP === 'grandmaster' ? LEVEL_CFG.grandmaster : LEVEL_CFG.master;
const cand: MoveFn = arg === 'baseline' ? masterMove : ((await import(resolve(arg))) as { botMove: MoveFn }).botMove;
const CAND_CFG = arg === 'baseline' ? OPP_CFG : LEVEL_CFG.master;

const stat = { invalid: 0, moves: 0, plays: 0, draws: 0, ms: 0, maxMove: 0, drawsWithPlay: 0 };
function play(candSeat: number, seed: number) {
  const rng = mulberry32(seed);
  let g: GameState = createGame(Array.from({ length: PLAYERS }, (_, i) => ({ id: `p${i}`, name: `p${i}`, isBot: true })), rng);
  let guard = 0;
  while (g.phase === 'playing' && guard++ < MAX_TURNS) {
    const cur = currentPlayer(g);
    const mine = Number(cur.id.slice(1)) === candSeat;
    const t0 = performance.now();
    const t = (mine ? cand : masterMove)(g, mine ? CAND_CFG : OPP_CFG, rng);
    const dt = performance.now() - t0;
    let step = t ? playTurn(g, cur.id, t) : null;
    if (mine) {
      stat.moves++;
      stat.ms += dt;
      stat.maxMove = Math.max(stat.maxMove, dt);
      if (t && step && !step.ok) stat.invalid++; // jogada inválida cai em "comprar" sem aviso: precisa ser 0
      if (step && step.ok) stat.plays++;
      else stat.draws++;
    }
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
  const g = play(seat, SEED0 + i);
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
  jogadasInvalidasDoCandidato: stat.invalid, comprasDoCandidato: stat.draws, jogadasDoCandidato: stat.plays, msMedioPorJogada: +(stat.ms / Math.max(stat.moves, 1)).toFixed(1), msMaxPorJogada: Math.round(stat.maxMove),
  fimPorMaoVazia: emptied, mãoVaziaDoCandidato: candEmptied, maiorPartidaMs: Math.round(maxMs),
}));
