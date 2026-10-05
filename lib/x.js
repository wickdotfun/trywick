// Poster sur X (optionnel) : un post avec une image, via l'API X v2 (OAuth 1.0a, le compte du
// projet). Actif seulement si les quatre clés sont réglées dans Cloudflare :
//   X_API_KEY, X_API_SECRET (l'app), X_ACCESS_TOKEN, X_ACCESS_SECRET (le compte qui poste).
// L'API X est payante à l'usage (quelques centimes par post) : sans clés, rien n'est envoyé, et la
// page d'admin donne l'image et le texte à poster soi-même.

export const xReady = (env) => Boolean(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_SECRET);

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

// L'en-tête OAuth 1.0a d'une requête (les corps JSON et multipart ne sont pas signés).
export async function oauthHeader(env, method, url, { nonce, timestamp } = {}) {
  const u = new URL(url);
  const oauth = {
    oauth_consumer_key: env.X_API_KEY,
    oauth_nonce: nonce || crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  const params = [...Object.entries(oauth), ...u.searchParams.entries()]
    .map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(params.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${enc(env.X_API_SECRET)}&${enc(env.X_ACCESS_SECRET)}`),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base)));
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ')}`;
}

async function call(env, url, init) {
  const res = await fetch(url, { ...init, headers: { ...init.headers, authorization: await oauthHeader(env, init.method, url) } });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`x ${res.status}: ${JSON.stringify(data?.errors || data?.detail || data?.title || '').slice(0, 200)}`);
  return data;
}

// Un post : le texte, et l'image (PNG, JPEG, GIF ou WebP, en octets). Renvoie l'id du post.
export async function xPost(env, { text, image, type = 'image/png' }) {
  let media = null;
  if (image) {
    const form = new FormData();
    form.append('media', new Blob([image], { type }), `card.${type.split('/')[1] || 'png'}`);
    form.append('media_category', 'tweet_image');
    const up = await call(env, 'https://api.x.com/2/media/upload', { method: 'POST', body: form, headers: {} });
    media = up?.data?.id || up?.media_id_string || null;
    if (!media) throw new Error('x media: no id');
  }
  const res = await call(env, 'https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, ...(media ? { media: { media_ids: [media] } } : {}) }),
  });
  return res?.data?.id || null;
}
