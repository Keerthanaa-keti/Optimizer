import type Database from 'better-sqlite3';
import type { Execution } from '@creditforge/core';

export function insertExecution(db: Database.Database, exec: Omit<Execution, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO executions (task_id, model, prompt_tokens, completion_tokens, total_tokens,
      cost_usd_cents, duration_ms, exit_code, stdout, stderr, branch, commit_hash, started_at, completed_at)
    VALUES (@taskId, @model, @promptTokens, @completionTokens, @totalTokens,
      @costUsdCents, @durationMs, @exitCode, @stdout, @stderr, @branch, @commitHash, @startedAt, @completedAt)
  `);

  const result = stmt.run({
    taskId: exec.taskId,
    model: exec.model,
    promptTokens: exec.promptTokens,
    completionTokens: exec.completionTokens,
    totalTokens: exec.totalTokens,
    costUsdCents: exec.costUsdCents,
    durationMs: exec.durationMs,
    exitCode: exec.exitCode,
    stdout: exec.stdout,
    stderr: exec.stderr,
    branch: exec.branch,
    commitHash: exec.commitHash ?? null,
    startedAt: exec.startedAt ?? new Date().toISOString(),
    completedAt: exec.completedAt ?? null,
  });

  return Number(result.lastInsertRowid);
}

export function getExecutionsForTask(db: Database.Database, taskId: number): Execution[] {
  const rows = db.prepare(
    'SELECT * FROM executions WHERE task_id = ? ORDER BY started_at DESC',
  ).all(taskId) as Record<string, unknown>[];
  return rows.map(mapExecution);
}

export function getRecentExecutions(db: Database.Database, limit: number = 20): Execution[] {
  const rows = db.prepare(
    'SELECT * FROM executions ORDER BY started_at DESC LIMIT ?',
  ).all(limit) as Record<string, unknown>[];
  return rows.map(mapExecution);
}

export function getTotalSpent(db: Database.Database, since?: string): { tokens: number; usdCents: number } {
  const whereClause = since ? 'WHERE started_at >= ?' : '';
  const args = since ? [since] : [];

  const row = db.prepare(`
    SELECT COALESCE(SUM(total_tokens), 0) as tokens, COALESCE(SUM(cost_usd_cents), 0) as usd_cents
    FROM executions ${whereClause}
  `).get(...args) as { tokens: number; usd_cents: number };

  return { tokens: row.tokens, usdCents: row.usd_cents };
}

function mapExecution(row: Record<string, unknown>): Execution {
  return {
    id: row.id as number,
    taskId: row.task_id as number,
    model: row.model as string,
    promptTokens: row.prompt_tokens as number,
    completionTokens: row.completion_tokens as number,
    totalTokens: row.total_tokens as number,
    costUsdCents: row.cost_usd_cents as number,
    durationMs: row.duration_ms as number,
    exitCode: row.exit_code as number,
    stdout: row.stdout as string,
    stderr: row.stderr as string,
    branch: row.branch as string,
    commitHash: row.commit_hash as string | undefined,
    startedAt: row.started_at as string,
    completedAt: row.completed_at as string | undefined,
  };
}
