import type Database from 'better-sqlite3';
import type { Task, TaskStatus } from '@creditforge/core';
import { computeScore } from '@creditforge/core';

export function insertTask(db: Database.Database, task: Task, projectId: number): number {
  const score = task.score ?? computeScore(task);
  const stmt = db.prepare(`
    INSERT INTO tasks (project_id, project_path, project_name, source, category, title, description,
      file_path, line_number, impact, confidence, risk, duration, score, status, prompt)
    VALUES (@projectId, @projectPath, @projectName, @source, @category, @title, @description,
      @filePath, @lineNumber, @impact, @confidence, @risk, @duration, @score, @status, @prompt)
  `);

  const result = stmt.run({
    projectId,
    projectPath: task.projectPath,
    projectName: task.projectName,
    source: task.source,
    category: task.category,
    title: task.title,
    description: task.description,
    filePath: task.filePath ?? null,
    lineNumber: task.lineNumber ?? null,
    impact: task.impact,
    confidence: task.confidence,
    risk: task.risk,
    duration: task.duration,
    score,
    status: task.status,
    prompt: task.prompt ?? null,
  });

  return Number(result.lastInsertRowid);
}

export function getQueuedTasks(db: Database.Database): Task[] {
  const rows = db.prepare(
    'SELECT * FROM tasks WHERE status = ? ORDER BY score DESC',
  ).all('queued') as Record<string, unknown>[];
  return rows.map(mapTask);
}

export function getTasksByProject(db: Database.Database, projectPath: string): Task[] {
  const rows = db.prepare(
    'SELECT * FROM tasks WHERE project_path = ? ORDER BY score DESC',
  ).all(projectPath) as Record<string, unknown>[];
  return rows.map(mapTask);
}

export function getTaskById(db: Database.Database, id: number): Task | undefined {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return mapTask(row);
}

export function updateTaskStatus(db: Database.Database, id: number, status: TaskStatus): void {
  db.prepare("UPDATE tasks SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export function clearTasksForProject(db: Database.Database, projectPath: string): number {
  // Delete child rows first to avoid FK constraint violations
  db.prepare('DELETE FROM executions WHERE task_id IN (SELECT id FROM tasks WHERE project_path = ?)').run(projectPath);
  db.prepare('UPDATE ledger SET task_id = NULL WHERE task_id IN (SELECT id FROM tasks WHERE project_path = ?)').run(projectPath);
  db.prepare('UPDATE pool_transactions SET task_id = NULL WHERE task_id IN (SELECT id FROM tasks WHERE project_path = ?)').run(projectPath);
  const result = db.prepare('DELETE FROM tasks WHERE project_path = ?').run(projectPath);
  return result.changes;
}

export function deleteTask(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM executions WHERE task_id = ?').run(id);
  db.prepare('UPDATE ledger SET task_id = NULL WHERE task_id = ?').run(id);
  db.prepare('UPDATE pool_transactions SET task_id = NULL WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function getTaskStats(db: Database.Database): { total: number; byStatus: Record<string, number>; bySource: Record<string, number> } {
  const total = (db.prepare('SELECT COUNT(*) as count FROM tasks').get() as { count: number }).count;

  const byStatus: Record<string, number> = {};
  const statusRows = db.prepare('SELECT status, COUNT(*) as count FROM tasks GROUP BY status').all() as { status: string; count: number }[];
  for (const row of statusRows) {
    byStatus[row.status] = row.count;
  }

  const bySource: Record<string, number> = {};
  const sourceRows = db.prepare('SELECT source, COUNT(*) as count FROM tasks GROUP BY source').all() as { source: string; count: number }[];
  for (const row of sourceRows) {
    bySource[row.source] = row.count;
  }

  return { total, byStatus, bySource };
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as number,
    projectPath: row.project_path as string,
    projectName: row.project_name as string,
    source: row.source as Task['source'],
    category: row.category as Task['category'],
    title: row.title as string,
    description: row.description as string,
    filePath: row.file_path as string | undefined,
    lineNumber: row.line_number as number | undefined,
    impact: row.impact as number,
    confidence: row.confidence as number,
    risk: row.risk as number,
    duration: row.duration as number,
    score: row.score as number,
    status: row.status as Task['status'],
    prompt: row.prompt as string | undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
