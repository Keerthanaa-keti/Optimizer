import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@creditforge/core';

const HOME = process.env.HOME ?? '~';

/**
 * Productivity scanner: bookmark summaries, new repo study notes.
 * All tasks get minimum risk=3 and are report-only.
 */
export function scanProductivity(): Task[] {
  const tasks: Task[] = [];

  // Check Chrome bookmarks for recently added entries
  const chromeBookmarks = path.join(
    HOME,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'Default',
    'Bookmarks',
  );

  try {
    if (fs.existsSync(chromeBookmarks)) {
      const raw = fs.readFileSync(chromeBookmarks, 'utf-8');
      const data = JSON.parse(raw);
      const recentBookmarks = findRecentBookmarks(data, 7); // last 7 days

      if (recentBookmarks.length > 5) {
        const names = recentBookmarks.slice(0, 5).map((b) => b.name).join(', ');
        tasks.push(makeTask(
          `${recentBookmarks.length} new Chrome bookmarks this week`,
          `You added ${recentBookmarks.length} bookmarks in the last 7 days including: ${names}. Summarize the content of each bookmark and suggest categories or tags for organization. DO NOT modify any bookmarks.`,
          3,
        ));
      }
    }
  } catch { /* ignore */ }

  // Check recently cloned repos with unread READMEs
  const cloneRoots = [
    path.join(HOME, 'Documents', 'ClaudeExperiments'),
    path.join(HOME, 'Projects'),
    path.join(HOME, 'repos'),
  ];

  for (const root of cloneRoots) {
    try {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root);
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const newRepos: string[] = [];

      for (const entry of entries) {
        const entryPath = path.join(root, entry);
        try {
          const stat = fs.statSync(entryPath);
          if (!stat.isDirectory()) continue;

          const gitDir = path.join(entryPath, '.git');
          const readme = path.join(entryPath, 'README.md');

          if (fs.existsSync(gitDir) && fs.existsSync(readme)) {
            const gitStat = fs.statSync(gitDir);
            if (gitStat.ctimeMs > sevenDaysAgo) {
              newRepos.push(entry);
            }
          }
        } catch { /* ignore */ }
      }

      if (newRepos.length > 0) {
        tasks.push(makeTask(
          `${newRepos.length} new repos in ${root.replace(HOME, '~')} with unread READMEs`,
          `Recently cloned repositories: ${newRepos.join(', ')}. Read each README.md and generate concise study notes covering: purpose, tech stack, key features, and getting started steps. Output as markdown notes.`,
          4,
        ));
      }
    } catch { /* ignore */ }
  }

  return tasks;
}

interface Bookmark {
  name: string;
  url: string;
  dateAdded: string;
}

function findRecentBookmarks(data: unknown, daysBack: number): Bookmark[] {
  const results: Bookmark[] = [];
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;
  // Chrome stores date_added as microseconds since Windows epoch (Jan 1, 1601)
  const chromeEpochOffset = 11644473600000000;

  function walk(node: Record<string, unknown>): void {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'url' && node.date_added) {
      const dateAdded = Number(node.date_added);
      // Convert Chrome timestamp to Unix ms
      const unixMs = (dateAdded - chromeEpochOffset) / 1000;
      if (unixMs > cutoff) {
        results.push({
          name: String(node.name ?? ''),
          url: String(node.url ?? ''),
          dateAdded: new Date(unixMs).toISOString(),
        });
      }
    }

    if (node.children && Array.isArray(node.children)) {
      for (const child of node.children) {
        walk(child as Record<string, unknown>);
      }
    }

    // Traverse roots
    if (node.roots && typeof node.roots === 'object') {
      for (const root of Object.values(node.roots as Record<string, unknown>)) {
        if (root && typeof root === 'object') {
          walk(root as Record<string, unknown>);
        }
      }
    }
  }

  walk(data as Record<string, unknown>);
  return results;
}

function makeTask(
  title: string,
  description: string,
  impact: number,
): Task {
  return {
    projectPath: HOME,
    projectName: 'system',
    source: 'productivity',
    category: 'docs',
    title,
    description,
    impact,
    confidence: 3,
    risk: 3,
    duration: 3,
    status: 'queued',
    prompt: `REPORT ONLY — analyze and generate notes, DO NOT modify any files or bookmarks.\n\n${description}`,
  };
}
