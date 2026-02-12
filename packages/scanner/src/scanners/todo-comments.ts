import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@creditforge/core';

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX|OPTIMIZE|BUG)\b[:\s]*(.+)/i;

/**
 * Check if the keyword match is inside a code comment (not in actual code).
 * Looks for comment markers before the keyword position on the line.
 */
function isInComment(line: string, matchIndex: number): boolean {
  const before = line.substring(0, matchIndex);
  // Single/multi-line comment markers before the keyword
  if (/\/\/|\/\*|<!--/.test(before)) return true;
  // Line starts with block comment continuation (*) or hash comment (#)
  const trimmed = line.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('#')) return true;
  return false;
}

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.swift', '.rs', '.go',
  '.css', '.scss', '.vue', '.svelte',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.turbo', '.cache', '__pycache__', '.venv',
  'vendor', 'target', 'Pods',
]);

/**
 * Recursively scans source files for TODO, FIXME, HACK, XXX comments.
 */
export function scanTodoComments(projectPath: string, projectName: string): Task[] {
  const tasks: Task[] = [];
  walkDir(projectPath, projectPath, projectName, tasks);
  return tasks;
}

function walkDir(dir: string, projectPath: string, projectName: string, tasks: Task[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walkDir(fullPath, projectPath, projectName, tasks);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!SCAN_EXTENSIONS.has(ext)) continue;
      scanFile(fullPath, projectPath, projectName, tasks);
    }
  }
}

function scanFile(filePath: string, projectPath: string, projectName: string, tasks: Task[]): void {
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(TODO_PATTERN);
    if (!match) continue;

    // Skip matches that aren't inside comments (e.g. todo.id, case bug = ...)
    if (!isInComment(lines[i], match.index!)) continue;

    const tag = match[1].toUpperCase();
    const text = match[2].trim();
    if (text.length < 3) continue;

    const relativePath = path.relative(projectPath, filePath);
    const impactMap: Record<string, number> = {
      BUG: 5, FIXME: 4, HACK: 3, TODO: 3, OPTIMIZE: 2, XXX: 3,
    };
    const categoryMap: Record<string, Task['category']> = {
      BUG: 'bug-fix', FIXME: 'bug-fix', HACK: 'refactor',
      TODO: 'refactor', OPTIMIZE: 'refactor', XXX: 'refactor',
    };

    tasks.push({
      projectPath,
      projectName,
      source: 'todo-comment',
      category: categoryMap[tag] ?? 'refactor',
      title: truncate(`${tag}: ${text}`, 120),
      description: `${tag} comment at ${relativePath}:${i + 1} — ${text}`,
      filePath: relativePath,
      lineNumber: i + 1,
      impact: impactMap[tag] ?? 3,
      confidence: tag === 'BUG' || tag === 'FIXME' ? 3 : 2,
      risk: 2,
      duration: 2,
      status: 'queued',
      prompt: `In the project at ${projectPath}, address the ${tag} comment at ${relativePath}:${i + 1}: "${text}". Read the surrounding code to understand context, then implement the fix or improvement. Do not just remove the comment — actually implement what it asks for.`,
    });
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
