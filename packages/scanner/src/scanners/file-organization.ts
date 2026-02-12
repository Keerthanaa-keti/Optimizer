import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@creditforge/core';

const HOME = process.env.HOME ?? '~';

/**
 * File organization scanner: Downloads clutter, screenshot org, duplicates.
 * All tasks get minimum risk=3 and are report-only.
 */
export function scanFileOrganization(): Task[] {
  const tasks: Task[] = [];

  // Check ~/Downloads for old files
  const downloadsDir = path.join(HOME, 'Downloads');
  try {
    if (fs.existsSync(downloadsDir)) {
      const entries = fs.readdirSync(downloadsDir);
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let oldFiles = 0;

      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        try {
          const stat = fs.statSync(path.join(downloadsDir, entry));
          if (stat.mtimeMs < thirtyDaysAgo) oldFiles++;
        } catch { /* ignore */ }
      }

      if (oldFiles > 50) {
        tasks.push(makeTask(
          `${oldFiles} files in ~/Downloads older than 30 days`,
          `The Downloads folder has ${oldFiles} files older than 30 days (out of ${entries.length} total). Categorize these files by type (documents, images, installers, archives) and suggest an organization plan. DO NOT move or delete any files.`,
          'organization',
          3,
        ));
      }
    }
  } catch { /* ignore */ }

  // Check ~/Desktop for screenshots
  const desktopDir = path.join(HOME, 'Desktop');
  try {
    if (fs.existsSync(desktopDir)) {
      const entries = fs.readdirSync(desktopDir);
      const screenshots = entries.filter((e) =>
        e.startsWith('Screenshot') && e.endsWith('.png'),
      );

      if (screenshots.length > 20) {
        tasks.push(makeTask(
          `${screenshots.length} screenshots cluttering ~/Desktop`,
          `The Desktop has ${screenshots.length} screenshot files matching "Screenshot*.png". Suggest organizing these by date into a ~/Screenshots folder. DO NOT move or delete any files.`,
          'organization',
          2,
        ));
      }
    }
  } catch { /* ignore */ }

  // Check ~/Documents for obvious duplicates
  const documentsDir = path.join(HOME, 'Documents');
  try {
    if (fs.existsSync(documentsDir)) {
      const entries = fs.readdirSync(documentsDir);
      const duplicatePatterns = entries.filter((e) =>
        /\(\d+\)\.\w+$/.test(e) ||     // "file (1).pdf"
        / copy\.\w+$/.test(e) ||         // "file copy.pdf"
        / copy \d+\.\w+$/.test(e)        // "file copy 2.pdf"
      );

      if (duplicatePatterns.length > 5) {
        tasks.push(makeTask(
          `${duplicatePatterns.length} potential duplicate files in ~/Documents`,
          `Found ${duplicatePatterns.length} files in ~/Documents that appear to be duplicates (naming patterns like "file (1).pdf", "file copy.pdf"). List the duplicates and their originals. DO NOT delete any files.`,
          'organization',
          2,
        ));
      }
    }
  } catch { /* ignore */ }

  return tasks;
}

function makeTask(
  title: string,
  description: string,
  category: 'organization' | 'cleanup',
  impact: number,
): Task {
  return {
    projectPath: HOME,
    projectName: 'system',
    source: 'file-organization',
    category,
    title,
    description,
    impact,
    confidence: 4,
    risk: 3,
    duration: 2,
    status: 'queued',
    prompt: `REPORT ONLY — analyze and suggest, DO NOT move or delete files.\n\n${description}`,
  };
}
