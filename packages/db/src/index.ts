import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { up as migration001 } from './migrations/001_initial.js';
import { up as migration002 } from './migrations/002_intelligence.js';

const DEFAULT_DB_DIR = path.join(
  process.env.HOME ?? '~',
  '.creditforge',
);
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, 'creditforge.db');

let _db: Database.Database | null = null;

export function getDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  if (_db) return _db;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  runMigrations(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function runMigrations(db: Database.Database): void {
  // Check if schema_version table exists
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
  ).get();

  let currentVersion = 0;
  if (tableExists) {
    const row = db.prepare(
      'SELECT MAX(version) as version FROM schema_version',
    ).get() as { version: number } | undefined;
    currentVersion = row?.version ?? 0;
  }

  const migrations = [migration001, migration002];

  for (let i = currentVersion; i < migrations.length; i++) {
    db.transaction(() => {
      migrations[i](db);
    })();
  }
}

// Re-export all query functions
export * from './queries/projects.js';
export * from './queries/tasks.js';
export * from './queries/executions.js';
export * from './queries/ledger.js';
export * from './queries/intelligence.js';
