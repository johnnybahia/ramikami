// Lê o log de partidas baixado do servidor (scripts/games-export.mjs) e mostra o que importa para melhorar os bots.
//   npx tsx scripts/games-report.ts <arquivo.ndjson>                 resumo por nível e comportamento de humanos x bots
//   npx tsx scripts/games-report.ts <arquivo.ndjson> --missed        + jogadas em que existia saída (bater) e o jogador não achou
//   npx tsx scripts/games-report.ts <arquivo.ndjson> --missed --humans   (inclui os humanos nessa análise)
//   npx tsx scripts/games-report.ts <arquivo.ndjson> --replay <id>   conta uma partida jogada a jogada
import { readFileSync } from 'node:fs';
import type { GameLog, GameSummary, LogPlayer, LogTurn } from '../shared/gamelog';
import { relayout } from '../shared/layout';
import { validatePlay } from '../shared/rules';
import { isJoker, tileColor, tileNum } from '../shared/tiles';
import { solveOut } from '../shared/grandmaster';

const args = process.argv.slice(2);
const flag = (n: string): boolean => args.includes(n);
const replayId = flag('--replay') ? args[args.indexOf('--replay') + 1] : undefined;
const file = args.find((a) => !a.startsWith('--') && a !== replayId) ?? '';
if (!file) {
  console.log('uso: npx tsx scripts/games-report.ts <arquivo.ndjson> [--missed [--humans]] [--replay <id>]');
  process.exit(1);
}
const rows = readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as { n: number; summary: GameSummary; log: GameLog | null });
const logs = rows.filter((r) => r.log).map((r) => r.log!);

const tile = (id: number): string => (isJoker(id) ? '★' : `${'●▲■◆'[tileColor(id)]}${tileNum(id)}`);
const sets = (tb: number[][]): string => tb.map((s) => s.map(tile).join(' ')).join(' | ');
const who = (p: LogPlayer): string => (p.kind === 'h' ? 'humano' : (p.level ?? 'bot'));
const pct = (a: number, b: number): string => (b ? `${Math.round((100 * a) / b)}%` : '-');
const avg = (a: number[]): number => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0);

