import { DatabaseSync } from 'node:sqlite';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { seedDb } from './seed.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const DB_PATH = process.env.BAY_DB || join(ROOT, 'bay.db');

import { CATEGORIES } from './shared.mjs';
export { CATEGORIES, OPEN_LICENSES, TRACKERS, magnetFor, validateListing } from './shared.mjs';

let db;

export function getDb() {
  if (db) return db;
  const fresh = !existsSync(DB_PATH);
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  if (fresh) seedDb(db);
  return db;
}

export function resetDb() {
  if (db) { db.close(); db = undefined; }
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(DB_PATH + suffix)) unlinkSync(DB_PATH + suffix);
  }
  getDb();
  console.log('Database reset and reseeded at', DB_PATH);
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS uploaders (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      rank TEXT NOT NULL DEFAULT 'Sailor',
      joined_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS torrents (
      id INTEGER PRIMARY KEY,
      infohash TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      seeds INTEGER NOT NULL DEFAULT 0,
      leechers INTEGER NOT NULL DEFAULT 0,
      uploader_id INTEGER REFERENCES uploaders(id),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      license TEXT NOT NULL,
      source_url TEXT,
      description TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      files_json TEXT,
      webseeds_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_torrents_cat ON torrents(category);
    CREATE INDEX IF NOT EXISTS idx_torrents_seeds ON torrents(seeds);
  `);
}

const SORTS = {
  seeds: 't.seeds DESC',
  date: 't.uploaded_at DESC',
  size: 't.size_bytes DESC',
  name: 't.name COLLATE NOCASE ASC',
};

const BASE_SELECT = `
  SELECT t.*, u.name AS uploader, u.rank AS uploader_rank
  FROM torrents t LEFT JOIN uploaders u ON u.id = t.uploader_id
`;

export function searchTorrents({ q = '', cats = [], sort = 'seeds', limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(t.name LIKE ? OR t.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const validCats = cats.filter((c) => CATEGORIES[c]);
  if (validCats.length) {
    where.push(`t.category IN (${validCats.map(() => '?').join(',')})`);
    params.push(...validCats);
  }
  const sql = BASE_SELECT +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ${SORTS[sort] || SORTS.seeds} LIMIT ?`;
  params.push(Math.min(limit, 500));
  return getDb().prepare(sql).all(...params);
}

export function getTorrent(infohash) {
  return getDb().prepare(BASE_SELECT + ' WHERE t.infohash = ?').get(infohash);
}

export function latestCatalog() {
  return getDb().prepare(
    BASE_SELECT + " WHERE t.name LIKE 'hugging-bay-catalog-%' ORDER BY t.uploaded_at DESC LIMIT 1"
  ).get();
}

export function randomTorrent() {
  return getDb().prepare(BASE_SELECT + ' ORDER BY RANDOM() LIMIT 1').get();
}

export function categoryCounts() {
  return getDb().prepare(
    'SELECT category, COUNT(*) AS n, SUM(size_bytes) AS bytes FROM torrents GROUP BY category'
  ).all();
}

export function fleetStats() {
  const totals = getDb().prepare(`
    SELECT COUNT(*) AS torrents, SUM(size_bytes) AS bytes,
           SUM(seeds) AS seeds, SUM(leechers) AS leechers
    FROM torrents
  `).get();
  const underSeeded = getDb().prepare(
    BASE_SELECT + ' ORDER BY t.seeds ASC, t.size_bytes DESC LIMIT 10'
  ).all();
  return { totals, underSeeded };
}

export function insertTorrent(t) {
  const db = getDb();
  let uploader = db.prepare('SELECT id FROM uploaders WHERE name = ?').get(t.uploader);
  if (!uploader) {
    db.prepare('INSERT INTO uploaders (name) VALUES (?)').run(t.uploader);
    uploader = db.prepare('SELECT id FROM uploaders WHERE name = ?').get(t.uploader);
  }
  db.prepare(`
    INSERT INTO torrents (infohash, name, category, size_bytes, seeds, leechers,
      uploader_id, uploaded_at, license, source_url, description, verified, files_json, webseeds_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    t.infohash.toLowerCase(), t.name, t.category, t.size_bytes,
    t.seeds ?? 0, t.leechers ?? 0, uploader.id,
    t.uploaded_at ?? new Date().toISOString(),
    t.license, t.source_url ?? null, t.description ?? null,
    t.verified ?? 0, t.files_json ?? null, t.webseeds_json ?? null,
  );
}

export function topUploaders(limit = 10) {
  return getDb().prepare(`
    SELECT u.name, u.rank, COUNT(t.id) AS uploads, SUM(t.size_bytes) AS bytes
    FROM uploaders u JOIN torrents t ON t.uploader_id = u.id
    GROUP BY u.id ORDER BY uploads DESC, bytes DESC LIMIT ?
  `).all(limit);
}

