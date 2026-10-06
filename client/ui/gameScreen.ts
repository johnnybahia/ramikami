import type { Backend } from '../backend';
import { getIceServers } from '../api';
import { RtcMesh } from '../net/rtc';
import { TableScene, type Mode } from '../game/scene';
import {
  draftStatus,
  dropNew,
  placeSets,
  dropOnSet,
  dropToRack,
  isDirty,
  moveSet,
  newDraft,
  resolveBoardDrop,
  sortRack,
  splitSet,
  suggestDrop,
  tidyTable,
  tableWithoutTile,
  MELD_MIN,
  type Draft,
} from '../game/draft';
import { analyzeSet, arrangeTiles } from '../../shared/rules';
import { isJoker } from '../../shared/tiles';
import { PERSONAS, botIdOf, personaOfBotId } from '../../shared/bot';
import { personaAvatar } from '../botAvatars';
import { a11yPanel, modal } from './screens';
import { relayout, type SetState } from '../../shared/layout';
import { TURN_SECONDS_OPTIONS, type RoomPlayer, type RoomView, type TurnSeconds } from '../../shared/protocol';
import { applyUpdate, checkForUpdate, onPwa, type PwaState } from '../pwa';
import { avatarColor, loadA11y, type Profile } from '../store';
import { avatarEl, btn, clear, h, toast } from './dom';

interface PBox {
  el: HTMLElement;
  holder: HTMLElement;
  video: HTMLVideoElement;
  name: HTMLElement;
  meta: HTMLElement;
  ring: HTMLElement;
  cam: HTMLButtonElement;
  mic: HTMLButtonElement;
  mute: HTMLButtonElement;
  kick: HTMLButtonElement;
  avatarKey: string;
  muted: boolean;
}

export interface GameScreenOpts {
  backend: Backend;
  profile: Profile;
  onExit(): void;
  onRematch?(): void;
}

const REASONS: Record<string, string> = { empty: 'Alguém bateu (ficou sem pedras).', pool: 'O pote acabou e ninguém conseguiu jogar.', left: 'Os outros jogadores saíram.' };

export class GameScreen {
  private root = h('div', { class: 'game' });
  private stage = h('div', { class: 'stage' });
  private topbar = h('div', { class: 'topbar' });
  private boxLayer = h('div', { class: 'boxes' });
  private actionbar = h('div', { class: 'actionbar' });
  private overlay = h('div', { class: 'overlay-host' });
  private scene: TableScene;
  private view: RoomView | null = null;
  private receivedAt = 0;
  private draft: Draft | null = null;
  private undo: Draft[] = [];
  private selected = new Set<number>();
  private btnPlaySel!: HTMLButtonElement;
  private turnBanner = h('div', { class: 'turn-banner hidden', text: '⚡ SUA VEZ! Toque para começar' });
  private nagTimer = 0;
  private autoMediaDone = false;
  private mode: Mode = 'tile';
  private remoteDraft: SetState[] | null = null;
  private photos = new Map<string, string>();
  private boxes = new Map<string, PBox>();
  private streams = new Map<string, MediaStream>();
  private rtc: RtcMesh | null = null;
  private pendingPeers: string[] = [];
  private sig = '';
  private tick = 0;
  private draftTimer = 0;
  private lastTurnId: string | null = null;
  private pwa: PwaState | null = null;
  private offPwa: () => void;
  private seatsOpen = false;
  private seatPick: string | null = null;
  private seatModal: HTMLElement | null = null;
  private b: Backend;
  private timerPill = h('div', { class: 'pill timer', text: '' });
  private menuBtn = h('button', { class: 'pill menu', text: '☰ Menu', attrs: { type: 'button' } });
  private zoomDock = h('div', { class: 'zoomdock' });
  private btnConfirm!: HTMLButtonElement;
  private btnDraw!: HTMLButtonElement;
  private btnUndo!: HTMLButtonElement;
  private btnReset!: HTMLButtonElement;
  private modeBtns = new Map<Mode, HTMLButtonElement>();
  private statusEl = h('div', { class: 'status' });
  private connEl = h('div', { class: 'conn hidden', text: 'Reconectando…' });
  private unlock = (): void => this.boxes.forEach((b) => void b.video.play().catch(() => {}));

