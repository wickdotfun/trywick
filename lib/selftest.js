// Le test de la page d'admin (POST /api/admin/selftest) : chaque étape réelle d'un lancement, en
// production, une par une, avec ce qui casse et pourquoi. Rien n'est signé ni envoyé sur Solana :
// la transaction de création est seulement construite (PumpPortal), jamais signée.
import { tgToken } from './tgtoken.js';
import { CONFIG } from './config.js';
import { aiToday } from './keepers.js';
import { getSetting, setSetting } from './settings.js';
import { buildCreateTx, pinataStatus } from './pump.js';
import { sparkCoin, sparkImage } from './spark.js';
import { base58, getLatestBlockhash, WSOL } from './solana.js';

async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    return { name, ok: true, ms: Date.now() - t, detail: detail ?? 'ok' };
  } catch (err) {
    return { name, ok: false, ms: Date.now() - t, detail: String(err?.message ?? err).slice(0, 300) };
  }
}
const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const randomKey = () => base58(crypto.getRandomValues(new Uint8Array(32)));

export async function selfTest(env, now = Date.now()) {
  const steps = [];
  steps.push(await step('Database (D1)', async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM matches').first();
    return `${row.n} coins`;
  }));
  steps.push(await step('AI binding (Workers AI)', async () => {
    need(env.AI?.run, 'No AI binding: add [ai] binding = "AI" (it is in wrangler.toml) and redeploy');
    const res = await env.AI.run(CONFIG.keepers.models[0].model, { messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 5 });
    // L'IA répond : si le site l'avait mise en pause (quota du jour épuisé), elle repart tout de
    // suite (par exemple juste après le passage au plan payant).
    const paused = await getSetting(env.DB, 'ai.out', null);
    if (paused != null) await setSetting(env.DB, 'ai.out', null);
    return `answered: ${JSON.stringify(res?.response ?? res).slice(0, 40)}${paused != null ? ' · AI pause lifted' : ''}`;
  }));
  // L'IA au lancement est coupée (SPARK=on la rallume) : rien à tester, rien à payer.
  if (env.SPARK !== 'on') {
    steps.push({ name: 'AI at launch (coin, logo)', ok: true, ms: 0, detail: 'off by design: creators bring their own image (SPARK=on turns it on)' });
  }
  let spark = null;
  if (env.SPARK === 'on') steps.push(await step('Spark: the AI writes a coin', async () => {
    const res = await sparkCoin(env, { idea: 'a moth that finally caught the flame', style: 'stoic', model: 'llama', ip: 'selftest', now });
    need(!res.error, `error: ${res.error}`);
    spark = res.value;
    return `$${spark.symbol}: ${spark.name}`;
  }));
  if (env.SPARK === 'on') steps.push(await step('Spark: the AI paints the logo', async () => {
    const res = await sparkImage(env, { visual: spark?.visual || 'a moth made of candle wax', name: spark?.name || 'Moth', ip: 'selftest', now });
    need(!res.error, `error: ${res.error}`);
    return `${Math.round(res.bytes.length / 1024)} KB with ${res.model.split('/').pop()}`;
  }));
  steps.push(await step('Pinata (image upload)', async () => {
    const st = await pinataStatus(env, now);
    need(st === 'ok', st === 'missing' ? 'PINATA_JWT is not set' : `PINATA_JWT ${st}`);
    return 'key works';
  }));
  steps.push(await step('Solana RPC', async () => {
    need(env.SOLANA_RPC, 'SOLANA_RPC is not set: the public RPC is slow and rate-limited');
    return `blockhash ${String(await getLatestBlockhash(env)).slice(0, 8)}…`;
  }));
  steps.push(await step('PumpPortal (builds the launch)', async () => {
    const bytes = await buildCreateTx({ creator: randomKey(), mint: randomKey(), name: 'Self Test', symbol: 'TEST', devBuy: 0 }, 'https://example.com/test.json');
    return `built, ${bytes.length} bytes (not signed, not sent)`;
  }));
  steps.push(await step('DEX Screener (markets, Scout)', async () => {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${WSOL}`);
    need(res.ok, `HTTP ${res.status}`);
    return 'reachable';
  }));
  steps.push(await step('Telegram bot', async () => {
    need(env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN is not set');
    const res = await fetch(`https://api.telegram.org/bot${tgToken(env)}/getMe`).then((r) => r.json());
    need(res?.ok, `Telegram: ${res?.description || 'invalid token'}`);
    return `@${res.result.username}`;
  }));
  steps.push(await step('Other settings', async () => {
    const missing = ['IP_SALT', 'BUYBACK_SECRET_KEY', 'ADMIN_KEY'].filter((k) => !env[k]);
    need(!missing.length, `missing: ${missing.join(', ')}`);
    return 'IP_SALT, BUYBACK_SECRET_KEY, ADMIN_KEY set';
  }));
  const today = await aiToday(env.DB, now);
  return { at: now, ok: steps.every((s) => s.ok), steps, aiToday: today };
}
