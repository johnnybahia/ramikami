// Bot "Grão-mestre": segura o coringa e procura sempre fechar a partida ("bater") com busca exata.
//
// Por que é mais forte que o Mestre (medido em simulação, 500 partidas por semente, 2 jogadores: ~72% de vitórias contra o
// Mestre, ic95 68–76%; com 3 jogadores ~59% contra dois Mestres; com 4 jogadores ~51% contra três):
//  1. SEGURAR: o Mestre conta o coringa como 30 pontos de alívio e o gasta assim que ele entra em algum conjunto,
//     deixando-o solto na mesa para o oponente reaproveitar. Aqui o coringa só sai da mão quando a jogada esvazia o
//     cavalete ("bate"), ou perto do fim do pote (coringa na mão vale 30 pontos de risco).
//  2. BATER: busca de cobertura exata (solveOut) de TODA a mesa em foco + TODO o cavalete, com os coringas como
//     curingas livres (inclusive os que já estavam na mesa: o coringa da mesa é trocado por pedra do cavalete e
//     reaproveitado no MESMO turno). Acha fechamentos que a busca por alívio do Mestre (foco de 7 conjuntos, objetivo
//     em pontos) não enxerga, e por isso compra bem menos sem necessidade.
//
// Só usa informação pública (mesa, cavalete próprio, tamanho do cavalete dos oponentes, tamanho do pote).
// Jogada média ~25 ms; pior caso medido ~0,8 s; nenhuma jogada inválida em milhares de partidas.
import { isJoker, tileValue } from './tiles';
import { analyzeSet, validatePlay } from './rules';
import { findCompactSpot, relayout, type SetState } from './layout';
import type { GameState } from './game';
import { key, packCounts, type Cand } from './pack';
import { solveTable } from './solver';
import type { LevelCfg } from './bot';

// ---------------------------------------------------------------------------------------------
// Parâmetros
// ---------------------------------------------------------------------------------------------
interface Params {
  /** segura o coringa do cavalete (false = joga como o Mestre) */
  hold: boolean;
  /** quantos coringas ficam sempre guardados; os que passam disso jogam como o Mestre (2 = guarda todos) */
  keepJ: number;
  /** solta o coringa se o meu cavalete tem <= relMe pedras (0 = nunca) */
  relMe: number;
  /** solta se algum oponente tem <= relOpp pedras (0 = nunca) */
  relOpp: number;
  /** solta se o coringa deixa colocar >= relGain pedras comuns a mais do que sem ele (99 = nunca) */
  relGain: number;
  /** solta se o pote tem <= relPool pedras (o jogo está perto de travar e coringa na mão vale 30 pontos) */
  relPool: number;
  /** solta para abrir quando sem o coringa não dá para abrir */
  relOpen: boolean;
  /** busca de bater: 0 desliga; 1 só com coringa na mão; 2 sempre */
  deepOut: number;
  /** só tenta bater com até tantas pedras no cavalete */
  outRack: number;
  /** teto de nós e de milissegundos da busca de bater */
  outBudget: number;
  outMs: number;
  /** quantos conjuntos da mesa (os mais próximos das pedras do cavalete, e os com coringa) entram na busca de bater */
  outFocus: number;
}

const DEFAULTS: Params = {
  hold: true,
  keepJ: 2,
  relMe: 0,
  relOpp: 0,
  relGain: 99,
  relPool: 3,
  relOpen: false,
  deepOut: 2,
  outRack: 99,
  outBudget: 30000,
  outMs: 120,
  outFocus: 99,
};

const P: Params = { ...DEFAULTS };

/** gancho de medição (scripts/sim-gm-sweep.ts): objeto vivo dos parâmetros e os valores de fábrica */
export const GM_TUNING: Params = P;
export const GM_DEFAULTS: Readonly<Params> = DEFAULTS;

