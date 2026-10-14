// Progresso para liberar o Grão-mestre: vitórias contra bots de nível Mestre (ou acima). Lógica pura, testada em rules.test.ts.
export const GM_UNLOCK_WINS = 10;

export interface Progress {
  /** vitórias contra bots Mestre ou Grão-mestre (desbloqueiam o Grão-mestre) */
  masterWins: number;
  /** vitórias contra Grão-mestres (já inclusas em masterWins) */
  gmWins: number;
}

export interface GameFacts {
  /** id do jogador local */
  you: string;
  winners: readonly string[];
  /** motivo do fim da partida (saída de adversário não conta) */
  reason: string;
  /** os adversários que ainda estavam na partida */
  players: readonly { id: string; bot: boolean; left: boolean; level?: string }[];
}

/**
 * Esta partida conta como vitória contra Mestre/Grão-mestre? Só conta se o jogador local venceu, o fim foi normal
 * (bateu ou o pote acabou) e TODOS os bots da mesa eram Mestre ou Grão-mestre (bot fraco na mesa não vale).
 */
export function winKind(g: GameFacts): 'master' | 'grandmaster' | null {
  if (!g.winners.includes(g.you) || g.reason === 'left') return null;
  const bots = g.players.filter((p) => p.bot && !p.left);
  if (bots.length === 0) return null;
  if (!bots.every((b) => b.level === 'master' || b.level === 'grandmaster')) return null;
  return bots.every((b) => b.level === 'grandmaster') ? 'grandmaster' : 'master';
}

export function addWin(p: Progress, kind: 'master' | 'grandmaster'): Progress {
  return { masterWins: p.masterWins + 1, gmWins: p.gmWins + (kind === 'grandmaster' ? 1 : 0) };
}

export const isGmUnlocked = (p: Progress): boolean => p.masterWins >= GM_UNLOCK_WINS;
export const winsToUnlock = (p: Progress): number => Math.max(0, GM_UNLOCK_WINS - p.masterWins);

/** Texto curto para mostrar ao usuário em qualquer lugar onde se escolhe o nível. */
export function gmStatusText(p: Progress): string {
  return isGmUnlocked(p)
    ? '👑 Grão-mestre liberado.'
    : `🔒 Grão-mestre: vença bots de nível Mestre ${GM_UNLOCK_WINS} vezes para liberar (${Math.min(p.masterWins, GM_UNLOCK_WINS)}/${GM_UNLOCK_WINS}).`;
}

/** Explicação completa (tela "Como jogar"). */
export const GM_HOW_TO: readonly string[] = [
  'Níveis dos bots: Fácil, Médio, Difícil, Mestre e Grão-mestre (Yoda, Sun Tzu, Marie Curie, Einstein e Kame), o mais forte: guarda o coringa para a hora certa e procura sempre fechar a partida.',
  `Como liberar o Grão-mestre: vença ${GM_UNLOCK_WINS} partidas contra bots de nível Mestre (ou Grão-mestre). Vale jogo offline ou sala online, desde que todos os bots da mesa sejam Mestre ou acima; sair da partida no meio não conta.`,
  'O progresso (vitórias já contadas) fica salvo neste aparelho. Ao completar, o Grão-mestre aparece liberado em "Nível dos bots".',
];
