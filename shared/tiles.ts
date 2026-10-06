// 106 pedras: ids 0..103 = 4 cores x 13 números x 2 cópias; 104 e 105 = coringas.
export const TILE_COUNT = 106;
export const JOKER_A = 104;
export const JOKER_B = 105;
export const JOKER_POINTS = 30;

export const isJoker = (id: number): boolean => id >= 104;
/** 0 preto, 1 azul, 2 vermelho, 3 laranja; -1 coringa */
export const tileColor = (id: number): number => (isJoker(id) ? -1 : Math.floor((id % 52) / 13));
/** 1..13; 0 coringa */
export const tileNum = (id: number): number => (isJoker(id) ? 0 : (id % 52) % 13 + 1);
/** pontos que a pedra vale na mão ao fim da partida */
export const tileValue = (id: number): number => (isJoker(id) ? JOKER_POINTS : tileNum(id));
export const handPoints = (rack: readonly number[]): number => rack.reduce((a, t) => a + tileValue(t), 0);

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(arr: readonly T[], rng: Rng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export const newPool = (rng: Rng): number[] => shuffled(Array.from({ length: TILE_COUNT }, (_, i) => i), rng);
