// Gera um arquivo NDJSON de teste no mesmo formato do servidor (humano = bot Fácil/Médio fingindo): serve para ensaiar o leitor.
//   npx tsx scripts/gamelog-synth.ts <saida.ndjson> [partidas=20]
import { writeFileSync } from 'node:fs';
import { createGame, currentPlayer, drawTurn, playTurn } from '../shared/game';
import { botMove, LEVEL_CFG, type BotLevel } from '../shared/bot';
import { logHead, logResult, logTurn, summarize, type GameLog, type LogPlayer, type LogTurn } from '../shared/gamelog';
import { mulberry32 } from '../shared/tiles';

const out = process.argv[2] ?? 'sintetico.ndjson';
const N = Number(process.argv[3] ?? 20);
const combos: BotLevel[][] = [['normal', 'master'], ['normal', 'hard'], ['hard', 'grandmaster'], ['easy', 'normal']];
const lines: string[] = [];
for (let i = 0; i < N; i++) {
  const [human, bot] = combos[i % combos.length]!;
  const levels = [human!, bot!];
  const rng = mulberry32(100 + i);
  let g = createGame([{ id: 'p0', name: 'p0', isBot: false }, { id: 'p1', name: 'p1', isBot: true }], rng);
  const players: LogPlayer[] = [{ seat: 0, kind: 'h' }, { seat: 1, kind: 'b', level: bot, persona: `bot-${bot}-0` }];
  const head = logHead(g, players, { id: (0xabc000 + i).toString(16), t: 1_700_000_000_000 + i * 600_000, turnSeconds: 60 });
  const turns: LogTurn[] = [];
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 700) {
    const cur = currentPlayer(g);
    const prev = g;
    const t = botMove(g, LEVEL_CFG[levels[g.turn]!], rng);
    let step = t ? playTurn(g, cur.id, t) : null;
    if (!step || !step.ok) step = drawTurn(g, cur.id);
    if (!step.ok) break;
    g = step.state;
    turns.push(...logTurn(prev, g, { ms: 4000 + Math.floor(rng() * 9000) }));
  }
  const log: GameLog = { ...head, dur: 900, turns, result: logResult(g) };
  lines.push(JSON.stringify({ n: i + 1, summary: summarize(log), log }));
}
writeFileSync(out, lines.join('\n') + '\n');
console.log(`${N} partidas sintéticas em ${out}`);
