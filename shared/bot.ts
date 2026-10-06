import { isJoker, tileColor, tileNum, tileValue, JOKER_POINTS } from './tiles';
import { analyzeSet, validatePlay, MELD_MIN } from './rules';
import { COLS, ROWS, findSpot, relayout, type SetState } from './layout';
import type { GameState } from './game';

interface Cand {
  slots: number[]; // chave cor*13+(n-1) ou -1 = coringa
  jokers: number;
  meld: number;
  relief: number;
}

const key = (id: number): number => tileColor(id) * 13 + tileNum(id) - 1;
export type BotLevel = 'easy' | 'normal' | 'hard';
export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard'];
const LEVEL: Record<BotLevel, { budget: number; extend: boolean; jokers: boolean; skip: number }> = {
  easy: { budget: 1500, extend: false, jokers: false, skip: 0.4 },
  normal: { budget: 8000, extend: true, jokers: false, skip: 0.1 },
  hard: { budget: 40000, extend: true, jokers: true, skip: 0 },
};

function genCands(cnt: Int8Array, jokers: number): Cand[] {
  const out: Cand[] = [];
  for (let c = 0; c < 4; c++) {
    for (let s = 1; s <= 11; s++) {
      for (let len = 3; s + len - 1 <= 13; len++) {
        const slots: number[] = [];
        let missing = 0;
        let meld = 0;
        let relief = 0;
        for (let n = s; n < s + len; n++) {
          const k = c * 13 + n - 1;
          meld += n;
          if (cnt[k]! > 0) {
            slots.push(k);
            relief += n;
          } else {
            slots.push(-1);
            missing++;
            relief += JOKER_POINTS;
          }
        }
        if (missing > jokers || missing === len) continue;
        out.push({ slots, jokers: missing, meld, relief });
      }
    }
  }
  for (let n = 1; n <= 13; n++) {
    for (let mask = 0; mask < 16; mask++) {
      let size = 0;
      for (let c = 0; c < 4; c++) if (mask & (1 << c)) size++;
      if (size < 3) continue;
      const slots: number[] = [];
      let missing = 0;
      let relief = 0;
      for (let c = 0; c < 4; c++) {
        if (!(mask & (1 << c))) continue;
        const k = c * 13 + n - 1;
        if (cnt[k]! > 0) {
          slots.push(k);
          relief += n;
        } else {
          slots.push(-1);
          missing++;
          relief += JOKER_POINTS;
        }
      }
      if (missing > jokers || missing === size) continue;
      out.push({ slots, jokers: missing, meld: n * size, relief });
    }
  }
  return out.sort((a, b) => b.relief - a.relief);
}

/** Melhor conjunto de sets novos só com o cavalete (maximiza pontos tirados da mão; abertura exige 30+). */
function packRack(rack: readonly number[], needMeld: boolean, budget: number): Cand[] | null {
  const cnt = new Int8Array(52);
  let jokers = 0;
  for (const id of rack) {
    if (isJoker(id)) jokers++;
    else cnt[key(id)]!++;
  }
  const cands = genCands(cnt, jokers);
  let best: { sel: number[]; relief: number } | null = null;
  let nodes = 0;
  const sel: number[] = [];
  let jokersLeft = jokers;
  const dfs = (i: number, relief: number, meld: number): void => {
    if (nodes++ > budget) return;
    if (sel.length > 0 && (!needMeld || meld >= MELD_MIN) && (!best || relief > best.relief)) best = { sel: sel.slice(), relief };
    if (i >= cands.length) return;
    const c = cands[i]!;
    let ok = c.jokers <= jokersLeft;
    if (ok) for (const k of c.slots) if (k >= 0 && cnt[k]! <= 0) { ok = false; break; }
    // um candidato pode usar a mesma chave duas vezes? não: cada slot tem chave distinta
    if (ok) {
      for (const k of c.slots) if (k >= 0) cnt[k]!--;
      jokersLeft -= c.jokers;
      sel.push(i);
      dfs(i + 1, relief + c.relief, meld + c.meld);
      sel.pop();
      jokersLeft += c.jokers;
      for (const k of c.slots) if (k >= 0) cnt[k]!++;
    }
    dfs(i + 1, relief, meld);
  };
  dfs(0, 0, 0);
  const found = best as { sel: number[]; relief: number } | null;
  return found ? found.sel.map((i) => cands[i]!) : null;
}

function realize(rack: readonly number[], chosen: readonly Cand[]): { sets: number[][]; rest: number[] } {
  const stacks = new Map<number, number[]>();
  const jokers: number[] = [];
  for (const id of rack) {
    if (isJoker(id)) jokers.push(id);
    else {
      const k = key(id);
      if (!stacks.has(k)) stacks.set(k, []);
      stacks.get(k)!.push(id);
    }
  }
  const sets = chosen.map((c) => c.slots.map((k) => (k === -1 ? jokers.pop()! : stacks.get(k)!.pop()!)));
  const rest = [...jokers, ...[...stacks.values()].flat()];
  return { sets, rest };
}

function extend(table: SetState[], rest: number[], allowJokers: boolean): number[] {
  let remaining = rest.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of remaining.slice()) {
      if (isJoker(t) && !allowJokers) continue;
      let done = false;
      for (const s of table) {
        for (let pos = 0; pos <= s.tiles.length && !done; pos++) {
          const cand = [...s.tiles.slice(0, pos), t, ...s.tiles.slice(pos)];
          if (analyzeSet(cand).valid) {
            s.tiles = cand;
            done = true;
          }
        }
        if (done) break;
      }
      if (done) {
        remaining = remaining.filter((r) => r !== t);
        changed = true;
      }
    }
  }
  return remaining;
}

/** Jogada do bot: nova mesa, ou null para comprar uma pedra. */
export function botMove(state: GameState, level: BotLevel = 'hard', rng: () => number = Math.random): SetState[] | null {
  const me = state.players[state.turn]!;
  const cfg = LEVEL[level];
  if (me.melded && rng() < cfg.skip) return null;
  const chosen = packRack(me.rack, !me.melded, cfg.budget);
  let table: SetState[] = state.table.map((s) => ({ ...s, tiles: s.tiles.slice() }));
  let rest = me.rack.slice();
  if (chosen) {
    const r = realize(me.rack, chosen);
    rest = r.rest;
    for (const tiles of r.sets) {
      const spot = findSpot(table, -1, Math.floor((COLS - tiles.length) / 2), Math.floor(ROWS / 2), tiles.length);
      if (!spot) return null;
      table.push({ id: table.length + 1, tiles, x: spot.x, z: spot.z });
    }
  }
  if (me.melded) {
    if (cfg.extend) rest = extend(table, rest, false);
    if (cfg.jokers && rest.length > 0 && rest.every(isJoker)) rest = extend(table, rest, true);
  } else if (!chosen) {
    return null;
  }
  table = relayout(table);
  const check = validatePlay(state.table, me.rack, me.melded, table);
  if (!check.ok) return null;
  return table;
}

export { tileValue };
