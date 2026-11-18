import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { DATA_DIR } from './config';

const dataDir = DATA_DIR;
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Bump when the database structure changes. Existing archives get a safety copy first.
const SCHEMA_VERSION = 1;

const dbPath = path.join(dataDir, 'artalog.sqlite');

if (fs.existsSync(dbPath)) {
  const probe = new Database(dbPath, { readonly: true });
  const existingVersion = probe.pragma('user_version', { simple: true }) as number;
  probe.close();

  if (existingVersion > SCHEMA_VERSION) {
    throw new Error(
      'This archive was created by a newer version of Artalog. Please update Artalog before opening it.',
    );
  }
  if (existingVersion < SCHEMA_VERSION) {
    const backupDir = path.join(dataDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(dbPath, path.join(backupDir, `artalog-before-v${SCHEMA_VERSION}-${stamp}.sqlite`));
  }
}

export const db = new Database(dbPath);

db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  year TEXT,
  medium_materials TEXT,
  height REAL,
  width REAL,
  depth REAL,
  dimensions_unit TEXT DEFAULT 'cm',
  weight REAL,
  weight_unit TEXT DEFAULT 'kg',
  edition_info TEXT,
  price REAL,
  currency TEXT,
  availability TEXT,
  collection_series TEXT,
  tags TEXT DEFAULT '[]',
  short_description TEXT,
  long_description TEXT,
  artwork_statement TEXT,
  process_notes TEXT,
  exhibition_history TEXT,
  private_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artwork_images (
  id TEXT PRIMARY KEY,
  artwork_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  caption TEXT,
  credit TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_detail INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (artwork_id) REFERENCES artworks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_artwork_images_artwork_id
ON artwork_images(artwork_id);
`);

const artworkColumns = db.prepare('PRAGMA table_info(artworks)').all() as Array<{ name: string }>;
if (!artworkColumns.some((column) => column.name === 'materials')) {
  db.exec('ALTER TABLE artworks ADD COLUMN materials TEXT');
}

db.pragma(`user_version = ${SCHEMA_VERSION}`);
