import { describe, expect, it } from 'vitest';
import { analyzeSet, arrangeTiles, validatePlay } from './rules';
import { createGame, drawTurn, playTurn, removePlayer, currentPlayer, salvagePlay } from './game';
import { botMove, pickBots, PERSONAS } from './bot';
import { solveTable } from './solver';
import { mulberry32, handPoints } from './tiles';
import { findCompactSpot, packRows, relayout, type SetState } from './layout';

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

describe('arrangeTiles', () => {
  it('divide em sequência + trinca', () => {
    const r = arrangeTiles([T(0, 4), T(0, 5), T(0, 6), T(0, 7), T(1, 9), T(2, 9), T(3, 9)], true);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sets.map((s) => s.length).sort()).toEqual([3, 4]);
  });
  it('coringa preenche lacuna', () => {
    const r = arrangeTiles([T(0, 4), J1, T(0, 6)], true);
    expect(r).toMatchObject({ ok: true, points: 15 });
  });
  it('rejeita 2 coringas, sobra de pedra e abertura < 30', () => {
    expect(arrangeTiles([T(0, 4), J1, J2], true).ok).toBe(false);
    expect(arrangeTiles([T(0, 4), T(0, 5), T(0, 6), T(2, 13)], true).ok).toBe(false);
    expect(arrangeTiles([T(0, 4), T(0, 5), T(0, 6)], false).ok).toBe(false);
    expect(arrangeTiles([T(0, 10), T(0, 11), T(0, 12)], false).ok).toBe(true);
  });
});

describe('bots e solucionador', () => {
  it('rearranja a mesa para colocar pedras (tira o 8 da sequência para formar trinca)', () => {
    const table = [S(1, [T(0, 5), T(0, 6), T(0, 7), T(0, 8)], 0, 0)];
    const rack = [T(1, 8), T(2, 8), T(3, 1)];
    const r = solveTable(table, rack, 20000);
    expect(r).not.toBeNull();
    expect(validatePlay(table, rack, true, r!.table).ok).toBe(true);
    expect(r!.placed).toBe(2);
  });
  it('cada personalidade devolve jogada válida ou null, dentro do orçamento de CPU', () => {
    for (const persona of PERSONAS) {
      let worst = 0;
      for (let seed = 1; seed <= 30; seed++) {
        const g = createGame([{ id: 'a', name: 'A', isBot: true }, { id: 'b', name: 'B' }], mulberry32(seed));
        const t0 = performance.now();
        const m = botMove({ ...g, turn: 0 }, persona, mulberry32(seed));
        worst = Math.max(worst, performance.now() - t0);
        if (m) expect(validatePlay(g.table, g.players[0]!.rack, g.players[0]!.melded, m).ok).toBe(true);
      }
      console.log(persona.name, 'pior caso ms:', worst.toFixed(1));
    }
  });
});

describe('salvagePlay (fim do tempo)', () => {
  const base = () => {
    const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], mulberry32(3));
    g.turn = 0;
    g.players[0]!.melded = true;
    g.table = [S(1, [T(0, 5, 1), T(0, 6, 1), T(0, 7, 1)], 0, 0)];
    g.players[0]!.rack = [T(1, 9), T(2, 9), T(3, 9), T(0, 8, 1), T(1, 1)];
    return g;
  };
  it('mantém conjunto só da mão e desfaz o que mexeu em jogo pronto', () => {
    const g = base();
    const draft = [S(1, [T(0, 5, 1), T(0, 6, 1), T(0, 7, 1), T(0, 8, 1)], 0, 0), S(2, [T(1, 9), T(2, 9), T(3, 9)], 0, 3)];
    const out = salvagePlay(g, 'a', draft)!;
    expect(out).not.toBeNull();
    expect(out.table.find((s) => s.tiles.includes(T(0, 8, 1)))).toBeUndefined();
    expect(out.table.some((s) => s.tiles.length === 3 && s.tiles.includes(T(1, 9)))).toBe(true);
    expect(out.players[0]!.rack.sort()).toEqual([T(0, 8, 1), T(1, 1)].sort());
  });
  it('sem conjunto só da mão, ou abertura abaixo de 30, volta tudo (null)', () => {
    const g = base();
    expect(salvagePlay(g, 'a', [S(1, [T(0, 5, 1), T(0, 6, 1), T(0, 7, 1), T(0, 8, 1)], 0, 0)])).toBeNull();
    g.players[0]!.melded = false;
    expect(salvagePlay(g, 'a', [S(1, [T(0, 5, 1), T(0, 6, 1), T(0, 7, 1)], 0, 0), S(2, [T(1, 9), T(2, 9), T(3, 9)], 0, 3)])).toBeNull();
  });
});

