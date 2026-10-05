// Le token du bot Telegram, nettoyé. Ce qui revient souvent en le collant dans Cloudflare (et qui
// donne « Not Found ») : des espaces ou des guillemets autour, « bot » devant, ou toute l'adresse
// https://api.telegram.org/bot…/ au lieu du token seul. On garde la partie « 123456789:AA… ».
const SHAPE = /\d{6,12}:[A-Za-z0-9_-]{30,}/;

export const tgToken = (env) => {
  const raw = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  return raw.match(SHAPE)?.[0] ?? raw.replace(/^["']|["']$/g, '').replace(/^bot(?=\d)/i, '');
};

// Ce qui cloche dans sa forme, sans jamais le montrer. → null si elle est bonne.
export function tgTokenProblem(env) {
  const t = String(env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!t) return 'TELEGRAM_BOT_TOKEN is not set';
  if (SHAPE.test(t)) return null;
  const hint = !t.includes(':') ? 'it has no ":"'
    : !/^\D*\d{6,12}:/.test(t) ? 'the part before ":" should be the bot number'
      : 'the part after ":" is too short or has odd characters';
  return `TELEGRAM_BOT_TOKEN does not look like a bot token (${hint}, ${t.length} characters). Expected 123456789:AA… (about 46 characters)`;
}
