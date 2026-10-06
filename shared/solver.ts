// Rearranjo da mesa: reparte as pedras da mesa + cavalete em conjuntos válidos cobrindo TODA a mesa e
// colocando o máximo de pontos do cavalete. Busca exata com limite de nós (CPU do Worker é curta).
import { isJoker, JOKER_POINTS } from './tiles';
import { COLS, ROWS, findSpot, type SetState } from './layout';
import { key, packCounts } from './pack';

interface Step {
  slots: number[];
  jokers: number;
}

export interface Rearranged {
  table: SetState[];
  /** pontos de pedras do cavalete colocadas */
  relief: number;
  placed: number;
}

const keyValue = (k: number): number => (k % 13) + 1;
const keyColor = (k: number): number => Math.floor(k / 13);

/** Conjuntos possíveis que contêm a chave k, usando só o que ainda está disponível. */
function candidatesFor(k: number, avail: Int8Array, jokersLeft: number): Step[] {
  const out: Step[] = [];
  const c = keyColor(k);
  const n = keyValue(k);
  for (let s = Math.max(1, n - 12); s <= n; s++) {
    for (let e = Math.max(s + 2, n); e <= 13; e++) {
      const slots: number[] = [];
      let missing = 0;
      for (let v = s; v <= e; v++) {
        const kk = c * 13 + v - 1;
        if (avail[kk]! > 0) slots.push(kk);
        else {
          slots.push(-1);
          missing++;
        }
      }
      if (missing > jokersLeft || missing === slots.length) continue;
      out.push({ slots, jokers: missing });
    }
  }
  for (let mask = 0; mask < 16; mask++) {
    if (!(mask & (1 << c))) continue;
    let size = 0;
    for (let cc = 0; cc < 4; cc++) if (mask & (1 << cc)) size++;
    if (size < 3) continue;
    const slots: number[] = [];
    let missing = 0;
    for (let cc = 0; cc < 4; cc++) {
      if (!(mask & (1 << cc))) continue;
      const kk = cc * 13 + n - 1;
      if (avail[kk]! > 0) slots.push(kk);
      else {
        slots.push(-1);
        missing++;
      }
    }
    if (missing > jokersLeft || missing === size) continue;
    out.push({ slots, jokers: missing });
  }
  return out;
}

/** Conjuntos que usam ao menos um coringa (para encaixar coringas que estavam na mesa). */
function jokerCandidates(avail: Int8Array, jokersLeft: number): Step[] {
  const out: Step[] = [];
  for (let c = 0; c < 4; c++) {
    for (let s = 1; s <= 11; s++) {
      for (let e = s + 2; e <= 13; e++) {
        const slots: number[] = [];
        let missing = 0;
        for (let v = s; v <= e; v++) {
          const kk = c * 13 + v - 1;
          if (avail[kk]! > 0) slots.push(kk);
          else {
            slots.push(-1);
            missing++;
          }
        }
        if (missing === 0 || missing > jokersLeft || missing === slots.length) continue;
        out.push({ slots, jokers: missing });
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
      for (let c = 0; c < 4; c++) {
        if (!(mask & (1 << c))) continue;
        const kk = c * 13 + n - 1;
        if (avail[kk]! > 0) slots.push(kk);
        else {
          slots.push(-1);
          missing++;
        }
      }
      if (missing === 0 || missing > jokersLeft || missing === size) continue;
      out.push({ slots, jokers: missing });
    }
  }
  return out;
}

const MAX_FOCUS = 7;

/** Só os conjuntos da mesa "perto" das pedras do cavalete entram no rearranjo; o resto fica como está. */
function focusSets(table: readonly SetState[], rack: readonly number[]): { focus: SetState[]; fixed: SetState[] } {
  const rackKeys = rack.filter((t) => !isJoker(t)).map(key);
  const scored = table.map((s) => {
    let score = 0;
    for (const t of s.tiles) {
      if (isJoker(t)) {
        score += 1;
        continue;
      }
      const k = key(t);
      for (const r of rackKeys) {
        const sameNum = keyValue(r) === keyValue(k);
        const near = keyColor(r) === keyColor(k) && Math.abs(keyValue(r) - keyValue(k)) <= 2;
        if (sameNum || near) score++;
      }
    }
    return { s, score };
  });
  const picked = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, MAX_FOCUS);
  const pickedSet = new Set(picked.map((x) => x.s));
  return { focus: picked.map((x) => x.s), fixed: table.filter((s) => !pickedSet.has(s)) };
}

