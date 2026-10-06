export interface Env {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  RANKING: DurableObjectNamespace;
  ASSETS: Fetcher;
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
}
