import { isJoker, tileColor, tileNum, TILE_COUNT } from './tiles';
import type { SetState } from './layout';

export const MELD_MIN = 30;

export interface SetInfo {
  valid: boolean;
  points: number;
  kind: 'run' | 'group' | null;
}

const NO_SET: SetInfo = { valid: false, points: 0, kind: null };

function runPoints(tiles: readonly number[]): number {
  const n = tiles.length;
  let color = -2;
  let start: number | null = null;
  for (let i = 0; i < n; i++) {
    const id = tiles[i]!;
    if (isJoker(id)) continue;
    const c = tileColor(id);
    if (color === -2) color = c;
    else if (c !== color) return -1;
    const s = tileNum(id) - i;
    if (start === null) start = s;
    else if (start !== s) return -1;
  }
  if (start === null || start < 1 || start + n - 1 > 13) return -1;
  return n * start + (n * (n - 1)) / 2;
}

function groupPoints(tiles: readonly number[]): number {
  const n = tiles.length;
  if (n < 3 || n > 4) return -1;
  let num = -1;
  const colors = new Set<number>();
  for (const id of tiles) {
    if (isJoker(id)) continue;
    const v = tileNum(id);
    if (num === -1) num = v;
    else if (num !== v) return -1;
    const c = tileColor(id);
    if (colors.has(c)) return -1;
    colors.add(c);
  }
  return num === -1 ? -1 : num * n;
}

/** Sequência (mesma cor, números consecutivos, 3+) ou trinca/quadra (mesmo número, cores diferentes). Coringa vale o que falta. */
export function analyzeSet(tiles: readonly number[]): SetInfo {
  if (tiles.length < 3 || tiles.length > 13) return NO_SET;
  const run = runPoints(tiles);
  const grp = groupPoints(tiles);
  if (run < 0 && grp < 0) return NO_SET;
  return run >= grp ? { valid: true, points: run, kind: 'run' } : { valid: true, points: grp, kind: 'group' };
}

export type PlayCheck = { ok: true; added: number[]; meldPoints: number } | { ok: false; reason: string };

const fail = (reason: string): PlayCheck => ({ ok: false, reason });
const setKey = (tiles: readonly number[]): string => tiles.slice().sort((a, b) => a - b).join(',');

/**
 * Valida a mesa proposta ao fim do turno.
 * - nenhuma pedra da mesa some; só entram pedras do cavalete do jogador;
 * - todo set precisa ser válido;
 * - na abertura (melded = false) a mesa antiga fica intacta e os sets novos, só com pedras do cavalete, somam 30+.
 */
export function validatePlay(prevTable: readonly SetState[], rack: readonly number[], melded: boolean, newTable: readonly SetState[]): PlayCheck {
  if (!Array.isArray(newTable)) return fail('mesa inválida');
  const seen = new Set<number>();
  for (const s of newTable) {
    if (!s || !Array.isArray(s.tiles)) return fail('mesa inválida');
    for (const t of s.tiles) {
      if (!Number.isInteger(t) || t < 0 || t >= TILE_COUNT) return fail('pedra inválida');
      if (seen.has(t)) return fail('pedra repetida');
      seen.add(t);
    }
  }
  const prevTiles = new Set<number>();
  for (const s of prevTable) for (const t of s.tiles) prevTiles.add(t);
  for (const t of prevTiles) if (!seen.has(t)) return fail('pedra da mesa não pode voltar ao cavalete');
  const rackSet = new Set(rack);
  const added: number[] = [];
  for (const t of seen) {
    if (prevTiles.has(t)) continue;
    if (!rackSet.has(t)) return fail('pedra que não é sua');
    added.push(t);
  }
  if (added.length === 0) return fail('nenhuma pedra jogada');
  for (const s of newTable) if (!analyzeSet(s.tiles).valid) return fail('há um conjunto inválido na mesa');

  let meldPoints = 0;
  if (!melded) {
    const remaining = new Map<string, number>();
    for (const s of prevTable) remaining.set(setKey(s.tiles), (remaining.get(setKey(s.tiles)) ?? 0) + 1);
    for (const s of newTable) {
      const k = setKey(s.tiles);
      const left = remaining.get(k) ?? 0;
      if (left > 0) {
        remaining.set(k, left - 1);
        continue;
      }
      for (const t of s.tiles) if (!rackSet.has(t)) return fail('na abertura use só pedras do seu cavalete');
      meldPoints += analyzeSet(s.tiles).points;
    }
    for (const left of remaining.values()) if (left > 0) return fail('na abertura a mesa não pode ser alterada');
    if (meldPoints < MELD_MIN) return fail(`abertura precisa de ${MELD_MIN} pontos (você tem ${meldPoints})`);
  }
  return { ok: true, added, meldPoints };
}
