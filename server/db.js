import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, 'polycule.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS polycules (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    data        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS assets (
    id          TEXT PRIMARY KEY,
    mime        TEXT NOT NULL,
    bytes       BLOB NOT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_polycules_updated ON polycules (updated_at DESC);
`);

export const statements = {
  listPolycules: db.prepare(
    `SELECT id, name, data, created_at, updated_at FROM polycules ORDER BY updated_at DESC`
  ),
  getPolycule: db.prepare(`SELECT * FROM polycules WHERE id = ?`),
  insertPolycule: db.prepare(
    `INSERT INTO polycules (id, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ),
  updatePolycule: db.prepare(
    `UPDATE polycules SET name = ?, data = ?, updated_at = ? WHERE id = ?`
  ),
  deletePolycule: db.prepare(`DELETE FROM polycules WHERE id = ?`),

  insertAsset: db.prepare(
    `INSERT INTO assets (id, mime, bytes, created_at) VALUES (?, ?, ?, ?)`
  ),
  getAsset: db.prepare(`SELECT mime, bytes FROM assets WHERE id = ?`),
};
