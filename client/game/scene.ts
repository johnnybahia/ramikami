import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLS, ROWS, type SetState } from '../../shared/layout';
import { TILE_COUNT } from '../../shared/tiles';
import { setHighContrast } from './tiles3d';
import { acceptingSets, newSetSpot, resolveBoardDrop, tableWithoutTile } from './draft';
import { CELL_D, CELL_W, ROW_D, TILE_D, TILE_H, TILE_W, Tile, woodTexture } from './tiles3d';
import { onSkinChange, skinById, skinTexture, type SkinId } from './skins';

export const BOARD_W = COLS * CELL_W;
export const BOARD_D = ROWS * ROW_D;

export type Mode = 'tile' | 'set' | 'split' | 'pick';
type Region = 'board' | 'rack';

export interface SceneState {
  table: SetState[];
  rack: number[];
  placed: Set<number>;
  valid: Map<number, boolean>;
  canEditBoard: boolean;
  mode: Mode;
  poolCount: number;
  selected: Set<number>;
  /** a mesa mudou por jogada de outro jogador: as pedras entram uma a uma, devagar */
  slow?: boolean;
}

export interface SceneHandlers {
  onPick(id: number): void;
  onRackDrop(id: number, index: number): void;
  onBoardDrop(id: number, cx: number, cz: number): void;
  onSetMove(setId: number, dx: number, dz: number): void;
  onSplit(setId: number, index: number): void;
  onPoolTap(): void;
}

type Interaction =
  | null
  | { type: 'tile'; id: number; startX: number; startY: number; active: boolean }
  | { type: 'set'; setId: number; anchor: THREE.Vector3; startX: number; startY: number; active: boolean; dx: number; dz: number }
  | { type: 'hold'; id: number; startX: number; startY: number; timer: number }
  | { type: 'pan'; anchor: THREE.Vector3 }
  | { type: 'pool'; startX: number; startY: number }
  | { type: 'split'; setId: number; index: number; startX: number; startY: number }
  | { type: 'pinch'; startDist: number; startCam: number };

const ELEV = THREE.MathUtils.degToRad(64);
const FOV = 38;
const DRAG_THRESHOLD = 7;
const HOLD_MS = 330;
const HOLD_SLOP = 12;
const DOUBLE_TAP_MS = 380;

export class TableScene {
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private boardScene = new THREE.Scene();
  private rackScene = new THREE.Scene();
  private boardCam = new THREE.PerspectiveCamera(FOV, 1, 0.5, 220);
  private rackCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
  private tiles: Tile[] = [];
  private tileScene: (Region | null)[] = new Array(TILE_COUNT).fill(null);
  private state: SceneState = { table: [], rack: [], placed: new Set(), valid: new Map(), canEditBoard: false, mode: 'tile', poolCount: 0, selected: new Set() };
  private cam = { tx: 0, tz: 0, dist: 28 };
  private W = 1;
  private H = 1;
  private rackH = 120;
  private cols = 9;
  private rows = 2;
  private raycaster = new THREE.Raycaster();
  private pointers = new Map<number, { x: number; y: number }>();
  private it: Interaction = null;
  private lastP = { x: 0, y: 0 };
  private lastTap: { setId: number; t: number } | null = null;
  private aniso = 4;
  private sizeF = 1;
  private slowNext = false;
  private felt!: THREE.Mesh;
  private offSkin: () => void = () => {};
  /** conjuntos onde a pedra arrastada encaixa (brilham em verde) */
  private hintSets = new Set<number>();
  private hintFor = -1;
  private rafId = 0;
  private lastT = 0;
  private dirty = true;
  private idleFrames = 0;
  private poolGroup = new THREE.Group();
  private rackTray!: THREE.Mesh;
  private hintBoardCell!: THREE.Mesh;
  /** vaga guia: onde o próximo conjunto novo deve ir para a mesa ficar compacta */
  private hintGuide!: THREE.Group;
  private hintBoardBar!: THREE.Mesh;
  private hintRackBar!: THREE.Mesh;
  private ro: ResizeObserver;
  private disposed = false;
  private fitted = false;
  /** enquadra a mesa sozinha (o mínimo de zoom manual); some quando o jogador mexe na câmera */
  private autoFit = true;
  private camGoal: { tx: number; tz: number; dist: number } | null = null;
  private boundsKey = '';

  constructor(
    private container: HTMLElement,
    private handlers: SceneHandlers,
  ) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setScissorTest(true);
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'scene-canvas';
    container.prepend(this.canvas);

    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.aniso = aniso;
    for (let i = 0; i < TILE_COUNT; i++) this.tiles.push(new Tile(i, aniso));

