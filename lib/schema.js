// La table des allumettes, créée automatiquement au premier passage.
// (Les tables de l'ancienne version du site ne sont pas touchées.)
//
// Une allumette = un coin lancé depuis le site.
// - préparée : on a ses métadonnées (seq vide) ;
// - envoyée : la transaction signée est partie (signature remplie) ;
// - allumée : la transaction est confirmée on-chain, elle reçoit son numéro (seq).
const CREATE = [
  `CREATE TABLE IF NOT EXISTS matches (
    mint TEXT PRIMARY KEY,
    creator TEXT NOT NULL,
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    image TEXT,
    uri TEXT NOT NULL,
    dev_buy REAL NOT NULL DEFAULT 0,
    ip TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    signature TEXT,
    sent_at INTEGER,
    seq INTEGER UNIQUE,
    lit_at INTEGER
  )`,
  'CREATE INDEX IF NOT EXISTS matches_ip ON matches (ip, created_at)',
  'CREATE INDEX IF NOT EXISTS matches_lit ON matches (lit_at)',
];

let ready = false;

export async function ensureSchema(db) {
  if (ready) return;
  await db.batch(CREATE.map((sql) => db.prepare(sql)));
  ready = true;
}
