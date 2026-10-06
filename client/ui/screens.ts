import { createRoom, getRanking, listRooms } from '../api';
import { getPwa, installApp, applyUpdate, isIos, onPwa } from '../pwa';
import { avatarColor, loadA11y, saveA11y, type A11y, loadOfflineSettings, newId, photoFromFile, saveOfflineSettings, saveProfile, type OfflineSettings, type Profile } from '../store';
import { BOT_LEVELS, LEVEL_CFG } from '../../shared/bot';
import { SKINS } from '../game/skins';
import { NAME_MAX, TURN_SECONDS_OPTIONS, type TurnSeconds } from '../../shared/protocol';
import { avatarEl, btn, clear, h, toast } from './dom';

export interface MenuActions {
  profile: Profile;
  onProfile(p: Profile): void;
  startOffline(cfg: OfflineSettings): void;
  startOnline(code: string): void;
}

function segmented<T extends string | number>(options: readonly { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'seg' });
  const render = (cur: T): void => {
    clear(wrap);
    for (const o of options) wrap.append(h('button', { class: `seg-btn${o.value === cur ? ' active' : ''}`, text: o.label, attrs: { type: 'button' }, on: { click: () => { onChange(o.value); render(o.value); } } }));
  };
  render(value);
  return wrap;
}

export function modal(content: HTMLElement): { close(): void; el: HTMLElement } {
  const el = h('div', { class: 'modal', on: { click: (e) => e.target === el && close() } }, content);
  const close = (): void => el.remove();
  document.body.append(el);
  return { close, el };
}

// ---------- perfil ----------
export function showProfile(root: HTMLElement, existing: Profile | null, onDone: (p: Profile) => void, onCancel?: () => void): void {
  clear(root);
  let photo = existing?.photo ?? null;
  const id = existing?.id ?? newId();
  const nameIn = h('input', { class: 'input', attrs: { type: 'text', maxlength: String(NAME_MAX), placeholder: 'Seu nome', autocomplete: 'nickname' } });
  nameIn.value = existing?.name ?? '';
  const camIn = h('input', { attrs: { type: 'checkbox' } });
  const micIn = h('input', { attrs: { type: 'checkbox' } });
  camIn.checked = !!existing?.cam;
  micIn.checked = !!existing?.mic;
  const preview = h('div', { class: 'photo-preview' });
  const drawPreview = (): void => {
    clear(preview);
    preview.append(avatarEl(nameIn.value || '?', avatarColor(id), photo, 'avatar big'));
  };
  drawPreview();
  nameIn.addEventListener('input', () => !photo && drawPreview());
  const pick = (capture: boolean): void => {
    const f = h('input', { attrs: { type: 'file', accept: 'image/*', ...(capture ? { capture: 'user' } : {}) } });
    f.addEventListener('change', async () => {
      const file = f.files?.[0];
      if (!file) return;
      try {
        photo = await photoFromFile(file);
        drawPreview();
      } catch {
        toast('Não consegui ler essa imagem.');
      }
    });
    f.click();
  };
  const save = (): void => {
    const name = nameIn.value.trim();
    if (name.length < 2) return toast('Digite um nome com pelo menos 2 letras.');
    const p: Profile = { id, name, photo, cam: camIn.checked, mic: micIn.checked };
    saveProfile(p);
    onDone(p);
  };
  nameIn.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  root.append(
    h(
      'div',
      { class: 'screen center' },
      h(
        'div',
        { class: 'panel profile' },
        h('h2', { text: existing ? 'Seu perfil' : 'Bem-vindo ao Rami-kami' }),
        h('p', { class: 'muted', text: 'Escolha o nome e, se quiser, uma foto. Ela aparece no seu quadro na mesa quando a câmera está desligada.' }),
        preview,
        h('div', { class: 'row' }, btn('Escolher foto', () => pick(false)), btn('Tirar selfie', () => pick(true)), photo || existing?.photo ? btn('Remover', () => { photo = null; drawPreview(); }, 'ghost') : null),
        nameIn,
        h('label', { class: 'check' }, camIn, h('span', { text: 'Entrar nas salas ao vivo com minha câmera (no lugar da foto)' })),
        h('label', { class: 'check' }, micIn, h('span', { text: 'Entrar nas salas com o microfone ligado' })),
        h('div', { class: 'row' }, btn('Salvar e continuar', save, 'primary'), existing && onCancel ? btn('Cancelar', onCancel, 'ghost') : null),
      ),
    ),
  );
  nameIn.focus();
}

