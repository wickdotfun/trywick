// Petits réglages modifiables depuis la page d'admin, gardés dans la base (table settings).

export async function getSetting(db, key, fallback = null) {
  const row = await db.prepare('SELECT v FROM settings WHERE k = ?').bind(key).first();
  return row ? JSON.parse(row.v) : fallback;
}

export async function setSetting(db, key, value) {
  await db.prepare('INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(key, JSON.stringify(value)).run();
}

// L'interrupteur d'urgence : en pause, aucun nouvel achat de $WICK ne part.
export async function buybackPaused(db) {
  return Boolean(await getSetting(db, 'buyback.paused', false));
}
