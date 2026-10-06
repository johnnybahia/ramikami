import { tileColor, tileNum, JOKER_POINTS } from './tiles';
import { MELD_MIN } from './rules';

export interface Cand {
  slots: number[]; // chave cor*13+(n-1) ou -1 = coringa
  jokers: number;
  meld: number;
  relief: number;
}

export const key = (id: number): number => tileColor(id) * 13 + tileNum(id) - 1;

export function genCands(cnt: Int8Array, jokers: number): Cand[] {
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
export function packCounts(cnt: Int8Array, jokers: number, needMeld: boolean, budget: number): Cand[] | null {
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

