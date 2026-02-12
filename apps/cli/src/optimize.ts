import { Executor, type ExecutionResult } from '@creditforge/executor';
import { Governor, estimateRemainingBudget, getDailyBudgetCents } from '@creditforge/core';
import type { Task, BatchPlan } from '@creditforge/core';
import { TokenMonitor } from '@creditforge/token-monitor';
import type { TokenSnapshot } from '@creditforge/token-monitor';
import { getDb, getQueuedTasks, updateTaskStatus, insertExecution, insertLedgerEntry, getTaskStats } from '@creditforge/db';
import { scanAll, type ScannerOptions } from '@creditforge/scanner';
import { upsertProject, insertTask, clearTasksForProject } from '@creditforge/db';
import { computeScore } from '@creditforge/core';
import { loadConfig } from './config.js';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

export async function runOptimize(args: string[]): Promise<void> {
  const config = loadConfig();
  const dryRun = args.includes('--dry-run');
  const skipScan = args.includes('--skip-scan');
  const autoApprove = args.includes('--yes');
  const tier = config.subscription?.tier ?? 'max5';

  const startTime = Date.now();

  // ─── STEP 1: Token Usage ───────────────────────────────────
  console.log('STEP 1: Reading token usage...');
  const monitor = new TokenMonitor(tier);
  const snapshot = monitor.getSnapshot();

  if (!snapshot) {
    console.log('  Warning: Could not read Claude stats. Using config budget estimate.');
  } else {
    console.log(`  Today: ${formatTokens(snapshot.todayTokens)} tokens (${snapshot.estimatedDailyBudgetUsedPercent}% of daily budget)`);
  }
  console.log('');

  // ─── STEP 2: Budget Calculation ────────────────────────────
  console.log('STEP 2: Calculating budget...');
  let remainingBudgetCents: number;

  if (snapshot) {
    remainingBudgetCents = estimateRemainingBudget(tier, snapshot.todayTokens);
    const dailyCents = getDailyBudgetCents(tier);
    console.log(`  Daily budget: $${(dailyCents / 100).toFixed(2)}`);
    console.log(`  Remaining: $${(remainingBudgetCents / 100).toFixed(2)} (from real usage data)`);
  } else {
    remainingBudgetCents = config.credits.estimatedBalanceUsdCents;
    console.log(`  Using config estimate: $${(remainingBudgetCents / 100).toFixed(2)}`);
  }
  console.log('');

  // ─── STEP 3: Task Discovery ────────────────────────────────
  console.log('STEP 3: Discovering tasks...');
  const db = getDb();

  if (!skipScan) {
    const scanRoots = config.scanner.scanRoots;
    if (scanRoots.length === 0) {
      console.error('  No scan roots configured. Add paths to creditforge.toml [scanner] scan_roots');
      process.exit(1);
    }

    const options: ScannerOptions = {
      skipNpmAudit: config.scanner.skipNpmAudit,
      skipGit: false,
      skipTodos: false,
      maxTodosPerProject: config.scanner.maxTodosPerProject,
    };

    const results = scanAll(scanRoots, options);
    let taskCount = 0;

    for (const result of results) {
      const projectId = upsertProject(db, result.project);
      clearTasksForProject(db, result.project.path);
      for (const task of result.tasks) {
        task.score = task.score ?? computeScore(task);
        insertTask(db, task, projectId);
      }
      taskCount += result.tasks.length;
    }

    console.log(`  Scanned ${results.length} projects, discovered ${taskCount} tasks`);
  } else {
    const stats = getTaskStats(db);
    console.log(`  Using cached tasks: ${stats.total} total (${stats.byStatus['queued'] ?? 0} queued)`);
  }
  console.log('');

  // ─── STEP 4: Build Plan ────────────────────────────────────
  console.log('STEP 4: Building optimization plan...');
  const tasks = getQueuedTasks(db);

  if (tasks.length === 0) {
    console.log('  No queued tasks found. Nothing to optimize.');
    return;
  }

  const governor = new Governor({
    creditCapPercent: config.nightMode.creditCapPercent,
    maxBudgetPerTaskUsdCents: Math.round(config.nightMode.maxBudgetPerTaskUsd * 100),
    hardStopMinutesBeforeReset: config.credits.hardStopMinutesBefore,
    windowResetHour: config.credits.windowResetHour,
  });

  const windowResetAt = getWindowResetTime(config.credits.windowResetHour);
  const plan = governor.buildBatchPlan(tasks, remainingBudgetCents, windowResetAt);
  const branch = `nightmode/${new Date().toISOString().slice(0, 10)}`;

  console.log(`  Planned: ${plan.tasks.length} tasks | Skipped: ${plan.tasksSkipped}`);
  console.log('');

  // ─── STEP 5: Approval Report ──────────────────────────────
  printApprovalReport(plan, remainingBudgetCents, config.nightMode.creditCapPercent, branch);

  if (dryRun) {
    console.log('\n[DRY RUN] No tasks will be executed.');
    printTimingReport(startTime);
    return;
  }

  // ─── STEP 6: Confirmation ─────────────────────────────────
  if (!autoApprove) {
    const confirmed = await askConfirmation('Proceed with optimization?');
    if (!confirmed) {
      console.log('Optimization cancelled.');
      return;
    }
    console.log('');
  }

  // ─── STEP 7: Execute ──────────────────────────────────────
  console.log('EXECUTION');
  console.log('='.repeat(50));

  const executor = new Executor({
    cli: {
      model: config.nightMode.modelPreference,
      maxBudgetUsd: config.nightMode.maxBudgetPerTaskUsd,
    },
    dryRun: false,
  });

  const results: ExecutionResult[] = [];
  const executionStart = Date.now();

  for (let i = 0; i < plan.tasks.length; i++) {
    const task = plan.tasks[i];
    updateTaskStatus(db, task.id!, 'running');

    const result = await executor.executeTask(task);
    results.push(result);

    const status = result.success ? 'OK' : 'FAIL';
    const cost = `$${(result.execution.costUsdCents / 100).toFixed(2)}`;
    const dur = `${Math.round(result.execution.durationMs / 1000)}s`;
    console.log(`[${i + 1}/${plan.tasks.length}] [${status}] ${task.projectName} | ${task.title} (${cost}, ${dur})`);

    // Persist
    const taskStatus = result.success ? 'completed' : 'failed';
    updateTaskStatus(db, task.id!, taskStatus);
    const execId = insertExecution(db, result.execution);

    if (result.execution.costUsdCents > 0) {
      insertLedgerEntry(db, {
        accountId: 'self',
        counterpartyId: 'claude-api',
        entryType: 'debit',
        amount: result.execution.costUsdCents,
        currency: 'usd_cents',
        description: `optimize: ${task.title}`,
        taskId: task.id,
        executionId: execId,
      });
    }

    // Stop after 3 failures
    const failures = results.filter((r) => !r.success).length;
    if (failures >= 3) {
      console.log('\nStopping: too many failures (3+).');
      break;
    }
  }

  // ─── STEP 8: Report ───────────────────────────────────────
  console.log('');
  printCompletionReport(results, executionStart, branch);

  // Save report
  const report = executor.generateMorningReport(results);
  const reportDir = path.join(process.env.HOME ?? '~', '.creditforge', 'reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `${new Date().toISOString().split('T')[0]}.md`);
  fs.writeFileSync(reportPath, report);
  console.log(`Report saved: ${reportPath}`);
}

// ─── Helpers ────────────────────────────────────────────────

function printApprovalReport(
  plan: BatchPlan,
  remainingBudgetCents: number,
  capPercent: number,
  branch: string,
): void {
  console.log('OPTIMIZATION PLAN');
  console.log('='.repeat(50));
  console.log(`Budget: $${(plan.budgetCapUsdCents / 100).toFixed(2)} remaining (${capPercent}% of $${(remainingBudgetCents / 100).toFixed(2)} estimated)`);
  console.log(`Tasks:  ${plan.tasks.length} planned | ${plan.tasksSkipped} skipped (budget/risk)`);
  console.log(`Cost:   ~$${(plan.totalEstimatedCostUsdCents / 100).toFixed(2)} estimated`);
  console.log(`Time:   ~${plan.tasks.length * 3} minutes`);
  console.log(`Branch: ${branch}`);
  console.log('');

  // Task table
  const header = ` #  Score  Risk  Project           Task`;
  console.log(header);

  for (let i = 0; i < plan.tasks.length; i++) {
    const t = plan.tasks[i];
    const num = String(i + 1).padStart(2);
    const score = (t.score ?? 0).toFixed(1).padStart(4);
    const risk = `${t.risk}/5`;
    const project = t.projectName.padEnd(16).slice(0, 16);
    const title = t.title.length > 40 ? t.title.slice(0, 37) + '...' : t.title;
    console.log(`${num}   ${score}   ${risk}   ${project}  ${title}`);
  }
}

function printCompletionReport(
  results: ExecutionResult[],
  executionStart: number,
  branch: string,
): void {
  const succeeded = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalCost = results.reduce((sum, r) => sum + r.execution.costUsdCents, 0);
  const totalTokens = results.reduce((sum, r) => sum + r.execution.totalTokens, 0);
  const durationMs = Date.now() - executionStart;

  console.log('COMPLETION REPORT');
  console.log('='.repeat(50));
  console.log(`Succeeded: ${succeeded.length}/${results.length}`);
  console.log(`Failed:    ${failed.length}`);
  console.log(`Cost:      $${(totalCost / 100).toFixed(2)}`);
  console.log(`Tokens:    ${totalTokens.toLocaleString()}`);
  console.log(`Duration:  ${Math.round(durationMs / 1000)}s`);
  console.log(`Branch:    ${branch}`);

  if (failed.length > 0) {
    console.log('\nFailed tasks:');
    for (const r of failed) {
      console.log(`  - ${r.task.projectName} | ${r.task.title}`);
      if (r.error) console.log(`    Error: ${r.error.slice(0, 120)}`);
    }
  }
}

function printTimingReport(startTime: number): void {
  const elapsed = Date.now() - startTime;
  console.log(`\nPlan generated in ${Math.round(elapsed / 1000)}s`);
}

async function askConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`\n${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

function getWindowResetTime(resetHour: number): Date {
  const now = new Date();
  const reset = new Date(now);
  reset.setHours(resetHour, 0, 0, 0);
  if (reset <= now) {
    reset.setDate(reset.getDate() + 1);
  }
  return reset;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
