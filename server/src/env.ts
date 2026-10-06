export interface Env {
  ROOM: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
  RANKING: DurableObjectNamespace;
  ASSETS: Fetcher;
  TURN_KEY_ID?: string;
  TURN_API_TOKEN?: string;
  /** senha para zerar o ranking: npx wrangler secret put ADMIN_KEY -c server/wrangler.toml */
  ADMIN_KEY?: string;
}