  constructor(private o: GameScreenOpts) {
    this.b = o.backend;
    document.body.append(this.root);
    this.root.append(this.stage, this.boxLayer, this.topbar, this.actionbar, this.overlay, this.connEl);
    this.scene = new TableScene(this.stage, {
      onRackDrop: (id, i) => this.onRackDrop(id, i),
      onBoardDrop: (id, cx, cz) => this.onBoardDrop(id, cx, cz),
      onSetMove: (sid, dx, dz) => this.onSetMove(sid, dx, dz),
      onSplit: (sid, i) => this.onSplit(sid, i),
      onPoolTap: () => this.requestDraw(),
      onPick: (id) => this.onPick(id),
    });
    this.buildTopbar();
    this.buildActions();
    document.addEventListener('pointerdown', this.unlock, { once: true });
    this.offPwa = onPwa((s) => {
      this.pwa = s;
      this.renderUpdate();
    });

    const ev = this.b.events;
    ev.onView = (v) => this.onView(v);
    ev.onDraft = (from, table) => {
      if (this.view && this.view.turnId === from && from !== this.view.you) {
        this.remoteDraft = table;
        this.sync();
      }
    };
    ev.onPhoto = (id, data) => {
      this.photos.set(id, data);
      this.renderBoxes();
    };
    ev.onError = (m) => toast(m);
    ev.onNotice = (text) => toast(text, 5000);
    ev.onSay = (id, text) => {
      const who = this.view?.players.find((p) => p.id === id)?.name ?? '';
      toast(`${who}: “${text}”`, 2400);
    };
    ev.onKicked = () => {
      toast('Você saiu da sala.');
      this.teardown();
      this.o.onExit();
    };
    ev.onRtc = (from, data) => void this.rtc?.handle(from, data as never);
    ev.onConn = (s) => this.connEl.classList.toggle('hidden', s === 'open' || this.b.mode === 'offline');

    if (this.b.mode === 'online') void this.initRtc();
    if (this.o.profile.photo) this.photos.set(this.o.profile.id, this.o.profile.photo);
    this.scene.setSize(loadA11y().size);
    this.tick = window.setInterval(() => this.tickUi(), 250);
    this.b.connect();
  }

  // ---------- WebRTC ----------
  private async initRtc(): Promise<void> {
    const iceServers = await getIceServers();
    this.rtc = new RtcMesh({
      myId: this.o.profile.id,
      iceServers,
      send: (to, data) => this.b.rtc(to, data),
      onStream: (id, s) => {
        if (s) this.streams.set(id, s);
        else this.streams.delete(id);
        this.renderBoxes();
      },
    });
    this.rtc.setPeers(this.pendingPeers);
  }

  private async toggleMedia(kind: 'cam' | 'mic'): Promise<void> {
    if (!this.rtc) return toast('Vídeo e áudio só funcionam no jogo online.');
    try {
      if (kind === 'cam') await this.rtc.setCam(!this.rtc.camOn);
      else await this.rtc.setMic(!this.rtc.micOn);
    } catch {
      toast(kind === 'cam' ? 'Não consegui usar a câmera. Verifique a permissão do navegador.' : 'Não consegui usar o microfone. Verifique a permissão do navegador.');
      return;
    }
    this.b.media(this.rtc.camOn, this.rtc.micOn);
    this.renderBoxes();
    if (this.view?.phase === 'lobby') this.renderOverlay();
  }

  /** Aplica a preferência do perfil (câmera/microfone) uma vez, ao entrar na sala. */
  private autoMedia(): void {
    if (this.autoMediaDone || !this.rtc || !this.me()) return;
    this.autoMediaDone = true;
    if (this.o.profile.cam) void this.toggleMedia('cam');
    if (this.o.profile.mic) void this.toggleMedia('mic');
  }

  // ---------- visão do servidor ----------
  private me(): RoomPlayer | undefined {
    return this.view?.players.find((p) => p.id === this.view!.you);
  }

  private myTurn(): boolean {
    return !!this.view && this.view.phase === 'playing' && this.view.turnId === this.view.you;
  }

  private startTurnAlert(): void {
    this.stopTurnAlert();
    this.turnBanner.classList.remove('hidden');
    this.root.classList.add('my-turn');
    let n = 0;
    const buzz = (): void => {
      navigator.vibrate?.([220, 120, 220]);
      if (++n >= 8) window.clearInterval(this.nagTimer);
    };
    buzz();
    this.nagTimer = window.setInterval(buzz, 6000);
    window.addEventListener('pointerdown', this.ackTurn, { capture: true, once: true });
    window.addEventListener('keydown', this.ackTurn, { capture: true, once: true });
  }

  private ackTurn = (): void => this.stopTurnAlert();

  private stopTurnAlert(): void {
    window.clearInterval(this.nagTimer);
    this.nagTimer = 0;
    this.turnBanner.classList.add('hidden');
    this.root.classList.remove('my-turn');
    window.removeEventListener('pointerdown', this.ackTurn, true);
    window.removeEventListener('keydown', this.ackTurn, true);
    navigator.vibrate?.(0);
  }

