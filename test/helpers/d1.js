// Une base D1 en mémoire pour les tests, sur le SQLite intégré à Node.
import { DatabaseSync } from 'node:sqlite';

export function fakeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
    async run() {
      const r = sqlite.prepare(sql).run(...args);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    sqlite,
    prepare: (sql) => statement(sql),
    async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; },
  };
}
