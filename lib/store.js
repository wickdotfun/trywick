// Petits accès à la base Cloudflare D1 : caches (kv) et fil public (events).

export async function getKv(db, key) {
  const row = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(key).first();
  return row ? JSON.parse(row.v) : null;
}

export async function setKv(db, key, value) {
  await db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(key, JSON.stringify(value)).run();
}

// events : [{ kind, who, candle, detail }]
export async function addEvents(db, at, events) {
  if (!events.length) return;
  await db.batch(events.map((e) => db.prepare(
    'INSERT INTO events (at, kind, who, candle, detail) VALUES (?, ?, ?, ?, ?)',
  ).bind(e.at ?? at, e.kind, e.who ?? null, e.candle ?? null, e.detail == null ? null : String(e.detail))));
  // De temps en temps, on oublie les événements de plus d'une semaine.
  if (Math.random() < 0.01) {
    await db.prepare('DELETE FROM events WHERE at < ?').bind(at - 7 * 86400_000).run();
  }
}

export async function recentEvents(db, limit = 20) {
  const { results } = await db.prepare(
    'SELECT at, kind, who, candle, detail FROM events ORDER BY id DESC LIMIT ?',
  ).bind(limit).all();
  return results;
}
