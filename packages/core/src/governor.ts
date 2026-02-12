import type { GovernorConfig, GovernorDecision, Task, BatchPlan } from './models.js';
import { computeScore } from './models.js';

const DEFAULT_CONFIG: GovernorConfig = {
  creditCapPercent: 75,
  maxBudgetPerTaskUsdCents: 50,    // $0.50
  hardStopMinutesBeforeReset: 30,
  windowResetHour: 0,              // midnight by default
};

/**
 * Credit Governor: enforces spending caps and builds optimal batch plans.
 *
 * The governor answers: "Given my remaining budget and these queued tasks,
 * what should I execute tonight?"
 */
export class Governor {
  private config: GovernorConfig;

  constructor(config?: Partial<GovernorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if we're within the hard-stop window (too close to credit reset).
   */
  isWithinHardStop(windowResetAt: Date, now: Date = new Date()): boolean {
    const diffMs = windowResetAt.getTime() - now.getTime();
    const diffMinutes = diffMs / (1000 * 60);
    return diffMinutes >= 0 && diffMinutes <= this.config.hardStopMinutesBeforeReset;
  }

  /**
   * Calculate the capped budget based on remaining balance.
   */
  getCappedBudget(remainingUsdCents: number): number {
    return Math.floor(remainingUsdCents * (this.config.creditCapPercent / 100));
  }

  /**
   * Evaluate whether a batch of tasks should proceed.
   */
  evaluate(
    tasks: Task[],
    remainingUsdCents: number,
    windowResetAt: Date,
  ): GovernorDecision {
    if (this.isWithinHardStop(windowResetAt)) {
      return {
        allowed: false,
        reason: `Within ${this.config.hardStopMinutesBeforeReset} minutes of credit window reset`,
        remainingBudgetUsdCents: remainingUsdCents,
        cappedBudgetUsdCents: 0,
        tasksApproved: 0,
        tasksRejected: tasks.length,
      };
    }

    const cappedBudget = this.getCappedBudget(remainingUsdCents);

    if (cappedBudget <= 0) {
      return {
        allowed: false,
        reason: 'No budget remaining after applying credit cap',
        remainingBudgetUsdCents: remainingUsdCents,
        cappedBudgetUsdCents: 0,
        tasksApproved: 0,
        tasksRejected: tasks.length,
      };
    }

    // Estimate how many tasks fit
    const perTaskCap = this.config.maxBudgetPerTaskUsdCents;
    const maxTasks = Math.floor(cappedBudget / perTaskCap);
    const approved = Math.min(tasks.length, maxTasks);

    return {
      allowed: approved > 0,
      reason: approved > 0
        ? `Approved ${approved}/${tasks.length} tasks within ${cappedBudget}¢ budget`
        : 'Budget too low for any tasks at current per-task cap',
      remainingBudgetUsdCents: remainingUsdCents,
      cappedBudgetUsdCents: cappedBudget,
      tasksApproved: approved,
      tasksRejected: tasks.length - approved,
    };
  }

  /**
   * Greedy knapsack: select highest-score tasks that fit within budget.
   * Each task costs up to maxBudgetPerTaskUsdCents.
   */
  buildBatchPlan(
    tasks: Task[],
    remainingUsdCents: number,
    windowResetAt: Date,
  ): BatchPlan {
    const cappedBudget = this.getCappedBudget(remainingUsdCents);

    // Score and sort descending
    const scored = tasks
      .map((t) => ({ ...t, score: t.score ?? computeScore(t) }))
      .sort((a, b) => b.score! - a.score!);

    const selected: Task[] = [];
    let totalCost = 0;
    let skipped = 0;

    for (const task of scored) {
      const taskCost = this.config.maxBudgetPerTaskUsdCents;
      if (totalCost + taskCost <= cappedBudget && !this.isWithinHardStop(windowResetAt)) {
        selected.push(task);
        totalCost += taskCost;
      } else {
        skipped++;
      }
    }

    return {
      tasks: selected,
      totalEstimatedCostUsdCents: totalCost,
      budgetCapUsdCents: cappedBudget,
      tasksSkipped: skipped,
      executionOrder: selected.map((t) => t.id!),
    };
  }
}