  private onView(v: RoomView): void {
    const prev = this.view;
    this.view = v;
    this.receivedAt = performance.now();
    const sig = `${v.phase}|${v.turnNo}|${JSON.stringify(v.table)}|${v.rack.slice().sort((a, b) => a - b).join(',')}`;
    if (sig !== this.sig) {
      this.sig = sig;
      this.remoteDraft = null;
      this.undo = [];
      const order = new Map<number, number>();
      this.draft?.rack.forEach((id, i) => order.set(id, i));
      const rack = v.rack.slice().sort((a, b) => (order.get(a) ?? 1000 + a) - (order.get(b) ?? 1000 + b));
      const me = v.players.find((p) => p.id === v.you);
      let d = newDraft(v.table, rack, !!me?.melded);
      if (!prev || prev.phase === 'lobby') d = sortRack(d, 'num');
      this.draft = d;
    }
    this.autoMedia();
    if (v.turnId !== this.lastTurnId) {
      this.lastTurnId = v.turnId;
      if (v.turnId === v.you && v.phase === 'playing') {
        this.startTurnAlert();
      } else this.stopTurnAlert();
    }
    const ids = v.players.filter((p) => !p.left && p.connected).map((p) => p.id);
    if (this.rtc) this.rtc.setPeers(ids);
    else this.pendingPeers = ids;
    this.render();
  }

  // ---------- rascunho ----------
  private apply(next: Draft | null, why?: string): void {
    if (!next || !this.draft) {
      if (why) toast(why);
      this.sync();
      return;
    }
    this.undo.push(this.draft);
    if (this.undo.length > 80) this.undo.shift();
    this.draft = next;
    this.sync();
    this.updateActions();
    this.sendDraft();
  }

  private onPick(id: number): void {
    if (!this.draft || !this.myTurn() || !this.draft.rack.includes(id)) return;
    if (this.selected.has(id)) this.selected.delete(id);
    else if (isJoker(id) && [...this.selected].some(isJoker)) return toast('Marque no máximo 1 coringa.');
    else this.selected.add(id);
    this.sync();
    this.updateActions();
  }

  private playSelected(): void {
    const d = this.draft;
    if (!d || !this.myTurn()) return;
    const r = arrangeTiles([...this.selected], d.melded);
    if (!r.ok) return toast(r.reason);
    this.selected.clear();
    this.apply(placeSets(d, r.sets), 'Sem espaço na mesa.');
  }

  private onRackDrop(id: number, index: number): void {
    if (!this.draft) return;
    this.apply(dropToRack(this.draft, id, index), 'Você só pode devolver ao cavalete pedras que jogou neste turno.');
  }

  private onBoardDrop(id: number, cx: number, cz: number): void {
    if (!this.draft || !this.myTurn()) return this.sync();
    let act = resolveBoardDrop(tableWithoutTile(this.draft.table, id), cx, cz);
    if (act.kind === 'new') act = suggestDrop(this.draft.table, id, cx, cz) ?? act;
    this.apply(act.kind === 'insert' ? dropOnSet(this.draft, id, act.setId, act.index) : dropNew(this.draft, id, act.x, act.z), 'Sem espaço na mesa.');
  }

  private onSetMove(setId: number, dx: number, dz: number): void {
    const d = this.draft;
    const s = d?.table.find((x) => x.id === setId);
    if (!d || !s) return;
    this.apply(moveSet(d, setId, s.x + dx, s.z + dz), 'Sem espaço aí.');
  }

  private onSplit(setId: number, index: number): void {
    if (!this.draft) return;
    this.apply(splitSet(this.draft, setId, index), 'Não dá para dividir aí.');
  }

  private sendDraft(): void {
    if (!this.myTurn() || !this.draft) return;
    window.clearTimeout(this.draftTimer);
    this.draftTimer = window.setTimeout(() => this.draft && this.b.draft(relayout(this.draft.table)), 180);
  }

  private doUndo(): void {
    const prev = this.undo.pop();
    if (!prev) return;
    this.draft = prev;
    this.sync();
    this.updateActions();
    this.sendDraft();
  }

  private doReset(): void {
    const v = this.view;
    const d = this.draft;
    if (!v || !d || !isDirty(d)) return;
    const rack = [...d.rack, ...d.placed].sort((a, b) => d.baseRack.indexOf(a) - d.baseRack.indexOf(b));
    this.undo.push(d);
    const fresh = newDraft(d.baseTable, d.baseRack, d.melded);
    fresh.rack = rack.filter((id) => d.baseRack.includes(id));
    this.draft = fresh;
    this.sync();
    this.updateActions();
    this.sendDraft();
  }

  private doConfirm(): void {
    const d = this.draft;
    if (!d || !this.myTurn()) return;
    const st = draftStatus(d);
    if (!st.check.ok) return toast(st.check.reason);
    this.b.submit(relayout(d.table));
  }

