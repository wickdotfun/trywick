// Les tables, créées automatiquement au premier passage.
// (Les tables de l'ancienne version du site ne sont pas touchées.)
//
// Une allumette = un coin lancé depuis le site.
// - préparée : on a ses métadonnées (seq vide) ;
// - envoyée : la transaction signée est partie (signature remplie) ;
// - allumée : la transaction est confirmée on-chain, elle reçoit son numéro (seq)
//   et la bougie (cycle) qui brûlait à ce moment-là.
//
// Une bougie = un cycle, de son allumage à son buyback :
//   burning → ended → buying → bought → burning_tx → burned
//   (ou skipped : rien à racheter ; failed : le rachat a échoué, la cagnotte reste là).
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
  `CREATE TABLE IF NOT EXISTS cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    matches INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'burning',
    note TEXT,
    step_at INTEGER,
    buy_sol REAL,
    buy_sig TEXT,
    pre_raw TEXT,
    bought_raw TEXT,
    decimals INTEGER,
    token_account TEXT,
    token_program TEXT,
    burn_sig TEXT,
    burn_tries INTEGER NOT NULL DEFAULT 0,
    burned_ui REAL
  )`,
  // Une seule bougie allumée à la fois, même si deux requêtes en allument une en même temps.
  'CREATE UNIQUE INDEX IF NOT EXISTS cycles_one_open ON cycles ((ended_at IS NULL)) WHERE ended_at IS NULL',
  'CREATE INDEX IF NOT EXISTS cycles_status ON cycles (status, id)',
];

// Les colonnes ajoutées après coup aux tables déjà en ligne.
const UPGRADES = [
  'ALTER TABLE matches ADD COLUMN cycle INTEGER',
];

const ready = new WeakSet();

export async function ensureSchema(db) {
  if (ready.has(db)) return;
  await db.batch(CREATE.map((sql) => db.prepare(sql)));
  for (const sql of UPGRADES) {
    try {
      await db.prepare(sql).run();
    } catch (err) {
      if (!/duplicate column/i.test(String(err?.message ?? err))) throw err;
    }
  }
  await db.prepare('CREATE INDEX IF NOT EXISTS matches_cycle ON matches (cycle, seq)').run();
  ready.add(db);
}
