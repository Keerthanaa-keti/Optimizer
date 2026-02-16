import { getDb, getRecentExecutions, getTotalSpent, getTaskById, getTaskStats } from '@creditforge/db';
import fs from 'node:fs';
import path from 'node:path';

export async function runReport(args: string[]): Promise<void> {
  const json = args.includes('--json');
  const date = getFlag(args, '--date') ?? new Date().toISOString().split('T')[0];

  // Check for saved report first
  const reportPath = path.join(process.env.HOME ?? '~', '.creditforge', 'reports', `${date}.md`);
  if (fs.existsSync(reportPath) && !json) {
    console.log(fs.readFileSync(reportPath, 'utf-8'));
    return;
  }

  // Generate report from DB
  const db = getDb();
  const stats = getTaskStats(db);
  const recentExecs = getRecentExecutions(db, 50);
  const todayExecs = recentExecs.filter(e => e.startedAt?.startsWith(date));
  const todaySpent = getTotalSpent(db, date);

  const succeeded = todayExecs.filter(e => e.exitCode === 0);
  const failed = todayExecs.filter(e => e.exitCode !== 0);

  if (json) {
    console.log(JSON.stringify({
      date,
      executions: todayExecs.length,
      succeeded: succeeded.length,
      failed: failed.length,
      totalCostUsd: todaySpent.usdCents / 100,
      totalTokens: todaySpent.tokens,
      taskStats: stats,
    }, null, 2));
    return;
  }

  // Pretty print
  console.log('CreditForge Morning Report');
  console.log('='.repeat(50));
  console.log(`Date: ${date}`);
  console.log('');

  console.log('Task Queue');
  console.log('-'.repeat(30));
  console.log(`  Total:     ${stats.total}`);
  for (const [status, count] of Object.entries(stats.byStatus)) {
    console.log(`  ${status.padEnd(12)} ${count}`);
  }
  console.log('');

  console.log("Today's Executions");
  console.log('-'.repeat(30));
  console.log(`  Total:     ${todayExecs.length}`);
  console.log(`  Succeeded: ${succeeded.length}`);
  console.log(`  Failed:    ${failed.length}`);
  console.log(`  Cost:      $${(todaySpent.usdCents / 100).toFixed(2)}`);
  console.log(`  Tokens:    ${todaySpent.tokens.toLocaleString()}`);
  console.log('');

  if (succeeded.length > 0) {
    console.log('Completed');
    console.log('-'.repeat(30));
    for (const exec of succeeded) {
      const task = getTaskById(db, exec.taskId);
      const name = task ? `[${task.projectName}] ${task.title}` : `Task #${exec.taskId}`;
      console.log(`  ${name}`);
      console.log(`    Model: ${exec.model} | $${(exec.costUsdCents / 100).toFixed(2)} | ${Math.round(exec.durationMs / 1000)}s`);
      if (exec.commitHash) {
        console.log(`    Branch: ${exec.branch} | Commit: ${exec.commitHash.slice(0, 8)}`);
      }
    }
    console.log('');
  }

  if (failed.length > 0) {
    console.log('Failed');
    console.log('-'.repeat(30));
    for (const exec of failed) {
      const task = getTaskById(db, exec.taskId);
      const name = task ? `[${task.projectName}] ${task.title}` : `Task #${exec.taskId}`;
      console.log(`  ${name}`);
      console.log(`    Exit: ${exec.exitCode} | ${exec.stderr?.slice(0, 100) || '(no error)'}`);
    }
    console.log('');
  }

  // Source breakdown
  console.log('Tasks by Source');
  console.log('-'.repeat(30));
  for (const [source, count] of Object.entries(stats.bySource)) {
    console.log(`  ${source.padEnd(20)} ${count}`);
  }

  console.log('');
  console.log('Review nightmode branches:');
  console.log('  git log nightmode/ --oneline');
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx >= args.length - 1) return undefined;
  return args[idx + 1];
}
