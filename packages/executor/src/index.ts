import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Task, Execution, BatchPlan } from '@creditforge/core';
import { CliAdapter, type CliOptions } from './cli-adapter.js';
import { NightPlanner, type NightPlannerConfig } from './night-planner.js';
import { routeModel, getHistoricalStats, type HistoricalStats, type ModelChoice } from './model-router.js';

export interface ExecutorConfig {
  cli: Partial<CliOptions>;
  nightPlanner: Partial<NightPlannerConfig>;
  logDir: string;
  dryRun: boolean;
}

export interface ExecutionResult {
  task: Task;
  execution: Omit<Execution, 'id'>;
  success: boolean;
  error?: string;
  modelChoice?: ModelChoice;
}

export interface SafetyCommitResult {
  projectPath: string;
  skipped: boolean;
  reason?: string;
  commitHash?: string;
  branch?: string;
}

const DEFAULT_CONFIG: ExecutorConfig = {
  cli: {},
  nightPlanner: {},
  logDir: path.join(process.env.HOME ?? '~', '.creditforge', 'logs'),
  dryRun: false,
};

/**
 * Execution orchestrator: runs tasks via Claude CLI and manages git branches.
 */
export class Executor {
  private config: ExecutorConfig;
  private cli: CliAdapter;
  private planner: NightPlanner;

  constructor(config?: Partial<ExecutorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.cli = new CliAdapter(this.config.cli);
    this.planner = new NightPlanner(this.config.nightPlanner);
  }

  get nightPlanner(): NightPlanner {
    return this.planner;
  }

  /**
   * Pre-flight safety commit: saves any uncommitted changes on the current branch before night mode touches a project.
   */
  safetyCommit(projectPath: string): SafetyCommitResult {
    const resolved = projectPath.replace(/^~/, process.env.HOME ?? '');

    // Must be a git repo
    if (!fs.existsSync(path.join(resolved, '.git'))) {
      return { projectPath, skipped: true, reason: 'not a git repo' };
    }

    try {
      // Check for uncommitted changes
      const status = execSync('git status --porcelain', {
        cwd: resolved,
        encoding: 'utf-8',
      }).trim();

      if (!status) {
        return { projectPath, skipped: true, reason: 'clean working tree' };
      }

      // Get current branch name
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: resolved,
        encoding: 'utf-8',
      }).trim();

      // Stage and commit on current branch
      execSync('git add -A', { cwd: resolved, stdio: 'pipe' });

      const date = new Date().toISOString().split('T')[0];
      const commitMsg = `CreditForge: auto-save before night run [${date}]`;
      const result = spawnSync('git', ['commit', '-m', commitMsg], {
        cwd: resolved,
        stdio: 'pipe',
      });

      if (result.status !== 0) {
        return { projectPath, skipped: true, reason: 'commit failed' };
      }

      const hash = execSync('git rev-parse HEAD', {
        cwd: resolved,
        encoding: 'utf-8',
      }).trim();

