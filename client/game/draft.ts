// Rascunho do turno: o jogador mexe na mesa e no cavalete livremente; só vale ao confirmar.
import { analyzeSet, validatePlay, MELD_MIN, type PlayCheck } from '../../shared/rules';
import { COLS, ROWS, findSpot, fits, relayout, type SetState } from '../../shared/layout';
import { isJoker, tileColor, tileNum } from '../../shared/tiles';

export interface Draft {
  baseTable: SetState[];
  baseRack: number[];
  table: SetState[];
  rack: number[];
  /** pedras que vieram do cavalete neste turno (só essas podem voltar para ele) */
  placed: Set<number>;
  melded: boolean;
}

export type DropAction = { kind: 'insert'; setId: number; index: number } | { kind: 'new'; x: number; z: number };

export function newDraft(table: readonly SetState[], rack: readonly number[], melded: boolean): Draft {
  const t = table.map((s) => ({ ...s, tiles: s.tiles.slice() }));
  return { baseTable: t.map((s) => ({ ...s, tiles: s.tiles.slice() })), baseRack: rack.slice(), table: t, rack: rack.slice(), placed: new Set(), melded };
}

export const cloneDraft = (d: Draft): Draft => ({
  ...d,
  table: d.table.map((s) => ({ ...s, tiles: s.tiles.slice() })),
  rack: d.rack.slice(),
  placed: new Set(d.placed),
});

export const isDirty = (d: Draft): boolean => d.placed.size > 0 || JSON.stringify(d.table) !== JSON.stringify(d.baseTable);

function detach(d: Draft, id: number): void {
  const ri = d.rack.indexOf(id);
  if (ri >= 0) {
    d.rack.splice(ri, 1);
    return;
  }
  for (let i = 0; i < d.table.length; i++) {
    const s = d.table[i]!;
    const k = s.tiles.indexOf(id);
    if (k >= 0) {
      s.tiles.splice(k, 1);
      if (s.tiles.length === 0) d.table.splice(i, 1);
      return;
    }
  }
}

/** Mesa como ficaria sem a pedra `id` (para decidir onde ela cai). */
export function tableWithoutTile(table: readonly SetState[], id: number): SetState[] {
  const out: SetState[] = [];
  for (const s of table) {
    const tiles = s.tiles.filter((t) => t !== id);
    if (tiles.length > 0) out.push({ ...s, tiles });
  }
  return out;
}

const inRack = (d: Draft, id: number): boolean => d.rack.includes(id);
const inTable = (d: Draft, id: number): boolean => d.table.some((s) => s.tiles.includes(id));
const nextId = (d: Draft): number => d.table.reduce((m, s) => Math.max(m, s.id), 0) + 1;

/** Solta uma pedra no cavalete (reordenar) ou devolve uma pedra que você mesmo jogou neste turno. */
export function dropToRack(d: Draft, id: number, index: number): Draft | null {
  if (!inRack(d, id) && !(inTable(d, id) && d.placed.has(id))) return null;
  const n = cloneDraft(d);
  detach(n, id);
  n.rack.splice(Math.max(0, Math.min(index, n.rack.length)), 0, id);
  n.placed.delete(id);
  return n;
}

export function dropOnSet(d: Draft, id: number, setId: number, index: number): Draft | null {
  const n = cloneDraft(d);
  const wasInRack = inRack(n, id);
  const origin = n.table.find((s) => s.tiles.includes(id));
  // índice informado vale para o conjunto sem a pedra; se vem do mesmo conjunto, ajusta
  detach(n, id);
  const target = n.table.find((s) => s.id === setId);
  if (!target) return null;
  if (origin && origin.id === setId) {
    /* mesmo conjunto: índice já é relativo ao conjunto sem a pedra */
  }
  target.tiles.splice(Math.max(0, Math.min(index, target.tiles.length)), 0, id);
  if (wasInRack) n.placed.add(id);
  n.table = fixLayout(n.table, setId);
  return n;
}