export function solveTable(fullTable: readonly SetState[], rack: readonly number[], budget: number, maxMs = 60): Rearranged | null {
  const { focus: table, fixed } = focusSets(fullTable, rack);
  const startAt = performance.now();
  const tableCnt = new Int8Array(52);
  const avail = new Int8Array(52);
  let tableJ = 0;
  let jokersLeft = 0;
  const tableIds: number[][] = Array.from({ length: 52 }, () => []);
  const rackIds: number[][] = Array.from({ length: 52 }, () => []);
  const tJ: number[] = [];
  const rJ: number[] = [];
  for (const s of table)
    for (const t of s.tiles) {
      if (isJoker(t)) {
        tableJ++;
        jokersLeft++;
        tJ.push(t);
      } else {
        tableCnt[key(t)]!++;
        avail[key(t)]!++;
        tableIds[key(t)]!.push(t);
      }
    }
  for (const t of rack) {
    if (isJoker(t)) {
      jokersLeft++;
      rJ.push(t);
    } else {
      avail[key(t)]!++;
      rackIds[key(t)]!.push(t);
    }
  }
  const need = Int8Array.from(tableCnt);
  let jokersNeed = tableJ;

  let nodes = 0;
  let best: { steps: Step[]; relief: number } | null = null;
  const chosen: Step[] = [];

  const reliefOf = (): number => {
    let r = 0;
    for (const st of chosen) for (const k of st.slots) if (k >= 0) r += keyValue(k);
    // pedras da mesa não contam: desconta o que já estava lá
    let tab = 0;
    for (let k = 0; k < 52; k++) tab += tableCnt[k]! * keyValue(k);
    return r - tab + (chosen.reduce((a, st) => a + st.jokers, 0) - tableJ) * JOKER_POINTS;
  };

  const dfs = (): void => {
    if (nodes++ > budget || ((nodes & 63) === 0 && performance.now() - startAt > maxMs)) return;
    // próxima chave da mesa ainda não coberta, com menos opções
    let pick = -1;
    let pickList: Step[] = [];
    for (let k = 0; k < 52; k++) {
      if (need[k]! <= 0) continue;
      const list = candidatesFor(k, avail, jokersLeft);
      if (pick < 0 || list.length < pickList.length) {
        pick = k;
        pickList = list;
        if (list.length === 0) return; // beco sem saída
      }
    }
    if (pick < 0) {
      if (jokersNeed > 0) {
        // coringas da mesa precisam estar em algum conjunto
        const list = jokerCandidates(avail, jokersLeft);
        for (const st of list) {
          take(st);
          dfs();
          untake(st);
          if (nodes > budget) return;
        }
        return;
      }
      leaf();
      return;
    }
    // prefere conjuntos que cobrem mais pedras da mesa e usam menos coringas
    const cover = (st: Step): number => st.slots.reduce((a, k) => a + (k >= 0 && need[k]! > 0 ? 1 : 0), 0);
    pickList.sort((a, b) => cover(b) - cover(a) || a.jokers - b.jokers || a.slots.length - b.slots.length);
    for (const st of pickList) {
      take(st);
      dfs();
      untake(st);
      if (nodes > budget) return;
    }
  };

  const savedNeed: Int8Array[] = [];
  const savedJN: number[] = [];
  const take = (st: Step): void => {
    savedNeed.push(Int8Array.from(need));
    savedJN.push(jokersNeed);
    for (const k of st.slots) {
      if (k < 0) continue;
      avail[k]!--;
      if (need[k]! > 0) need[k]!--;
    }
    jokersLeft -= st.jokers;
    jokersNeed = Math.max(0, jokersNeed - st.jokers);
    chosen.push(st);
  };
  const untake = (st: Step): void => {
    chosen.pop();
    jokersLeft += st.jokers;
    for (const k of st.slots) if (k >= 0) avail[k]!++;
    need.set(savedNeed.pop()!);
    jokersNeed = savedJN.pop()!;
  };

  let leaves = 0;
  const leaf = (): void => {
    if (leaves++ > 40) return;
    const base = reliefOf();
    // o que sobra (todo do cavalete) pode virar conjuntos novos
    const extra = packCounts(Int8Array.from(avail), jokersLeft, false, 600);
    let relief = base;
    if (extra) for (const c of extra) relief += c.relief;
    if (!best || relief > best.relief) {
      const steps = chosen.map((s) => ({ slots: s.slots.slice(), jokers: s.jokers }));
      if (extra) for (const c of extra) steps.push({ slots: c.slots.slice(), jokers: c.jokers });
      best = { steps, relief };
    }
  };

  dfs();
  const found = best as { steps: Step[]; relief: number } | null;
  if (!found || found.relief <= 0) return null;

  // realiza com ids reais: pedras da mesa primeiro, depois do cavalete
  const poolT = tableIds.map((a) => a.slice());
  const poolR = rackIds.map((a) => a.slice());
  const jt = tJ.slice();
  const jr = rJ.slice();
  const sets: number[][] = found.steps.map((st) =>
    st.slots.map((k) => (k === -1 ? (jt.pop() ?? jr.pop()!) : (poolT[k]!.pop() ?? poolR[k]!.pop()!))),
  );
  const rackSet = new Set(rack);
  let placed = 0;
  for (const set of sets) for (const t of set) if (rackSet.has(t)) placed++;

  // mantém posição dos conjuntos que não mudaram
  const sig = (tiles: readonly number[]): string => tiles.slice().sort((a, b) => a - b).join(',');
  const oldBySig = new Map<string, SetState[]>();
  for (const s of table) {
    const k = sig(s.tiles);
    (oldBySig.get(k) ?? oldBySig.set(k, []).get(k)!).push(s);
  }
  const out: SetState[] = fixed.map((s, i) => ({ id: i + 1, tiles: s.tiles.slice(), x: s.x, z: s.z }));
  const fresh: number[][] = [];
  for (const tiles of sets) {
    const olds = oldBySig.get(sig(tiles));
    const old = olds?.pop();
    if (old) out.push({ id: out.length + 1, tiles: old.tiles.slice(), x: old.x, z: old.z });
    else fresh.push(tiles);
  }
  for (const tiles of fresh) {
    const spot = findSpot(out, -1, Math.floor((COLS - tiles.length) / 2), Math.floor(ROWS / 2), tiles.length);
    if (!spot) return null;
    out.push({ id: out.length + 1, tiles, x: spot.x, z: spot.z });
  }
  return { table: out, relief: found.relief, placed };
}