// ---------- menu ----------
export function showMenu(root: HTMLElement, a: MenuActions): () => void {
  clear(root);
  const pwaBox = h('div', { class: 'pwa-box' });
  const off = onPwa((s) => {
    clear(pwaBox);
    if (s.update) pwaBox.append(h('div', { class: 'pwa-line' }, h('span', { text: 'Nova versão disponível' }), btn('Atualizar', () => void applyUpdate(), 'primary small')));
    else if (s.phase === 'downloading') pwaBox.append(h('div', { class: 'pwa-line', text: `Baixando para jogar offline… ${s.pct}%` }));
    else if (s.phase === 'ready') pwaBox.append(h('div', { class: 'pwa-line ok', text: '✓ Pronto para jogar offline' }));
    if (s.installable) pwaBox.append(btn('Instalar app', () => void installApp(), 'small'));
    else if (isIos() && !s.standalone) pwaBox.append(h('div', { class: 'pwa-line muted', text: 'iPhone: Compartilhar → Adicionar à Tela de Início' }));
  });

  const avatar = avatarEl(a.profile.name, avatarColor(a.profile.id), a.profile.photo, 'avatar');
  const who = h('button', { class: 'who', attrs: { type: 'button', title: 'Editar perfil' }, on: { click: () => showProfile(root, a.profile, a.onProfile, () => { off(); showMenu(root, a); }) } }, avatar, h('span', { text: a.profile.name }));

  const tiles = h('div', { class: 'logo-tiles' });
  'RAMI'.split('').forEach((ch, i) => tiles.append(h('span', { class: `lt c${i}`, text: ch })));
  const kami = h('div', { class: 'logo-sub', text: 'kami' });

  root.append(
    h(
      'div',
      { class: 'screen menu' },
      h('div', { class: 'menu-top' }, who, btn('Aa Visual', () => a11yPanel(), 'small ghost')),
      h('div', { class: 'logo' }, tiles, kami),
      h(
        'div',
        { class: 'menu-btns' },
        btn('Jogar online', () => onlinePanel(a), 'primary big'),
        btn('Jogar offline (contra bots)', () => offlinePanel(a), 'big'),
        btn('Ranking', () => void rankingPanel(a.profile.id), 'big'),
        btn('Como jogar', () => rulesPanel(), 'ghost'),
      ),
      pwaBox,
    ),
  );
  void getPwa;
  return off;
}

function offlinePanel(a: MenuActions): void {
  const cfg = loadOfflineSettings();
  const m = modal(
    h(
      'div',
      { class: 'panel' },
      h('h3', { text: 'Jogo offline' }),
      h('p', { class: 'muted', text: 'Funciona sem internet depois que o jogo for baixado.' }),
      h('label', { class: 'lbl', text: 'Adversários (bots)' }),
      segmented([{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }] as const, cfg.bots, (v) => (cfg.bots = v)),
      h('label', { class: 'lbl', text: 'Nível dos bots' }),
      segmented(BOT_LEVELS.map((l) => ({ value: l, label: LEVEL_CFG[l].label })), cfg.level, (v) => (cfg.level = v)),
      h('label', { class: 'lbl', text: 'Tempo por jogada' }),
      segmented([{ value: 30, label: '30s' }, { value: 60, label: '60s' }, { value: 0, label: 'Sem limite' }] as const, cfg.turnSeconds, (v) => (cfg.turnSeconds = v)),
      h('div', { class: 'row' }, btn('Começar', () => { saveOfflineSettings(cfg); m.close(); a.startOffline(cfg); }, 'primary'), btn('Cancelar', () => m.close(), 'ghost')),
    ),
  );
}

