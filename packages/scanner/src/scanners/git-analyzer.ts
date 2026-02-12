import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@creditforge/core';

/**
 * Analyzes git state: stale branches, uncommitted work, large files.
 */
export function scanGitAnalyzer(projectPath: string, projectName: string): Task[] {
  const gitDir = path.join(projectPath, '.git');
  if (!fs.existsSync(gitDir)) return [];

  const tasks: Task[] = [];

  tasks.push(...detectStaleBranches(projectPath, projectName));
  tasks.push(...detectUncommittedWork(projectPath, projectName));

  return tasks;
}

function git(projectPath: string, args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd: projectPath,
      timeout: 10000,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return null;
  }
}

function detectStaleBranches(projectPath: string, projectName: string): Task[] {
  const tasks: Task[] = [];

  // Get branches with last commit date
  const branchOutput = git(projectPath, 'for-each-ref --sort=-committerdate --format="%(refname:short)|%(committerdate:iso8601)" refs/heads/');
  if (!branchOutput) return tasks;

  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const staleBranches: string[] = [];
  for (const line of branchOutput.split('\n')) {
    const [branch, dateStr] = line.replace(/"/g, '').split('|');
    if (!branch || !dateStr) continue;
    if (branch === 'main' || branch === 'master') continue;

    const lastCommit = new Date(dateStr);
    if (lastCommit < twoWeeksAgo) {
      staleBranches.push(branch);
    }
  }

  if (staleBranches.length > 0) {
    tasks.push({
      projectPath,
      projectName,
      source: 'git-stale-branch',
      category: 'cleanup',
      title: `${staleBranches.length} stale branches in ${projectName}`,
      description: `Branches with no commits in 14+ days: ${staleBranches.join(', ')}`,
      impact: 1,
      confidence: 5,
      risk: 2, // branch deletion needs care
      duration: 1,
      status: 'queued',
      prompt: `In the project at ${projectPath}, review these stale git branches (no commits in 14+ days): ${staleBranches.join(', ')}. For each branch, check if it has been merged to main/master. If merged, it can be safely deleted. If not merged, list the unmerged changes. Do NOT delete any branches — only report which are safe to delete and which have unmerged work.`,
    });
  }

  return tasks;
}

function detectUncommittedWork(projectPath: string, projectName: string): Task[] {
  const tasks: Task[] = [];

  const status = git(projectPath, 'status --porcelain');
  if (!status) return tasks;

  const lines = status.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return tasks;

  const modified = lines.filter((l) => l.startsWith(' M') || l.startsWith('M ')).length;
  const untracked = lines.filter((l) => l.startsWith('??')).length;
  const staged = lines.filter((l) => l.startsWith('A ') || l.startsWith('D ')).length;

  // Only flag if there are significant uncommitted changes
  if (lines.length >= 5) {
    tasks.push({
      projectPath,
      projectName,
      source: 'git-stale-branch',
      category: 'cleanup',
      title: `${lines.length} uncommitted changes in ${projectName}`,
      description: `Modified: ${modified}, Untracked: ${untracked}, Staged: ${staged}. Consider committing or cleaning up.`,
      impact: 2,
      confidence: 5,
      risk: 1,
      duration: 1,
      status: 'queued',
      prompt: `In the project at ${projectPath}, there are ${lines.length} uncommitted changes (${modified} modified, ${untracked} untracked, ${staged} staged). Review the changes with "git diff" and "git status". DO NOT commit anything — just report what the uncommitted changes are and whether they look like work-in-progress or abandoned changes.`,
    });
  }

  return tasks;
}
