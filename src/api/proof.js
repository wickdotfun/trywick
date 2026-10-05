// GET /api/proof : ce que chacun peut vérifier (lib/proof.js).
// GET /api/proof/burns.csv : tous les burns, avec leurs transactions.
import { json } from '../../lib/http.js';
import { burnsCsv, proofPage } from '../../lib/proof.js';
import { ensureSchema } from '../../lib/schema.js';

export async function proof({ env }) {
  await ensureSchema(env.DB);
  return json(await proofPage(env));
}

export async function proofCsv({ env }) {
  await ensureSchema(env.DB);
  return new Response(await burnsCsv(env.DB), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="wick-burns.csv"', 'cache-control': 'public, max-age=60' },
  });
}
