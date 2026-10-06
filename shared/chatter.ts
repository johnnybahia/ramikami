// Frases dos bots comentando as jogadas (só enfeite no cliente; nada vai pelo servidor).
import type { RoomView } from './protocol';
import { isJoker } from './tiles';

export type ChatKind =
  | 'ownPlay' | 'ownDraw' | 'bigPlay' | 'otherPlay' | 'otherDraw'
  | 'ownOpened' | 'otherOpened' | 'ownNear' | 'otherNear' | 'ownLast' | 'otherLast'
  | 'ownJoker' | 'otherJoker' | 'ownRearr' | 'otherRearr' | 'ownStreak' | 'otherStreak'
  | 'botWon' | 'humanWon';

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
  ownOpened: ['Abri o jogo, agora a festa começa.', 'Entrei na mesa, finalmente.', 'Trinta pontos na conta, vamos lá.'],
  otherOpened: ['Abriu o jogo, hein!', 'Entrou na mesa, agora a coisa esquenta.', 'Já abriu… cuidado com ele.'],
  ownNear: ['Tô quase acabando, hein.', 'Meu cavalete já está leve.', 'Falta pouco para mim.'],
  otherNear: ['O cavalete dele está quase vazio!', 'Tá perto de acabar, vamos segurar!', 'Cuidado, tem gente quase ganhando.'],
  ownLast: ['Uma pedra só!', 'Última pedra, ninguém me segura.', 'Reza, porque eu tô quase lá!'],
  otherLast: ['Última pedra! Alguém trava ele!', 'Uma só! Que perigo!', 'Atenção, tá quase no fim!'],
  ownJoker: ['Coringa na mesa, olha a classe.', 'Usei o coringa na hora certa.', 'Esse coringa estava só esperando.'],
  otherJoker: ['Gastou o coringa, hein!', 'Coringa na mesa, que luxo.', 'Esse coringa eu queria ter achado.'],
  ownRearr: ['Dei uma arrumada na mesa.', 'Mexi aqui, mexi ali, e deu certo.', 'Quem disse que a mesa era fixa?'],
  otherRearr: ['Bagunçou a mesa toda, hein!', 'Que mexida na mesa, ficou até melhor.', 'Tá reorganizando tudo, é?'],
  ownStreak: ['De novo sem nada, que fase.', 'Compra, compra, compra…', 'Alguém esconde as pedras boas de mim?'],
  otherStreak: ['Comprou de novo, tá difícil!', 'Dá até pena, nada serve para ele.', 'Que má fase, hein.'],
  botWon: ['Ganhei! Foi um prazer.', 'Fim de jogo, esvaziei o cavalete!', 'Essa foi minha, valeu pela partida.'],
  humanWon: ['Parabéns, vitória merecida!', 'Ganhou de mim, mas a revanche vem.', 'Fim de jogo! Você jogou bem.'],
};

// Frases dirigidas a um jogador humano: {nome} vira o nome dele.
export const CHATTER_NAMED: Record<ChatKind, readonly string[]> = {
  ownPlay: [
    '{nome}, olha e aprende.',
    '{nome}, essa foi para você ver.',
    'Prepare o cavalete, {nome}, que eu estou chegando.',
    '{nome}, não vá dormir agora.',
    'Tenta me alcançar, {nome}!',
  ],
  ownDraw: [
    '{nome}, não ri não, eu volto.',
    'Se eu fosse você, {nome}, não comemorava ainda.',
    '{nome}, me empresta um coringa?',
    'Hoje não foi meu dia, {nome}.',
  ],
  bigPlay: [
    'Isso, {nome}! Assim você me destrói!',
    '{nome}, que jogada, hein!',
    'Peraí, {nome}, devagar com a mesa!',
    'Quem diria, {nome}, jogando assim.',
    '{nome} está voando hoje!',
  ],
  otherPlay: [
    'Boa, {nome}!',
    '{nome}, essa eu não vi vindo.',
    'Tá esperto hoje, {nome}.',
    'Foi sorte, {nome}, confessa.',
    'Gostei, {nome}, vou copiar.',
    '{nome}, cuidado que eu estou de olho.',
  ],
  otherDraw: [
    'Que pena, {nome}, nada serviu.',
    'Calma, {nome}, a próxima vem.',
    '{nome} comprando… já é um começo.',
    'Respira, {nome}, ainda tem jogo.',
    'Ótimo para mim, {nome}. Obrigado!',
  ],
  ownOpened: ['{nome}, agora é comigo, abri o jogo.', 'Entrei na briga, {nome}.'],
  otherOpened: ['Abriu, {nome}! Agora vai.', '{nome} entrou na mesa, cuidado pessoal.'],
  ownNear: ['{nome}, tô quase acabando, hein.', 'Segura a onda, {nome}, falta pouco para mim.'],
  otherNear: ['{nome} está quase acabando!', 'Cuidado, {nome}, você está perto de ganhar.'],
  ownLast: ['{nome}, é a última pedra!', '{nome}, reza que eu estou quase!'],
  otherLast: ['{nome} com uma pedra só! Segura, gente!', 'Última pedra, {nome}! Nervoso aqui.'],
  ownJoker: ['{nome}, coringa na mesa, olha só.', 'Olha o coringa, {nome}. Não é para qualquer um.'],
  otherJoker: ['Coringa, {nome}? Que luxo!', '{nome} gastou o coringa, ousado.'],
  ownRearr: ['{nome}, mexi na mesa, viu?', 'Dei uma arrumada na mesa, {nome}, de nada.'],
  otherRearr: ['{nome} bagunçou a mesa, e deu certo!', 'Boa mexida, {nome}.'],
  ownStreak: ['{nome}, não ri, tô numa fase ruim.', 'Me dá uma pedra boa, {nome}!'],
  otherStreak: ['{nome}, tá difícil, né? Calma.', 'Mais uma compra, {nome}, coragem!'],
  botWon: ['{nome}, foi bom jogar com você. Revanche?', 'Ganhei, {nome}! Quer tentar de novo?'],
  humanWon: ['Parabéns, {nome}! Você jogou bem demais.', '{nome} ganhou! Quero a revanche.'],
};

