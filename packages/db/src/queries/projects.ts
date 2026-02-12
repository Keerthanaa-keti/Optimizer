import type Database from 'better-sqlite3';
import type { Project } from '@creditforge/core';

export function upsertProject(db: Database.Database, project: Omit<Project, 'id'>): number {
  const stmt = db.prepare(`
    INSERT INTO projects (path, name, last_scanned_at, task_count, has_claude_md, has_bugs_codex, has_package_json, is_git_repo)
    VALUES (@path, @name, @lastScannedAt, @taskCount, @hasClaudeMd, @hasBugsCodex, @hasPackageJson, @isGitRepo)
    ON CONFLICT(path) DO UPDATE SET
      name = @name,
      last_scanned_at = @lastScannedAt,
      task_count = @taskCount,
      has_claude_md = @hasClaudeMd,
      has_bugs_codex = @hasBugsCodex,
      has_package_json = @hasPackageJson,
      is_git_repo = @isGitRepo,
      updated_at = datetime('now')
  `);

  stmt.run({
    path: project.path,
    name: project.name,
    lastScannedAt: project.lastScannedAt ?? null,
    taskCount: project.taskCount,
    hasClaudeMd: project.hasClaudeMd ? 1 : 0,
    hasBugsCodex: project.hasBugsCodex ? 1 : 0,
    hasPackageJson: project.hasPackageJson ? 1 : 0,
    isGitRepo: project.isGitRepo ? 1 : 0,
  });

  // Always SELECT — lastInsertRowid is unreliable for ON CONFLICT UPDATE
  const row = db.prepare('SELECT id FROM projects WHERE path = ?').get(project.path) as { id: number };
  return row.id;
}

export function getProject(db: Database.Database, path: string): Project | undefined {
  const row = db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return mapProject(row);
}

export function getAllProjects(db: Database.Database): Project[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY name').all() as Record<string, unknown>[];
  return rows.map(mapProject);
}

function mapProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as number,
    path: row.path as string,
    name: row.name as string,
    lastScannedAt: row.last_scanned_at as string | undefined,
    taskCount: row.task_count as number,
    hasClaudeMd: Boolean(row.has_claude_md),
    hasBugsCodex: Boolean(row.has_bugs_codex),
    hasPackageJson: Boolean(row.has_package_json),
    isGitRepo: Boolean(row.is_git_repo),
  };
}