describe('pickBots', () => {
  it('devolve exatamente a quantidade pedida, sem repetir nomes', () => {
    for (const level of ['easy', 'normal', 'hard', 'master'] as const) {
      for (const n of [0, 1, 2, 3, 4]) {
        const bots = pickBots(level, n, mulberry32(n + 7));
        expect(bots.length).toBe(n);
        expect(new Set(bots.map((b) => b.id)).size).toBe(n);
        expect(bots.every((b) => b.level === level)).toBe(true);
      }
    }
  });
});

describe('createGame: quem começa', () => {
  it('usa o jogador indicado; sem indicação ou id desconhecido, sorteia', () => {
    const inits = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
    for (const id of ['a', 'b', 'c']) expect(currentPlayer(createGame(inits, mulberry32(1), id)).id).toBe(id);
    const g = createGame(inits, mulberry32(2), 'zzz');
    expect(g.turn).toBeGreaterThanOrEqual(0);
    expect(g.turn).toBeLessThan(3);
  });
});

describe('salvagePlay com checkpoint (jogada válida + outra incompleta)', () => {
  it('mantém a jogada válida (inclusive encaixe em jogo da mesa) e desfaz só a parte incompleta', () => {
    const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], mulberry32(3));
    g.turn = 0;
    g.players[0]!.melded = true;
    g.table = [S(1, [T(0, 5, 1), T(0, 6, 1), T(0, 7, 1)], 0, 0)];
    g.players[0]!.rack = [T(0, 8, 1), T(1, 9), T(2, 9), T(3, 1), T(3, 2)];
    // checkpoint: 8 preto encaixado na sequência da mesa (jogada válida)
    const checkpoint = [S(1, [T(0, 5, 1), T(0, 6, 1), T(0, 7, 1), T(0, 8, 1)], 0, 0)];
    // rascunho atual: começou outra jogada (9 azul + 9 vermelho soltos, e 1/2 laranja soltos)
    const draft = [...checkpoint, S(2, [T(1, 9), T(2, 9)], 0, 3), S(3, [T(3, 1), T(3, 2)], 5, 3)];
    const out = salvagePlay(g, 'a', draft, checkpoint)!;
    expect(out).not.toBeNull();
    expect(out.table.find((s) => s.tiles.includes(T(0, 8, 1)))?.tiles.length).toBe(4);
    expect(out.players[0]!.rack.sort()).toEqual([T(1, 9), T(2, 9), T(3, 1), T(3, 2)].sort());
  });
  it('checkpoint + conjunto novo válido formado depois dele', () => {
    const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], mulberry32(3));
    g.turn = 0;
    g.players[0]!.melded = true;
    g.table = [S(1, [T(0, 5, 1), T(0, 6, 1), T(0, 7, 1)], 0, 0)];
    g.players[0]!.rack = [T(0, 8, 1), T(1, 9), T(2, 9), T(3, 9), T(3, 1)];
    const checkpoint = [S(1, [T(0, 5, 1), T(0, 6, 1), T(0, 7, 1), T(0, 8, 1)], 0, 0)];
    const draft = [...checkpoint, S(2, [T(1, 9), T(2, 9), T(3, 9)], 0, 3)];
    const out = salvagePlay(g, 'a', draft, checkpoint)!;
    expect(out.table.length).toBe(2);
    expect(out.players[0]!.rack).toEqual([T(3, 1)]);
  });
  it('sem checkpoint e sem conjunto só da mão, volta tudo (null)', () => {
    const g = createGame([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], mulberry32(3));
    g.turn = 0;
    g.players[0]!.melded = true;
    expect(salvagePlay(g, 'a', [], null)).toBeNull();
  });
});

