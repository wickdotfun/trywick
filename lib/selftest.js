// Le test de la page d'admin (POST /api/admin/selftest) : chaque étape réelle d'un lancement, en
// production, une par une, avec ce qui casse et pourquoi. Rien n'est signé ni envoyé sur Solana :
// la transaction de création est seulement construite (PumpPortal), jamais signée.
import { tgToken, tgTokenProblem } from './tgtoken.js';
import { CONFIG } from './config.js';
import { dexJson } from './dex.js';
import { aiToday, hasBackup, noteAiOut } from './keepers.js';
import { callPremium } from './minds.js';
import { getSetting, setSetting } from './settings.js';
import { buildCreateTx, pinataStatus } from './pump.js';
import { sparkCoin, sparkImage } from './spark.js';
import { base58, getLatestBlockhash, WSOL } from './solana.js';

// Une étape renvoie son détail (OK), ou { note } : elle marche, avec une chose à savoir (en jaune,
// pas en rouge : rien n'est cassé, rien à réparer).
async function step(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    if (detail?.note) return { name, ok: true, warn: true, ms: Date.now() - t, detail: detail.note };
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
    // Le plus petit modèle, 2 mots : le test ne coûte presque rien du quota du jour.
    let res;
    try {
      res = await env.AI.run(CONFIG.keepers.lightModel, { messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 3 });
    } catch (err) {
      // 4006 : le quota gratuit du jour (10 000 neurons) est épuisé. Rien n'est cassé : il revient à
      // minuit UTC, et d'ici là les agents parlent avec leurs phrases écrites.
      if (!/4006|daily free allocation|neurons/i.test(String(err?.message ?? err))) throw err;
      await noteAiOut(env.DB, err, now);
      if (hasBackup(env)) return "today's free Workers AI quota is used up (back at 00:00 UTC): agents answer with the free backup brain meanwhile";
      return { note: "today's free AI quota (10,000 neurons) is used up, back at 00:00 UTC. Add a free GROQ_API_KEY (console.groq.com → API Keys) and agents never stop talking" };
    }
    // L'IA répond : si le site l'avait mise en pause (quota du jour épuisé), elle repart tout de
    // suite (par exemple juste après le passage au plan payant).
    const paused = await getSetting(env.DB, 'ai.out', null);
    if (paused != null) await setSetting(env.DB, 'ai.out', null);
    return `answered: ${JSON.stringify(res?.response ?? res).slice(0, 40)}${paused != null ? ' · AI pause lifted' : ''}`;
  }));
  // Le cerveau de secours (Groq, gratuit), s'il est réglé.
  if (hasBackup(env)) steps.push(await step('Backup brain (Groq, free)', async () => {
    const text = await callPremium(env, CONFIG.keepers.backup, { system: 'Reply with the single word OK.', prompt: 'OK?', maxTokens: 3, temperature: 0 });
    return `answered: ${JSON.stringify(String(text).trim()).slice(0, 20)}`;
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
    try {
      await dexJson(`https://api.dexscreener.com/tokens/v1/solana/${WSOL}`);
    } catch (err) {
      // 429 : DEX Screener limite par IP, et celles de Cloudflare sont partagées avec d'autres sites.
      if (err.message !== 'dexscreener_429') throw new Error(err.message.replace('dexscreener_', 'HTTP '));
      return { note: 'reachable, but busy right now (HTTP 429: its limit is shared by many sites on Cloudflare). WICK waits a minute and reads it again by itself. Nothing to fix' };
    }
    return 'reachable';
  }));
  steps.push(await step('Telegram bot', async () => {
    if (!env.TELEGRAM_BOT_TOKEN) return { note: 'not set: optional, the site works without it (no Telegram posts)' };
    const bad = tgTokenProblem(env);
    need(!bad, bad);
    const res = await fetch(`https://api.telegram.org/bot${tgToken(env)}/getMe`).then((r) => r.json()).catch(() => null);
    const fix = 'Open @BotFather in Telegram → /mybots → your bot → API Token, copy it, and paste it alone in Cloudflare → Workers → wick → Settings → Variables and Secrets → TELEGRAM_BOT_TOKEN (type Secret)';
    need(res?.ok, res?.error_code === 401 ? `Telegram does not know this token (it was revoked or regenerated). ${fix}`
      : res?.error_code === 404 ? `Telegram: Not Found, the token is mistyped. ${fix}`
        : `Telegram: ${res?.description || 'no answer'}`);
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
