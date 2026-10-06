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

/** Custo de enquadramento: quanto menor, maiores ficam as pedras na tela (uma fileira vale ~1,64 colunas no celular em pé). */
function frameCost(minX: number, maxX: number, minZ: number, maxZ: number): number {
  return Math.max(maxX - minX, 1.64 * (maxZ - minZ + 1));
}

/**
 * Lugar para um conjunto novo (jogadas de bots e "jogar marcadas"): escolhe a vaga que deixa a mesa com o
 * menor enquadramento (largura x altura, pesando a tela do celular em pé), empilhando os jogos em colunas
 * alinhadas em vez de espalhar; empate vai para o mais perto do centro.
 */
export function findCompactSpot(table: readonly SetState[], len: number): { x: number; z: number } | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of table) {
    minX = Math.min(minX, s.x);
    maxX = Math.max(maxX, s.x + s.tiles.length);
    minZ = Math.min(minZ, s.z);
    maxZ = Math.max(maxZ, s.z);
  }
  let best: { x: number; z: number } | null = null;
  let bestCost = Infinity;
  let bestD = Infinity;
  for (let z = 0; z < ROWS; z++) {
    for (let x = 0; x + len <= COLS; x++) {
      if (!fits(table, -1, x, z, len)) continue;
      const c = frameCost(Math.min(minX, x), Math.max(maxX, x + len), Math.min(minZ, z), Math.max(maxZ, z));
      const d = Math.abs(x + len / 2 - COLS / 2) + Math.abs(z - ROWS / 2) * 2;
      if (c < bestCost - 1e-9 || (Math.abs(c - bestCost) < 1e-9 && d < bestD)) {
        bestCost = c;
        bestD = d;
        best = { x, z };
      }
    }
  }
  return best;
}

/**
 * Vaga guia para uma NOVA linha: usa as fileiras "pares" em volta do centro (uma fileira de folga entre elas),
 * escolhe a mais perto da altura pedida e preenche da esquerda para a direita, perto do centro.
 */
export function findGuideSpot(table: readonly SetState[], len: number, wantZ: number): { x: number; z: number } | null {
  const cx = Math.floor(COLS / 2);
  const cz = Math.floor(ROWS / 2);
  const rows: number[] = [];
  for (let d = 0; d <= ROWS; d++) {
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

const clone = (list: readonly SetState[]): SetState[] => list.map((s) => ({ ...s, tiles: s.tiles.slice() }));

/**
 * Grade imaginária: cada fileira é uma linha; os conjuntos de uma linha ficam sempre com PELO MENOS uma casa
 * (uma pedra) de distância na horizontal. Se um conjunto cresce ou é solto perto de outro, os vizinhos são
 * EMPURRADOS para o lado (para a direita; se faltar espaço na borda, para a esquerda) em vez de mudar de lugar.
 * `anchorId` é o conjunto que fica parado (o que cresceu ou foi solto).
 */
export function packRows(input: readonly SetState[], anchorId = -1): SetState[] | null {
  const out = clone(input);
  const rows = new Map<number, SetState[]>();
  for (const s of out) {
    const r = rows.get(s.z);
    if (r) r.push(s);
    else rows.set(s.z, [s]);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x || (a.id === anchorId ? -1 : b.id === anchorId ? 1 : 0));
    const ai = row.findIndex((s) => s.id === anchorId);
    const len = (s: SetState): number => s.tiles.length;
    if (ai >= 0) {
      for (let i = ai + 1; i < row.length; i++) row[i]!.x = Math.max(row[i]!.x, row[i - 1]!.x + len(row[i - 1]!) + 1);
      for (let i = ai - 1; i >= 0; i--) row[i]!.x = Math.min(row[i]!.x, row[i + 1]!.x - len(row[i]!) - 1);
    } else {
      for (let i = 1; i < row.length; i++) row[i]!.x = Math.max(row[i]!.x, row[i - 1]!.x + len(row[i - 1]!) + 1);
    }
    // estourou a borda direita: puxa para a esquerda; se ainda assim não couber, a linha está cheia
    for (let i = row.length - 1; i >= 0; i--) {
      const maxX = i === row.length - 1 ? COLS - len(row[i]!) : row[i + 1]!.x - len(row[i]!) - 1;
      if (row[i]!.x > maxX) row[i]!.x = maxX;
    }
    for (let i = 0; i < row.length; i++) {
      const minX = i === 0 ? 0 : row[i - 1]!.x + len(row[i - 1]!) + 1;
      if (row[i]!.x < minX) return null;
    }
  }
  return out;
}

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(v) ? v : 0)));

/** Normaliza posições e resolve sobreposições, mantendo a ordem dos sets. Reatribui ids 1..n. */
export function relayout(input: readonly SetState[]): SetState[] {
  const clamped: SetState[] = input.map((s, i) => {
    const len = s.tiles.length;
    return { id: i + 1, tiles: s.tiles.slice(), x: clampInt(s.x, 0, Math.max(0, COLS - len)), z: clampInt(s.z, 0, ROWS - 1) };
  });
  const packed = packRows(clamped);
  if (packed) return packed;
  // linha lotada: coloca um a um no espaço livre mais próximo
  const placed: SetState[] = [];
  for (const set of clamped) {
    if (!fits(placed, -1, set.x, set.z, set.tiles.length)) {
      const spot = findSpot(placed, -1, set.x, set.z, set.tiles.length);
      if (spot) {
        set.x = spot.x;
        set.z = spot.z;
      }
    }
    placed.push(set);
  }
  return placed;
}

/** Quantas pedras são novas na mesa e quantas já estavam mas mudaram de lugar (para dimensionar a animação). */
export function animCounts(prev: readonly SetState[], next: readonly SetState[]): { fresh: number; moved: number } {
  const was = new Map<number, string>();
  for (const s of prev) s.tiles.forEach((t, i) => was.set(t, `${s.x + i},${s.z}`));
  let fresh = 0;
  let moved = 0;
  for (const s of next)
    s.tiles.forEach((t, i) => {
      const old = was.get(t);
      if (old === undefined) fresh++;
      else if (old !== `${s.x + i},${s.z}`) moved++;
    });
  return { fresh, moved };
}
