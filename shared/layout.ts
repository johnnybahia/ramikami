// Posição dos sets na mesa: grade de células, uma pedra por célula, com 1 célula de folga entre sets na mesma linha.
export const COLS = 34;
export const ROWS = 12;

export interface SetState {
  id: number;
  tiles: number[];
  x: number;
  z: number;
}

export function fits(table: readonly SetState[], skipId: number, x: number, z: number, len: number): boolean {
  if (x < 0 || z < 0 || z >= ROWS || x + len > COLS) return false;
  for (const s of table) {
    if (s.id === skipId || s.z !== z) continue;
    if (s.x < x + len + 1 && x < s.x + s.tiles.length + 1) return false;
  }
  return true;
}

/** Célula livre mais próxima de (wantX, wantZ) onde um set de `len` pedras cabe. */
export function findSpot(table: readonly SetState[], skipId: number, wantX: number, wantZ: number, len: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestD = Infinity;
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x + len <= COLS; x++) {
      if (!fits(table, skipId, x, z, len)) continue;
      const d = (x - wantX) ** 2 + ((z - wantZ) * 3) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, z };
      }
    }
  }
  return best;
}

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : 0)));

/** Normaliza posições e resolve sobreposições, mantendo a ordem dos sets. Reatribui ids 1..n. */
export function relayout(input: readonly SetState[]): SetState[] {
  const placed: SetState[] = [];
  input.forEach((s, i) => {
    const len = s.tiles.length;
    const set: SetState = { id: i + 1, tiles: s.tiles.slice(), x: clampInt(s.x, 0, Math.max(0, COLS - len)), z: clampInt(s.z, 0, ROWS - 1) };
    if (!fits(placed, -1, set.x, set.z, len)) {
      const spot = findSpot(placed, -1, set.x, set.z, len);
      if (spot) {
        set.x = spot.x;
        set.z = spot.z;
      }
    }
    placed.push(set);
  });
  return placed;
}