/** Com `target` (nome de um humano), na maior parte das vezes sorteia uma frase dirigida a ele. */
export function pickChatter(kind: ChatKind, rnd: () => number = Math.random, target?: string): string {
  if (target && rnd() < 0.7) {
    const named = CHATTER_NAMED[kind];
    return named[Math.floor(rnd() * named.length)]!.replace('{nome}', target);
  }
  const list = CHATTER[kind];
  return list[Math.floor(rnd() * list.length)]!;
}

export interface ChatPlan {
  speakerId: string;
  speakerName: string;
  kind: ChatKind;
  target?: string;
  /** falas importantes ignoram o intervalo mínimo entre comentários */
  priority: boolean;
}

const sig = (t: readonly number[]): string => t.slice().sort((a, b) => a - b).join(',');

/**
 * Decide se (e o que) um bot comenta depois de uma jogada, olhando o estado do jogo:
 * fim de partida, última pedra, poucas pedras, abertura, coringa, mesa rearranjada, compras seguidas.
 * `streak` = quantas compras seguidas o jogador da vez fez (contando esta).
 */
export function decideChatter(prev: RoomView, v: RoomView, streak: number, rnd: () => number = Math.random): ChatPlan | null {
  const mover = prev.players.find((p) => p.id === prev.turnId);
  const now = mover && v.players.find((p) => p.id === mover.id);
  if (!mover || !now) return null;
  const bots = v.players.filter((p) => p.bot && !p.left);
  if (bots.length === 0) return null;
  const humans = v.players.filter((p) => !p.bot && !p.left);
  const one = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)]!;
  const plan = (speaker: { id: string; name: string }, kind: ChatKind, target?: string, priority = false): ChatPlan => ({ speakerId: speaker.id, speakerName: speaker.name, kind, target, priority });

  // fim da partida
  if (v.phase === 'ended' && v.result && v.result.winners.length > 0) {
    const winner = v.players.find((p) => p.id === v.result!.winners[0]);
    if (!winner) return null;
    if (winner.bot) return plan(winner, 'botWon', humans.length > 0 ? one(humans).name : undefined, true);
    return plan(one(bots), 'humanWon', winner.name, true);
  }

  const delta = mover.rackCount - now.rackCount;
  const moverBot = mover.bot;
  const speaker = moverBot ? mover : one(bots);
  const target = moverBot ? (humans.length > 0 ? one(humans).name : undefined) : mover.name;
  const pair = (own: ChatKind, other: ChatKind): ChatKind => (moverBot ? own : other);

  if (delta > 0 && now.rackCount === 1) return plan(speaker, pair('ownLast', 'otherLast'), target, true);
  if (delta > 0 && now.rackCount <= 3 && rnd() < 0.8) return plan(speaker, pair('ownNear', 'otherNear'), target, true);
  if (delta > 0 && !mover.melded && now.melded && rnd() < 0.8) return plan(speaker, pair('ownOpened', 'otherOpened'), target);
  if (delta > 0) {
    const had = new Set(prev.table.flatMap((x) => x.tiles));
    const jokerNew = v.table.some((x) => x.tiles.some((t) => isJoker(t) && !had.has(t)));
    if (jokerNew && rnd() < 0.7) return plan(speaker, pair('ownJoker', 'otherJoker'), target);
    const before = new Set(prev.table.map((x) => sig(x.tiles)));
    const after = new Set(v.table.map((x) => sig(x.tiles)));
    const broken = [...before].filter((k) => !after.has(k)).length;
    if (broken >= 2 && rnd() < 0.6) return plan(speaker, pair('ownRearr', 'otherRearr'), target);
  }
  if (delta <= 0 && streak >= 2 && rnd() < 0.8) return plan(speaker, pair('ownStreak', 'otherStreak'), target);

  // comentário comum
  if (rnd() > 0.35) return null;
  if (moverBot) {
    if (delta >= 5) {
      const others = bots.filter((b) => b.id !== mover.id);
      return others.length > 0 ? plan(one(others), 'bigPlay', target) : plan(mover, 'ownPlay', target);
    }
    return plan(mover, delta > 0 ? 'ownPlay' : 'ownDraw', target);
  }
  return plan(speaker, delta >= 5 ? 'bigPlay' : delta > 0 ? 'otherPlay' : 'otherDraw', mover.name);
}
