import { describe, expect, it } from 'vitest';
import { analyzeSet, validatePlay } from './rules';
import { createGame, drawTurn, playTurn, removePlayer, currentPlayer } from './game';
import { botMove } from './bot';
import { mulberry32, handPoints } from './tiles';
import type { SetState } from './layout';

// id = cor*26 + (num-1) (+13 para a segunda cópia). cor 0 preto, 1 azul, 2 vermelho, 3 laranja
const T = (color: number, num: number, copy = 0) => color * 13 + (num - 1) + copy * 52;
const J1 = 104;
const J2 = 105;
const S = (id: number, tiles: number[], x = 0, z = 0): SetState => ({ id, tiles, x, z });

describe('analyzeSet', () => {
  it('aceita sequência e trinca', () => {
    expect(analyzeSet([T(0, 4), T(0, 5), T(0, 6)])).toMatchObject({ valid: true, kind: 'run', points: 15 });
    expect(analyzeSet([T(0, 7), T(1, 7), T(2, 7)])).toMatchObject({ valid: true, kind: 'group', points: 21 });
    expect(analyzeSet([T(0, 7), T(1, 7), T(2, 7), T(3, 7)]).valid).toBe(true);
  });
  it('rejeita casos inválidos', () => {
    expect(analyzeSet([T(0, 4), T(0, 5)]).valid).toBe(false);
    expect(analyzeSet([T(0, 4), T(1, 5), T(0, 6)]).valid).toBe(false);
    expect(analyzeSet([T(0, 12), T(0, 13), T(0, 1)]).valid).toBe(false); // sem volta
    expect(analyzeSet([T(0, 7), T(1, 7), T(0, 7, 1)]).valid).toBe(false); // cor repetida
    expect(analyzeSet([T(0, 7), T(1, 7), T(2, 7), T(3, 7), J1]).valid).toBe(false);
    expect(analyzeSet([T(0, 5), T(0, 4), T(0, 6)]).valid).toBe(false); // fora de ordem
  });
  it('coringa substitui e conta o valor que representa', () => {
    expect(analyzeSet([T(0, 4), J1, T(0, 6)])).toMatchObject({ valid: true, points: 15 });
    expect(analyzeSet([J1, T(0, 5), T(0, 6)])).toMatchObject({ valid: true, points: 15 });
    expect(analyzeSet([J1, T(0, 1), T(0, 2)]).valid).toBe(false);
    expect(analyzeSet([T(0, 12), T(0, 13), J1]).valid).toBe(false);
    expect(analyzeSet([T(0, 9), T(1, 9), J1]).points).toBe(27);
    expect(analyzeSet([J1, J2, T(0, 9)]).valid).toBe(true);
  });
});

