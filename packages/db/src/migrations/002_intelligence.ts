import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    -- Indexes for intelligence queries
    CREATE INDEX IF NOT EXISTS idx_executions_started_at ON executions(started_at);
    CREATE INDEX IF NOT EXISTS idx_executions_model ON executions(model);
    CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category);
    CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);

    -- Cache table for intelligence snapshots (avoid recomputing on every refresh)
    CREATE TABLE IF NOT EXISTS intelligence_snapshots (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      computed_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO schema_version (version) VALUES (2);
  `);
}
