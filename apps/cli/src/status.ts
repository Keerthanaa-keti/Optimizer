import { getDb, getTaskStats, getAllProjects, getRecentExecutions, getTotalSpent } from '@creditforge/db';
import { loadConfig } from './config.js';
import fs from 'node:fs';
import path from 'node:path';

export async function runStatus(args: string[]): Promise<void> {
  const db = getDb();
  const config = loadConfig();
  const showReport = args.includes('--report');

  if (showReport) {
    showMorningReport();
    return;
  }

  console.log('CreditForge Status');
  console.log('='.repeat(50));

  // Projects
  const projects = getAllProjects(db);
  console.log(`\nProjects: ${projects.length}`);
  for (const p of projects) {
    const scanAge = p.lastScannedAt
      ? timeSince(new Date(p.lastScannedAt))
      : 'never';
    console.log(`  ${p.name}: ${p.taskCount} tasks (scanned ${scanAge})`);
  }

  // Task stats
  const stats = getTaskStats(db);
  console.log(`\nTasks: ${stats.total}`);
  for (const [status, count] of Object.entries(stats.byStatus)) {
    console.log(`  ${status}: ${count}`);
  }

  // Recent executions
  const recent = getRecentExecutions(db, 5);
  if (recent.length > 0) {
    console.log('\nRecent executions:');
    for (const exec of recent) {
      const status = exec.exitCode === 0 ? 'OK' : 'FAIL';
      const cost = `$${(exec.costUsdCents / 100).toFixed(2)}`;
      const duration = `${Math.round(exec.durationMs / 1000)}s`;
      console.log(`  [${status}] Task #${exec.taskId} | ${cost} | ${duration} | ${exec.model}`);
    }
  }

  // Spending
  const today = new Date().toISOString().split('T')[0] + 'T00:00:00';
  const todaySpent = getTotalSpent(db, today);
  const totalSpent = getTotalSpent(db);
  console.log('\nSpending:');
  console.log(`  Today: $${(todaySpent.usdCents / 100).toFixed(2)} (${todaySpent.tokens.toLocaleString()} tokens)`);
  console.log(`  Total: $${(totalSpent.usdCents / 100).toFixed(2)} (${totalSpent.tokens.toLocaleString()} tokens)`);

  // Night mode status
  console.log('\nNight Mode:');
  console.log(`  Enabled: ${config.nightMode.enabled ? 'yes' : 'no'}`);
  console.log(`  Hours: ${config.nightMode.startHour}:00 - ${config.nightMode.endHour}:00`);
  console.log(`  Credit cap: ${config.nightMode.creditCapPercent}%`);
  console.log(`  Model: ${config.nightMode.modelPreference}`);
  console.log(`  Max per task: $${config.nightMode.maxBudgetPerTaskUsd.toFixed(2)}`);
}

function showMorningReport(): void {
  const reportDir = path.join(process.env.HOME ?? '~', '.creditforge', 'reports');
  const today = new Date().toISOString().split('T')[0];
  const reportPath = path.join(reportDir, `${today}.md`);

  if (fs.existsSync(reportPath)) {
    console.log(fs.readFileSync(reportPath, 'utf-8'));
  } else {
    console.log('No morning report for today. Night mode may not have run yet.');

    // Try to find the most recent report
    if (fs.existsSync(reportDir)) {
      const files = fs.readdirSync(reportDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse();

      if (files.length > 0) {
        console.log(`\nMost recent report: ${files[0]}`);
        console.log('Use: creditforge status --report to view it');
      }
    }
  }
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
