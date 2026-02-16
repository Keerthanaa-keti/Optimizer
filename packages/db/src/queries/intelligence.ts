import type Database from 'better-sqlite3';

export interface IntelligenceSnapshot {
  key: string;
  data: string;
  computedAt: string;
  expiresAt: string;
}

export function getCachedSnapshot(db: Database.Database, key: string): IntelligenceSnapshot | null {
  const row = db.prepare(
    "SELECT key, data, computed_at, expires_at FROM intelligence_snapshots WHERE key = ? AND expires_at > datetime('now')",
  ).get(key) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    key: row.key as string,
    data: row.data as string,
    computedAt: row.computed_at as string,
    expiresAt: row.expires_at as string,
  };
}

export function upsertSnapshot(db: Database.Database, key: string, data: string, ttlMinutes: number = 5): void {
  db.prepare(`
    INSERT INTO intelligence_snapshots (key, data, computed_at, expires_at)
    VALUES (?, ?, datetime('now'), datetime('now', '+' || ? || ' minutes'))
    ON CONFLICT(key) DO UPDATE SET
      data = excluded.data,
      computed_at = excluded.computed_at,
      expires_at = excluded.expires_at
  `).run(key, data, ttlMinutes);
}

export function clearExpiredSnapshots(db: Database.Database): void {
  db.prepare("DELETE FROM intelligence_snapshots WHERE expires_at <= datetime('now')").run();
}

export interface CategoryPerformanceRow {
  category: string;
  source: string;
  model: string;
  totalRuns: number;
  successCount: number;
  avgCost: number;
  avgDuration: number;
}

export function getCategoryPerformance(db: Database.Database): CategoryPerformanceRow[] {
  const rows = db.prepare(`
    SELECT
      t.category,
      t.source,
      e.model,
      COUNT(*) as total_runs,
      SUM(CASE WHEN e.exit_code = 0 THEN 1 ELSE 0 END) as success_count,
      AVG(e.cost_usd_cents) as avg_cost,
      AVG(e.duration_ms) as avg_duration
    FROM executions e
    JOIN tasks t ON e.task_id = t.id
    GROUP BY t.category, t.source, e.model
    ORDER BY total_runs DESC
  `).all() as Record<string, unknown>[];

  return rows.map(r => ({
    category: r.category as string,
    source: r.source as string,
    model: r.model as string,
    totalRuns: r.total_runs as number,
    successCount: r.success_count as number,
    avgCost: r.avg_cost as number,
    avgDuration: r.avg_duration as number,
  }));
}

export function getRecentExecutionStats(db: Database.Database, limit: number = 10): Array<{
  model: string;
  exitCode: number;
  cost: number;
  duration: number;
  category: string;
  startedAt: string;
}> {
  const rows = db.prepare(`
    SELECT e.model, e.exit_code, e.cost_usd_cents, e.duration_ms, t.category, e.started_at
    FROM executions e
    JOIN tasks t ON e.task_id = t.id
    ORDER BY e.started_at DESC
    LIMIT ?
  `).all(limit) as Record<string, unknown>[];

  return rows.map(r => ({
    model: r.model as string,
    exitCode: r.exit_code as number,
    cost: r.cost_usd_cents as number,
    duration: r.duration_ms as number,
    category: r.category as string,
    startedAt: r.started_at as string,
  }));
}