function onlinePanel(a: MenuActions): void {
  let turn: TurnSeconds = 60;
  let isPublic = true;
  const codeIn = h('input', { class: 'input code-in', attrs: { type: 'text', maxlength: '5', placeholder: 'CÓDIGO', autocapitalize: 'characters', autocomplete: 'off' } });
  const list = h('div', { class: 'rooms' }, h('p', { class: 'muted', text: 'Carregando salas…' }));
  const m = modal(h('div', { class: 'panel online' }));
  const panel = m.el.firstElementChild as HTMLElement;

  const join = (code: string): void => {
    const c = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(c)) return toast('O código tem 5 letras/números.');
    m.close();
    a.startOnline(c);
  };
  codeIn.addEventListener('keydown', (e) => e.key === 'Enter' && join(codeIn.value));

  const refresh = async (): Promise<void> => {
    clear(list);
    try {
      const rooms = await listRooms();
      if (rooms.length === 0) list.append(h('p', { class: 'muted', text: 'Nenhuma sala pública aberta agora.' }));
      for (const r of rooms) list.append(h('button', { class: 'room', attrs: { type: 'button' }, on: { click: () => join(r.code) } }, h('b', { text: r.code }), h('span', { text: `${r.hostName} · ${r.count}/4 · ${r.turnSeconds}s` })));
    } catch {
      list.append(h('p', { class: 'muted', text: 'Sem conexão com o servidor.' }));
    }
  };

  const create = async (): Promise<void> => {
    try {
      const { code } = await createRoom(turn, isPublic);
      m.close();
      a.startOnline(code);
    } catch {
      toast('Não consegui criar a sala. Verifique a conexão.');
    }
  };

  panel.append(
    h('h3', { text: 'Jogar online' }),
    h('label', { class: 'lbl', text: 'Criar sala — tempo por jogada' }),
    segmented(TURN_SECONDS_OPTIONS.map((s) => ({ value: s, label: `${s}s` })), turn, (v) => (turn = v)),
    h('label', { class: 'check' }, h('input', { attrs: { type: 'checkbox', checked: '' }, on: { change: (e) => (isPublic = (e.target as HTMLInputElement).checked) } }), h('span', { text: 'Sala pública (aparece na lista)' })),
    btn('Criar sala', () => void create(), 'primary'),
    h('hr'),
    h('label', { class: 'lbl', text: 'Entrar com código' }),
    h('div', { class: 'row' }, codeIn, btn('Entrar', () => join(codeIn.value))),
    h('label', { class: 'lbl', text: 'Salas públicas' }),
    list,
    h('div', { class: 'row' }, btn('Atualizar lista', () => void refresh(), 'small'), btn('Fechar', () => m.close(), 'ghost small')),
  );
  void refresh();
}

async function rankingPanel(myId: string): Promise<void> {
  const body = h('div', { class: 'rank-body' }, h('p', { class: 'muted', text: 'Carregando…' }));
  const m = modal(h('div', { class: 'panel ranking' }, h('h3', { text: 'Ranking' }), h('p', { class: 'muted', text: 'Menor média de pontos na mão por partida vence. Entram no topo quem tem 3+ partidas online.' }), body, btn('Fechar', () => m.close(), 'ghost')));
  try {
    const rows = await getRanking();
    clear(body);
    if (rows.length === 0) return void body.append(h('p', { class: 'muted', text: 'Ainda não há partidas registradas.' }));
    const t = h('table', { class: 'rank' }, h('thead', null, h('tr', null, ...['#', 'Jogador', 'Média', 'Vitórias', 'Partidas'].map((x) => h('th', { text: x })))));
    const tb = h('tbody');
    rows.forEach((r, i) => {
      tb.append(h('tr', { class: `${r.id === myId ? 'me' : ''}${r.games < 3 ? ' prov' : ''}`.trim() }, h('td', { text: String(i + 1) }), h('td', { text: r.name }), h('td', { text: r.avg.toFixed(1) }), h('td', { text: String(r.wins) }), h('td', { text: String(r.games) })));
    });
    t.append(tb);
    body.append(t);
  } catch {
    clear(body);
    body.append(h('p', { class: 'muted', text: 'Não consegui carregar o ranking (sem conexão).' }));
  }
}

