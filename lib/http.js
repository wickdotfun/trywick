// Petits outils partagés par les routes de l'API.
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// On ne garde jamais l'IP en clair : seulement une empreinte salée.
export async function ipHash(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const data = new TextEncoder().encode(`${env.IP_SALT || 'wick'}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function tokenInfo(env) {
  return {
    mint: env.TOKEN_MINT || null,
    ticker: env.TOKEN_TICKER || 'WICK',
    x: env.X_URL || null,
    telegram: env.TELEGRAM_URL || null,
  };
}
