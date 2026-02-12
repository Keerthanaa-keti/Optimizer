import { spawn } from 'node:child_process';
import type { Task, Execution } from '@creditforge/core';

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  costUsdCents: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
}

export interface CliOptions {
  model: string;
  maxBudgetUsd: number;
  timeoutMs: number;
  claudePath: string;
}

const DEFAULT_OPTIONS: CliOptions = {
  model: 'sonnet',
  maxBudgetUsd: 0.50,
  timeoutMs: 5 * 60 * 1000, // 5 minutes per task
  claudePath: 'claude',
};

/**
 * Wraps the Claude CLI (`claude -p`) via child_process.
 * Executes a task prompt and captures all output.
 */
export class CliAdapter {
  private options: CliOptions;

  constructor(options?: Partial<CliOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute a task using Claude CLI.
   */
  async execute(task: Task): Promise<CliResult> {
    const prompt = task.prompt ?? task.description;
    const projectPath = task.projectPath.replace(/^~/, process.env.HOME ?? '');

    const args = [
      '-p', prompt,
      '--model', this.options.model,
      '--output-format', 'json',
      '--max-turns', '25',
    ];

    // Add project directory context
    args.push('--add-dir', projectPath);

    const start = Date.now();

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn(this.options.claudePath, args, {
        cwd: projectPath,
        env: {
          ...process.env,
          // Ensure Claude doesn't try to use interactive mode
          CI: 'true',
        },
        timeout: this.options.timeoutMs,
      });

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, this.options.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - start;

        // Try to parse JSON output for token usage
        let costUsdCents = 0;
        let totalTokens = 0;
        let promptTokens = 0;
        let completionTokens = 0;

        try {
          const parsed = JSON.parse(stdout);
          if (parsed.usage) {
            promptTokens = parsed.usage.input_tokens ?? 0;
            completionTokens = parsed.usage.output_tokens ?? 0;
            totalTokens = promptTokens + completionTokens;
          }
          if (parsed.cost_usd) {
            costUsdCents = Math.round(parsed.cost_usd * 100);
          }
        } catch {
          // Non-JSON output, estimate tokens from length
          totalTokens = Math.ceil(stdout.length / 4);
        }

        resolve({
          exitCode: timedOut ? 124 : (code ?? 1),
          stdout: timedOut ? stdout + '\n[TIMED OUT]' : stdout,
          stderr,
          durationMs,
          costUsdCents,
          totalTokens,
          promptTokens,
          completionTokens,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: 127,
          stdout: '',
          stderr: err.message,
          durationMs: Date.now() - start,
          costUsdCents: 0,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
        });
      });
    });
  }

  /**
   * Convert a CliResult into an Execution record.
   */
  toExecution(task: Task, result: CliResult, branch: string): Omit<Execution, 'id'> {
    return {
      taskId: task.id!,
      model: this.options.model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      costUsdCents: result.costUsdCents,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      stdout: result.stdout.slice(0, 10000), // cap stored output
      stderr: result.stderr.slice(0, 5000),
      branch,
      startedAt: new Date(Date.now() - result.durationMs).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}