if (replayId !== undefined) {
  const id = replayId;
  const log = logs.find((l) => l.id === id);
  if (!log) {
    console.log(`partida ${id} não encontrada (ids: ${logs.slice(0, 8).map((l) => l.id).join(', ')}...)`);
    process.exit(1);
  }
  console.log(`partida ${log.id} — ${log.players.map((p) => `#${p.seat} ${who(p)}`).join(', ')} — começou o #${log.first}`);
  log.deal.racks.forEach((r, i) => console.log(`  mão inicial #${i}: ${r.map(tile).join(' ')}`));
  for (const t of log.turns) {
    const act = { p: 'joga', d: 'compra', x: 'passa', l: 'sai da partida' }[t.a];
    console.log(`T${t.n} #${t.s} (${who(log.players[t.s]!)}) ${act}${t.to ? ' [tempo esgotado]' : ''}${t.ms !== undefined ? ` em ${Math.round(t.ms / 1000)}s` : ''} — cavalete antes: ${t.rk.map(tile).join(' ')}`);
    if (t.tb) console.log(`   mesa: ${sets(t.tb)}`);
    console.log(`   cavaletes: ${t.rs.join('/')}  pote: ${t.pool}`);
  }
  if (log.result) console.log(`FIM (${log.result.reason}) vencedor(es): ${log.result.winners.map((w) => `#${w}`).join(', ')} — pontos: ${log.result.points.join('/')}`);
  process.exit(0);
}

// ---- 1. resumo por combinação de bots (partidas interrompidas ficam fora)
const sums = rows.map((r) => r.summary);
const full = sums.filter((s) => !s.partial);
console.log(`\n== ${sums.length} partidas no arquivo (${sums.length - full.length} interrompidas ou relâmpago, fora das taxas)`);
const groups = new Map<string, GameSummary[]>();
for (const s of full) groups.set(`${s.humans} humano(s) x [${s.levels || 'sem bots'}]`, [...(groups.get(`${s.humans} humano(s) x [${s.levels || 'sem bots'}]`) ?? []), s]);
console.log('mesa'.padEnd(46), 'partidas', 'humano vence', 'turnos', 'pts humano', 'pts bot');
for (const [k, g] of [...groups].sort((a, b) => b[1].length - a[1].length))
  console.log(k.padEnd(46), String(g.length).padStart(8), pct(g.filter((s) => s.humanWon).length, g.length).padStart(12), String(avg(g.map((s) => s.turns))).padStart(6), String(avg(g.filter((s) => s.humanPts >= 0).map((s) => s.humanPts))).padStart(10), String(avg(g.filter((s) => s.botPts >= 0).map((s) => s.botPts))).padStart(7));

// ---- 2. comportamento por tipo de jogador
type Acc = { turns: number; plays: number; draws: number; jokersLoose: number; jokersFinal: number; ms: number[] };
const acc = new Map<string, Acc>();
for (const l of logs) {
  for (const t of l.turns) {
    const k = who(l.players[t.s]!);
    const a = acc.get(k) ?? { turns: 0, plays: 0, draws: 0, jokersLoose: 0, jokersFinal: 0, ms: [] };
    if (t.a === 'p' || t.a === 'd' || t.a === 'x') a.turns++;
    if (t.a === 'p') {
      a.plays++;
      const placed = t.rk.filter((id) => isJoker(id) && t.tb!.some((s) => s.includes(id))).length;
      if (t.rs[t.s] === 0) a.jokersFinal += placed;
      else a.jokersLoose += placed;
    }
    if (t.a === 'd') a.draws++;
    if (t.ms !== undefined && t.a !== 'l') a.ms.push(t.ms);
    acc.set(k, a);
  }
}
console.log('\n== comportamento');
console.log('quem'.padEnd(14), 'vezes', 'joga', 'compra', 'coringa solto', 'coringa no fecho', 'tempo médio/vez');
for (const [k, a] of [...acc].sort())
  console.log(k.padEnd(14), String(a.turns).padStart(5), pct(a.plays, a.turns).padStart(4), pct(a.draws, a.turns).padStart(6), String(a.jokersLoose).padStart(13), String(a.jokersFinal).padStart(16), `${Math.round(avg(a.ms) / 1000)}s`.padStart(15));

// ---- 3. saídas perdidas (precisa de busca: lento)
if (flag('--missed')) {
  const withHumans = flag('--humans');
  let checked = 0;
  const miss = new Map<string, { n: number; of: number }>();
  const ex: string[] = [];
  for (const l of logs) {
    let table: number[][] = [];
    for (const t of l.turns) {
      const kind = who(l.players[t.s]!);
      const mine = l.players[t.s]!.kind === 'b' || withHumans;
      if (mine && t.mel && (t.a === 'd' || (t.a === 'p' && t.rs[t.s]! > 0)) && t.rk.length <= 8) {
        checked++;
        const before = relayout(table.map((tiles, i) => ({ id: i + 1, tiles: tiles.slice(), x: 0, z: 0 })));
        const sol = solveOut(before, t.rk, 300000, 2500, 99, true);
        const ok = sol && (() => { const c = validatePlay(before, t.rk, true, relayout(sol)); return c.ok && c.added.length === t.rk.length; })();
        const m = miss.get(kind) ?? { n: 0, of: 0 };
        m.of++;
        if (ok) {
          m.n++;
          if (ex.length < 8) ex.push(`  partida ${l.id} T${t.n} #${t.s} (${kind}) com ${t.rk.length} pedra(s): ${t.rk.map(tile).join(' ')} — havia saída`);
        }
        miss.set(kind, m);
      }
      if (t.tb) table = t.tb;
    }
  }
  console.log(`\n== saídas perdidas (${checked} vezes analisadas, cavalete ≤ 8)`);
  for (const [k, m] of [...miss].sort()) console.log(`${k.padEnd(14)} ${m.n}/${m.of} (${pct(m.n, m.of)})`);
  ex.forEach((e) => console.log(e));
}
