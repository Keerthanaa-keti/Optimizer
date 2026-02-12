import { scanAll, scanSystemTasks, type ScanResult, type ScannerOptions } from '@creditforge/scanner';
import { getDb, upsertProject, insertTask, clearTasksForProject, getTaskStats } from '@creditforge/db';
import { computeScore } from '@creditforge/core';
import { loadConfig } from './config.js';

export async function runScan(args: string[]): Promise<void> {
  const config = loadConfig();
  const verbose = args.includes('--verbose') || args.includes('-v');
  const quick = args.includes('--quick');
  const includeSystem = args.includes('--system') || config.scanner.includeSystemTasks;

  const scanRoots = config.scanner.scanRoots;
  if (scanRoots.length === 0) {
    console.error('No scan roots configured. Add paths to creditforge.toml [scanner] scan_roots');
    process.exit(1);
  }

  console.log(`Scanning ${scanRoots.length} projects...\n`);

  const options: ScannerOptions = {
    skipNpmAudit: quick || config.scanner.skipNpmAudit,
    skipGit: false,
    skipTodos: false,
    maxTodosPerProject: config.scanner.maxTodosPerProject,
  };

  const results = scanAll(scanRoots, options);
  const db = getDb();

  let totalTasks = 0;
  let totalErrors = 0;

  for (const result of results) {
    printProjectResult(result, verbose);

    // Persist to database
    const projectId = upsertProject(db, result.project);
    clearTasksForProject(db, result.project.path);

    for (const task of result.tasks) {
      task.score = task.score ?? computeScore(task);
      insertTask(db, task, projectId);
    }

    totalTasks += result.tasks.length;
    totalErrors += result.errors.length;
  }

  // System scanners (if --system flag is present)
  if (includeSystem) {
    console.log('\nScanning system tasks...');
    const systemResult = scanSystemTasks();
    results.push(systemResult);

    printProjectResult(systemResult, verbose);

    const projectId = upsertProject(db, systemResult.project);
    clearTasksForProject(db, systemResult.project.path);
    for (const task of systemResult.tasks) {
      task.score = task.score ?? computeScore(task);
      insertTask(db, task, projectId);
    }

    totalTasks += systemResult.tasks.length;
    totalErrors += systemResult.errors.length;
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SCAN SUMMARY');
  console.log('='.repeat(60));
  console.log(`Projects scanned: ${results.length}`);
  console.log(`Total tasks discovered: ${totalTasks}`);
  console.log(`Errors: ${totalErrors}`);

  const stats = getTaskStats(db);
  console.log('\nBy source:');
  for (const [source, count] of Object.entries(stats.bySource)) {
    console.log(`  ${source}: ${count}`);
  }
  console.log('\nBy category:');
  const byCat: Record<string, number> = {};
  for (const result of results) {
    for (const task of result.tasks) {
      byCat[task.category] = (byCat[task.category] ?? 0) + 1;
    }
  }
  for (const [cat, count] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  // Show top 10 tasks
  console.log('\nTop 10 tasks by score:');
  const allTasks = results
    .flatMap((r) => r.tasks)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 10);

  for (let i = 0; i < allTasks.length; i++) {
    const t = allTasks[i];
    console.log(`  ${i + 1}. [${t.score?.toFixed(1)}] ${t.projectName} | ${t.title}`);
  }
}

function printProjectResult(result: ScanResult, verbose: boolean): void {
  const icon = result.errors.length > 0 ? '!' : result.tasks.length > 0 ? '+' : '-';
  console.log(`[${icon}] ${result.project.name} (${result.project.path})`);
  console.log(`    Tasks: ${result.tasks.length} | Scan time: ${result.durationMs}ms`);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.log(`    Error: ${err}`);
    }
  }

  if (verbose && result.tasks.length > 0) {
    const bySource: Record<string, number> = {};
    for (const t of result.tasks) {
      bySource[t.source] = (bySource[t.source] ?? 0) + 1;
    }
    const parts = Object.entries(bySource).map(([s, c]) => `${s}:${c}`);
    console.log(`    Sources: ${parts.join(', ')}`);

    // Show top 3 tasks for this project
    const top = result.tasks.slice(0, 3);
    for (const t of top) {
      console.log(`      [${t.score?.toFixed(1)}] ${t.title}`);
    }
  }
}
