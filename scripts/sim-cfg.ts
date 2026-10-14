// Candidato (nível base + ajustes) x nível adversário, 2 jogadores, lugares alternados.
// npx tsx scripts/sim-cfg.ts <nivelBase> '<json de ajustes do LevelCfg; "gm" ajusta o motor do Grão-mestre>' <nivelAdversario> [partidas=300]
//   (SEED=<n>, OPPCFG='<json de ajustes do adversário>')
// Além das vitórias, mede os coringas que o candidato deixa na mesa fora do lance final e quantos o adversário reaproveita.
import { createGame, playTurn, drawTurn, currentPlayer, type GameState } from '../shared/game';
import { botMove, LEVEL_CFG, type BotLevel, type LevelCfg } from '../shared/bot';
import { isJoker, mulberry32 } from '../shared/tiles';
import { placedJokerRisks } from '../shared/jokerrisk';

type Over = Partial<LevelCfg>;
const base = (process.argv[2] ?? 'hard') as BotLevel;
const over = JSON.parse(process.argv[3] ?? '{}') as Over;
const oppLevel = (process.argv[4] ?? 'master') as BotLevel;
const N = Number(process.argv[5] ?? 300);
const SEED0 = Number(process.env.SEED ?? 7000);
const oppOver = JSON.parse(process.env.OPPCFG ?? '{}') as Over;
const mix = (lv: BotLevel, o: Over): LevelCfg => ({ ...LEVEL_CFG[lv], ...o, gm: { ...LEVEL_CFG[lv].gm, ...o.gm } });
const cand = mix(base, over);
const opp = mix(oppLevel, oppOver);

let wins = 0, games = 0, turns = 0, ptsC = 0, ptsO = 0, ms = 0, moves = 0, maxMs = 0;
let jokPlaced = 0, jokReusedOpp = 0, jokReusedSelf = 0, jokHeldAtEnd = 0;
const how = { gratis: 0, troca: 0, reorganizacao: 0 }; // como o adversário levou o coringa
// calibração do modelo de risco: faixa de risco estimado -> [colocados, levados de graça/por troca]
const BUCKETS = [0.05, 0.15, 0.5, 0.99, 1];
const cal = BUCKETS.map(() => [0, 0]);
const bucketOf = (r: number): number => BUCKETS.findIndex((b) => r <= b);
const sig = (tiles: readonly number[]): string => tiles.slice().sort((a, b) => a - b).join(',');
for (let i = 0; i < N; i++) {
  const seat = i % 2;
  const rng = mulberry32(SEED0 + i);
  let g: GameState = createGame([0, 1].map((k) => ({ id: `p${k}`, name: `p${k}`, isBot: true })), rng);
  const tracked = new Map<number, { sig: string; tiles: number[]; bucket: number }>(); // coringa do candidato solto -> conjunto onde ficou
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 700) {
    const cur = currentPlayer(g);
    const mine = Number(cur.id.slice(1)) === seat;
    const t0 = performance.now();
    const t = botMove(g, mine ? cand : opp, rng);
    if (mine) { const d = performance.now() - t0; ms += d; moves++; maxMs = Math.max(maxMs, d); }
    let step = t ? playTurn(g, cur.id, t) : null;
    if (step && step.ok) {
      const next = step.state;
      // coringas que o candidato jogou neste turno e que não fecharam a partida
      if (mine && next.phase === 'playing') {
        const risks = placedJokerRisks(g, next.table);
        let ri = 0;
        for (const j of cur.rack.filter(isJoker)) {
          const set = next.table.find((s) => s.tiles.includes(j));
          if (set) {
            const b = bucketOf(risks[ri++] ?? 1);
            tracked.set(j, { sig: sig(set.tiles), tiles: set.tiles.slice(), bucket: b });
            cal[b]![0]++;
            jokPlaced++;
          }
        }
      }
      // reaproveitados: o conjunto do coringa mudou
      for (const [j, t0] of [...tracked]) {
        const set = next.table.find((s) => s.tiles.includes(j));
        if (!set || sig(set.tiles) !== t0.sig) {
          tracked.delete(j);
          if (mine) { jokReusedSelf++; continue; }
          jokReusedOpp++;
          // como levou: tirou de graça (os pedaços que sobram continuam válidos), trocou pela pedra exata, ou reorganizou
          const sets = new Set(next.table.map((s) => sig(s.tiles)));
          const k = t0.tiles.indexOf(j);
          const frags = [t0.tiles.slice(0, k), t0.tiles.slice(k + 1)].filter((f) => f.length > 0);
          const gratis = frags.length > 0 && frags.every((f) => sets.has(sig(f)));
          const troca = next.table.some((s) => {
            if (s.tiles.length !== t0.tiles.length) return false;
            const a = s.tiles.filter((x) => !t0.tiles.includes(x));
            const b = t0.tiles.filter((x) => !s.tiles.includes(x));
            return a.length === 1 && b.length === 1 && b[0] === j && !isJoker(a[0]!);
          });
          if (gratis) how.gratis++;
          else if (troca) how.troca++;
          else how.reorganizacao++;
          if (gratis || troca) cal[t0.bucket]![1]++;
        }
      }
    }
    if (!step || !step.ok) step = drawTurn(g, cur.id);
    if (!step.ok) break;
    g = step.state;
  }
  if (g.phase !== 'ended' || !g.result) continue;
  games++; turns += g.turnNo;
  if (g.result.winners.includes(`p${seat}`)) wins += 1 / g.result.winners.length;
  ptsC += g.result.points[`p${seat}`]!;
  ptsO += g.result.points[`p${1 - seat}`]!;
  jokHeldAtEnd += g.players[seat]!.rack.filter(isJoker).length;
}
const p = wins / Math.max(games, 1), n = Math.max(games, 1), z = 1.96;
const c = (p + (z * z) / (2 * n)) / (1 + (z * z) / n), h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
console.log(JSON.stringify({
  base, ajustes: over, vs: oppLevel, partidas: games, vitorias: +(p * 100).toFixed(1), ic95: [+((c - h) * 100).toFixed(1), +((c + h) * 100).toFixed(1)],
  pontos: +(ptsC / n).toFixed(1), pontosAdv: +(ptsO / n).toFixed(1), turnos: +(turns / n).toFixed(0), msMedio: +(ms / Math.max(moves, 1)).toFixed(1), msMax: Math.round(maxMs),
  coringasSoltosPorPartida: +(jokPlaced / n).toFixed(2), reusadosPeloAdversarioPorPartida: +(jokReusedOpp / n).toFixed(2), reusadosPorMimPorPartida: +(jokReusedSelf / n).toFixed(2),
  comoOAdversarioLevou: { gratisPorPartida: +(how.gratis / n).toFixed(2), trocaPorPartida: +(how.troca / n).toFixed(2), reorganizacaoPorPartida: +(how.reorganizacao / n).toFixed(2), humanoPorPartida: +((how.gratis + how.troca) / n).toFixed(2) },
  calibracaoRisco: Object.fromEntries(BUCKETS.map((b, i) => [`risco<=${b}`, `${cal[i]![0]} colocados, ${cal[i]![0] ? Math.round((100 * cal[i]![1]) / cal[i]![0]) : 0}% levados de graça/troca`])),
  pctSoltosReusadosPeloAdversario: +((100 * jokReusedOpp) / Math.max(jokPlaced, 1)).toFixed(1), coringaNaMaoAoFim: +(jokHeldAtEnd / n).toFixed(2),
}));
