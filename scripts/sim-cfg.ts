// Candidato (nível base + ajustes) x nível adversário, 2 jogadores, lugares alternados.
// npx tsx scripts/sim-cfg.ts <nivelBase> '<json de ajustes do LevelCfg>' <nivelAdversario> [partidas=300]   (SEED=<n>, OPPGM='<json de parâmetros do motor do Grão-mestre do adversário>')
import { createGame, playTurn, drawTurn, currentPlayer, type GameState } from '../shared/game';
import { botMove, LEVEL_CFG, type BotLevel, type LevelCfg } from '../shared/bot';
import { GM_TUNING, GM_DEFAULTS } from '../shared/grandmaster';
import { mulberry32 } from '../shared/tiles';

const base = (process.argv[2] ?? 'hard') as BotLevel;
const over = JSON.parse(process.argv[3] ?? '{}') as Partial<LevelCfg> & { gm?: Record<string, number | boolean> };
const oppLevel = (process.argv[4] ?? 'master') as BotLevel;
const N = Number(process.argv[5] ?? 300);
const SEED0 = Number(process.env.SEED ?? 7000);
const { gm, ...cfgOver } = over;
const cand: LevelCfg = { ...LEVEL_CFG[base], ...cfgOver };
const opp = LEVEL_CFG[oppLevel];
const oppGm = JSON.parse(process.env.OPPGM ?? '{}') as Record<string, number | boolean>;

let wins = 0, games = 0, turns = 0, ptsC = 0, ptsO = 0, ms = 0, moves = 0, maxMs = 0;
for (let i = 0; i < N; i++) {
  const seat = i % 2;
  const rng = mulberry32(SEED0 + i);
  let g: GameState = createGame([0, 1].map((k) => ({ id: `p${k}`, name: `p${k}`, isBot: true })), rng);
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 700) {
    const cur = currentPlayer(g);
    const mine = Number(cur.id.slice(1)) === seat;
    Object.assign(GM_TUNING, GM_DEFAULTS, mine ? gm ?? {} : oppGm);
    const t0 = performance.now();
    const t = botMove(g, mine ? cand : opp, rng);
    if (mine) { const d = performance.now() - t0; ms += d; moves++; maxMs = Math.max(maxMs, d); }
    let step = t ? playTurn(g, cur.id, t) : null;
    if (!step || !step.ok) step = drawTurn(g, cur.id);
    if (!step.ok) break;
    g = step.state;
  }
  if (g.phase !== 'ended' || !g.result) continue;
  games++; turns += g.turnNo;
  if (g.result.winners.includes(`p${seat}`)) wins += 1 / g.result.winners.length;
  ptsC += g.result.points[`p${seat}`]!;
  ptsO += g.result.points[`p${1 - seat}`]!;
}
const p = wins / Math.max(games, 1), n = Math.max(games, 1), z = 1.96;
const c = (p + (z * z) / (2 * n)) / (1 + (z * z) / n), h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
console.log(JSON.stringify({ base, ajustes: over, vs: oppLevel, partidas: games, vitorias: +(p * 100).toFixed(1), ic95: [+((c - h) * 100).toFixed(1), +((c + h) * 100).toFixed(1)], pontos: +(ptsC / n).toFixed(1), pontosAdv: +(ptsO / n).toFixed(1), turnos: +(turns / n).toFixed(0), msMedio: +(ms / Math.max(moves, 1)).toFixed(1), msMax: Math.round(maxMs) }));
