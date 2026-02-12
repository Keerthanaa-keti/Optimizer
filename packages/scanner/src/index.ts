import fs from 'node:fs';
import path from 'node:path';
import type { Task, Project } from '@creditforge/core';
import { computeScore } from '@creditforge/core';
import { scanPackageJson } from './scanners/package-json.js';
import { scanClaudeMd } from './scanners/claude-md.js';
import { scanTodoComments } from './scanners/todo-comments.js';
import { scanNpmAudit } from './scanners/npm-audit.js';
import { scanGitAnalyzer } from './scanners/git-analyzer.js';

export interface ScanResult {
  project: Project;
  tasks: Task[];
  durationMs: number;
  errors: string[];
}

export interface ScannerOptions {
  skipNpmAudit?: boolean;   // npm audit can be slow
  skipGit?: boolean;
  skipTodos?: boolean;
  maxTodosPerProject?: number;
}

const DEFAULT_OPTIONS: ScannerOptions = {
  skipNpmAudit: false,
  skipGit: false,
  skipTodos: false,
  maxTodosPerProject: 50,
};

/**
 * Scans a single project directory for automatable tasks.
 */
export function scanProject(
  projectPath: string,
  options: ScannerOptions = {},
): ScanResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const start = Date.now();
  const errors: string[] = [];

  // Resolve ~ in paths
  const resolvedPath = projectPath.replace(/^~/, process.env.HOME ?? '');

  if (!fs.existsSync(resolvedPath)) {
    return {
      project: makeProject(resolvedPath, 'unknown'),
      tasks: [],
      durationMs: Date.now() - start,
      errors: [`Path does not exist: ${resolvedPath}`],
    };
  }

  const projectName = path.basename(resolvedPath);
  const project = detectProjectInfo(resolvedPath, projectName);
  const allTasks: Task[] = [];

  // Run each scanner, collecting errors
  const scanners: Array<{ name: string; fn: () => Task[] }> = [
    { name: 'package-json', fn: () => scanPackageJson(resolvedPath, projectName) },
    { name: 'claude-md', fn: () => scanClaudeMd(resolvedPath, projectName) },
  ];

  if (!opts.skipTodos) {
    scanners.push({ name: 'todo-comments', fn: () => scanTodoComments(resolvedPath, projectName) });
  }
  if (!opts.skipNpmAudit) {
    scanners.push({ name: 'npm-audit', fn: () => scanNpmAudit(resolvedPath, projectName) });
  }
  if (!opts.skipGit) {
    scanners.push({ name: 'git-analyzer', fn: () => scanGitAnalyzer(resolvedPath, projectName) });
  }

  for (const scanner of scanners) {
    try {
      const tasks = scanner.fn();
      allTasks.push(...tasks);
    } catch (err) {
      errors.push(`${scanner.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Cap TODO comments
  const todoTasks = allTasks.filter((t) => t.source === 'todo-comment');
  const otherTasks = allTasks.filter((t) => t.source !== 'todo-comment');
  const cappedTodos = todoTasks.slice(0, opts.maxTodosPerProject);
  const finalTasks = [...otherTasks, ...cappedTodos];

  // Compute scores
  for (const task of finalTasks) {
    task.score = computeScore(task);
  }

  // Sort by score descending
  finalTasks.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  project.taskCount = finalTasks.length;
  project.lastScannedAt = new Date().toISOString();

  return {
    project,
    tasks: finalTasks,
    durationMs: Date.now() - start,
    errors,
  };
}

/**
 * Scans multiple project directories.
 */
export function scanAll(
  projectPaths: string[],
  options: ScannerOptions = {},
): ScanResult[] {
  return projectPaths.map((p) => scanProject(p, options));
}

function detectProjectInfo(projectPath: string, projectName: string): Project {
  return {
    path: projectPath,
    name: projectName,
    taskCount: 0,
    hasClaudeMd: fs.existsSync(path.join(projectPath, 'CLAUDE.md')),
    hasBugsCodex: fs.existsSync(path.join(projectPath, 'bugs-codex.md')),
    hasPackageJson: fs.existsSync(path.join(projectPath, 'package.json')),
    isGitRepo: fs.existsSync(path.join(projectPath, '.git')),
  };
}

function makeProject(projectPath: string, projectName: string): Project {
  return {
    path: projectPath,
    name: projectName,
    taskCount: 0,
    hasClaudeMd: false,
    hasBugsCodex: false,
    hasPackageJson: false,
    isGitRepo: false,
  };
}

// Re-export individual scanners for direct use
export { scanPackageJson } from './scanners/package-json.js';
export { scanClaudeMd } from './scanners/claude-md.js';
export { scanTodoComments } from './scanners/todo-comments.js';
export { scanNpmAudit } from './scanners/npm-audit.js';
export { scanGitAnalyzer } from './scanners/git-analyzer.js';
