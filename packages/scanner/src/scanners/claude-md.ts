import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@creditforge/core';

/**
 * Parses CLAUDE.md files for "Next Steps", "TODO", "Current Status" sections.
 * Also detects bugs-codex.md and FIX_*.md files for documented fixes.
 */
export function scanClaudeMd(projectPath: string, projectName: string): Task[] {
  const tasks: Task[] = [];

  // Scan CLAUDE.md
  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    const content = fs.readFileSync(claudeMdPath, 'utf-8');
    tasks.push(...extractNextSteps(content, projectPath, projectName));
    tasks.push(...extractTodoItems(content, projectPath, projectName));
  }

  // Scan bugs-codex.md
  const bugsCodexPath = path.join(projectPath, 'bugs-codex.md');
  if (fs.existsSync(bugsCodexPath)) {
    const content = fs.readFileSync(bugsCodexPath, 'utf-8');
    tasks.push(...extractBugs(content, projectPath, projectName, bugsCodexPath));
  }

  // Scan FIX_*.md files
  try {
    const entries = fs.readdirSync(projectPath);
    for (const entry of entries) {
      if (entry.startsWith('FIX_') && entry.endsWith('.md')) {
        const fixPath = path.join(projectPath, entry);
        const content = fs.readFileSync(fixPath, 'utf-8');
        tasks.push(...extractFixFile(content, projectPath, projectName, fixPath, entry));
      }
    }
  } catch {
    // directory read error, skip
  }

  return tasks;
}

function extractNextSteps(content: string, projectPath: string, projectName: string): Task[] {
  const tasks: Task[] = [];
  const nextStepsMatch = content.match(/##\s*Next\s*Steps([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  if (!nextStepsMatch) return tasks;

  const section = nextStepsMatch[1];
  const items = section.match(/^[\s]*[-*]\s+(.+)/gm);
  if (!items) return tasks;

  for (const item of items) {
    const text = item.replace(/^[\s]*[-*]\s+/, '').trim();
    if (text.length < 5) continue;

    tasks.push({
      projectPath,
      projectName,
      source: 'claude-md',
      category: categorizeFromText(text),
      title: truncate(`Next step: ${text}`, 120),
      description: `From CLAUDE.md "Next Steps" section: ${text}`,
      impact: 3,
      confidence: 3,
      risk: 2,
      duration: 3,
      status: 'queued',
      prompt: `In the project at ${projectPath}, implement the following planned work item from CLAUDE.md: "${text}". Follow existing code patterns and conventions.`,
    });
  }

  return tasks;
}

function extractTodoItems(content: string, projectPath: string, projectName: string): Task[] {
  const tasks: Task[] = [];

  // Look for unchecked markdown checkboxes
  const unchecked = content.match(/^[\s]*-\s*\[\s\]\s+(.+)/gm);
  if (!unchecked) return tasks;

  for (const item of unchecked) {
    const text = item.replace(/^[\s]*-\s*\[\s\]\s+/, '').trim();
    if (text.length < 5) continue;

    tasks.push({
      projectPath,
      projectName,
      source: 'claude-md',
      category: categorizeFromText(text),
      title: truncate(`TODO: ${text}`, 120),
      description: `Unchecked item from CLAUDE.md: ${text}`,
      impact: 3,
      confidence: 3,
      risk: 2,
      duration: 2,
      status: 'queued',
      prompt: `In the project at ${projectPath}, complete this task from CLAUDE.md: "${text}". Follow existing patterns.`,
    });
  }

  return tasks;
}

function extractBugs(content: string, projectPath: string, projectName: string, filePath: string): Task[] {
  const tasks: Task[] = [];

  // Match bug entries: "## Bug #N" or "### Bug #N" patterns
  const bugSections = content.split(/(?=#{2,3}\s*Bug\s*#?\d+)/i);

  for (const section of bugSections) {
    const headerMatch = section.match(/#{2,3}\s*Bug\s*#?(\d+)[:\s]*(.+)?/i);
    if (!headerMatch) continue;

    const bugNum = headerMatch[1];
    const bugTitle = headerMatch[2]?.trim() ?? `Bug #${bugNum}`;

    // Extract severity if present
    const severityMatch = section.match(/severity[:\s]*(high|medium|low|critical)/i);
    const severity = severityMatch?.[1]?.toLowerCase() ?? 'medium';

    // Extract location if present
    const locationMatch = section.match(/location[:\s]*`?([^`\n]+)`?/i);
    const location = locationMatch?.[1]?.trim();

    const impactMap: Record<string, number> = { critical: 5, high: 5, medium: 3, low: 2 };
    const confidenceMap: Record<string, number> = { critical: 4, high: 4, medium: 3, low: 3 };

    tasks.push({
      projectPath,
      projectName,
      source: 'bugs-codex',
      category: 'bug-fix',
      title: truncate(`Bug #${bugNum}: ${bugTitle}`, 120),
      description: truncate(section.trim(), 500),
      filePath: location,
      impact: impactMap[severity] ?? 3,
      confidence: 4, // bugs-codex typically has documented solutions
      risk: severity === 'critical' || severity === 'high' ? 3 : 2,
      duration: 2,
      status: 'queued',
      prompt: `In the project at ${projectPath}, fix Bug #${bugNum} documented in ${filePath}. The bug: "${bugTitle}". Read the bugs-codex.md file for the full bug description and suggested solution. Apply the fix following the documented approach.`,
    });
  }

  return tasks;
}

function extractFixFile(
  content: string,
  projectPath: string,
  projectName: string,
  filePath: string,
  fileName: string,
): Task[] {
  const title = fileName.replace(/^FIX_/, '').replace(/\.md$/, '').replace(/_/g, ' ');

  // Count the number of fix items (sections, bullet points)
  const sections = content.split(/(?=#{1,3}\s)/).filter((s) => s.trim().length > 0);
  const itemCount = Math.max(sections.length - 1, 1); // subtract header

  return [{
    projectPath,
    projectName,
    source: 'fix-md',
    category: 'bug-fix',
    title: truncate(`Fix: ${title}`, 120),
    description: `Fix file with ${itemCount} documented issues: ${filePath}`,
    filePath,
    impact: 4,
    confidence: 5, // fix files have exact solutions
    risk: 2,
    duration: Math.min(itemCount, 5) as 1 | 2 | 3 | 4 | 5,
    status: 'queued',
    prompt: `In the project at ${projectPath}, implement the fixes documented in ${filePath}. Read the file for detailed instructions and apply each fix. Follow the documented approach exactly.`,
  }];
}

function categorizeFromText(text: string): Task['category'] {
  const lower = text.toLowerCase();
  if (lower.includes('test') || lower.includes('spec')) return 'test';
  if (lower.includes('fix') || lower.includes('bug')) return 'bug-fix';
  if (lower.includes('lint') || lower.includes('format')) return 'lint';
  if (lower.includes('security') || lower.includes('audit') || lower.includes('vuln')) return 'security';
  if (lower.includes('refactor') || lower.includes('clean')) return 'refactor';
  if (lower.includes('doc') || lower.includes('readme')) return 'docs';
  if (lower.includes('build') || lower.includes('deploy') || lower.includes('ci')) return 'build';
  return 'refactor';
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
