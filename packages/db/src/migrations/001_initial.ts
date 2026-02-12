import type Database from 'better-sqlite3';

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      last_scanned_at TEXT,
      task_count INTEGER DEFAULT 0,
      has_claude_md INTEGER DEFAULT 0,
      has_bugs_codex INTEGER DEFAULT 0,
      has_package_json INTEGER DEFAULT 0,
      is_git_repo INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id),
      project_path TEXT NOT NULL,
      project_name TEXT NOT NULL,
      source TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      file_path TEXT,
      line_number INTEGER,
      impact INTEGER NOT NULL CHECK (impact BETWEEN 1 AND 5),
      confidence INTEGER NOT NULL CHECK (confidence BETWEEN 1 AND 5),
      risk INTEGER NOT NULL CHECK (risk BETWEEN 1 AND 5),
      duration INTEGER NOT NULL CHECK (duration BETWEEN 1 AND 5),
      score REAL,
      status TEXT NOT NULL DEFAULT 'queued',
      prompt TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      model TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cost_usd_cents REAL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      exit_code INTEGER,
      stdout TEXT DEFAULT '',
      stderr TEXT DEFAULT '',
      branch TEXT NOT NULL,
      commit_hash TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      counterparty_id TEXT NOT NULL,
      entry_type TEXT NOT NULL CHECK (entry_type IN ('debit', 'credit')),
      amount REAL NOT NULL,
      currency TEXT NOT NULL CHECK (currency IN ('tokens', 'usd_cents')),
      description TEXT NOT NULL,
      task_id INTEGER REFERENCES tasks(id),
      execution_id INTEGER REFERENCES executions(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS credit_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      balance_tokens REAL DEFAULT 0,
      balance_usd_cents REAL DEFAULT 0,
      window_reset_at TEXT NOT NULL,
      captured_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pool_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id TEXT NOT NULL,
      consumer_id TEXT NOT NULL,
      task_id INTEGER REFERENCES tasks(id),
      tokens_allocated INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'disputed')),
      escrow_usd_cents REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      settled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_score ON tasks(score DESC);
    CREATE INDEX IF NOT EXISTS idx_executions_task ON executions(task_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_created ON ledger(created_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_account ON credit_snapshots(account_id);

    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO schema_version (version) VALUES (1);
  `);
}