describe('validatePlay', () => {
  const rack = [T(0, 10), T(0, 11), T(0, 12), T(1, 2), T(1, 3), T(1, 4), T(2, 1)];
  it('abertura exige 30 pontos só com o cavalete', () => {
    const low = validatePlay([], rack, false, [S(1, [T(1, 2), T(1, 3), T(1, 4)])]);
    expect(low.ok).toBe(false);
    const ok = validatePlay([], rack, false, [S(1, [T(0, 10), T(0, 11), T(0, 12)])]);
    expect(ok).toMatchObject({ ok: true, meldPoints: 33 });
  });
  it('abertura soma vários sets', () => {
    const ok = validatePlay([], rack, false, [S(1, [T(0, 10), T(0, 11), T(0, 12)]), S(2, [T(1, 2), T(1, 3), T(1, 4)], 5)]);
    expect(ok).toMatchObject({ ok: true, meldPoints: 42 });
  });
  it('na abertura a mesa antiga não pode mudar', () => {
    const table = [S(1, [T(3, 5), T(3, 6), T(3, 7)])];
    const r = validatePlay(table, rack, false, [S(1, [T(3, 5), T(3, 6), T(3, 7)]), S(2, [T(0, 10), T(0, 11), T(0, 12)], 5)]);
    expect(r.ok).toBe(true);
    const bad = validatePlay(table, [...rack, T(3, 8)], false, [S(1, [T(3, 5), T(3, 6), T(3, 7), T(3, 8)]), S(2, [T(0, 10), T(0, 11), T(0, 12)], 8)]);
    expect(bad.ok).toBe(false);
  });
  it('depois de abrir pode estender e rearranjar a mesa', () => {
    const table = [S(1, [T(3, 5), T(3, 6), T(3, 7)])];
    const r = validatePlay(table, [T(3, 8), T(3, 4)], true, [S(1, [T(3, 4), T(3, 5), T(3, 6), T(3, 7), T(3, 8)])]);
    expect(r.ok).toBe(true);
  });
  it('pedra da mesa não volta ao cavalete e pedra alheia é recusada', () => {
    const table = [S(1, [T(3, 5), T(3, 6), T(3, 7), T(3, 8)])];
    expect(validatePlay(table, [T(1, 1)], true, [S(1, [T(3, 5), T(3, 6), T(3, 7)])]).ok).toBe(false);
    expect(validatePlay(table, [T(1, 1)], true, [S(1, [T(3, 5), T(3, 6), T(3, 7), T(3, 8), T(3, 9)])]).ok).toBe(false);
  });
  it('rejeita ids repetidos e sets inválidos', () => {
    expect(validatePlay([], rack, true, [S(1, [T(0, 10), T(0, 10), T(0, 12)])]).ok).toBe(false);
    expect(validatePlay([], rack, true, [S(1, [T(0, 10), T(0, 11)])]).ok).toBe(false);
  });
});

describe('game', () => {
  const inits = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  it('distribui 14 pedras e conserva as 106', () => {
    const g = createGame(inits, mulberry32(1));
    expect(g.players.every((p) => p.rack.length === 14)).toBe(true);
    expect(g.pool.length).toBe(106 - 28);
  });
  it('comprar encerra o turno e só vale para quem joga', () => {
    const g = createGame(inits, mulberry32(2));
    const cur = currentPlayer(g).id;
    const other = cur === 'a' ? 'b' : 'a';
    expect(drawTurn(g, other).ok).toBe(false);
    const r = drawTurn(g, cur);
    expect(r.ok && currentPlayer(r.state).id).toBe(other);
    expect(r.ok && r.state.players.find((p) => p.id === cur)!.rack.length).toBe(15);
  });
  it('sair da partida dá vitória ao outro', () => {
    const g = removePlayer(createGame(inits, mulberry32(3)), 'a');
    expect(g.phase).toBe('ended');
    expect(g.result!.winners).toEqual(['b']);
    expect(g.result!.points.a).toBeGreaterThanOrEqual(50);
  });
  it('partidas só de bots terminam, são válidas e conservam as pedras', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const players = [{ id: 'a', name: 'A', isBot: true }, { id: 'b', name: 'B', isBot: true }, { id: 'c', name: 'C', isBot: true }];
      let g = createGame(players.slice(0, 2 + (seed % 2)), mulberry32(seed));
      let guard = 0;
      while (g.phase === 'playing' && guard++ < 600) {
        const cur = currentPlayer(g);
        const move = botMove(g);
        const step = move ? playTurn(g, cur.id, move) : drawTurn(g, cur.id);
        expect(step.ok).toBe(true);
        if (!step.ok) return;
        g = step.state;
        const total = g.pool.length + g.table.reduce((a, s) => a + s.tiles.length, 0) + g.players.reduce((a, p) => a + p.rack.length, 0);
        expect(total).toBe(106);
      }
      expect(g.phase).toBe('ended');
      expect(g.result!.winners.length).toBeGreaterThan(0);
      const min = Math.min(...g.players.map((p) => handPoints(p.rack)));
      expect(g.result!.winners.every((w) => handPoints(g.players.find((p) => p.id === w)!.rack) === min)).toBe(true);
    }
  });
});