function rulesPanel(): void {
  const li = (t: string): HTMLElement => h('li', { text: t });
  const m = modal(
    h(
      'div',
      { class: 'panel rules' },
      h('h3', { text: 'Como jogar' }),
      h(
        'ul',
        null,
        li('Cada jogador começa com 14 pedras. Há 106 pedras: 4 cores × números 1–13 (duas de cada) e 2 coringas.'),
        li('Sequência: 3+ pedras da mesma cor em ordem (ex.: 4-5-6 azuis). Não existe 13→1.'),
        li('Trinca/quadra: 3 ou 4 pedras do mesmo número em cores diferentes.'),
        li('Coringa vale qualquer pedra; dentro de um conjunto ele conta o valor que representa.'),
        li('Primeira jogada (abertura): conjuntos novos, só com pedras do seu cavalete, somando 30+ pontos. A mesa não pode ser mexida nessa jogada.'),
        li('Depois de abrir, você pode juntar pedras a conjuntos da mesa, dividir e recombinar — ao fim da jogada todos os conjuntos devem ser válidos.'),
        li('Pedras da mesa nunca voltam ao cavalete. Se não puder (ou não quiser) jogar, compre 1 pedra do pote.'),
        li('Acabou o tempo? A mesa volta ao início da sua vez e você compra 1 pedra. Três estouros seguidos tiram você da partida.'),
        li('Fim: quem esvaziar o cavalete bate; se o pote acabar e ninguém jogar, termina também. Vence quem tem MENOS pontos na mão (coringa = 30).'),
        li('Arrastar: pedra a pedra (✋), conjunto inteiro (▭) ou dividir (✂). Duas mãos / roda do mouse fazem zoom; arraste a mesa vazia para mover a câmera.'),
      ),
      btn('Entendi', () => m.close(), 'primary'),
    ),
  );
}

// ---------- visual / acessibilidade ----------
export function a11yPanel(onChange?: (a: A11y) => void): void {
  const cur = loadA11y();
  const cb = h('input', { attrs: { type: 'checkbox' } });
  cb.checked = cur.contrast;
  cb.addEventListener('change', () => {
    saveA11y({ ...loadA11y(), contrast: cb.checked });
    onChange?.(loadA11y());
  });
  const skinPicker = h('div', { class: 'skins' });
  const drawSkins = (): void => {
    clear(skinPicker);
    for (const k of SKINS) {
      const on = loadA11y().skin === k.id;
      skinPicker.append(
        h(
          'button',
          {
            class: `skin${on ? ' active' : ''}`,
            attrs: { type: 'button', 'aria-label': k.name },
            on: {
              click: () => {
                saveA11y({ ...loadA11y(), skin: k.id });
                onChange?.(loadA11y());
                drawSkins();
              },
            },
          },
          h('span', { class: 'sw', attrs: { style: `background: linear-gradient(135deg, ${k.swatch[0]} 0 60%, ${k.swatch[1]} 60% 100%)` } }),
          h('span', { text: k.name }),
        ),
      );
    }
  };
  drawSkins();
  const m = modal(
    h(
      'div',
      { class: 'panel' },
      h('h2', { text: 'Visual' }),
      h('label', { class: 'check' }, cb, h('span', { text: 'Alto contraste: pedras brancas, cores bem distintas e um símbolo para cada cor (● ▲ ■ ◆)' })),
      h('label', { class: 'lbl', text: 'Tamanho das letras e botões' }),
      segmented([{ value: 0, label: 'Normal' }, { value: 1, label: 'Grande' }, { value: 2, label: 'Extra' }] as const, cur.size, (v) => {
        saveA11y({ ...loadA11y(), size: v });
        onChange?.(loadA11y());
      }),
      h('label', { class: 'lbl', text: 'Mesa' }),
      skinPicker,
      h('p', { class: 'hint', text: 'Na mesa: arraste para rolar, pince ou use ＋ − para aproximar, toque duas vezes num conjunto para ampliá-lo. Para mover uma pedra, segure o dedo nela até vibrar.' }),
      h('div', { class: 'row' }, btn('Pronto', () => m.close(), 'primary')),
    ),
  );
}
