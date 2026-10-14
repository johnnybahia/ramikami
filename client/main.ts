import './style.css';
import { LocalBackend } from './local';
import { OnlineBackend } from './net/online';
import { registerPwa } from './pwa';
import { applyA11yToPage, loadA11y, loadProfile, loadTitle, saveTitle, type OfflineSettings, type Profile } from './store';
import { getTitle } from './api';
import { setHighContrast } from './game/tiles3d';
import { GameScreen } from './ui/gameScreen';
import { toast } from './ui/dom';
import { showMenu, showProfile } from './ui/screens';

registerPwa();

const root = document.getElementById('app')!;
applyA11yToPage();
setHighContrast(loadA11y().contrast);
let profile: Profile | null = loadProfile();
let stopMenu: (() => void) | null = null;
let game: GameScreen | null = null;

/** Pergunta ao servidor se o jogador tem o título (melhor esforço; sem internet vale a cópia guardada). */
async function refreshTitle(): Promise<void> {
  if (!profile) return;
  try {
    const t = await getTitle(profile.id);
    const before = loadTitle();
    saveTitle({ title: t.title, wins: t.wins });
    if (before.title !== t.title) menu();
  } catch {
    /* offline */
  }
}

function menu(): void {
  stopMenu?.();
  game = null;
  root.hidden = false;
  if (!profile) {
    showProfile(root, null, (p) => {
      profile = p;
      menu();
    });
    return;
  }
  stopMenu = showMenu(root, {
    profile,
    onProfile: (p) => {
      profile = p;
      menu();
    },
    startOffline,
    startOnline,
  });
}

function enterGame(g: GameScreen): void {
  stopMenu?.();
  stopMenu = null;
  root.hidden = true;
  game = g;
}

function startOffline(cfg: OfflineSettings): void {
  if (!profile) return;
  const p = profile;
  enterGame(
    new GameScreen({
      backend: new LocalBackend(p, cfg),
      profile: p,
      onExit: () => {
        history.replaceState(null, '', location.pathname);
        menu();
      },
      onRematch: () => startOffline(cfg),
    }),
  );
}

function startOnline(code: string): void {
  if (!profile) return;
  if (!navigator.onLine) return void toast('Sem internet: use o modo offline.');
  const p = profile;
  history.replaceState(null, '', `${location.pathname}?sala=${code}`);
  enterGame(
    new GameScreen({
      backend: new OnlineBackend(code, p),
      profile: p,
      onExit: () => {
        history.replaceState(null, '', location.pathname);
        menu();
      },
    }),
  );
}

menu();
void refreshTitle();

// link de convite: ?sala=ABCDE
const invite = new URLSearchParams(location.search).get('sala')?.toUpperCase();
if (invite && /^[A-Z0-9]{5}$/.test(invite) && profile) startOnline(invite);
void game;
