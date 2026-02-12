import { Executor } from '@creditforge/executor';
import { Governor } from '@creditforge/core';
import { getDb, getQueuedTasks, getTaskById, updateTaskStatus, insertExecution, insertLedgerEntry } from '@creditforge/db';
import { loadConfig } from './config.js';
import fs from 'node:fs';
import path from 'node:path';

export async function runExecute(args: string[]): Promise<void> {
  const config = loadConfig();
  const mode = getFlag(args, '--mode') ?? 'single';
  const taskId = getFlag(args, '--task');
  const dryRun = args.includes('--dry-run');

  if (mode === 'night') {
    await runNightMode(config, dryRun);
  } else if (taskId) {
    await runSingleTask(Number(taskId), config, dryRun);
  } else {
    console.error('Usage: creditforge run --task <id> OR creditforge run --mode night [--dry-run]');
    process.exit(1);
  }
}

async function runSingleTask(
  taskId: number,
  config: ReturnType<typeof loadConfig>,
  dryRun: boolean,
): Promise<void> {
  const db = getDb();
  const task = getTaskById(db, taskId);

  if (!task) {
    console.error(`Task #${taskId} not found`);
    process.exit(1);
  }

  console.log(`Executing task #${taskId}: ${task.title}`);
  console.log(`Project: ${task.projectName}`);
  console.log(`Source: ${task.source} | Category: ${task.category}`);

  if (dryRun) {
    console.log('\n[DRY RUN] Would execute with prompt:');
    console.log(task.prompt ?? task.description);
    return;
  }

  const executor = new Executor({
    cli: {
      model: config.nightMode.modelPreference,
      maxBudgetUsd: config.nightMode.maxBudgetPerTaskUsd,
    },
    dryRun,
  });

  updateTaskStatus(db, taskId, 'running');
  const result = await executor.executeTask(task);

  if (result.success) {
    updateTaskStatus(db, taskId, 'completed');
    const execId = insertExecution(db, result.execution);

    // Record in ledger
    insertLedgerEntry(db, {
      accountId: 'self',
      counterpartyId: 'claude-api',
      entryType: 'debit',
      amount: result.execution.costUsdCents,
      currency: 'usd_cents',
      description: `Task #${taskId}: ${task.title}`,
      taskId,
      executionId: execId,
    });

    console.log(`\nTask completed successfully!`);
    console.log(`Cost: $${(result.execution.costUsdCents / 100).toFixed(2)}`);
    console.log(`Tokens: ${result.execution.totalTokens.toLocaleString()}`);
    console.log(`Duration: ${Math.round(result.execution.durationMs / 1000)}s`);
    if (result.execution.commitHash) {
      console.log(`Branch: ${result.execution.branch}`);
      console.log(`Commit: ${result.execution.commitHash.slice(0, 8)}`);
    }
  } else {
    updateTaskStatus(db, taskId, 'failed');
    console.error(`\nTask failed: ${result.error}`);
  }
}

async function runNightMode(
  config: ReturnType<typeof loadConfig>,
  dryRun: boolean,
): Promise<void> {
  if (!config.nightMode.enabled) {
    console.log('Night mode is disabled in config.');
    return;
  }

  const executor = new Executor({
    cli: {
      model: config.nightMode.modelPreference,
      maxBudgetUsd: config.nightMode.maxBudgetPerTaskUsd,
    },
    dryRun,
  });

  const planner = executor.nightPlanner;

  if (!planner.isNightTime() && !dryRun) {
    console.log(`Not in night mode hours (${config.nightMode.startHour}:00 - ${config.nightMode.endHour}:00).`);
    console.log('Use --dry-run to preview the batch plan.');
    return;
  }

  const db = getDb();
  const tasks = getQueuedTasks(db);

  if (tasks.length === 0) {
    console.log('No queued tasks. Run "creditforge scan" first.');
    return;
  }

  // Build batch plan
  const windowResetAt = getWindowResetTime(config.credits.windowResetHour);
  const plan = planner.plan(tasks, config.credits.estimatedBalanceUsdCents, windowResetAt);

  console.log('Night Mode Batch Plan');
  console.log('='.repeat(50));
  console.log(`Queued tasks: ${tasks.length}`);
  console.log(`Planned for execution: ${plan.tasks.length}`);
  console.log(`Skipped: ${plan.tasksSkipped}`);
  console.log(`Budget cap: $${(plan.budgetCapUsdCents / 100).toFixed(2)} (${config.nightMode.creditCapPercent}% of remaining)`);
  console.log(`Estimated cost: $${(plan.totalEstimatedCostUsdCents / 100).toFixed(2)}`);
  console.log(`Estimated duration: ~${planner.estimateDurationMinutes(plan)} minutes`);
  console.log(`Branch: ${planner.getBranchName()}`);
  console.log('');

  console.log('Execution order:');
  for (let i = 0; i < plan.tasks.length; i++) {
    const t = plan.tasks[i];
    console.log(`  ${i + 1}. [${t.score?.toFixed(1)}] ${t.projectName} | ${t.title}`);
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No tasks will be executed.');
    return;
  }

  // Execute batch
  console.log('\nStarting execution...\n');

  const results = await executor.executeBatch(plan, (completed, total, result) => {
    const status = result.success ? 'OK' : 'FAIL';
    console.log(`[${completed}/${total}] [${status}] ${result.task.title}`);
  });

  // Persist results
  for (const result of results) {
    const status = result.success ? 'completed' : 'failed';
    updateTaskStatus(db, result.task.id!, status);
    const execId = insertExecution(db, result.execution);

    if (result.execution.costUsdCents > 0) {
      insertLedgerEntry(db, {
        accountId: 'self',
        counterpartyId: 'claude-api',
        entryType: 'debit',
        amount: result.execution.costUsdCents,
        currency: 'usd_cents',
        description: `Night mode: ${result.task.title}`,
        taskId: result.task.id,
        executionId: execId,
      });
    }
  }

  // Generate and save morning report
  const report = executor.generateMorningReport(results);
  const reportDir = path.join(process.env.HOME ?? '~', '.creditforge', 'reports');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `${new Date().toISOString().split('T')[0]}.md`);
  fs.writeFileSync(reportPath, report);

  console.log('\n' + report);
  console.log(`\nReport saved to: ${reportPath}`);
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

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx >= args.length - 1) return undefined;
  return args[idx + 1];
}