    this.buildBoard(coarse ? 1024 : 2048);
    this.buildRack();
    this.buildPool();
    this.buildHints();

    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    document.addEventListener('visibilitychange', this.onVis);
    this.resize();
    this.applyCam();
    this.lastT = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ---------- construção ----------
  private buildBoard(shadowSize: number): void {
    const s = this.boardScene;
    s.background = new THREE.Color(skinById('verde').bg);
    const feltW = BOARD_W + 9;
    const feltD = BOARD_D + 8;
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(feltW, feltD), new THREE.MeshStandardMaterial({ map: skinTexture('verde', 4), roughness: 1, metalness: 0 }));
    this.felt = felt;
    this.offSkin = onSkinChange(() => (this.dirty = true));
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    s.add(felt);

    // moldura de madeira
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0.05 });
    const fw = 2.2;
    const frame = (w: number, d: number, x: number, z: number): void => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, 1.1, d, 3, 0.25), wood);
      m.position.set(x, 0.1, z);
      m.castShadow = true;
      m.receiveShadow = true;
      s.add(m);
    };
    frame(feltW + fw * 2, fw, 0, -(feltD / 2 + fw / 2) + 0.3);
    frame(feltW + fw * 2, fw, 0, feltD / 2 + fw / 2 - 0.3);
    frame(fw, feltD + 0.6, -(feltW / 2 + fw / 2) + 0.3, 0);
    frame(fw, feltD + 0.6, feltW / 2 + fw / 2 - 0.3, 0);

    // área de jogo (borda tênue)
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 256;
    const c = cv.getContext('2d')!;
    c.strokeStyle = 'rgba(255,255,255,0.22)';
    c.lineWidth = 3;
    c.setLineDash([14, 10]);
    c.strokeRect(4, 4, 504, 248);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    const area = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W + 0.4, BOARD_D + 0.4), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
    area.rotation.x = -Math.PI / 2;
    area.position.y = 0.01;
    s.add(area);

    s.add(new THREE.HemisphereLight(0xfff1dc, 0x16261d, 0.9));
    const sun = new THREE.DirectionalLight(0xfff0d6, 1.5);
    sun.position.set(-14, 28, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const sc = sun.shadow.camera;
    sc.left = -BOARD_W / 2 - 4;
    sc.right = BOARD_W / 2 + 4;
    sc.top = BOARD_D / 2 + 6;
    sc.bottom = -BOARD_D / 2 - 6;
    sc.near = 5;
    sc.far = 80;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    s.add(sun);
    const lamp = new THREE.PointLight(0xffd7a0, 70, 70, 1.6);
    lamp.position.set(0, 18, 2);
    s.add(lamp);

    for (const t3 of this.tiles) s.add(t3.group);
  }

  private buildRack(): void {
    const s = this.rackScene;
    s.background = new THREE.Color(0x120d09);
    this.rackTray = new THREE.Mesh(
      new RoundedBoxGeometry(1, 0.5, 1, 3, 0.18),
      new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.5, metalness: 0.05 }),
    );
    this.rackTray.position.y = -0.27;
    this.rackTray.receiveShadow = true;
    s.add(this.rackTray);
    s.add(new THREE.HemisphereLight(0xfff1dc, 0x2a1a10, 1.0));
    const d = new THREE.DirectionalLight(0xfff0d6, 1.7);
    d.position.set(-6, 14, 8);
    d.castShadow = true;
    d.shadow.mapSize.set(1024, 1024);
    d.shadow.camera.left = -12;
    d.shadow.camera.right = 12;
    d.shadow.camera.top = 8;
    d.shadow.camera.bottom = -8;
    d.shadow.camera.near = 2;
    d.shadow.camera.far = 40;
    d.shadow.bias = -0.0006;
    s.add(d);
    this.rackCam.position.set(0, 20, 0);
    this.rackCam.up.set(0, 0, -1);
    this.rackCam.lookAt(0, 0, 0);
  }

  private buildPool(): void {
    const geo = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_D, 3, 0.11);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xe3d6b6, roughness: 0.5, clearcoat: 0.4 });
    const spots: [number, number, number][] = [
      [-1.2, -0.6, 0.2],
      [0.3, 0.5, -0.3],
      [1.4, -0.4, 0.5],
      [-0.2, -1.5, 0.1],
    ];
    for (const [px, pz, rot] of spots) {
      for (let k = 0; k < 5; k++) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(px + (Math.random() - 0.5) * 0.12, TILE_H * (k + 0.5), pz + (Math.random() - 0.5) * 0.12);
        m.rotation.y = rot + (Math.random() - 0.5) * 0.25;
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData.pool = true;
        this.poolGroup.add(m);
      }
    }
    this.poolGroup.position.set(BOARD_W / 2 - 3.2, 0, -BOARD_D / 2 - 2.3);
    this.boardScene.add(this.poolGroup);
  }

  private buildHints(): void {
    const glow = (color: number, o: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false });
    this.hintBoardCell = new THREE.Mesh(new THREE.PlaneGeometry(TILE_W, TILE_D), glow(0xffe28a, 0.35));
    this.hintBoardCell.rotation.x = -Math.PI / 2;
    this.hintBoardCell.position.y = 0.03;
    // vaga guia: 3 casas (o menor conjunto), com contorno, no lugar sugerido para uma nova linha
    this.hintGuide = new THREE.Group();
    const gw = CELL_W * 3 - 0.1;
    const gd = TILE_D + 0.34;
    const gfill = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), glow(0x7fe6ff, 0.3));
    gfill.rotation.x = -Math.PI / 2;
    const gedge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(gw, gd)), new THREE.LineBasicMaterial({ color: 0xc8f7ff }));
    gedge.rotation.x = -Math.PI / 2;
    gedge.position.y = 0.01;
    this.hintGuide.add(gfill, gedge);
    this.hintGuide.position.y = 0.035;
    this.hintBoardBar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, TILE_D + 0.2), glow(0xffe28a, 0.9));
    this.hintRackBar = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, TILE_D + 0.2), glow(0xffe28a, 0.9));
    for (const h of [this.hintBoardCell, this.hintGuide, this.hintBoardBar, this.hintRackBar]) h.visible = false;
    this.boardScene.add(this.hintBoardCell, this.hintGuide, this.hintBoardBar);
    this.rackScene.add(this.hintRackBar);
  }

  // ---------- coordenadas ----------
  private boardPos(sx: number, i: number, sz: number, y = 0): THREE.Vector3 {
    return new THREE.Vector3((sx + i + 0.5) * CELL_W - BOARD_W / 2, y, (sz + 0.5) * ROW_D - BOARD_D / 2);
  }

  private rackPos(i: number): THREE.Vector3 {
    const col = i % this.cols;
    const row = Math.floor(i / this.cols);
    return new THREE.Vector3((col - (this.cols - 1) / 2) * CELL_W, 0, (row - (this.rows - 1) / 2) * CELL_D);
  }

  private rackIndexAt(x: number, z: number, count: number): number {
    const col = Math.max(0, Math.min(this.cols - 1, Math.round(x / CELL_W + (this.cols - 1) / 2)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.round(z / CELL_D + (this.rows - 1) / 2)));
    return Math.min(row * this.cols + col, count);
  }

  private regionAt(y: number): Region {
    return y >= this.H - this.rackH ? 'rack' : 'board';
  }

  private ndc(region: Region, x: number, y: number): THREE.Vector2 {
    if (region === 'rack') return new THREE.Vector2((x / this.W) * 2 - 1, -(((y - (this.H - this.rackH)) / this.rackH) * 2 - 1));
    return new THREE.Vector2((x / this.W) * 2 - 1, -((y / (this.H - this.rackH)) * 2 - 1));
  }

  private ground(region: Region, x: number, y: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(region, x, y), region === 'rack' ? this.rackCam : this.boardCam);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }

  /**
   * Pedra sob o dedo/mouse. Em vez de exigir acertar o corpo 3D da pedra, escolhe a pedra cujo centro (face de cima)
   * está mais perto do ponto tocado, medindo em "tamanhos de pedra" na tela, e aceita um pequeno erro:
   * vale entre pedras coladas, nas bordas e com o dedo grosso.
   */
  private pickTile(region: Region, x: number, y: number, touch = false): number | null {
    const cam = region === 'rack' ? this.rackCam : this.boardCam;
    cam.updateMatrixWorld();
    const top = this.rackH > 0 ? (region === 'rack' ? this.H - this.rackH : 0) : 0;
    const hgt = region === 'rack' ? this.rackH : this.H - this.rackH;
    const toPx = (v: THREE.Vector3): { sx: number; sy: number } => ({ sx: ((v.x + 1) / 2) * this.W, sy: top + ((1 - v.y) / 2) * hgt });
    const c = new THREE.Vector3();
    const e = new THREE.Vector3();
    let best: number | null = null;
    let bestM = Infinity;
    for (const t of this.tiles) {
      if (!t.present || this.tileScene[t.id] !== region || t.dragging) continue;
      c.copy(t.group.position);
      c.y += TILE_H;
      const g = t.group.scale.x || 1;
      const pc = toPx(c.clone().project(cam));
      e.set(c.x + (TILE_W / 2) * g, c.y, c.z);
      const px = toPx(e.clone().project(cam));
      e.set(c.x, c.y, c.z + (TILE_D / 2) * g);
      const pz = toPx(e.clone().project(cam));
      const hx = Math.max(6, Math.hypot(px.sx - pc.sx, px.sy - pc.sy));
      const hy = Math.max(6, Math.hypot(pz.sx - pc.sx, pz.sy - pc.sy));
      // projeta o deslocamento nos eixos da pedra: m = quão fora do centro (1 = borda da pedra)
      const dx = x - pc.sx;
      const dy = y - pc.sy;
      const ux = { x: (px.sx - pc.sx) / hx, y: (px.sy - pc.sy) / hx };
      const uz = { x: (pz.sx - pc.sx) / hy, y: (pz.sy - pc.sy) / hy };
      const m = Math.max(Math.abs(dx * ux.x + dy * ux.y) / hx, Math.abs(dx * uz.x + dy * uz.y) / hy);
      if (m < bestM) {
        bestM = m;
        best = t.id;
      }
    }
    // dentro da pedra (m ≤ 1) ou perto dela: mais folga no toque do que no mouse
    return best !== null && bestM <= (touch ? 1.45 : 1.2) ? best : null;
  }

  private pickPool(x: number, y: number): boolean {
    if (this.state.poolCount <= 0) return false;
    this.raycaster.setFromCamera(this.ndc('board', x, y), this.boardCam);
    return this.raycaster.intersectObjects(this.poolGroup.children, false).length > 0;
  }

  // ---------- estado ----------
  setState(s: SceneState): void {
    this.state = s;
    this.poolGroup.visible = s.poolCount > 0;
    this.layoutRack(s.rack.length);
    this.slowNext = !!s.slow;
    this.syncTiles();
    this.slowNext = false;
    if (!this.fitted && s.table.length > 0) this.fitNow();
    else if (s.table.length > 0 && !this.it) this.followTable();
    this.dirty = true;
  }

  private layoutRack(n: number): void {
    const W = this.W;
    const H = this.H;
    const minCols = this.sizeF > 1 ? 5 : 7;
    let cols = Math.max(minCols, Math.min(16, Math.floor(W / (CELL_W * 40 * this.sizeF))));
    const need = (c: number): { rows: number; h: number } => {
      const rows = Math.max(1, Math.ceil(Math.max(n, 1) / c));
      const u = W / (c * CELL_W + 0.9);
      return { rows, h: rows * CELL_D * u + 0.9 * u };
    };
    while (cols < 16 && need(cols).h > H * (this.sizeF > 1 ? 0.5 : 0.4)) cols++;
    const { rows, h } = need(cols);
    this.cols = cols;
    this.rows = rows;
    const nextH = Math.max(H * 0.17, Math.min(H * (this.sizeF > 1 ? 0.52 : 0.42), h));
    if (Math.abs(nextH - this.rackH) > 0.5) {
      this.rackH = nextH;
      this.updateCams();
    }
    const cw = cols * CELL_W + 0.9;
    const ch = rows * CELL_D + 0.9;
    this.rackTray.scale.set(cw, 1, ch);
    const aspect = W / this.rackH;
    const halfH = Math.max(ch / 2, cw / 2 / aspect);
    const halfW = halfH * aspect;
    this.rackCam.left = -halfW;
    this.rackCam.right = halfW;
    this.rackCam.top = halfH;
    this.rackCam.bottom = -halfH;
    this.rackCam.updateProjectionMatrix();
  }

  private syncTiles(): void {
    const s = this.state;
    const where = new Map<number, { set: SetState; index: number }>();
    for (const set of s.table) set.tiles.forEach((id, index) => where.set(id, { set, index }));
    const rackIdx = new Map<number, number>();
    s.rack.forEach((id, i) => rackIdx.set(id, i));
    // jogada de outro jogador: as pedras novas entram uma por uma (devagar), vindas de cima
    const slow = this.slowNext;
    const order = new Map<number, number>();
    if (slow) for (const set of s.table) for (const id of set.tiles) if (!this.tiles[id]!.present) order.set(id, order.size);
    const gap = Math.min(0.7, 6 / Math.max(1, order.size));
    const dragId = this.it && this.it.type === 'tile' && this.it.active ? this.it.id : -1;
    const setDrag = this.it && this.it.type === 'set' && this.it.active ? this.it : null;

    const oldTarget = new THREE.Vector3();
    for (const t of this.tiles) {
      let region: Region | null = null;
      const ri = rackIdx.get(t.id);
      const w = where.get(t.id);
      if (ri !== undefined) {
        region = 'rack';
        t.target.copy(this.rackPos(ri));
        t.targetRotY = 0;
      } else if (w) {
        region = 'board';
        if (slow && t.present) oldTarget.copy(t.target);
        const lift = setDrag && setDrag.setId === w.set.id ? 0.5 : 0;
        const p = this.boardPos(w.set.x + (setDrag && setDrag.setId === w.set.id ? setDrag.dx : 0), w.index, w.set.z + (setDrag && setDrag.setId === w.set.id ? setDrag.dz : 0), lift);
        t.target.copy(p);
        t.targetRotY = 0;
      }
      if (t.id === dragId) continue;
      if (!region) {
        t.present = false;
        t.group.visible = false;
        this.tileScene[t.id] = null;
        continue;
      }
      const prev = this.tileScene[t.id];
      if (!t.present || prev !== region) {
        (region === 'board' ? this.boardScene : this.rackScene).add(t.group);
        t.group.visible = true;
        t.group.position.copy(t.target);
        if (!t.present && region === 'board') t.group.position.y += 5;
        if (slow && !t.present && region === 'board') {
          t.group.visible = false;
          t.delay = (order.get(t.id) ?? 0) * gap + 0.3;
          t.speed = 4;
          t.group.position.set(t.target.x, 6, -BOARD_D / 2 - 7);
        }
        if (region === 'rack') t.group.scale.setScalar(0.35);
        else t.group.scale.setScalar(1);
        t.present = true;
        this.tileScene[t.id] = region;
      }
      t.dragging = false;
      // pedras que já estavam na mesa e mudaram de lugar (rearranjo, empurrão) deslizam devagar
      if (slow && region === 'board' && prev === 'board' && oldTarget.distanceToSquared(t.target) > 0.01) t.speed = 3.2;
      // cores de estado do conjunto
      let tint = 0;
      let k = 0;
      if (region === 'board' && w) {
        const valid = s.valid.get(w.set.id);
        const mine = s.placed.has(t.id);
        if (valid === false && w.set.tiles.length >= 3) {
          tint = 0xff3b2a;
          k = 0.32;
        } else if (valid === false && w.set.tiles.some((x) => s.placed.has(x))) {
          tint = 0xffb02a;
          k = 0.26;
        } else if (mine) {
          tint = 0x3ad0ff;
          k = 0.2;
        }
      }
      if (region === 'board' && w && this.hintSets.has(w.set.id)) {
        tint = 0x3dff7a;
        k = 0.42;
      }
      if (region === 'rack' && s.selected.has(t.id)) {
        tint = 0xffd23a;
        k = 0.55;
      }
      t.setTint(tint, k);
    }
  }

  /** Tamanho da interface (0 normal, 1 grande, 2 extra): pedras do cavalete maiores. */
  setSize(size: number): void {
    this.sizeF = [1, 1.25, 1.5][size] ?? 1;
    this.layoutRack(this.state.rack.length);
    this.syncTiles();
    this.dirty = true;
  }

  /** Troca o pano da mesa (verde padrão ou homenagens sóbrias). */
  setSkin(id: SkinId): void {
    const skin = skinById(id);
    const mat = this.felt.material as THREE.MeshStandardMaterial;
    mat.map = skinTexture(id, this.aniso);
    mat.needsUpdate = true;
    this.boardScene.background = new THREE.Color(skin.bg);
    this.dirty = true;
  }

  /** Alto contraste: troca as faces de todas as pedras. */
  setContrast(on: boolean): void {
    setHighContrast(on);
    for (const t of this.tiles) t.refreshFace(this.aniso);
    this.dirty = true;
  }

  zoomBy(factor: number): void {
    this.manualCam();
    this.cam.dist *= factor;
    this.clampCam();
    this.applyCam();
  }

  /** Aproxima a câmera para o conjunto ocupar boa parte da tela. */
  zoomToSet(setId: number): void {
    this.manualCam();
    const set = this.state.table.find((x) => x.id === setId);
    if (!set) return;
    const a = this.boardPos(set.x, 0, set.z);
    const b = this.boardPos(set.x, set.tiles.length - 1, set.z);
    const aspect = this.W / Math.max(1, this.H - this.rackH);
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const w = Math.max(b.x - a.x + 2.4, 6);
    this.cam.tx = (a.x + b.x) / 2;
    this.cam.tz = a.z;
    this.cam.dist = w / 2 / (t * aspect);
    this.clampCam();
    this.applyCam();
  }

  /** Quadro (centro e distância) que mostra a mesa toda com as pedras o maior possível. */
  private computeFit(): { tx: number; tz: number; dist: number; key: string } {
    const sets = this.state.table;
    let minX = -5.5;
    let maxX = 5.5;
    let minZ = -2.5;
    let maxZ = 2.5;
    if (sets.length > 0) {
      minX = Infinity;
      maxX = -Infinity;
      minZ = Infinity;
      maxZ = -Infinity;
      for (const s of sets) {
        const a = this.boardPos(s.x, 0, s.z);
        const b = this.boardPos(s.x, s.tiles.length - 1, s.z);
        minX = Math.min(minX, a.x - 1);
        maxX = Math.max(maxX, b.x + 1);
        minZ = Math.min(minZ, a.z - 1.2);
        maxZ = Math.max(maxZ, a.z + 1.2);
      }
      this.fitted = true;
    }
    const w = Math.max(maxX - minX, 11) + 3;
    const h = Math.max(maxZ - minZ, 5) + 1.5;
    const aspect = this.W / Math.max(1, this.H - this.rackH);
    const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const goal = {
      tx: Math.max(-BOARD_W / 2, Math.min(BOARD_W / 2, (minX + maxX) / 2)),
      tz: Math.max(-BOARD_D / 2 - 3, Math.min(BOARD_D / 2, (minZ + maxZ) / 2)),
      dist: Math.max(8, Math.min(75, Math.max(w / 2 / (t * aspect), h / 2 / (t * Math.sin(ELEV))))),
    };
    return { ...goal, key: [minX, maxX, minZ, maxZ].map((v) => Math.round(v * 2)).join(',') };
  }

  /** ⌖: enquadra a mesa toda (suave) e volta ao enquadramento automático. */
  fit(): void {
    this.autoFit = true;
    const g = this.computeFit();
    this.boundsKey = g.key;
    this.camGoal = { tx: g.tx, tz: g.tz, dist: g.dist };
    this.dirty = true;
  }

  private fitNow(): void {
    const g = this.computeFit();
    this.boundsKey = g.key;
    this.cam.tx = g.tx;
    this.cam.tz = g.tz;
    this.cam.dist = g.dist;
    this.applyCam();
  }

  /** O que está na mesa mudou (jogada de alguém, bots): mantém tudo à vista sem o jogador precisar dar zoom. */
  private followTable(): void {
    const g = this.computeFit();
    if (g.key === this.boundsKey) return;
    this.boundsKey = g.key;
    // na minha vez a câmera não mexe enquanto monto (senão o enquadramento muda debaixo do dedo): só se algo sair da tela
    if (this.state.canEditBoard) {
      if (this.allVisible()) return;
    } else if (!this.autoFit && this.allVisible()) {
      // se o jogador mexeu na câmera, só reenquadra quando algo passa a ficar fora da tela
      return;
    }
    this.autoFit = true;
    this.camGoal = { tx: g.tx, tz: g.tz, dist: g.dist };
  }

  private allVisible(): boolean {
    this.boardCam.updateMatrixWorld();
    const v = new THREE.Vector3();
    for (const s of this.state.table) {
      for (const idx of [0, s.tiles.length - 1]) {
        const p = this.boardPos(s.x, idx, s.z);
        v.set(p.x, TILE_H, p.z).project(this.boardCam);
        if (Math.abs(v.x) > 0.94 || v.y > 0.94 || v.y < -0.94) return false;
      }
    }
    return true;
  }

  /** A câmera foi mexida à mão: para de enquadrar sozinha. */
  private manualCam(): void {
    this.autoFit = false;
    this.camGoal = null;
  }

  private clampCam(): void {
    this.cam.tx = Math.max(-BOARD_W / 2, Math.min(BOARD_W / 2, this.cam.tx));
    this.cam.tz = Math.max(-BOARD_D / 2 - 3, Math.min(BOARD_D / 2, this.cam.tz));
    this.cam.dist = Math.max(8, Math.min(75, this.cam.dist));
  }

  private applyCam(): void {
    const { tx, tz, dist } = this.cam;
    this.boardCam.position.set(tx, Math.sin(ELEV) * dist, tz + Math.cos(ELEV) * dist);
    this.boardCam.lookAt(tx, 0, tz);
    this.boardCam.updateMatrixWorld();
    this.dirty = true;
  }

  private updateCams(): void {
    this.boardCam.aspect = this.W / Math.max(1, this.H - this.rackH);
    this.boardCam.updateProjectionMatrix();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w < 2 || h < 2) return;
    this.W = w;
    this.H = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.layoutRack(this.state.rack.length);
    this.updateCams();
    this.syncTiles();
    this.dirty = true;
  }

  /** Altura (px) ocupada pelo cavalete, para a interface posicionar a barra de ações acima dele. */
  get rackHeight(): number {
    return this.rackH;
  }

  // ---------- interação ----------
  private rel(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.rel(e);
    this.lastP = p;
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      this.cancelActive();
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.it = { type: 'pinch', startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startCam: this.cam.dist };
      return;
    }
    if (this.pointers.size > 1) return;
    const region = this.regionAt(p.y);
    const id = this.pickTile(region, p.x, p.y, e.pointerType !== 'mouse');
    if (id !== null) {
      if (region === 'rack') {
        this.it = { type: 'tile', id, startX: p.x, startY: p.y, active: false };
        return;
      }
      if (!this.state.canEditBoard) {
        this.startPan(p);
        return;
      }
      const loc = this.locate(id);
      if (this.state.mode === 'set' && loc) {
        const g = this.ground('board', p.x, p.y);
        this.it = { type: 'set', setId: loc.set.id, anchor: g ?? new THREE.Vector3(), startX: p.x, startY: p.y, active: false, dx: 0, dz: 0 };
      } else if (this.state.mode === 'split' && loc) {
        this.it = { type: 'split', setId: loc.set.id, index: loc.index, startX: p.x, startY: p.y };
      } else if (e.pointerType !== 'mouse') {
        // no toque, a pedra da mesa só levanta se o dedo ficar parado: arrastar rápido rola a mesa
        const timer = window.setTimeout(() => this.liftHeld(), HOLD_MS);
        this.it = { type: 'hold', id, startX: p.x, startY: p.y, timer };
      } else {
        this.it = { type: 'tile', id, startX: p.x, startY: p.y, active: false };
      }
      return;
    }
    if (region === 'board' && this.pickPool(p.x, p.y)) {
      this.it = { type: 'pool', startX: p.x, startY: p.y };
      return;
    }
    if (region === 'board') this.startPan(p);
  };

  private locate(id: number): { set: SetState; index: number } | null {
    for (const set of this.state.table) {
      const index = set.tiles.indexOf(id);
      if (index >= 0) return { set, index };
    }
    return null;
  }

  private startPan(p: { x: number; y: number }): void {
    const g = this.ground('board', p.x, p.y);
    if (g) this.it = { type: 'pan', anchor: g };
  }

  /** O dedo ficou parado sobre a pedra: ela levanta (vibra de leve) e passa a seguir o dedo. */
  private liftHeld(): void {
    const it = this.it;
    if (!it || it.type !== 'hold') return;
    navigator.vibrate?.(18);
    this.it = { type: 'tile', id: it.id, startX: it.startX, startY: it.startY, active: true };
    this.tiles[it.id]!.dragging = true;
    this.dragTile(it.id, this.lastP);
    this.dirty = true;
  }

  private cancelActive(): void {
    if (this.it && this.it.type === 'hold') window.clearTimeout(this.it.timer);
    if (this.it && this.it.type === 'tile' && this.it.active) this.tiles[this.it.id]!.dragging = false;
    this.it = null;
    this.hideHints();
    this.clearHintSets();
    this.syncTiles();
  }

  private onMove = (e: PointerEvent): void => {
    const p = this.rel(e);
    this.lastP = p;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    const it = this.it;
    if (!it) return;
    if (it.type === 'hold') {
      if (Math.hypot(p.x - it.startX, p.y - it.startY) > HOLD_SLOP) {
        window.clearTimeout(it.timer);
        this.it = null;
        this.startPan(p);
      }
      return;
    }
    if (it.type === 'pinch') {
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        this.manualCam();
        this.cam.dist = it.startCam * (it.startDist / d);
        this.clampCam();
        this.applyCam();
      }
      return;
    }
    if (it.type === 'pan') {
      const g = this.ground('board', p.x, p.y);
      if (g) {
        this.manualCam();
        this.cam.tx += it.anchor.x - g.x;
        this.cam.tz += it.anchor.z - g.z;
        this.clampCam();
        this.applyCam();
      }
      return;
    }
    if (it.type === 'pool' || it.type === 'split') {
      if (Math.hypot(p.x - it.startX, p.y - it.startY) > DRAG_THRESHOLD * 2) this.startPan(p);
      return;
    }
    if (it.type === 'set') {
      if (!it.active && Math.hypot(p.x - it.startX, p.y - it.startY) > DRAG_THRESHOLD) it.active = true;
      if (!it.active) return;
      const g = this.ground('board', p.x, p.y);
      if (!g) return;
      it.dx = Math.round((g.x - it.anchor.x) / CELL_W);
      it.dz = Math.round((g.z - it.anchor.z) / ROW_D);
      this.syncTiles();
      this.dirty = true;
      return;
    }
    if (it.type === 'tile') {
      if (!it.active) {
        if (this.state.mode === 'pick' && this.tileScene[it.id] === 'rack') return;
        if (Math.hypot(p.x - it.startX, p.y - it.startY) <= DRAG_THRESHOLD) return;
        it.active = true;
        this.tiles[it.id]!.dragging = true;
      }
      this.dragTile(it.id, p);
    }
  };

  private dragTile(id: number, p: { x: number; y: number }): void {
    const t = this.tiles[id]!;
    const region = this.regionAt(p.y);
    const g = this.ground(region, p.x, p.y);
    if (!g) return;
    const scene = region === 'rack' ? this.rackScene : this.boardScene;
    if (t.group.parent !== scene) {
      scene.add(t.group);
      t.group.scale.setScalar(1);
    }
    t.group.visible = true;
    t.target.set(g.x, 0.9, g.z);
    t.group.position.copy(t.target);
    t.group.rotation.y = 0;
    this.hideHints();
    if (region === 'rack') {
      this.clearHintSets();
      const n = this.state.rack.length - (this.state.rack.includes(id) ? 1 : 0);
      const idx = this.rackIndexAt(g.x, g.z, n);
      const pos = this.rackPos(idx);
      this.hintRackBar.position.set(pos.x - CELL_W / 2, 0.25, pos.z);
      this.hintRackBar.visible = true;
    } else if (this.state.canEditBoard) {
      const cx = g.x / CELL_W + COLS / 2;
      const cz = g.z / ROW_D + ROWS / 2;
      if (this.hintFor !== id) {
        this.hintFor = id;
        this.hintSets = new Set(acceptingSets(this.state.table, id).map((a) => a.setId));
        this.syncTiles();
      }
      const act = resolveBoardDrop(tableWithoutTile(this.state.table, id), cx, cz);
      if (act.kind === 'insert') {
        const set = tableWithoutTile(this.state.table, id).find((s) => s.id === act.setId)!;
        const edge = this.boardPos(set.x, act.index, set.z);
        this.hintBoardBar.position.set(edge.x - CELL_W / 2, 0.25, edge.z);
        this.hintBoardBar.visible = true;
      } else {
        // pedra solta: mostra onde ela cai e, em azul, o lugar guia (próxima vaga compacta) para a mesa ficar arrumada
        const sp = newSetSpot(this.state.table, id, cx, cz);
        const c = this.boardPos(sp.x, 0, sp.z);
        this.hintBoardCell.position.set(c.x, 0.03, c.z);
        this.hintBoardCell.visible = true;
        if (sp.guide) {
          const g = this.boardPos(sp.guide.x, 1, sp.guide.z); // centro das 3 casas
          this.hintGuide.position.set(g.x, 0.035, g.z);
          this.hintGuide.visible = true;
        }
      }
    }
    this.dirty = true;
  }

  private clearHintSets(): void {
    if (this.hintSets.size === 0 && this.hintFor < 0) return;
    this.hintSets = new Set();
    this.hintFor = -1;
    this.syncTiles();
  }

  private hideHints(): void {
    this.hintBoardBar.visible = false;
    this.hintBoardCell.visible = false;
    this.hintGuide.visible = false;
    this.hintRackBar.visible = false;
  }

  private onUp = (e: PointerEvent): void => {
    const p = this.rel(e);
    this.pointers.delete(e.pointerId);
    const it = this.it;
    if (it?.type === 'pinch') {
      if (this.pointers.size < 2) this.it = null;
      return;
    }
    this.it = null;
    this.hideHints();
    this.clearHintSets();
    if (!it) return;
    if (it.type === 'hold') {
      window.clearTimeout(it.timer);
      const loc = this.locate(it.id);
      if (loc) {
        const now = performance.now();
        if (this.lastTap && this.lastTap.setId === loc.set.id && now - this.lastTap.t < DOUBLE_TAP_MS) {
          this.zoomToSet(loc.set.id);
          this.lastTap = null;
        } else this.lastTap = { setId: loc.set.id, t: now };
      }
      return;
    }
    if (it.type === 'pool') {
      if (Math.hypot(p.x - it.startX, p.y - it.startY) <= DRAG_THRESHOLD * 2) this.handlers.onPoolTap();
    } else if (it.type === 'split') {
      if (Math.hypot(p.x - it.startX, p.y - it.startY) <= DRAG_THRESHOLD * 2) this.handlers.onSplit(it.setId, it.index);
    } else if (it.type === 'set') {
      if (it.active && (it.dx !== 0 || it.dz !== 0)) this.handlers.onSetMove(it.setId, it.dx, it.dz);
      this.syncTiles();
    } else if (it.type === 'tile' && !it.active && this.state.mode === 'pick' && this.tileScene[it.id] === 'rack') {
      if (Math.hypot(p.x - it.startX, p.y - it.startY) <= DRAG_THRESHOLD * 2) this.handlers.onPick(it.id);
    } else if (it.type === 'tile' && it.active) {
      const t = this.tiles[it.id]!;
      t.dragging = false;
      const region = this.regionAt(p.y);
      const g = this.ground(region, p.x, p.y);
      if (g) {
        if (region === 'rack') {
          const n = this.state.rack.length - (this.state.rack.includes(it.id) ? 1 : 0);
          this.handlers.onRackDrop(it.id, this.rackIndexAt(g.x, g.z, n));
        } else if (this.state.canEditBoard) {
          this.handlers.onBoardDrop(it.id, g.x / CELL_W + COLS / 2, g.z / ROW_D + ROWS / 2);
        }
      }
      this.tileScene[it.id] = null; // força reposicionamento limpo
      this.syncTiles();
    }
    this.dirty = true;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.rel(e);
    if (this.regionAt(p.y) !== 'board') return;
    this.manualCam();
    this.cam.dist *= Math.exp(e.deltaY * 0.0012);
    this.clampCam();
    this.applyCam();
  };

  // ---------- loop ----------
  private onVis = (): void => {
    this.lastT = performance.now();
    this.dirty = true;
  };

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    let moving = false;
    if (this.camGoal) {
      const k = 1 - Math.exp(-dt * 9);
      const g = this.camGoal;
      this.cam.tx += (g.tx - this.cam.tx) * k;
      this.cam.tz += (g.tz - this.cam.tz) * k;
      this.cam.dist += (g.dist - this.cam.dist) * k;
      if (Math.abs(g.tx - this.cam.tx) < 0.02 && Math.abs(g.tz - this.cam.tz) < 0.02 && Math.abs(g.dist - this.cam.dist) < 0.05) {
        this.cam.tx = g.tx;
        this.cam.tz = g.tz;
        this.cam.dist = g.dist;
        this.camGoal = null;
      }
      this.applyCam();
      moving = true;
    }
    for (const t of this.tiles) if (t.present && t.step(dt)) moving = true;
    if (moving || this.dirty) {
      this.idleFrames = 0;
      this.dirty = false;
    } else if (++this.idleFrames > 2) {
      return;
    }
    this.draw();
  };

  private draw(): void {
    const r = this.renderer;
    const bh = this.H - this.rackH;
    r.setViewport(0, this.rackH, this.W, bh);
    r.setScissor(0, this.rackH, this.W, bh);
    r.render(this.boardScene, this.boardCam);
    r.setViewport(0, 0, this.W, this.rackH);
    r.setScissor(0, 0, this.W, this.rackH);
    r.render(this.rackScene, this.rackCam);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.offSkin();
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    this.canvas.remove();
    this.renderer.dispose();
  }
}
