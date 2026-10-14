// Quão fácil é o adversário pegar um coringa que acabei de colocar na mesa. Só usa informação pública (mesa, meu cavalete,
// tamanho do cavalete dos outros e do pote), como um jogador que conta as pedras já visíveis.
//
// Um coringa pode ser levado de duas formas:
//  1. de graça: tirá-lo deixa o conjunto válido (ponta de sequência com 4+ pedras, trinca de 4, ou meio de uma sequência
//     comprida em que sobram dois pedaços de 3+). Risco 1.
//  2. trocando por a pedra que ele representa (sequência: uma pedra exata; trinca de 3: uma das duas cores que faltam).
//     Risco = chance de algum dos adversários ter uma das cópias que ainda não vi (cada pedra existe em 2 cópias).
import type { GameState } from './game';
import type { SetState } from './layout';
import { isJoker, tileColor, tileNum } from './tiles';

/** Risco (0..1) de cada coringa do meu cavalete que ficou na mesa nova; 0 se nenhum foi jogado. */
export function placedJokerRisks(state: GameState, newTable: readonly SetState[]): number[] {
  const me = state.players[state.turn]!;
  const onTable = new Set<number>();
  for (const s of newTable) for (const t of s.tiles) onTable.add(t);
  const placed = me.rack.filter((t) => isJoker(t) && onTable.has(t));
  if (placed.length === 0) return [];

  // cópias que já vi: mesa nova + o que sobrou no meu cavalete
  const seen = new Int8Array(52);
  for (const s of newTable) for (const t of s.tiles) if (!isJoker(t)) seen[tileColor(t) * 13 + tileNum(t) - 1]!++;
  for (const t of me.rack) if (!isJoker(t) && !onTable.has(t)) seen[tileColor(t) * 13 + tileNum(t) - 1]!++;

  let oppTiles = 0;
  for (const p of state.players) if (p.id !== me.id && !p.left) oppTiles += p.rack.length;
  const share = oppTiles + state.pool.length > 0 ? oppTiles / (oppTiles + state.pool.length) : 0; // chance de uma pedra oculta estar na mão deles
  const takeChance = (k: number): number => {
    const unseen = Math.max(0, 2 - seen[k]!);
    return 1 - Math.pow(1 - share, unseen);
  };

  return placed.map((j) => {
    const set = newTable.find((s) => s.tiles.includes(j))!.tiles;
    const n = set.length;
    const i = set.indexOf(j);
    const reals = set.filter((t) => !isJoker(t));
    if (reals.length < 2) return 1;
    const group = tileNum(reals[0]!) === tileNum(reals[1]!); // duas pedras de mesmo número só podem ser trinca
    if (group) {
      if (n >= 4) return 1; // trinca de 4: tirar o coringa deixa uma trinca válida
      const num = tileNum(reals[0]!);
      const used = new Set(reals.map(tileColor));
      let safe = 1;
      for (let c = 0; c < 4; c++) if (!used.has(c)) safe *= 1 - takeChance(c * 13 + num - 1);
      return 1 - safe;
    }
    const left = i;
    const right = n - 1 - i;
    if ((left === 0 || left >= 3) && (right === 0 || right >= 3)) return 1; // sai de graça
    const first = set.findIndex((t) => !isJoker(t));
    const num = tileNum(set[first]!) - first + i; // número que o coringa representa
    const color = tileColor(reals[0]!);
    if (num < 1 || num > 13) return 1;
    return takeChance(color * 13 + num - 1);
  });
}

/** Risco do pior coringa colocado (0 se não colocou nenhum). */
export const placedJokerRisk = (state: GameState, newTable: readonly SetState[]): number => Math.max(0, ...placedJokerRisks(state, newTable));
