import { describe, expect, it } from 'vitest';
import { createGame, currentPlayer, drawTurn, playTurn, removePlayer, type GameState } from './game';
import { botMove, LEVEL_CFG, type BotLevel } from './bot';
import { mulberry32 } from './tiles';
import { logHead, logResult, logTurn, summarize, type GameLog, type LogPlayer, type LogTurn } from './gamelog';

/** Joga uma partida só de bots registrando tudo como o servidor faz. */
function play(levels: BotLevel[], seed: number, leaveAt = 0): { log: GameLog; final: GameState } {
  const rng = mulberry32(seed);
  let g = createGame(levels.map((_, i) => ({ id: `secret-player-id-${i}`, name: `Nome Secreto ${i}`, isBot: i > 0 })), rng);
  const players: LogPlayer[] = levels.map((lv, seat) => (seat === 0 ? { seat, kind: 'h' } : { seat, kind: 'b', level: lv, persona: `bot-${lv}-${seat}` }));
  const head = logHead(g, players, { id: 'abc12345', t: 1000, turnSeconds: 60 });
  const turns: LogTurn[] = [];
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 700) {
    const cur = currentPlayer(g);
    const prev = g;
    if (leaveAt && guard === leaveAt) g = removePlayer(g, cur.id);
    else {
      const t = botMove(g, LEVEL_CFG[levels[g.turn]!], rng);
      let step = t ? playTurn(g, cur.id, t) : null;
      if (!step || !step.ok) step = drawTurn(g, cur.id);
      if (!step.ok) break;
      g = step.state;
    }
    turns.push(...logTurn(prev, g, { ms: 1234 }));
  }
  return { log: { ...head, end: 61_000, turns, result: logResult(g) }, final: g };
}

describe('log de partidas', () => {
  it('basta o log para refazer a partida: mãos, compras (do fim do pote), jogadas e o resultado', () => {
    for (const [levels, seed] of [[['easy', 'master'], 11], [['easy', 'hard', 'master'], 12], [['easy', 'normal', 'grandmaster'], 13]] as const) {
      const { log, final } = play([...levels], seed);
      expect(final.phase).toBe('ended');
      const racks = log.deal.racks.map((r) => r.slice());
      const pool = log.deal.pool.slice();
      let table = new Set<number>();
      for (const t of log.turns) {
        expect(t.rk).toEqual(racks[t.s]!.slice().sort((a, b) => a - b)); // o cavalete anotado é o que a reconstrução tem
        if (t.a === 'd') racks[t.s]!.push(pool.pop()!);
        if (t.a === 'p') {
          const now = new Set(t.tb!.flat());
          const added = [...now].filter((id) => !table.has(id));
          expect(added.length).toBeGreaterThan(0);
          racks[t.s]!.splice(0, racks[t.s]!.length, ...racks[t.s]!.filter((id) => !added.includes(id)));
          table = now;
        }
        expect(racks.map((r) => r.length)).toEqual(t.rs);
        expect(pool.length).toBe(t.pool);
      }
      expect(log.result!.points).toEqual(final.players.map((p) => final.result!.points[p.id]));
      expect(racks.map((r) => r.length)).toEqual(final.players.map((p) => p.rack.length));
    }
  }, 60000);

  it('é anônimo: nenhum nome nem identificador de jogador entra no registro', () => {
    const { log } = play(['easy', 'master'], 21);
    const txt = JSON.stringify(log);
    expect(txt).not.toMatch(/Nome Secreto|secret-player-id/);
    expect(log.players).toEqual([{ seat: 0, kind: 'h' }, { seat: 1, kind: 'b', level: 'master', persona: 'bot-master-1' }]);
  });

  it('resumo: quem ganhou, níveis dos bots, turnos e se a partida foi interrompida', () => {
    const { log, final } = play(['easy', 'master'], 31);
    const s = summarize(log);
    expect(s).toMatchObject({ id: 'abc12345', dur: 60, players: 2, humans: 1, levels: 'master', turns: final.turnNo, reason: final.result!.reason, partial: false });
    expect(s.humanWon).toBe(final.result!.winners.includes('secret-player-id-0'));
    expect(s.humanPts).toBe(final.result!.points['secret-player-id-0']);
    expect(s.botPts).toBe(final.result!.points['secret-player-id-1']);

    const left = play(['easy', 'master'], 32, 6);
    expect(left.log.turns.some((t) => t.a === 'l')).toBe(true);
    expect(summarize(left.log)).toMatchObject({ reason: 'left', partial: true });
  }, 60000);

  it('estado igual não gera registro; saída fora da vez gera só a linha de saída', () => {
    const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], mulberry32(5));
    expect(logTurn(g, g)).toEqual([]);
    const other = (g.turn + 1) % 3;
    const next = removePlayer(g, g.players[other]!.id);
    const out = logTurn(g, next);
    expect(out.map((t) => [t.a, t.s])).toEqual([['l', other]]);
  });
});