// ---------------------------------------------------------------------------------------------
// Busca de "bater": cobertura exata de TODA a mesa em foco + TODO o cavalete (cópia enxuta do solver do Mestre)
// ---------------------------------------------------------------------------------------------
interface Step {
  slots: number[]; // chave cor*13+(n-1) ou -1 = coringa
  jokers: number;
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

/** Conjuntos da mesa "perto" das pedras do cavalete (e todos os que têm coringa); o resto fica como está. */
function focusSets(table: readonly SetState[], rack: readonly number[], maxFocus: number): { focus: SetState[]; fixed: SetState[] } {
  const rackKeys = rack.filter((t) => !isJoker(t)).map(key);
  const scored = table.map((s) => {
    let score = 0;
    for (const t of s.tiles) {
      if (isJoker(t)) {
        score += 1000;
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
  const picked = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, maxFocus);
  const pickedSet = new Set(picked.map((x) => x.s));
  return { focus: picked.map((x) => x.s), fixed: table.filter((s) => !pickedSet.has(s)) };
}

/**
 * Nova mesa em que TODAS as pedras do cavalete (coringas inclusive) entraram, ou null. Cobertura exata: cada pedra
 * comum da mesa em foco e do cavalete cai em exatamente um conjunto válido; coringas preenchem buracos e os que
 * sobram são encaixados numa ponta de algum conjunto.
 */
function solveOut(fullTable: readonly SetState[], rack: readonly number[], budget: number, maxMs: number, maxFocus: number): SetState[] | null {
  const { focus, fixed } = focusSets(fullTable, rack, maxFocus);
  const t0 = performance.now();
  const avail = new Int8Array(52);
  const need = new Int8Array(52);
  const ids: number[][] = Array.from({ length: 52 }, () => []);
  const jok: number[] = [];
  const addTile = (t: number): void => {
    if (isJoker(t)) jok.push(t);
    else {
      avail[key(t)]!++;
      need[key(t)]!++;
      ids[key(t)]!.push(t);
    }
  };
  for (const s of focus) for (const t of s.tiles) addTile(t);
  for (const t of rack) addTile(t);
  let jokersLeft = jok.length;
  const chosen: Step[] = [];
  let nodes = 0;
  let aborted = false;
  let result: SetState[] | null = null;

  const finalize = (): boolean => {
    const pool = ids.map((a) => a.slice());
    const jp = jok.slice();
    const sets: number[][] = chosen.map((st) => st.slots.map((k) => (k === -1 ? jp.pop()! : pool[k]!.pop()!)));
    for (const j of jp) {
      let done = false;
      for (const set of sets) {
        for (let pos = 0; pos <= set.length && !done; pos++) {
          const cand = [...set.slice(0, pos), j, ...set.slice(pos)];
          if (analyzeSet(cand).valid) {
            set.splice(0, set.length, ...cand);
            done = true;
          }
        }
        if (done) break;
      }
      if (!done) return false;
    }
    // mantém a posição dos conjuntos que não mudaram
    const sig = (tiles: readonly number[]): string => tiles.slice().sort((a, b) => a - b).join(',');
    const oldBySig = new Map<string, SetState[]>();
    for (const s of focus) {
      const k = sig(s.tiles);
      (oldBySig.get(k) ?? oldBySig.set(k, []).get(k)!).push(s);
    }
    const out: SetState[] = fixed.map((s, i) => ({ id: i + 1, tiles: s.tiles.slice(), x: s.x, z: s.z }));
    const fresh: number[][] = [];
    for (const tiles of sets) {
      const old = oldBySig.get(sig(tiles))?.pop();
      if (old) out.push({ id: out.length + 1, tiles: old.tiles.slice(), x: old.x, z: old.z });
      else fresh.push(tiles);
    }
    for (const tiles of fresh) {
      const spot = findCompactSpot(out, tiles.length);
      if (!spot) return false;
      out.push({ id: out.length + 1, tiles, x: spot.x, z: spot.z });
    }
    result = out;
    return true;
  };

  const dfs = (): boolean => {
    if (nodes++ > budget || ((nodes & 31) === 0 && performance.now() - t0 > maxMs)) {
      aborted = true;
      return false;
    }
    // chave ainda descoberta com menos opções
    let pick = -1;
    let pickList: Step[] = [];
    for (let k = 0; k < 52; k++) {
      if (need[k]! <= 0) continue;
      const list = candidatesFor(k, avail, jokersLeft);
      if (pick < 0 || list.length < pickList.length) {
        pick = k;
        pickList = list;
        if (list.length <= 1) break; // beco sem saída (0) ou jogada forçada (1)
      }
    }
    if (pick < 0) return finalize();
    if (pickList.length === 0) return false;
    // prefere conjuntos que cobrem mais pedras e gastam menos coringas
    const cover = (st: Step): number => st.slots.reduce((a, k) => a + (k >= 0 ? 1 : 0), 0);
    pickList.sort((a, b) => cover(b) - cover(a) || a.jokers - b.jokers);
    for (const st of pickList) {
      for (const k of st.slots) if (k >= 0) { avail[k]!--; need[k]!--; }
      jokersLeft -= st.jokers;
      chosen.push(st);
      const ok = dfs();
      chosen.pop();
      jokersLeft += st.jokers;
      for (const k of st.slots) if (k >= 0) { avail[k]!++; need[k]!++; }
      if (ok) return true;
      if (aborted) return false;
    }
    return false;
  };
  dfs();
  return result;
}

// ---------------------------------------------------------------------------------------------
// Geração de jogadas (mesma lógica do Mestre, com um número escolhido de coringas do cavalete disponíveis)
// ---------------------------------------------------------------------------------------------
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

interface Move {
  table: SetState[];
  /** coringas do cavalete usados */
  jokersUsed: number;
  /** quantidade de pedras comuns colocadas */
  nPlain: number;
  /** pontos como o Mestre conta (coringa = 30) */
  relief: number;
  /** esvazia o cavalete */
  empties: boolean;
}

/** Melhor jogada por alívio, como o Mestre, mas só com `nAllowed` dos coringas do cavalete disponíveis. */
function genMove(state: GameState, persona: LevelCfg, nAllowed: number): Move | null {
  const me = state.players[state.turn]!;
  let jLeft = nAllowed;
  const rack = me.rack.filter((t) => !isJoker(t) || jLeft-- > 0);
  const cnt = new Int8Array(52);
  let jokers = 0;
  for (const id of rack) {
    if (isJoker(id)) jokers++;
    else cnt[key(id)]!++;
  }
  const chosen = packCounts(cnt, jokers, !me.melded, persona.budget);

  const table: SetState[] = state.table.map((s) => ({ ...s, tiles: s.tiles.slice() }));
  let rest = rack.slice();
  let ok = true;
  if (chosen) {
    const r = realize(rack, chosen);
    rest = r.rest;
    for (const tiles of r.sets) {
      const spot = findCompactSpot(table, tiles.length);
      if (!spot) {
        ok = false;
        break;
      }
      table.push({ id: table.length + 1, tiles, x: spot.x, z: spot.z });
    }
  }
  let simple: SetState[] | null = null;
  if (ok) {
    if (me.melded) {
      if (persona.extend) rest = extend(table, rest, false);
      if (persona.jokers && rest.length > 0 && rest.every(isJoker)) rest = extend(table, rest, true);
      simple = relayout(table);
    } else if (chosen) {
      simple = relayout(table);
    }
  }
  let best: Move | null = null;
  const consider = (t: SetState[] | null): void => {
    if (!t) return;
    let cand: SetState[] = t;
    let check = validatePlay(state.table, me.rack, me.melded, cand);
    if (!check.ok) return;
    // sobraram só coringas (os que estou segurando): encaixa na ponta de algum conjunto e esvazia o cavalete
    const addedSet = new Set(check.added);
    const left = me.rack.filter((x) => !addedSet.has(x));
    if (left.length > 0 && left.every(isJoker) && persona.jokers) {
      const t2: SetState[] = cand.map((s) => ({ ...s, tiles: s.tiles.slice() }));
      if (extend(t2, left, true).length === 0) {
        const c2 = validatePlay(state.table, me.rack, me.melded, t2);
        if (c2.ok) {
          cand = relayout(t2);
          check = c2;
        }
      }
    }
    let relief = 0;
    let nPlain = 0;
    let jokersUsed = 0;
    for (const id of check.added) {
      relief += tileValue(id);
      if (isJoker(id)) jokersUsed++;
      else nPlain++;
    }
    if (!best || relief > best.relief) {
      best = { table: cand, jokersUsed, nPlain, relief, empties: check.added.length === me.rack.length };
    }
  };
  consider(simple);
  if (me.melded && persona.rearrange > 0) {
    const r = solveTable(state.table, rack, persona.rearrange);
    if (r) consider(relayout(r.table));
  }
  return best;
}

/** Busca exata de bater: devolve a mesa final se der para esvaziar o cavalete agora. */
function tryOut(state: GameState): SetState[] | null {
  const me = state.players[state.turn]!;
  const t = solveOut(state.table, me.rack, P.outBudget, P.outMs, P.outFocus);
  if (!t) return null;
  const table = relayout(t);
  const c = validatePlay(state.table, me.rack, me.melded, table);
  return c.ok && c.added.length === me.rack.length ? table : null;
}

// ---------------------------------------------------------------------------------------------
// Política de coringa
// ---------------------------------------------------------------------------------------------
/** Jogada do bot: nova mesa inteira, ou null para comprar uma pedra. Mesma assinatura de botMove em shared/bot.ts. */
export function grandmasterMove(state: GameState, persona: LevelCfg, _rng: () => number): SetState[] | null {
  const me = state.players[state.turn]!;
  const nJ = me.rack.reduce((a, t) => a + (isJoker(t) ? 1 : 0), 0);
  const full = genMove(state, persona, nJ); // o que o Mestre jogaria (todos os coringas à disposição)
  if (full?.empties) return full.table;

  // 1) dá para bater com a busca exata? (a abertura segue as regras do Mestre: só conjuntos novos)
  if (P.deepOut > 0 && me.melded && me.rack.length <= P.outRack && (P.deepOut === 2 || nJ > 0)) {
    const o = tryOut(state);
    if (o) return o;
  }

  // 2) sem coringa na mão, ou a melhor jogada nem usa coringa: igual ao Mestre
  if (!P.hold || nJ === 0 || !full || full.jokersUsed === 0) return full ? full.table : null;

  // 3) a jogada do Mestre gasta coringa sem bater: segura, salvo as regras de soltura
  const hold = genMove(state, persona, Math.max(0, nJ - P.keepJ)); // melhor jogada sem os coringas guardados
  const minOpp = state.players.reduce((a, p) => (p.id === me.id || p.left ? a : Math.min(a, p.rack.length)), 99);
  const release =
    me.rack.length <= P.relMe ||
    minOpp <= P.relOpp ||
    state.pool.length <= P.relPool ||
    (!me.melded && !hold && P.relOpen) ||
    full.nPlain - (hold ? hold.nPlain : 0) >= P.relGain;
  if (release) return full.table;
  return hold ? hold.table : null;
}