      return { projectPath, skipped: false, commitHash: hash, branch };
    } catch {
      return { projectPath, skipped: true, reason: 'git error' };
    }
  }

  /**
   * Execute a single task with smart model routing.
   */
  async executeTask(task: Task, history?: HistoricalStats[]): Promise<ExecutionResult> {
    const branch = this.planner.getBranchName();
    const projectPath = task.projectPath.replace(/^~/, process.env.HOME ?? '');

    // Route to best model (or skip if task type consistently fails)
    const modelChoice = routeModel(task, history, this.config.cli.model);

    if (modelChoice.model === 'skip') {
      return {
        task,
        execution: this.makeSkippedExecution(task, branch, modelChoice.reason),
        success: false,
        error: modelChoice.reason,
        modelChoice,
      };
    }

    if (this.config.dryRun) {
      return {
        task,
        execution: this.makeDryRunExecution(task, branch),
        success: true,
        modelChoice,
      };
    }

    // Create a task-specific CLI adapter with the routed model
    const taskCli = new CliAdapter({
      ...this.config.cli,
      model: modelChoice.model,
      maxBudgetUsd: modelChoice.maxBudgetUsd,
    });

    // Ensure nightmode branch exists (only for real execution)
    this.ensureBranch(projectPath, branch);

    try {
      const result = await taskCli.execute(task);
      const execution = taskCli.toExecution(task, result, branch);

      // If execution succeeded, commit changes
      if (result.exitCode === 0) {
        execution.commitHash = this.commitChanges(
          projectPath,
          branch,
          `nightmode: ${task.title}`,
        );
      }

      this.logExecution(task, execution);

      return {
        task,
        execution,
        success: result.exitCode === 0,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        modelChoice,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        task,
        execution: this.makeErrorExecution(task, branch, error),
        success: false,
        error,
        modelChoice,
      };
    }
  }

  /**
   * Execute a batch plan (night mode) with smart model routing.
   */
  async executeBatch(
    plan: BatchPlan,
    onProgress?: (completed: number, total: number, result: ExecutionResult) => void,
    db?: any,
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    const history = db ? getHistoricalStats(db) : [];

    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i];
      const result = await this.executeTask(task, history);
      results.push(result);

      onProgress?.(i + 1, plan.tasks.length, result);

      // If we're accumulating too many failures, stop early
      const failures = results.filter((r) => !r.success).length;
      if (failures >= 3) {
        break;
      }
    }

    return results;
  }

  /**
   * Generate a morning report from execution results.
   */
  generateMorningReport(results: ExecutionResult[], safetyCommits?: SafetyCommitResult[]): string {
    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const totalCost = results.reduce((sum, r) => sum + r.execution.costUsdCents, 0);
    const totalTokens = results.reduce((sum, r) => sum + r.execution.totalTokens, 0);
    const totalDuration = results.reduce((sum, r) => sum + r.execution.durationMs, 0);

    const lines = [
      '# CreditForge Morning Report',
      `Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
      '',
      '## Summary',
      `- Tasks executed: ${results.length}`,
      `- Succeeded: ${succeeded.length}`,
      `- Failed: ${failed.length}`,
      `- Total cost: $${(totalCost / 100).toFixed(2)}`,
      `- Total tokens: ${totalTokens.toLocaleString()}`,
      `- Total duration: ${Math.round(totalDuration / 60000)} minutes`,
      '',
    ];

    if (succeeded.length > 0) {
      lines.push('## Completed Tasks');
      for (const r of succeeded) {
        const modelLabel = r.modelChoice ? ` [${r.modelChoice.model}]` : '';
        lines.push(`- [${r.task.projectName}]${modelLabel} ${r.task.title} ($${(r.execution.costUsdCents / 100).toFixed(2)})`);
        if (r.execution.commitHash) {
          lines.push(`  Branch: ${r.execution.branch} | Commit: ${r.execution.commitHash.slice(0, 8)}`);
        }
      }
      lines.push('');
    }

    const skipped = results.filter(r => r.modelChoice?.model === 'skip');
    if (skipped.length > 0) {
      lines.push('## Skipped Tasks (low success rate)');
      for (const r of skipped) {
        lines.push(`- [${r.task.projectName}] ${r.task.title}`);
        lines.push(`  ${r.modelChoice?.reason}`);
      }
      lines.push('');
    }

    if (failed.length > 0) {
      lines.push('## Failed Tasks');
      for (const r of failed) {
        if (r.modelChoice?.model === 'skip') continue; // Already shown above
        lines.push(`- [${r.task.projectName}] ${r.task.title}`);
        if (r.error) {
          lines.push(`  Error: ${r.error.slice(0, 200)}`);
        }
      }
      lines.push('');
    }

    // Pre-flight safety commits section
    if (safetyCommits && safetyCommits.length > 0) {
      const saved = safetyCommits.filter(s => !s.skipped);
      if (saved.length > 0) {
        lines.push('## Pre-flight Safety Commits');
        for (const s of saved) {
          lines.push(`- ${s.projectPath} (${s.branch}) → ${s.commitHash?.slice(0, 8)}`);
        }
        lines.push('');
      }
    }

    lines.push('## Review');
    lines.push('Changes are on nightmode/ branches. Review and merge at your convenience.');
    const projects = [...new Set(succeeded.map((r) => r.task.projectPath))];
    const branch = this.planner.getBranchName();
    for (const proj of projects) {
      lines.push(`Project: ${proj} | Branch: ${branch}`);
    }

    return lines.join('\n');
  }

  private ensureBranch(projectPath: string, branch: string): void {
    if (!fs.existsSync(path.join(projectPath, '.git'))) return;

    try {
      // Check if branch exists
      execSync(`git rev-parse --verify ${branch}`, {
        cwd: projectPath,
        stdio: 'pipe',
      });
    } catch {
      // Branch doesn't exist — create without switching (safe with dirty working tree)
      try {
        execSync(`git branch ${branch}`, {
          cwd: projectPath,
          stdio: 'pipe',
        });
      } catch {
        // Branch may already exist or other git issue
      }
    }
  }

  private commitChanges(projectPath: string, branch: string, message: string): string | undefined {
    if (!fs.existsSync(path.join(projectPath, '.git'))) return undefined;

    try {
      // Checkout nightmode branch
      execSync(`git checkout ${branch}`, {
        cwd: projectPath,
        stdio: 'pipe',
      });

      // Stage all changes
      execSync('git add -A', {
        cwd: projectPath,
        stdio: 'pipe',
      });

      // Check if there are changes to commit
      const status = execSync('git status --porcelain', {
        cwd: projectPath,
        encoding: 'utf-8',
      }).trim();

      if (!status) {
        execSync('git checkout -', { cwd: projectPath, stdio: 'pipe' });
        return undefined;
      }

      // Commit — use spawnSync to avoid shell injection from task titles
      const commitMsg = `${message}\n\nCo-Authored-By: CreditForge <noreply@creditforge.dev>`;
      const commitResult = spawnSync('git', ['commit', '-m', commitMsg], {
        cwd: projectPath,
        stdio: 'pipe',
      });

      if (commitResult.status !== 0) {
        execSync('git checkout -', { cwd: projectPath, stdio: 'pipe' });
        return undefined;
      }

      // Get commit hash
      const hash = execSync('git rev-parse HEAD', {
        cwd: projectPath,
        encoding: 'utf-8',
      }).trim();

      // Return to previous branch
      execSync('git checkout -', { cwd: projectPath, stdio: 'pipe' });

      return hash;
    } catch {
      // Try to return to previous branch on any error
      try {
        execSync('git checkout -', { cwd: projectPath, stdio: 'pipe' });
      } catch { /* ignore */ }
      return undefined;
    }
  }

  private logExecution(task: Task, execution: Omit<Execution, 'id'>): void {
    const logDir = this.config.logDir.replace(/^~/, process.env.HOME ?? '');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, `${new Date().toISOString().split('T')[0]}.jsonl`);
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      task: { id: task.id, title: task.title, project: task.projectName },
      execution: {
        model: execution.model,
        exitCode: execution.exitCode,
        costUsdCents: execution.costUsdCents,
        totalTokens: execution.totalTokens,
        durationMs: execution.durationMs,
        branch: execution.branch,
        commitHash: execution.commitHash,
      },
    });

    fs.appendFileSync(logFile, entry + '\n');
  }

  private makeDryRunExecution(task: Task, branch: string): Omit<Execution, 'id'> {
    return {
      taskId: task.id!,
      model: 'dry-run',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsdCents: 0,
      durationMs: 0,
      exitCode: 0,
      stdout: '[DRY RUN] Would execute task',
      stderr: '',
      branch,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  private makeSkippedExecution(task: Task, branch: string, reason: string): Omit<Execution, 'id'> {
    return {
      taskId: task.id!,
      model: 'skipped',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsdCents: 0,
      durationMs: 0,
      exitCode: -1,
      stdout: '',
      stderr: reason,
      branch,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  private makeErrorExecution(task: Task, branch: string, error: string): Omit<Execution, 'id'> {
    return {
      taskId: task.id!,
      model: this.config.cli.model ?? 'sonnet',
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsdCents: 0,
      durationMs: 0,
      exitCode: 1,
      stdout: '',
      stderr: error,
      branch,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

export { CliAdapter } from './cli-adapter.js';
export { NightPlanner } from './night-planner.js';
export { routeModel, getHistoricalStats } from './model-router.js';
export type { ModelChoice, HistoricalStats } from './model-router.js';
