import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Task, Execution, BatchPlan } from '@creditforge/core';
import { CliAdapter, type CliOptions } from './cli-adapter.js';
import { NightPlanner, type NightPlannerConfig } from './night-planner.js';

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
   * Execute a single task.
   */
  async executeTask(task: Task): Promise<ExecutionResult> {
    const branch = this.planner.getBranchName();
    const projectPath = task.projectPath.replace(/^~/, process.env.HOME ?? '');

    // Ensure nightmode branch exists
    this.ensureBranch(projectPath, branch);

    if (this.config.dryRun) {
      return {
        task,
        execution: this.makeDryRunExecution(task, branch),
        success: true,
      };
    }

    try {
      const result = await this.cli.execute(task);
      const execution = this.cli.toExecution(task, result, branch);

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
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        task,
        execution: this.makeErrorExecution(task, branch, error),
        success: false,
        error,
      };
    }
  }

  /**
   * Execute a batch plan (night mode).
   */
  async executeBatch(
    plan: BatchPlan,
    onProgress?: (completed: number, total: number, result: ExecutionResult) => void,
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (let i = 0; i < plan.tasks.length; i++) {
      const task = plan.tasks[i];
      const result = await this.executeTask(task);
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
  generateMorningReport(results: ExecutionResult[]): string {
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
        lines.push(`- [${r.task.projectName}] ${r.task.title} ($${(r.execution.costUsdCents / 100).toFixed(2)})`);
        if (r.execution.commitHash) {
          lines.push(`  Branch: ${r.execution.branch} | Commit: ${r.execution.commitHash.slice(0, 8)}`);
        }
      }
      lines.push('');
    }

    if (failed.length > 0) {
      lines.push('## Failed Tasks');
      for (const r of failed) {
        lines.push(`- [${r.task.projectName}] ${r.task.title}`);
        if (r.error) {
          lines.push(`  Error: ${r.error.slice(0, 200)}`);
        }
      }
      lines.push('');
    }

    lines.push('## Review');
    lines.push('Changes are on nightmode/ branches. Review and merge at your convenience.');
    const projects = [...new Set(succeeded.map((r) => r.task.projectPath))];
    for (const proj of projects) {
      lines.push(`- cd ${proj} && git log nightmode/ --oneline`);
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
      // Branch doesn't exist, create from current HEAD
      try {
        execSync(`git checkout -b ${branch}`, {
          cwd: projectPath,
          stdio: 'pipe',
        });
        // Go back to previous branch
        execSync('git checkout -', {
          cwd: projectPath,
          stdio: 'pipe',
        });
      } catch {
        // May already be on the branch or other git issue
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

      // Commit
      execSync(`git commit -m "${message}\n\nCo-Authored-By: CreditForge <noreply@creditforge.dev>"`, {
        cwd: projectPath,
        stdio: 'pipe',
      });

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
