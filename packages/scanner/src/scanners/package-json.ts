import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '@creditforge/core';

/**
 * Scans package.json for available scripts (test, lint, build, typecheck).
 * Creates tasks to run these scripts and verify project health.
 */
export function scanPackageJson(projectPath: string, projectName: string): Task[] {
  const pkgPath = path.join(projectPath, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const scripts = pkg.scripts ?? {};
  const tasks: Task[] = [];

  // Test scripts
  for (const key of ['test', 'test:unit', 'test:e2e', 'test:integration']) {
    if (scripts[key]) {
      tasks.push({
        projectPath,
        projectName,
        source: 'package-json',
        category: 'test',
        title: `Run ${key} in ${projectName}`,
        description: `Execute \`npm run ${key}\` to verify test suite passes. Script: ${scripts[key]}`,
        impact: 4,
        confidence: 4,
        risk: 1,
        duration: 2,
        status: 'queued',
        prompt: `In the project at ${projectPath}, run "npm run ${key}" and fix any failing tests. If all tests pass, report success. Do not modify test expectations without understanding the intent.`,
      });
    }
  }

  // Lint scripts
  for (const key of ['lint', 'lint:fix', 'eslint']) {
    if (scripts[key]) {
      tasks.push({
        projectPath,
        projectName,
        source: 'package-json',
        category: 'lint',
        title: `Run ${key} in ${projectName}`,
        description: `Execute \`npm run ${key}\` to check code quality. Script: ${scripts[key]}`,
        impact: 2,
        confidence: 4,
        risk: 1,
        duration: 1,
        status: 'queued',
        prompt: `In the project at ${projectPath}, run "npm run ${key}" and fix any lint errors. Only fix auto-fixable issues. Report what was fixed.`,
      });
    }
  }

  // TypeScript check
  for (const key of ['typecheck', 'tsc', 'check:types']) {
    if (scripts[key]) {
      tasks.push({
        projectPath,
        projectName,
        source: 'package-json',
        category: 'build',
        title: `Run TypeScript check in ${projectName}`,
        description: `Execute \`npm run ${key}\` to check for type errors. Script: ${scripts[key]}`,
        impact: 3,
        confidence: 3,
        risk: 2,
        duration: 2,
        status: 'queued',
        prompt: `In the project at ${projectPath}, run "npm run ${key}" and fix any TypeScript type errors. Be careful with type changes that could affect runtime behavior.`,
      });
    }
  }

  // Build script — verify it compiles
  if (scripts.build) {
    tasks.push({
      projectPath,
      projectName,
      source: 'package-json',
      category: 'build',
      title: `Verify build in ${projectName}`,
      description: `Execute \`npm run build\` to verify project compiles successfully. Script: ${scripts.build}`,
      impact: 3,
      confidence: 4,
      risk: 1,
      duration: 2,
      status: 'queued',
      prompt: `In the project at ${projectPath}, run "npm run build" and fix any build errors. Report success or what was fixed.`,
    });
  }

  // Check for missing test infrastructure
  const hasTestScript = Object.keys(scripts).some((k) => k.startsWith('test'));
  if (!hasTestScript) {
    tasks.push({
      projectPath,
      projectName,
      source: 'package-json',
      category: 'test',
      title: `Add test infrastructure to ${projectName}`,
      description: 'No test scripts found in package.json. Set up basic testing framework.',
      impact: 4,
      confidence: 2,
      risk: 2,
      duration: 3,
      status: 'queued',
      prompt: `The project at ${projectPath} has no test scripts. Analyze the tech stack from package.json and add appropriate test infrastructure (vitest for Vite projects, jest for others). Add a "test" script to package.json and create one example test file.`,
    });
  }

  return tasks;
}
