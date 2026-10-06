// Frases dos bots comentando as jogadas (só enfeite no cliente; nada vai pelo servidor).
export type ChatKind = 'ownPlay' | 'ownDraw' | 'bigPlay' | 'otherPlay' | 'otherDraw';

export const CHATTER: Record<ChatKind, readonly string[]> = {
  // o próprio bot jogou
  ownPlay: [
    'Toma essa!',
    'Encaixou direitinho.',
    'Isso é que é jogar.',
    'Mais uma pro papo.',
    'Fácil demais…',
    'Ainda tem muito jogo pela frente.',
    'Agora o cavalete respira.',
    'Foi sem querer… brincadeira, foi de propósito.',
    'Respeita o mestre da mesa.',
    'Mais uma e já estou de saída.',
    'Calculei isso há três turnos.',
  ],
  // o próprio bot comprou
  ownDraw: [
    'Que azar, nada serve.',
    'Compro e rezo.',
    'Esse cavalete só cresce…',
    'Sem jogada, vida que segue.',
    'Quem me dera um coringa agora.',
    'Eu mereço uma pedra melhor que essa.',
    'Passei vergonha, mas volto.',
    'Alguém trocou meu baralho?',
    'Tá difícil, hein.',
    'Quase… quase.',
  ],
  // alguém soltou muitas pedras de uma vez
  bigPlay: [
    'Eita, esvaziou o cavalete!',
    'Isso foi um show.',
    'Chega! Assim não dá para competir.',
    'Quem ensinou você a jogar assim?',
    'Respeito essa jogada.',
    'Vou ficar de olho em você.',
    'Calma aí, deixa pelo menos uma para nós!',
    'Isso é jogar com a mão boa.',
  ],
  // outro jogador jogou
  otherPlay: [
    'Boa jogada!',
    'Essa eu não esperava.',
    'Tá jogando bonito, hein.',
    'Foi sorte, né?',
    'Gostei, vou copiar.',
    'Mexeu na mesa e ficou melhor.',
    'Hmm… perigosa essa.',
    'Já deu para ver que não vai ser fácil.',
    'Não achei que ia caber ali.',
    'Essa doeu em mim.',
    'Joga bem, mas eu jogo melhor.',
    'Assim eu fico nervoso.',
  ],
  // outro jogador comprou
  otherDraw: [
    'Comprou? Ótimo para mim.',
    'Aconteceu com todo mundo.',
    'Calma, a próxima vem.',
    'Sem jogada de novo? Que pena…',
    'Mais uma pedra para você carregar.',
    'Respira, é só um jogo.',
    'Bem-vindo ao clube dos sem sorte.',
    'Se eu fosse você, trocava de cavalete.',
    'Nem tudo está perdido… acho.',
  ],
};

export function pickChatter(kind: ChatKind, rnd: () => number = Math.random): string {
  const list = CHATTER[kind];
  return list[Math.floor(rnd() * list.length)]!;
}
