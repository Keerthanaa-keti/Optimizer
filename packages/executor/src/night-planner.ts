import type { Task, BatchPlan, GovernorConfig } from '@creditforge/core';
import { Governor } from '@creditforge/core';

export interface NightPlannerConfig {
  startHour: number;
  endHour: number;
  governorConfig: Partial<GovernorConfig>;
}

const DEFAULT_CONFIG: NightPlannerConfig = {
  startHour: 23,
  endHour: 6,
  governorConfig: {
    creditCapPercent: 75,
    maxBudgetPerTaskUsdCents: 50,
    hardStopMinutesBeforeReset: 30,
  },
};

/**
 * Night Planner: decides what to execute during off-hours.
 * Uses the Governor's greedy knapsack algorithm to pick
 * the highest-value tasks that fit within the credit budget.
 */
export class NightPlanner {
  private config: NightPlannerConfig;
  private governor: Governor;

  constructor(config?: Partial<NightPlannerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.governor = new Governor(this.config.governorConfig);
  }

  /**
   * Check if we're currently in night mode hours.
   */
  isNightTime(now: Date = new Date()): boolean {
    const hour = now.getHours();
    if (this.config.startHour > this.config.endHour) {
      // Spans midnight: e.g., 23-6
      return hour >= this.config.startHour || hour < this.config.endHour;
    }
    // Same day: e.g., 1-6
    return hour >= this.config.startHour && hour < this.config.endHour;
  }

  /**
   * Build a batch plan for tonight's execution.
   */
  plan(
    tasks: Task[],
    remainingUsdCents: number,
    windowResetAt: Date,
  ): BatchPlan {
    // Filter to only queued tasks
    const queued = tasks.filter((t) => t.status === 'queued');

    // Exclude high-risk tasks from automatic night execution
    const safe = queued.filter((t) => t.risk <= 3);

    return this.governor.buildBatchPlan(safe, remainingUsdCents, windowResetAt);
  }

  /**
   * Get the branch name for tonight's work.
   */
  getBranchName(date: Date = new Date()): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `nightmode/${yyyy}-${mm}-${dd}`;
  }

  /**
   * Estimate how long the batch will take (rough).
   */
  estimateDurationMinutes(plan: BatchPlan): number {
    // Rough estimate: 2-5 minutes per task
    return plan.tasks.length * 3;
  }
}
