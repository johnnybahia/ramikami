import type { LobbyRoom, RankingRow, TurnSeconds } from '../shared/protocol';

/** Vazio = mesmo endereço do jogo (Worker serve tudo). Em dev aponta para o `wrangler dev`. */
const API: string = (import.meta.env.VITE_SERVER_URL as string | undefined) ?? '';

export const wsUrl = (code: string): string => {
  if (!API) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/${code}`;
  return `${API.replace(/^http/, 'ws')}/ws/${code}`;
};

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export const createRoom = (turnSeconds: TurnSeconds, isPublic: boolean): Promise<{ code: string }> =>
  j('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turnSeconds, isPublic }) });
export const listRooms = (): Promise<LobbyRoom[]> => j('/api/rooms');
export const getRanking = (): Promise<RankingRow[]> => j('/api/ranking');

export async function getIceServers(): Promise<RTCIceServer[]> {
  try {
    return (await j<{ iceServers: RTCIceServer[] }>('/api/ice')).iceServers;
  } catch {
    return [{ urls: ['stun:stun.l.google.com:19302'] }];
  }
}
