// Progresso para liberar o Grão-mestre: vitórias contra bots de nível Mestre. Lógica pura, testada em rules.test.ts.
export const GM_UNLOCK_WINS = 10;
/** Vitórias contra Grão-mestres, em sala online (contadas pelo servidor), para ganhar o título. */
export const GM_TITLE_WINS = 10;

export interface Progress {
  /** vitórias contra bots Mestre (só elas desbloqueiam o Grão-mestre) */
  masterWins: number;
  /** vitórias contra Grão-mestres (não contam para liberar; ficam registradas) */
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
 * Que vitória foi esta? Só conta se o jogador local venceu, o fim foi normal (bateu ou o pote acabou) e TODOS os
 * bots da mesa eram do mesmo nível: 'master' (libera o Grão-mestre) ou 'grandmaster' (só registrada). Mesa com
 * bots de níveis diferentes não conta.
 */
export function winKind(g: GameFacts): 'master' | 'grandmaster' | null {
  if (!g.winners.includes(g.you) || g.reason === 'left') return null;
  const bots = g.players.filter((p) => p.bot && !p.left);
  if (bots.length === 0) return null;
  if (bots.every((b) => b.level === 'master')) return 'master';
  if (bots.every((b) => b.level === 'grandmaster')) return 'grandmaster';
  return null;
}

export function addWin(p: Progress, kind: 'master' | 'grandmaster'): Progress {
  return { masterWins: p.masterWins + (kind === 'master' ? 1 : 0), gmWins: p.gmWins + (kind === 'grandmaster' ? 1 : 0) };
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
  `Como liberar o Grão-mestre: vença ${GM_UNLOCK_WINS} partidas contra bots de nível Mestre. Vale jogo offline ou sala online, desde que todos os bots da mesa sejam Mestre; sair da partida no meio não conta.`,
  'O progresso (vitórias já contadas) fica salvo neste aparelho. Ao completar, o Grão-mestre aparece liberado em "Nível dos bots".',
  `Título de Grão-mestre: vença ${GM_TITLE_WINS} partidas contra bots Grão-mestre (todos os bots da mesa) em uma SALA ONLINE; o servidor conta e ninguém consegue forjar. Quem conquista ganha uma coroa 👑 ao lado do nome nas salas online, um aviso para os outros jogadores quando entra na sala, uma abertura de partida especial e a mesa exclusiva "Grão-mestre" em "Visual e mesa". Vitórias offline contra Grão-mestres não contam para o título.`,
];
