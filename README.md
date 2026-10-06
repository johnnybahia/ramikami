# Rami-kami

Jogo de pedras 3D (estilo Rummikub) para **2 a 4 jogadores**, com **jogo online**, **offline contra bots** e **instalação no celular (PWA)**. Feito com TypeScript, Vite e Three.js (pedras, mesa e feltro gerados por código — sem modelos 3D externos). O servidor é um Cloudflare Worker com Durable Objects, no plano **gratuito**.

## O que tem

- **Mesa 3D** com 106 pedras (4 cores × 1–13 × 2 + 2 coringas), pote para comprar, cavalete de madeira, sombras e luz.
- **Arrastar e soltar** por toque ou mouse: pedra a pedra (✋), conjunto inteiro (▭), dividir (✂); desfazer, recomeçar a jogada, ordenar por número/cor. Zoom por pinça/roda do mouse, arraste a mesa vazia para mover a câmera.
- **Regras**: sequência (3+ da mesma cor, sem 13→1), trinca/quadra, coringa, **abertura com 30+ pontos só com pedras do cavalete**, comprar do pote. **Vence quem tem menos pontos na mão** (coringa = 30).
- **Tempo por jogada: 30 s ou 60 s**, escolhido por quem cria a sala. O relógio é do **servidor**; estourou → a mesa volta ao início da vez e o jogador compra 1 pedra. 3 estouros seguidos tiram o jogador.
- **Online**: cadastro de nome + foto, sala por código/link, salas públicas, reconexão.
- **Ao vivo**: cada jogador tem uma caixinha no seu lado da mesa. **Câmera e microfone começam desligados**; ao ligar, os outros veem o vídeo e ouvem; ao desligar, volta a foto. O **anfitrião reposiciona** todo mundo na mesa (botão "Posições na mesa").
- **Ranking global**: menor **média de pontos na mão** por partida (mínimo de 3 partidas para o topo; quem tem menos fica listado como provisório).
- **Offline + atualização dentro do jogo**: o service worker baixa o jogo na primeira visita ("Baixando… N%" → "Pronto para jogar offline"). Versão nova aparece como **"Atualizar"** no menu e como aviso no topo da partida; nunca troca no meio de uma partida.

## Rodar localmente

```bash
npm install
npm run server:dev   # API + WebSocket em http://localhost:8787 (serve também o dist/)
npm run dev          # cliente em http://localhost:3000 (usa o servidor acima via .env.development)
npm test             # regras, bot, rascunho de jogada
npm run e2e:server   # com o server:dev ligado: teste de ponta a ponta do servidor
```

Para testar o jogo offline com a mesma mão toda vez: `?seed=2` na URL do modo offline.

## Publicar de graça (um deploy só: jogo + servidor)

1. Crie uma conta gratuita em cloudflare.com.
2. `npx wrangler login`
3. `npm run deploy` — gera o build e publica. Ele imprime o endereço `https://ramikami.<sua-conta>.workers.dev`.
4. Abra no celular, entre, e use "Instalar app" (Android/Chrome) ou Compartilhar → Adicionar à Tela de Início (iPhone).

Pelo GitHub: crie os segredos `CLOUDFLARE_API_TOKEN` (modelo "Edit Cloudflare Workers") e `CLOUDFLARE_ACCOUNT_ID`; todo push na `main` testa e publica (`.github/workflows/deploy.yml`). O `automerge.yml` liga o merge automático dos PRs: ative *Allow auto-merge* nas configurações do repositório e marque o check `test` como obrigatório na regra da branch `main` — sem isso o GitHub funde antes do CI terminar.

### TURN (opcional, melhora o vídeo)
Vídeo/áudio é ponto a ponto (WebRTC). Atrás de alguns roteadores/4G o ponto a ponto não conecta sem um servidor TURN. Crie uma chave TURN no painel Cloudflare (Realtime → TURN) e rode:

```bash
npx wrangler secret put TURN_KEY_ID -c server/wrangler.toml
npx wrangler secret put TURN_API_TOKEN -c server/wrangler.toml
```

O jogo continua funcionando sem isso (a pessoa só fica com a foto).

## Estrutura

```
shared/   regras, bot, protocolo — o MESMO código roda no navegador (offline) e no servidor
client/   cena 3D (game/), telas (ui/), rede e WebRTC (net/), PWA (pwa.ts)
server/   Worker: GameRoom (sala), Lobby (lista pública), Ranking (SQLite)
scripts/  sw.template.js (service worker), ícones, teste e2e do servidor
```

## Decisões de regra (ajuste em `shared/rules.ts` / `shared/game.ts`)

- Abertura: a mesa **não pode ser alterada** na jogada de abertura; depois de abrir, vale tudo desde que feche com a mesa válida.
- Pedras da mesa nunca voltam ao cavalete; só as que você mesmo jogou no turno.
- Quem sai da partida leva **+50 pontos**; o outro vence.
- Pote vazio: quem não joga passa; se todos passam, a partida acaba e vence quem tem menos pontos.
- Primeiro a jogar é sorteado; a ordem segue os assentos (0→1→2→3).
- Bot: joga conjuntos novos e estende conjuntos da mesa, mas **não rearranja** a mesa — é um adversário razoável, não forte.

## Limites e riscos (leia antes de convidar muita gente)

- **Plano gratuito do Cloudflare**: ~100 mil requisições/dia no Worker e limites diários nos Durable Objects. Para jogo entre amigos sobra; se estourar, o online para até o dia seguinte (UTC).
- **Vídeo sem TURN** pode falhar em ~10–20% das redes. **Moderação**: foto e vídeo entre desconhecidos exigem cuidado — salas começam **privadas** (só entra quem tem o código/link) e o anfitrião pode remover jogadores.
- **Ranking**: a identidade é um ID aleatório guardado no navegador. Limpar os dados do navegador cria um jogador novo, e dois amigos podem combinar partidas. Partidas relâmpago (quem sai logo no começo) não entram.
- **Testado**: regras/bot/rascunho (unitários), servidor (e2e com 2 clientes), 2 navegadores reais com WebRTC usando câmera/microfone falsos, modo offline sem rede, aviso e aplicação de atualização. **Não testado**: aparelhos reais (principalmente iPhone/Safari), redes reais com NAT, o deploy na Cloudflare em si (só `wrangler dev` local) e desempenho em celulares fracos.

## Zerar o ranking geral

1. Defina uma senha de administrador (uma vez): `npx wrangler secret put ADMIN_KEY -c server/wrangler.toml`
2. Para zerar: `curl -X POST -H "X-Admin-Key: SUA_SENHA" https://SEU-SITE.workers.dev/api/ranking/reset`

## Sessão melhor de 3/5/7

O anfitrião escolhe no saguão. Todas as partidas combinadas são jogadas; o placar da sessão (vitórias e pontos na mão) vive só enquanto a sala existir. Depois da última, o anfitrião pode pedir "Jogar mais uma": os jogadores confirmam em 30s e o placar continua. Teste de ponta a ponta: `npm run server:dev` e `npm run e2e:series`.