  private requestDraw(): void {
    const v = this.view;
    if (!v || !this.myTurn()) return toast('Aguarde a sua vez.');
    if (v.poolCount === 0) {
      if (!window.confirm('O pote está vazio. Passar a vez?')) return;
    } else if (this.draft && isDirty(this.draft) && !window.confirm('Desfazer o que você montou e comprar uma pedra?')) return;
    this.b.draw();
  }

  // ---------- renderização ----------
  private sync(): void {
    const d = this.draft;
    const v = this.view;
    if (!d || !v) return;
    for (const id of this.selected) if (!d.rack.includes(id)) this.selected.delete(id);
    const st = draftStatus(d);
    const table = this.remoteDraft ?? d.table;
    let valid = st.setValid;
    if (this.remoteDraft) {
      valid = new Map();
      for (const s of this.remoteDraft) valid.set(s.id, analyzeSet(s.tiles).valid);
    }
    this.scene.setState({
      table,
      rack: d.rack,
      placed: this.remoteDraft ? new Set() : d.placed,
      valid,
      canEditBoard: this.myTurn(),
      mode: this.mode,
      poolCount: v.poolCount,
      selected: this.selected,
    });
    this.layoutBars();
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    this.sync();
    this.renderTop();
    this.renderBoxes();
    this.updateActions();
    this.renderOverlay();
    this.renderUpdate();
  }

  private layoutBars(): void {
    const rh = this.scene.rackHeight;
    this.actionbar.style.bottom = `${rh}px`;
    this.root.style.setProperty('--rack-h', `${rh}px`);
    this.root.style.setProperty('--bar-h', `${this.actionbar.offsetHeight}px`);
  }

  private buildTopbar(): void {
    this.menuBtn.addEventListener('click', () => this.openMenu());
    this.topbar.append(this.menuBtn, this.timerPill);
    const dock = (label: string, title: string, fn: () => void): HTMLButtonElement => h('button', { class: 'zoom', text: label, attrs: { type: 'button', 'aria-label': title, title }, on: { click: fn } });
    this.zoomDock.append(dock('＋', 'Aproximar', () => this.scene.zoomBy(0.75)), dock('－', 'Afastar', () => this.scene.zoomBy(1.33)), dock('⌖', 'Ver a mesa toda', () => this.scene.fit()));
  }

  /** Menu do jogo: tudo o que não é jogada fica aqui, fora da tela de jogo. */
  private openMenu(): void {
    const v = this.view;
    if (!v) return;
    const me = this.me();
    const online = this.b.mode === 'online';
    const m = modal(h('div', { class: 'panel gamemenu' }));
    const panel = m.el.firstElementChild as HTMLElement;
    const item = (icon: string, label: string, fn: () => void): HTMLButtonElement =>
      h('button', { class: 'mitem', attrs: { type: 'button' }, on: { click: () => { m.close(); fn(); } } }, h('span', { class: 'ic', text: icon }), h('span', { text: label }));
    const hasNew = !!this.pwa?.update;
    panel.append(
      h('h2', { text: online ? `Sala ${v.code}` : 'Jogo' }),
      h('p', { class: 'muted', text: v.phase === 'lobby' ? 'Aguardando começar' : `Pote: ${v.poolCount} pedras` }),
      h(
        'div',
        { class: 'mgrid' },
        ...(online ? [item('🔗', 'Convidar', () => void this.shareRoom())] : []),
        ...(online ? [item(me?.cam ? '📷' : '🚫', me?.cam ? 'Câmera ligada' : 'Ligar câmera', () => void this.toggleMedia('cam'))] : []),
        ...(online ? [item(me?.mic ? '🎤' : '🔇', me?.mic ? 'Microfone ligado' : 'Ligar microfone', () => void this.toggleMedia('mic'))] : []),
        item('Aa', 'Letras e cores', () => a11yPanel((a) => { this.scene.setContrast(a.contrast); this.scene.setSize(a.size); })),
        item('↻', hasNew ? 'Atualizar (nova versão)' : 'Atualizar', () => void this.doUpdate()),
        item('✕', 'Sair do jogo', () => this.exit()),
      ),
      h('div', { class: 'row' }, btn('Fechar', () => m.close(), 'primary')),
    );
  }

  private renderTop(): void {
    this.tickUi();
  }