export function dropNew(d: Draft, id: number, x: number, z: number): Draft | null {
  const n = cloneDraft(d);
  const wasInRack = inRack(n, id);
  detach(n, id);
  const spot = findSpot(n.table, -1, x, z, 1);
  if (!spot) return null;
  n.table.push({ id: nextId(n), tiles: [id], x: spot.x, z: spot.z });
  if (wasInRack) n.placed.add(id);
  return n;
}

export function splitSet(d: Draft, setId: number, index: number): Draft | null {
  const s = d.table.find((x) => x.id === setId);
  if (!s || index <= 0 || index >= s.tiles.length) return null;
  const n = cloneDraft(d);
  const src = n.table.find((x) => x.id === setId)!;
  const tail = src.tiles.splice(index);
  const spot = findSpot(n.table, -1, src.x + index + 1, src.z, tail.length);
  if (!spot) return null;
  n.table.push({ id: nextId(n), tiles: tail, x: spot.x, z: spot.z });
  return n;
}

export function moveSet(d: Draft, setId: number, x: number, z: number): Draft | null {
  const n = cloneDraft(d);
  const s = n.table.find((v) => v.id === setId);
  if (!s) return null;
  const spot = findSpot(n.table, setId, x, z, s.tiles.length);
  if (!spot) return null;
  s.x = spot.x;
  s.z = spot.z;
  return n;
}

/** Depois de aumentar um conjunto, garante que ele (e só ele) não invade vizinhos. */
function fixLayout(table: SetState[], setId: number): SetState[] {
  const s = table.find((v) => v.id === setId);
  if (!s) return table;
  if (!fits(table, setId, s.x, s.z, s.tiles.length)) {
    const spot = findSpot(table, setId, s.x, s.z, s.tiles.length);
    if (spot) {
      s.x = spot.x;
      s.z = spot.z;
    }
  }
  return table;
}

/** Converte a posição solta (em células, centro das pedras em n+0.5) numa ação. */
export function resolveBoardDrop(table: readonly SetState[], cx: number, cz: number): DropAction {
  const row = Math.floor(cz);
  let best: { set: SetState; dist: number } | null = null;
  for (const s of table) {
    if (s.z !== row) continue;
    const left = s.x - 0.9;
    const right = s.x + s.tiles.length + 0.9;
    if (cx < left || cx > right) continue;
    const centre = s.x + s.tiles.length / 2;
    const dist = Math.abs(cx - centre);
    if (!best || dist < best.dist) best = { set: s, dist };
  }
  if (best) {
    let index = 0;
    for (let i = 0; i < best.set.tiles.length; i++) if (best.set.x + i + 0.5 < cx) index = i + 1;
    return { kind: 'insert', setId: best.set.id, index };
  }
  return { kind: 'new', x: Math.max(0, Math.min(COLS - 1, Math.floor(cx))), z: Math.max(0, Math.min(ROWS - 1, row)) };
}

export function sortRack(d: Draft, mode: 'num' | 'color'): Draft {
  const n = cloneDraft(d);
  const key = (id: number): number => (isJoker(id) ? 1000 : mode === 'num' ? tileNum(id) * 10 + tileColor(id) : tileColor(id) * 100 + tileNum(id));
  n.rack.sort((a, b) => key(a) - key(b) || a - b);
  return n;
}

export interface DraftStatus {
  setValid: Map<number, boolean>;
  allValid: boolean;
  check: PlayCheck;
  /** pontos dos conjuntos novos feitos só com o cavalete (abertura) */
  meldPoints: number;
}

export function draftStatus(d: Draft): DraftStatus {
  const setValid = new Map<number, boolean>();
  for (const s of d.table) setValid.set(s.id, analyzeSet(s.tiles).valid);
  const allValid = d.table.every((s) => setValid.get(s.id));
  const check = validatePlay(d.baseTable, d.baseRack, d.melded, relayout(d.table));
  // pontos "ao vivo" mesmo antes de valer: soma de conjuntos válidos feitos só de pedras jogadas
  let meldPoints = 0;
  if (!d.melded) {
    for (const s of d.table) if (s.tiles.every((t) => d.placed.has(t))) meldPoints += analyzeSet(s.tiles).points;
  } else if (check.ok) meldPoints = check.meldPoints;
  return { setValid, allValid, check, meldPoints };
}

export { MELD_MIN };
