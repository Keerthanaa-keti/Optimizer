export * from './types.js';
export { analyzeUsagePatterns } from './usage-patterns.js';
export { computeBurnRate } from './burn-rate.js';
export { analyzeTaskPerformance } from './task-learning.js';
export { getModelRecommendations } from './model-advisor.js';
export { suggestOptimalSchedule } from './schedule-optimizer.js';

import type Database from 'better-sqlite3';
import type { StatsCache } from '@creditforge/token-monitor';
import type { UsagePercentages } from '@creditforge/token-monitor';
import type { IntelligenceReport, ActionableInsight, ActionType, ActionUrgency } from './types.js';
import { analyzeUsagePatterns } from './usage-patterns.js';
import { computeBurnRate } from './burn-rate.js';
import { analyzeTaskPerformance } from './task-learning.js';
import { getModelRecommendations } from './model-advisor.js';
import { suggestOptimalSchedule } from './schedule-optimizer.js';

/**
 * Generate a full intelligence report combining all analysis modules.
 */
export function getIntelligenceReport(
  usage: UsagePercentages,
  cache: StatsCache | null,
  db: Database.Database | null,
): IntelligenceReport {
  const usagePatterns = cache ? analyzeUsagePatterns(cache) : null;
  const burnRate = computeBurnRate(usage, cache);
  const taskLearning = db ? analyzeTaskPerformance(db) : null;
  const modelRecommendations = taskLearning
    ? getModelRecommendations(taskLearning.categoryStats)
    : [];
  const scheduleSuggestion = usagePatterns
    ? suggestOptimalSchedule(usagePatterns)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    usagePatterns,
    burnRate,
    taskLearning,
    modelRecommendations,
    scheduleSuggestion,
  };
}

// ─── Tier → Monthly Subscription Cost (USD) ──────────────────

const TIER_MONTHLY_COST: Record<string, number> = {
  'Pro $20/mo': 20,
  'Max 5\u00d7 $100/mo': 100,
  'Max 20\u00d7 $200/mo': 200,
};

/**
 * Compute actionable insights for the menubar UI.
 * Returns a single prioritized action + utilization context.
 */
export function computeActionableInsights(
  usage: UsagePercentages,
  burnRate: import('./types.js').BurnRateSnapshot,
  nightModeEnabled: boolean,
  queuedTasks: number,
  schedule: import('./types.js').ScheduleSuggestion | null,
): ActionableInsight {
  const weeklyUsedUsd = usage.data.weekly.cost;
  const weeklyBudgetUsd = usage.tier.weeklyBudget;
  const utilizationPct = weeklyBudgetUsd > 0
    ? Math.round((weeklyUsedUsd / weeklyBudgetUsd) * 1000) / 10
    : 0;

  const monthlyCost = TIER_MONTHLY_COST[usage.tier.label] ?? 100;
  const subscriptionCostWeekly = Math.round((monthlyCost / 4.33) * 100) / 100;
  const unusedCapacityUsd = Math.max(weeklyBudgetUsd - weeklyUsedUsd, 0);

  const action = pickAction(usage, burnRate, nightModeEnabled, queuedTasks, utilizationPct, subscriptionCostWeekly);

  const bestWindow = schedule
    ? `${formatHourCompact(schedule.startHour)}-${formatHourCompact(schedule.endHour)}`
    : null;

  return {
    utilizationPct,
    weeklyUsedUsd: Math.round(weeklyUsedUsd * 100) / 100,
    weeklyBudgetUsd,
    subscriptionCostWeekly,
    unusedCapacityUsd: Math.round(unusedCapacityUsd * 100) / 100,
    action,
    burnRatePerHr: burnRate.sessionBurnRate,
    bestWindow,
  };
}

function pickAction(
  usage: UsagePercentages,
  burnRate: import('./types.js').BurnRateSnapshot,
  nightModeEnabled: boolean,
  queuedTasks: number,
  utilizationPct: number,
  subscriptionCostWeekly: number,
): { type: ActionType; urgency: ActionUrgency; headline: string; detail: string } {
  // P1: Session >80% or time-to-limit <60min
  if (usage.sessionPct > 80 || burnRate.sessionTimeToLimit < 60) {
    const mins = burnRate.sessionTimeToLimit === Infinity ? '?' : Math.round(burnRate.sessionTimeToLimit);
    return {
      type: 'slow-down',
      urgency: 'danger',
      headline: `Slow down \u2014 limit in ${mins}min`,
      detail: 'Use Haiku for routine tasks to stretch your session.',
    };
  }

  // P2: Weekly projected >100%
  if (burnRate.weeklyProjectedPct > 100) {
    const overBy = Math.round(burnRate.weeklyProjectedPct - 100);
    return {
      type: 'over-budget',
      urgency: 'danger',
      headline: `On pace to exceed weekly budget by ${overBy}%`,
      detail: 'Prioritize essential work and switch to lighter models.',
    };
  }

  // P3: Night mode disabled + queued tasks >0
  if (!nightModeEnabled && queuedTasks > 0) {
    return {
      type: 'enable-nightmode',
      urgency: 'warning',
      headline: `Enable night mode to run ${queuedTasks} task${queuedTasks > 1 ? 's' : ''} overnight`,
      detail: 'Recover idle capacity while you sleep.',
    };
  }

  // P4: Opus >80% of session cost, session >30%
  const sessionData = usage.data.session;
  const opusCost = Object.entries(sessionData.byModel)
    .filter(([name]) => name.includes('opus'))
    .reduce((sum, [, cost]) => sum + cost, 0);
  const opusPct = sessionData.cost > 0 ? (opusCost / sessionData.cost) * 100 : 0;

  if (opusPct > 80 && usage.sessionPct > 30) {
    return {
      type: 'switch-model',
      urgency: 'warning',
      headline: 'Switch to Haiku for simple tasks',
      detail: 'Opus is 80%+ of your session cost \u2014 save ~70% per request on routine work.',
    };
  }

  // P5: Utilization <40%
  if (utilizationPct < 40) {
    const wastedPerWeek = Math.round(subscriptionCostWeekly * (100 - utilizationPct) / 100);
    return {
      type: 'recover-waste',
      urgency: 'info',
      headline: `~$${wastedPerWeek}/week of your subscription is unused`,
      detail: 'Run `creditforge scan` to find tasks and put idle credits to work.',
    };
  }

  // P6: Default — everything is fine
  return {
    type: 'on-track',
    urgency: 'success',
    headline: `On track \u2014 ${utilizationPct}% utilized this week`,
    detail: 'Your subscription usage looks healthy.',
  };
}

function formatHourCompact(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}${period}`;
}
