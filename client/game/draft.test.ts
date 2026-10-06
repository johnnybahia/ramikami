import { describe, expect, it } from 'vitest';
import { dropNew, dropOnSet, dropToRack, draftStatus, newDraft, resolveBoardDrop, splitSet } from './draft';

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
