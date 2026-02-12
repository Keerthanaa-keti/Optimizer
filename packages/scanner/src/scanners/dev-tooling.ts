import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { Task } from '@creditforge/core';

const HOME = process.env.HOME ?? '~';

/**
 * Dev tooling scanner: brew outdated, npm global, Xcode cleanup, Docker prune.
 * All tasks get minimum risk=3 and are report-only.
 */
export function scanDevTooling(): Task[] {
  const tasks: Task[] = [];

  // Check brew outdated
  try {
    const output = execSync('brew outdated 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();

    if (output) {
      const packages = output.split('\n').filter((l) => l.trim());
      if (packages.length > 3) {
        tasks.push(makeTask(
          `${packages.length} outdated Homebrew packages`,
          `There are ${packages.length} outdated Homebrew packages: ${packages.slice(0, 10).join(', ')}${packages.length > 10 ? '...' : ''}. Analyze which are safe to update and suggest a prioritized update plan. DO NOT run brew upgrade.`,
          'update',
          3,
        ));
      }
    }
  } catch { /* brew not installed or timed out */ }

  // Check npm global outdated
  try {
    const output = execSync('npm outdated -g --json 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();

    if (output && output !== '{}') {
      const outdated = JSON.parse(output);
      const count = Object.keys(outdated).length;
      if (count > 0) {
        const names = Object.keys(outdated).slice(0, 10).join(', ');
        tasks.push(makeTask(
          `${count} outdated global npm packages`,
          `There are ${count} outdated global npm packages: ${names}. Analyze which should be updated based on semver changes and breaking change risk. DO NOT run npm update -g.`,
          'update',
          2,
        ));
      }
    }
  } catch { /* ignore */ }

  // Check Xcode DeviceSupport directory size
  const xcodeDeviceSupport = path.join(HOME, 'Library', 'Developer', 'Xcode', 'iOS DeviceSupport');
  try {
    if (fs.existsSync(xcodeDeviceSupport)) {
      const output = execSync(`du -sk "${xcodeDeviceSupport}" 2>/dev/null | cut -f1`, {
        encoding: 'utf-8',
        timeout: 10000,
      }).trim();
      const sizeKB = parseInt(output, 10);
      const sizeGB = sizeKB / (1024 * 1024);

      if (sizeGB > 10) {
        tasks.push(makeTask(
          `Xcode iOS DeviceSupport using ${sizeGB.toFixed(1)}GB`,
          `The Xcode iOS DeviceSupport directory at ${xcodeDeviceSupport} is using ${sizeGB.toFixed(1)}GB. List the device support files by version and size, identifying which old versions can be safely removed. DO NOT delete any files.`,
          'maintenance',
          3,
        ));
      }
    }
  } catch { /* ignore */ }

  // Check Docker disk usage
  try {
    const output = execSync('docker system df 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();

    if (output) {
      // Parse reclaimable from output
      const lines = output.split('\n');
      let totalReclaimable = 0;

      for (const line of lines) {
        const match = line.match(/(\d+(?:\.\d+)?)\s*(GB|MB)\s*\((\d+)%\)$/);
        if (match) {
          const size = parseFloat(match[1]);
          const unit = match[2];
          const sizeGB = unit === 'GB' ? size : size / 1024;
          totalReclaimable += sizeGB;
        }
      }

      if (totalReclaimable > 5) {
        tasks.push(makeTask(
          `Docker has ${totalReclaimable.toFixed(1)}GB reclaimable space`,
          `Docker is using significant disk space with ${totalReclaimable.toFixed(1)}GB reclaimable. Analyze what can be safely pruned (dangling images, stopped containers, unused volumes). DO NOT run docker system prune.`,
          'maintenance',
          3,
        ));
      }
    }
  } catch { /* Docker not installed or not running */ }

  return tasks;
}

function makeTask(
  title: string,
  description: string,
  category: 'update' | 'maintenance',
  impact: number,
): Task {
  return {
    projectPath: HOME,
    projectName: 'system',
    source: 'dev-tooling',
    category,
    title,
    description,
    impact,
    confidence: 4,
    risk: 3,
    duration: 2,
    status: 'queued',
    prompt: `REPORT ONLY — analyze and suggest, DO NOT execute updates or delete files.\n\n${description}`,
  };
}