describe('findCompactSpot', () => {
  it('conjuntos novos ficam no mesmo enquadramento, em fileiras separadas, sem sobrepor', () => {
    const table: SetState[] = [];
    for (let i = 0; i < 8; i++) {
      const spot = findCompactSpot(table, 4)!;
      expect(spot).not.toBeNull();
      table.push({ id: i + 1, tiles: [0, 1, 2, 3], x: spot.x, z: spot.z });
    }
    const xs = table.map((s) => s.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(23);
    // mesma fileira: sempre uma pedra de distância entre conjuntos
    for (const a of table) for (const b of table) if (a !== b && a.z === b.z) expect(a.x + a.tiles.length + 1 <= b.x || b.x + b.tiles.length + 1 <= a.x).toBe(true);
    expect(relayout(table).map((s) => [s.x, s.z])).toEqual(table.map((s) => [s.x, s.z]));
  });
});

describe('grade: packRows e relayout', () => {
  const set = (id: number, n: number, x: number, z: number): SetState => ({ id, tiles: Array.from({ length: n }, (_, i) => id * 10 + i), x, z });
  it('conjunto que cresce empurra os vizinhos da linha para a direita, mantendo uma pedra de distância', () => {
    const a = set(1, 5, 2, 3); // 2..6 (cresceu)
    const b = set(2, 3, 8, 3); // 8..10: ficou colado
    const c = set(3, 3, 12, 3);
    const out = packRows([a, b, c], 1)!;
    const get = (id: number) => out.find((s) => s.id === id)!;
    expect(get(1).x).toBe(2);
    expect(get(2).x).toBe(8);
    expect(get(3).x).toBe(12);
    const grown = packRows([set(1, 7, 2, 3), b, c], 1)!;
    expect(grown.find((s) => s.id === 2)!.x).toBe(10); // 2..8 + 1 de folga
    expect(grown.find((s) => s.id === 3)!.x).toBe(14); // empurrado em cadeia
  });
  it('na borda direita puxa para a esquerda; outras fileiras não mudam', () => {
    const out = packRows([set(1, 5, 28, 2), set(2, 3, 20, 2), set(3, 4, 10, 5)], 1)!;
    const g = (id: number) => out.find((s) => s.id === id)!;
    expect(g(1).x + 5).toBeLessThanOrEqual(34);
    expect(g(2).x + 3 + 1).toBeLessThanOrEqual(g(1).x);
    expect(g(3).x).toBe(10);
  });
  it('relayout nunca deixa dois conjuntos colados na mesma linha', () => {
    const out = relayout([set(1, 4, 5, 1), set(2, 4, 7, 1), set(3, 3, 8, 1)]);
    for (const a of out) for (const b of out) if (a !== b && a.z === b.z) expect(a.x + a.tiles.length + 1 <= b.x || b.x + b.tiles.length + 1 <= a.x).toBe(true);
  });
});

import { CHATTER, CHATTER_NAMED, pickChatter } from './chatter';
describe('chatter', () => {
  it('tem ~50 frases e sorteia de cada tipo', () => {
    const all = Object.values(CHATTER).flat();
    expect(all.length).toBeGreaterThanOrEqual(50);
    expect(new Set(all).size).toBe(all.length);
    for (const k of Object.keys(CHATTER) as (keyof typeof CHATTER)[]) expect(CHATTER[k]).toContain(pickChatter(k));
  });
  it('frases dirigidas usam o nome do jogador', () => {
    for (const k of Object.keys(CHATTER_NAMED) as (keyof typeof CHATTER_NAMED)[]) {
      expect(CHATTER_NAMED[k].every((t) => t.includes('{nome}'))).toBe(true);
      expect(pickChatter(k, () => 0, 'Johnny')).toContain('Johnny');
      expect(pickChatter(k, () => 0.99, 'Johnny')).not.toContain('{nome}');
    }
  });
});
