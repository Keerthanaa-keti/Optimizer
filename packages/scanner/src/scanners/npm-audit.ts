import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@creditforge/core';

interface AuditVuln {
  name: string;
  severity: string;
  title: string;
  url: string;
  range: string;
  fixAvailable: boolean | { name: string; version: string };
}

/**
 * Runs `npm audit --json` to detect security vulnerabilities.
 */
export function scanNpmAudit(projectPath: string, projectName: string): Task[] {
  const pkgPath = path.join(projectPath, 'package.json');
  const lockPath = path.join(projectPath, 'package-lock.json');

  // Need both package.json and lockfile
  if (!fs.existsSync(pkgPath) || !fs.existsSync(lockPath)) return [];

  let auditOutput: string;
  try {
    auditOutput = execSync('npm audit --json 2>/dev/null', {
      cwd: projectPath,
      timeout: 30000,
      encoding: 'utf-8',
    });
  } catch (err: unknown) {
    // npm audit exits with non-zero when vulns found, output is still in stdout
    const execError = err as { stdout?: string };
    if (execError.stdout) {
      auditOutput = execError.stdout;
    } else {
      return [];
    }
  }

  let auditData: { vulnerabilities?: Record<string, AuditVuln> };
  try {
    auditData = JSON.parse(auditOutput);
  } catch {
    return [];
  }

  if (!auditData.vulnerabilities) return [];

  const tasks: Task[] = [];
  const vulns = Object.entries(auditData.vulnerabilities);

  // Group by severity
  const criticalHigh = vulns.filter(([, v]) => v.severity === 'critical' || v.severity === 'high');
  const moderate = vulns.filter(([, v]) => v.severity === 'moderate');

  if (criticalHigh.length > 0) {
    const names = criticalHigh.map(([name]) => name).join(', ');
    const fixable = criticalHigh.filter(([, v]) => v.fixAvailable).length;

    tasks.push({
      projectPath,
      projectName,
      source: 'npm-audit',
      category: 'security',
      title: `Fix ${criticalHigh.length} critical/high vulnerabilities in ${projectName}`,
      description: `Packages: ${names}. ${fixable} auto-fixable.`,
      impact: 5,
      confidence: fixable > 0 ? 4 : 2,
      risk: 2,
      duration: fixable === criticalHigh.length ? 1 : 3,
      status: 'queued',
      prompt: `In the project at ${projectPath}, run "npm audit" to see security vulnerabilities. Fix critical and high severity issues. Use "npm audit fix" for auto-fixable ones. For others, check if major version updates are needed and assess compatibility. Do NOT use --force unless you verify the breaking changes are acceptable.`,
    });
  }

  if (moderate.length > 0) {
    const fixable = moderate.filter(([, v]) => v.fixAvailable).length;

    tasks.push({
      projectPath,
      projectName,
      source: 'npm-audit',
      category: 'security',
      title: `Fix ${moderate.length} moderate vulnerabilities in ${projectName}`,
      description: `${fixable} of ${moderate.length} are auto-fixable via npm audit fix.`,
      impact: 3,
      confidence: fixable > 0 ? 4 : 2,
      risk: 1,
      duration: 1,
      status: 'queued',
      prompt: `In the project at ${projectPath}, run "npm audit fix" to fix auto-fixable moderate security vulnerabilities. Report which packages were updated.`,
    });
  }

  return tasks;
}
