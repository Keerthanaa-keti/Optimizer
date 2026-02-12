import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { Task } from '@creditforge/core';

const HOME = process.env.HOME ?? '~';

/**
 * System maintenance scanner: disk usage, log rotation, cache cleanup.
 * All tasks get minimum risk=3 and are report-only.
 */
export function scanSystemMaintenance(): Task[] {
  const tasks: Task[] = [];

  // Check disk usage
  try {
    const df = execSync('df -h / | tail -1', { encoding: 'utf-8' }).trim();
    const parts = df.split(/\s+/);
    const usedPercent = parseInt(parts[4]?.replace('%', '') ?? '0', 10);

    if (usedPercent > 80) {
      tasks.push(makeTask(
        `Disk usage at ${usedPercent}% — analyze and suggest cleanup targets`,
        `Root volume is ${usedPercent}% full. Analyze disk usage with du and suggest cleanup targets. DO NOT delete or modify any files.`,
        'system',
        usedPercent > 90 ? 5 : 4,
      ));
    }
  } catch { /* ignore */ }

  // Check large log files in ~/Library/Logs/
  const logDirs = [
    path.join(HOME, 'Library', 'Logs'),
    path.join(HOME, '.creditforge', 'logs'),
  ];

  for (const logDir of logDirs) {
    try {
      if (!fs.existsSync(logDir)) continue;
      const entries = fs.readdirSync(logDir);
      let totalSize = 0;
      let largeFiles = 0;

      for (const entry of entries) {
        try {
          const stat = fs.statSync(path.join(logDir, entry));
          totalSize += stat.size;
          if (stat.size > 100 * 1024 * 1024) largeFiles++; // >100MB
        } catch { /* ignore */ }
      }

      if (largeFiles > 0 || totalSize > 500 * 1024 * 1024) {
        const sizeMB = Math.round(totalSize / (1024 * 1024));
        tasks.push(makeTask(
          `${logDir.replace(HOME, '~')}: ${sizeMB}MB in logs, ${largeFiles} files >100MB`,
          `Log directory ${logDir} contains ${sizeMB}MB total with ${largeFiles} files over 100MB. Analyze which logs are safe to rotate or compress. DO NOT delete any files.`,
          'maintenance',
          3,
        ));
      }
    } catch { /* ignore */ }
  }

  // Check large cache directories
  const cacheDirs = [
    { path: path.join(HOME, 'Library', 'Caches'), threshold: 1024 * 1024 * 1024 }, // 1GB
  ];

  for (const cacheDir of cacheDirs) {
    try {
      if (!fs.existsSync(cacheDir.path)) continue;
      const output = execSync(`du -sk "${cacheDir.path}" 2>/dev/null | cut -f1`, {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
      const sizeKB = parseInt(output, 10);

      if (sizeKB * 1024 > cacheDir.threshold) {
        const sizeGB = (sizeKB / (1024 * 1024)).toFixed(1);
        tasks.push(makeTask(
          `Cache directory ${cacheDir.path.replace(HOME, '~')}: ${sizeGB}GB`,
          `Cache directory at ${cacheDir.path} is using ${sizeGB}GB. Analyze which caches are safe to clear. DO NOT delete any files.`,
          'maintenance',
          3,
        ));
      }
    } catch { /* ignore */ }
  }

  return tasks;
}

function makeTask(
  title: string,
  description: string,
  category: 'system' | 'maintenance',
  impact: number,
): Task {
  return {
    projectPath: HOME,
    projectName: 'system',
    source: 'system-maintenance',
    category,
    title,
    description,
    impact,
    confidence: 3,
    risk: 3, // System tasks always minimum risk 3
    duration: 2,
    status: 'queued',
    prompt: `REPORT ONLY — analyze and suggest, DO NOT delete or modify files.\n\n${description}`,
  };
}
