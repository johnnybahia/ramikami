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

/**
 * Lugar para um conjunto novo (jogadas de bots e "jogar marcadas"): começa no mesmo enquadramento da tela
 * (perto do centro), enche cada fileira da esquerda para a direita e pula uma fileira entre elas para as
 * pedras ficarem mais separadas. Só abre para os lados/cima/baixo quando não houver mais espaço útil.
 */
export function findCompactSpot(table: readonly SetState[], len: number): { x: number; z: number } | null {
  const cx = Math.floor(COLS / 2);
  const cz = Math.floor(ROWS / 2);
  const rows: number[] = [0];
  for (let d = 2; d <= ROWS; d += 2) rows.push(-d, d);
  for (let half = 5; half <= COLS / 2; half += 3) {
    const lo = Math.max(0, cx - half);
    const hi = Math.min(COLS, cx + half + 1);
    for (const dz of rows) {
      const z = cz + dz;
      if (z < 0 || z >= ROWS) continue;
      for (let x = lo; x + len <= hi; x++) if (fits(table, -1, x, z, len)) return { x, z };
    }
  }
  return findSpot(table, -1, cx, cz, len);
}

/**
 * Vaga guia para uma NOVA linha: usa as fileiras "pares" em volta do centro (uma fileira de folga entre elas),
 * escolhe a mais perto da altura pedida e preenche da esquerda para a direita, perto do centro.
 */
export function findGuideSpot(table: readonly SetState[], len: number, wantZ: number): { x: number; z: number } | null {
  const cx = Math.floor(COLS / 2);
  const cz = Math.floor(ROWS / 2);
  const rows: number[] = [];
  for (let d = 0; d <= ROWS; d += 2) {
    if (d === 0) rows.push(cz);
    else rows.push(cz - d, cz + d);
  }
  const ordered = rows.filter((z) => z >= 0 && z < ROWS).sort((a, b) => Math.abs(a + 0.5 - wantZ) - Math.abs(b + 0.5 - wantZ));
  for (let half = 5; half <= COLS / 2; half += 3) {
    const lo = Math.max(0, cx - half);
    const hi = Math.min(COLS, cx + half + 1);
    for (const z of ordered) for (let x = lo; x + len <= hi; x++) if (fits(table, -1, x, z, len)) return { x, z };
  }
  return findCompactSpot(table, len);
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
