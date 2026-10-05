// Le token du bot Telegram, nettoyé : sans espaces, sans « bot » devant (une erreur fréquente en le
// collant dans Cloudflare, qui donne « Not Found »).
export const tgToken = (env) => String(env.TELEGRAM_BOT_TOKEN || '').trim().replace(/^bot(?=\d)/i, '');
