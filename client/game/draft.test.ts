import { describe, expect, it } from 'vitest';
import { dropNew, dropOnSet, dropToRack, draftStatus, newDraft, resolveBoardDrop, splitSet, tidyTable, acceptingSets, suggestDrop, newSetSpot } from './draft';

const T = (color: number, num: number) => color * 13 + (num - 1);

describe('draft', () => {
  it('monta conjunto novo, valida e soma a abertura', () => {
    let d = newDraft([], [T(0, 10), T(0, 11), T(0, 12), T(1, 1)], false);
    d = dropNew(d, T(0, 10), 5, 3)!;
    const setId = d.table[0]!.id;
    d = dropOnSet(d, T(0, 11), setId, 1)!;
    d = dropOnSet(d, T(0, 12), setId, 2)!;
    const st = draftStatus(d);
    expect(st.check.ok).toBe(true);
    expect(st.meldPoints).toBe(33);
    expect(d.rack).toEqual([T(1, 1)]);
  });
  it('só devolve ao cavalete pedra jogada neste turno', () => {
    const table = [{ id: 1, tiles: [T(2, 3), T(2, 4), T(2, 5)], x: 2, z: 2 }];
    let d = newDraft(table, [T(2, 6)], true);
    expect(dropToRack(d, T(2, 3), 0)).toBeNull();
    d = dropOnSet(d, T(2, 6), 1, 3)!;
    expect(d.table[0]!.tiles.length).toBe(4);
    d = dropToRack(d, T(2, 6), 0)!;
    expect(d.table[0]!.tiles.length).toBe(3);
    expect(d.placed.size).toBe(0);
  });
  it('dividir conjunto mantém todas as pedras', () => {
    const table = [{ id: 1, tiles: [T(2, 3), T(2, 4), T(2, 5), T(2, 6), T(2, 7), T(2, 8)], x: 2, z: 2 }];
    const d = splitSet(newDraft(table, [], true), 1, 3)!;
    expect(d.table.map((s) => s.tiles.length).sort()).toEqual([3, 3]);
  });
  it('resolve soltar perto de um conjunto como inserção', () => {
    const table = [{ id: 1, tiles: [T(2, 3), T(2, 4), T(2, 5)], x: 4, z: 2 }];
    expect(resolveBoardDrop(table, 7.4, 2.5)).toEqual({ kind: 'insert', setId: 1, index: 3 });
    expect(resolveBoardDrop(table, 4.3, 2.5)).toEqual({ kind: 'insert', setId: 1, index: 0 });
    expect(resolveBoardDrop(table, 12.5, 2.5)).toEqual({ kind: 'new', x: 12, z: 2 });
  });
});

describe('tidyTable', () => {
  it('alinha em linhas sem mudar o conteúdo dos conjuntos', () => {
    const d = newDraft([{ id: 1, tiles: [0, 1, 2], x: 20, z: 9 }, { id: 2, tiles: [13, 14, 15, 16], x: 3, z: 2 }], [], true);
    const t = tidyTable(d)!;
    expect(t.table.map((s) => s.tiles).sort()).toEqual([[0, 1, 2], [13, 14, 15, 16]].sort());
    expect(t.table.every((s) => s.z === 0)).toBe(true);
    expect(t.table.map((s) => s.x).sort((a, b) => a - b)).toEqual([0, 5]);
  });
});

describe('ajuda de encaixe', () => {
  const T = (c: number, n: number) => c * 13 + n - 1;
  const table = [{ id: 1, tiles: [T(0, 4), T(0, 5), T(0, 6)], x: 5, z: 3 }];
  it('acha o conjunto onde a pedra encaixa', () => {
    expect(acceptingSets(table, T(0, 7))).toEqual([{ setId: 1, index: 3 }]);
    expect(acceptingSets(table, T(1, 9))).toEqual([]);
  });
  it('pedra solta perto de um conjunto compatível encaixa nele; longe ou incompatível fica solta', () => {
    expect(suggestDrop(table, T(0, 7), 12, 3.5)).toEqual({ kind: 'insert', setId: 1, index: 3 });
    expect(suggestDrop(table, T(0, 7), 30, 3.5)).toBeNull();
    expect(suggestDrop(table, T(1, 9), 8, 3.5)).toBeNull();
  });
});

describe('lugar guia para pedras soltas', () => {
  it('perto do lugar guia encaixa nele; longe fica onde foi solta', () => {
    const table = [{ id: 1, tiles: [0, 1, 2], x: 15, z: 6 }];
    const near = newSetSpot(table, 99, 13.2, 6.5);
    expect(near.guide).not.toBeNull();
    expect(near.x).toBe(near.guide!.x);
    const far = newSetSpot(table, 99, 2.4, 1.4);
    expect(far.x).toBe(2);
    expect(far.z).toBe(1);
  });
});