  /** Botão "Atualizar": procura a versão mais nova e, se houver, recarrega (com aviso se a partida está em andamento). */
  private async doUpdate(): Promise<void> {
    const playing = this.view?.phase === 'playing';
    if (!this.pwa?.update) {
      toast('Procurando atualização…', 1500);
      const r = await checkForUpdate();
      if (r === 'none') return toast('Você já está com a versão mais recente.');
    }
    const msg =
      this.b.mode === 'offline'
        ? 'Atualizar agora recarrega o jogo e esta partida contra bots será perdida. Continuar?'
        : playing
          ? 'Atualizar agora recarrega o jogo. Você volta para a mesma sala em seguida, mas perde o rascunho da jogada atual. Continuar?'
          : 'Nova versão pronta. Atualizar agora?';
    if (!window.confirm(msg)) return;
    void applyUpdate();
  }

  private renderUpdate(): void {
    this.menuBtn.classList.toggle('dot', !!this.pwa?.update);
  }

  private async shareRoom(): Promise<void> {
    const v = this.view;
    if (!v) return;
    const url = `${location.origin}${location.pathname}?sala=${v.code}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Rami-kami', text: `Vem jogar Rami-kami! Sala ${v.code}`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link da sala copiado.');
      }
    } catch {
      /* cancelado */
    }
  }

  private tickUi(): void {
    const v = this.view;
    if (!v) return;
    let remaining: number | null = null;
    if (v.turnEndsAt) remaining = Math.max(0, Math.ceil((v.turnEndsAt - v.serverNow) / 1000 - (performance.now() - this.receivedAt) / 1000));
    this.timerPill.classList.toggle('hidden', remaining === null || v.phase !== 'playing');
    if (remaining !== null) {
      this.timerPill.textContent = `⏱ ${remaining}s`;
      this.timerPill.classList.toggle('danger', remaining <= 10);
      if (remaining <= 5 && remaining > 0 && this.myTurn()) navigator.vibrate?.(20);
    }
    const total = v.turnSeconds;
    for (const p of v.players) {
      const box = this.boxes.get(p.id);
      if (!box) continue;
      const active = v.phase === 'playing' && v.turnId === p.id;
      box.el.style.setProperty('--p', active && remaining !== null ? String(Math.round((remaining / total) * 100)) : active ? '100' : '0');
    }
  }

  // ---------- caixinhas dos jogadores ----------
  private ensureBox(p: RoomPlayer): PBox {
    let box = this.boxes.get(p.id);
    if (box) return box;
    const holder = h('div', { class: 'holder' });
    const video = h('video', { class: 'pvideo hidden-video', attrs: { autoplay: '', playsinline: '' } });
    video.muted = false;
    const ring = h('div', { class: 'ring' });
    const frame = h('div', { class: 'frame' }, holder, video, ring);
    const name = h('div', { class: 'pname' });
    const meta = h('div', { class: 'pmeta' });
    const mk = (label: string, title: string, fn: () => void): HTMLButtonElement => h('button', { class: 'mini', text: label, attrs: { type: 'button', title }, on: { click: fn } });
    const cam = mk('📷', 'Câmera', () => void this.toggleMedia('cam'));
    const mic = mk('🎤', 'Microfone', () => void this.toggleMedia('mic'));
    const mute = mk('🔊', 'Silenciar este jogador', () => {
      const b = this.boxes.get(p.id);
      if (!b) return;
      b.muted = !b.muted;
      b.video.muted = b.muted;
      b.mute.textContent = b.muted ? '🔇' : '🔊';
    });
    const kick = mk('✖', 'Remover da sala', () => {
      if (window.confirm(`Remover ${p.name} da sala?`)) this.b.kick(p.id);
    });
    const ctl = h('div', { class: 'ctl' }, cam, mic, mute, kick);
    const el = h('div', { class: 'pbox' }, frame, name, meta, ctl);
    let closer = 0;
    frame.addEventListener('click', () => {
      el.classList.toggle('open');
      window.clearTimeout(closer);
      if (el.classList.contains('open')) closer = window.setTimeout(() => el.classList.remove('open'), 6000);
    });
    this.boxLayer.append(el);
    box = { el, holder, video, name, meta, ring, cam, mic, mute, kick, avatarKey: '', muted: false };
    this.boxes.set(p.id, box);
    return box;
  }

  private renderBoxes(): void {
    const v = this.view;
    if (!v) return;
    const me = this.me();
    const mySeat = me?.seat ?? 0;
    const meId = v.you;
    const isHost = v.hostId === meId;
    const live = this.b.mode === 'online';
    const seen = new Set<string>();
    for (const p of v.players) {
      if (p.left) continue;
      seen.add(p.id);
      const box = this.ensureBox(p);
      const rel = (p.seat - mySeat + 4) % 4;
      box.el.className = `pbox pos-${rel}${v.turnId === p.id ? ' turn' : ''}${p.connected ? '' : ' offline'}${p.id === meId ? ' me' : ''}`;
      box.name.textContent = `${p.isHost ? '♛ ' : ''}${p.name}`;
      box.meta.textContent = v.phase === 'lobby' ? (p.connected ? '' : 'offline') : `${p.rackCount} pedras${p.melded ? ' · abriu' : ''}`;
      const bp = personaOfBotId(p.id);
      const photo = this.photos.get(p.id) ?? (bp ? personaAvatar(bp.id) : null);
      const key = `${p.name}|${photo ? photo.length : 0}`;
      if (key !== box.avatarKey) {
        box.avatarKey = key;
        clear(box.holder);
        box.holder.append(avatarEl(p.name, avatarColor(p.id), photo));
      }
      const isMe = p.id === meId;
      const stream = isMe ? this.rtc?.localVideo : this.streams.get(p.id);
      const showVideo = !!stream && p.cam && (isMe ? !!this.rtc?.camOn : true);
      if (stream && box.video.srcObject !== stream) {
        box.video.srcObject = stream;
        void box.video.play().catch(() => {});
      }
      if (!stream) box.video.srcObject = null;
      box.video.muted = isMe || box.muted;
      box.video.classList.toggle('hidden-video', !showVideo);
      box.video.classList.toggle('selfie', isMe);
      box.holder.classList.toggle('hidden', showVideo);
      box.cam.classList.toggle('on', p.cam);
      box.mic.classList.toggle('on', p.mic);
      box.cam.textContent = p.cam ? '📷' : '🚫';
      box.mic.textContent = p.mic ? '🎤' : '🔇';
      box.cam.classList.toggle('hidden', !live || !isMe);
      box.mic.classList.toggle('hidden', !live || !isMe);
      box.mute.classList.toggle('hidden', !live || isMe);
      box.kick.classList.toggle('hidden', !(live && isHost && !isMe));
    }
    for (const [id, box] of this.boxes) {
      if (!seen.has(id)) {
        box.el.remove();
        this.boxes.delete(id);
      }
    }
    if (this.seatsOpen) this.renderSeats();
  }

  // ---------- barra de ações ----------
  private buildActions(): void {
    const mk = (icon: string, label: string, title: string, fn: () => void): HTMLButtonElement =>
      h('button', { class: 'act2', attrs: { type: 'button', title, 'aria-label': title }, on: { click: fn } }, h('span', { class: 'ic', text: icon }), h('span', { class: 'tx', text: label }));
    this.btnUndo = mk('↶', 'Desfazer', 'Desfazer o último movimento', () => this.doUndo());
    this.btnReset = mk('⟲', 'Recomeçar', 'Recomeçar a jogada', () => this.doReset());
    const sortNum = mk('123', 'Por número', 'Ordenar o cavalete por número', () => this.draft && this.apply(sortRack(this.draft, 'num')));
    const sortCol = mk('🎨', 'Por cor', 'Ordenar o cavalete por cor', () => this.draft && this.apply(sortRack(this.draft, 'color')));
    const tidy = mk('▦', 'Arrumar', 'Arrumar a mesa em linhas', () => this.draft && this.myTurn() && this.apply(tidyTable(this.draft), 'Não coube na mesa.'));
    const modeDefs: [Mode, string, string, string][] = [
      ['tile', '✋', 'Mover', 'Mover pedra (segure o dedo na pedra da mesa)'],
      ['set', '▭', 'Conjunto', 'Mover conjunto inteiro'],
      ['split', '✂', 'Cortar', 'Dividir conjunto (toque na pedra onde cortar)'],
      ['pick', '☑', 'Marcar', 'Marcar pedras do cavalete para jogar de uma vez'],
    ];
    const modes = h('div', { class: 'moderow' });
    for (const [m, icon, label, title] of modeDefs) {
      const b = mk(icon, label, title, () => {
        this.mode = m;
        if (m !== 'pick') this.selected.clear();
        this.sync();
        this.updateActions();
      });
      this.modeBtns.set(m, b);
      modes.append(b);
    }
    this.btnPlaySel = h('button', { class: 'btn confirm hidden', attrs: { type: 'button' }, on: { click: () => this.playSelected() } });
    this.btnDraw = h('button', { class: 'btn draw', text: 'Comprar', attrs: { type: 'button' }, on: { click: () => this.requestDraw() } });
    this.btnConfirm = h('button', { class: 'btn confirm', text: 'Confirmar', attrs: { type: 'button' }, on: { click: () => this.doConfirm() } });
    this.actionbar.append(
      h('div', { class: 'mainrow' }, this.btnPlaySel, this.btnDraw, this.btnConfirm),
      h('div', { class: 'toolrow' }, this.btnUndo, this.btnReset, sortNum, sortCol, tidy),
      modes,
    );
    this.root.append(this.statusEl, this.turnBanner, this.zoomDock);
  }

  private updateActions(): void {
    const v = this.view;
    const d = this.draft;
    if (!v || !d) return;
    const mine = this.myTurn();
    this.actionbar.classList.toggle('hidden', v.phase !== 'playing');
    for (const [m, b] of this.modeBtns) b.classList.toggle('active', m === this.mode);
    this.btnUndo.disabled = !mine || this.undo.length === 0;
    this.btnReset.disabled = !mine || !isDirty(d);
    this.btnDraw.disabled = !mine;
    this.btnPlaySel.classList.toggle('hidden', !mine || this.mode !== 'pick' || this.selected.size < 3);
    this.btnPlaySel.textContent = `Jogar marcadas (${this.selected.size})`;
    this.btnDraw.textContent = v.poolCount === 0 ? 'Passar' : `Comprar (${v.poolCount})`;
    const st = draftStatus(d);
    const dirty = isDirty(d);
    this.btnConfirm.disabled = !mine || !st.check.ok;
    let text = '';
    if (!mine) {
      const who = v.players.find((p) => p.id === v.turnId)?.name;
      text = who ? `Vez de ${who}` : '';
    } else if (!dirty) {
      text = d.melded ? 'Monte jogadas ou compre' : `Abra com ${MELD_MIN}+ pontos`;
    } else if (st.check.ok) {
      text = d.melded ? 'Jogada válida' : `Abertura ✓ ${st.meldPoints} pontos`;
    } else if (!d.melded) {
      text = `Abertura: ${st.meldPoints}/${MELD_MIN}`;
    } else {
      text = `${st.check.reason} · no fim do tempo valem só os conjuntos feitos só com sua mão`;
    }
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('hidden', !text || v.phase !== 'playing');
    this.statusEl.classList.toggle('bad', mine && dirty && !st.check.ok);
    this.statusEl.classList.toggle('good', mine && dirty && st.check.ok);
    this.layoutBars();
  }

  // ---------- sobreposições ----------
  private renderOverlay(): void {
    const v = this.view!;
    clear(this.overlay);
    if (v.phase === 'lobby') this.overlay.append(this.lobbyPanel(v));
    else if (v.phase === 'ended') this.overlay.append(this.resultPanel(v));
  }

  private lobbyPanel(v: RoomView): HTMLElement {
    const host = v.hostId === v.you;
    const list = h('ul', { class: 'plist' });
    for (const p of v.players) {
      const li = h('li', { text: `${p.isHost ? '♛ ' : ''}${p.bot ? '🤖 ' : ''}${p.name}${p.id === v.you ? ' (você)' : ''}${p.connected ? '' : ' · offline'}` });
      if (host && p.bot) li.append(' ', btn('×', () => this.b.removeBot(p.id), 'ghost small'));
      list.append(li);
    }
    const free = PERSONAS.filter((p) => !v.players.some((x) => x.id === botIdOf(p.id)));
    const botRow =
      host && v.players.length < 4 && free.length > 0
        ? h(
            'div',
            { class: 'bots' },
            h('p', { class: 'muted', text: 'Adicionar bot (cada um joga de um jeito)' }),
            ...free.map((p) =>
              h(
                'button',
                { class: 'room bot-pick', attrs: { type: 'button', title: p.blurb }, on: { click: () => this.b.addBot(p.id) } },
                h('img', { class: 'avatar', attrs: { src: personaAvatar(p.id), alt: p.name } }),
                h('span', {}, h('b', { text: `${p.name} · ${p.level}` }), h('small', { class: 'muted', text: p.blurb })),
              ),
            ),
          )
        : null;
    const seg = h('div', { class: 'seg' });
    for (const s of TURN_SECONDS_OPTIONS) {
      seg.append(
        h('button', {
          class: `seg-btn${v.turnSeconds === s ? ' active' : ''}`,
          text: `${s}s`,
          attrs: { type: 'button', ...(host ? {} : { disabled: '' }) },
          on: { click: () => this.b.settings(s as TurnSeconds) },
        }),
      );
    }
    const start = btn('Iniciar partida', () => this.b.start(), 'primary');
    start.disabled = v.players.length < 2;
    const actions = host
      ? h('div', { class: 'row' }, btn('Posições na mesa', () => this.openSeats()), start)
      : h('p', { class: 'muted', text: 'Aguardando o anfitrião iniciar a partida…' });
    return h(
      'div',
      { class: 'panel lobby' },
      h('h2', { text: `Sala ${v.code}` }),
      h('p', { class: 'muted', text: `${v.players.length}/4 jogadores · tempo por jogada` }),
      seg,
      list,
      botRow,
      h('div', { class: 'row' }, btn('Convidar', () => void this.shareRoom())),
      h(
        'div',
        { class: 'row' },
        btn(this.rtc?.camOn ? '📷 Câmera ligada' : '🚫 Entrar sem câmera', () => void this.toggleMedia('cam'), this.rtc?.camOn ? 'primary' : ''),
        btn(this.rtc?.micOn ? '🎤 Microfone ligado' : '🔇 Entrar sem microfone', () => void this.toggleMedia('mic'), this.rtc?.micOn ? 'primary' : ''),
      ),
      actions,
      h('div', { class: 'row' }, btn('Sair da sala', () => this.exit(true), 'ghost')),
    );
  }

  private resultPanel(v: RoomView): HTMLElement {
    const r = v.result;
    const rows = h('ol', { class: 'results' });
    if (r) {
      const sorted = v.players.slice().sort((a, b) => (r.points[a.id] ?? 0) - (r.points[b.id] ?? 0));
      for (const p of sorted) {
        const win = r.winners.includes(p.id);
        rows.append(h('li', { class: win ? 'win' : '' }, h('span', { text: `${win ? '🏆 ' : ''}${p.name}${r.left.includes(p.id) ? ' (saiu +50)' : ''}` }), h('b', { text: `${r.points[p.id] ?? 0} pts` })));
      }
    }
    const names = r ? v.players.filter((p) => r.winners.includes(p.id)).map((p) => p.name).join(' e ') : '';
    const row = h('div', { class: 'row' });
    if (this.o.onRematch) row.append(btn('Jogar de novo', () => this.rematch(), 'primary'));
    row.append(btn('Voltar ao menu', () => this.exit(true), this.o.onRematch ? 'ghost' : 'primary'));
    return h(
      'div',
      { class: 'panel result' },
      h('h2', { text: names ? `${names} venceu!` : 'Fim de jogo' }),
      h('p', { class: 'muted', text: `${r ? REASONS[r.reason] : ''} Vence quem tem menos pontos na mão.` }),
      rows,
      this.b.mode === 'online' ? h('p', { class: 'hint', text: 'Pontuação registrada no ranking (menor média = melhor).' }) : null,
      row,
    );
  }

  private rematch(): void {
    this.teardown();
    this.o.onRematch?.();
  }

  // ---------- posições na mesa (anfitrião) ----------
  private openSeats(): void {
    this.seatsOpen = true;
    this.seatPick = null;
    this.seatModal = h('div', { class: 'modal' });
    document.body.append(this.seatModal);
    this.renderSeats();
  }

  private renderSeats(): void {
    const v = this.view;
    const modal = this.seatModal;
    if (!v || !modal) return;
    const mySeat = this.me()?.seat ?? 0;
    clear(modal);
    const table = h('div', { class: 'seat-table' });
    for (let rel = 0; rel < 4; rel++) {
      const abs = (mySeat + rel) % 4;
      const occupant = v.players.find((p) => p.seat === abs && !p.left);
      const slot = h('button', {
        class: `slot pos-${rel}${occupant ? ' taken' : ''}${occupant && this.seatPick === occupant.id ? ' picked' : ''}`,
        text: occupant ? occupant.name : 'vazio',
        attrs: { type: 'button' },
        on: {
          click: () => {
            if (occupant && (!this.seatPick || this.seatPick === occupant.id)) {
              this.seatPick = this.seatPick === occupant.id ? null : occupant.id;
            } else if (this.seatPick) {
              this.b.seat(this.seatPick, abs);
              this.seatPick = null;
            }
            this.renderSeats();
          },
        },
      });
      table.append(slot);
    }
    modal.append(
      h(
        'div',
        { class: 'panel seats' },
        h('h3', { text: 'Posições na mesa' }),
        h('p', { class: 'muted', text: 'Toque em um jogador e depois no lugar de destino (troca com quem estiver lá). A ordem das jogadas segue o sentido horário a partir do início da partida.' }),
        table,
        btn('Pronto', () => this.closeSeats(), 'primary'),
      ),
    );
  }

  private closeSeats(): void {
    this.seatsOpen = false;
    this.seatModal?.remove();
    this.seatModal = null;
  }

  // ---------- saída ----------
  private exit(force = false): void {
    const v = this.view;
    if (!force && v?.phase === 'playing' && !window.confirm('Sair da partida? Você perde e leva +50 pontos.')) return;
    this.teardown();
    this.o.onExit();
  }

  private teardown(): void {
    window.clearInterval(this.tick);
    window.clearTimeout(this.draftTimer);
    document.removeEventListener('pointerdown', this.unlock);
    this.offPwa();
    this.closeSeats();
    this.b.leave();
    this.stopTurnAlert();
    this.rtc?.close();
    this.scene.dispose();
    this.root.remove();
  }

  /** Para a interface chamar ao sair da aba. */
  destroy(): void {
    this.teardown();
  }
}

