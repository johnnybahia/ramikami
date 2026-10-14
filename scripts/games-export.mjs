// Baixa o log de partidas do servidor para um arquivo NDJSON.
//   BASE=https://SEU-SITE ADMIN_KEY=<senha> node scripts/games-export.mjs partidas.ndjson
// Continua de onde parou se o arquivo já existir (guarda o último número em <arquivo>.next).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://localhost:8787';
const KEY = process.env.ADMIN_KEY ?? '';
const out = process.argv[2] ?? 'partidas.ndjson';
const nextFile = `${out}.next`;
let after = existsSync(nextFile) ? Number(readFileSync(nextFile, 'utf8')) || 0 : 0;
if (after === 0) writeFileSync(out, '');
let total = 0;
for (;;) {
  const r = await fetch(`${BASE}/api/games?after=${after}&limit=200`, { headers: { 'X-Admin-Key': KEY } });
  if (r.status === 401) {
    console.error('não autorizado: confira ADMIN_KEY');
    process.exit(1);
  }
  const text = await r.text();
  const next = Number(r.headers.get('x-next-after') ?? after);
  if (!text.trim() || next === after) break;
  appendFileSync(out, text);
  total += text.trim().split('\n').length;
  after = next;
  writeFileSync(nextFile, String(after));
}
console.log(`${total} partidas novas em ${out} (último número: ${after})`);
