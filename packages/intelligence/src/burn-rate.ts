/**
 * Burn rate forecasting — predicts time-to-limit and projects usage at window end.
 * Uses current session cost + rate to forecast when limits will be hit.
 */

import type { UsagePercentages } from '@creditforge/token-monitor';
import { SESSION_WINDOW_HOURS } from '@creditforge/token-monitor';
import type { StatsCache } from '@creditforge/token-monitor';
import type { BurnRateSnapshot, BurnRisk, BurnTrend } from './types.js';

/**
 * Compute burn rate from current usage data.
 */
export function computeBurnRate(
  usage: UsagePercentages,
  cache: StatsCache | null,
): BurnRateSnapshot {
  const sessionData = usage.data.session;
  const tier = usage.tier;

  // Session burn rate: cost per hour
  const sessionCost = sessionData.cost;
  const hoursElapsed = computeSessionHours(sessionData.oldestTs);
  const sessionBurnRate = hoursElapsed > 0
    ? Math.round((sessionCost / hoursElapsed) * 100) / 100
    : 0;

  // Time to session limit (in minutes)
  const remainingSessionBudget = Math.max(tier.sessionBudget - sessionCost, 0);
  const sessionTimeToLimit = sessionBurnRate > 0
    ? Math.round((remainingSessionBudget / sessionBurnRate) * 60)
    : Infinity;

  // Projected session % at window end
  const remainingWindowHours = computeRemainingWindowHours(sessionData.oldestTs);
  const projectedSessionCost = sessionCost + sessionBurnRate * remainingWindowHours;
  const sessionProjectedPct = tier.sessionBudget > 0
    ? Math.round((projectedSessionCost / tier.sessionBudget) * 1000) / 10
    : 0;

  // Weekly burn rate: cost per day
  const weeklyCost = usage.data.weekly.cost;
  const dayOfWeek = new Date().getDay();
  const daysSoFar = dayOfWeek === 0 ? 7 : dayOfWeek; // Sun=7, Mon=1, etc.
  const weeklyBurnRate = daysSoFar > 0
    ? Math.round((weeklyCost / daysSoFar) * 100) / 100
    : 0;

  // Projected weekly % at reset (Saturday)
  const daysUntilReset = (6 - new Date().getDay() + 7) % 7 || 7;
  const projectedWeeklyCost = weeklyCost + weeklyBurnRate * daysUntilReset;
  const weeklyProjectedPct = tier.weeklyBudget > 0
    ? Math.round((projectedWeeklyCost / tier.weeklyBudget) * 1000) / 10
    : 0;

  // Trend: compare first half vs second half of recent data
  const trend = determineTrend(cache);

  // Risk assessment
  const { risk, riskReason } = assessRisk(
    usage.sessionPct,
    usage.weeklyPct,
    sessionTimeToLimit,
    sessionProjectedPct,
  );

  return {
    sessionBurnRate,
    sessionTimeToLimit,
    sessionProjectedPct,
    weeklyBurnRate,
    weeklyProjectedPct,
    trend,
    risk,
    riskReason,
  };
}

function computeSessionHours(oldestTs: string | null): number {
  if (!oldestTs) return 0;
  const elapsed = Date.now() - new Date(oldestTs).getTime();
  return Math.max(elapsed / 3600000, 0.01); // min 0.01h to avoid div by zero
}

function computeRemainingWindowHours(oldestTs: string | null): number {
  if (!oldestTs) return SESSION_WINDOW_HOURS;
  const windowEnd = new Date(oldestTs).getTime() + SESSION_WINDOW_HOURS * 3600000;
  const remaining = windowEnd - Date.now();
  return Math.max(remaining / 3600000, 0);
}

function determineTrend(cache: StatsCache | null): BurnTrend {
  if (!cache || cache.dailyModelTokens.length < 4) return 'steady';

  const entries = cache.dailyModelTokens
    .slice(-14)
    .map(d => Object.values(d.tokensByModel).reduce((s, v) => s + v, 0));

  if (entries.length < 4) return 'steady';

  const mid = Math.floor(entries.length / 2);
  const firstHalf = entries.slice(0, mid);
  const secondHalf = entries.slice(mid);

  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

  if (avgFirst === 0) return 'steady';
  const change = (avgSecond - avgFirst) / avgFirst;

  if (change > 0.2) return 'accelerating';
  if (change < -0.2) return 'decelerating';
  return 'steady';
}

function assessRisk(
  sessionPct: number,
  weeklyPct: number,
  timeToLimitMins: number,
  projectedPct: number,
): { risk: BurnRisk; riskReason: string } {
  // Critical: >95% used or <30min to limit
  if (sessionPct > 95 || timeToLimitMins < 30) {
    return {
      risk: 'critical',
      riskReason: timeToLimitMins < 30
        ? `Session limit in ~${Math.max(timeToLimitMins, 1)} min`
        : `Session at ${sessionPct}% capacity`,
    };
  }

  // Warning: 80-95% or projected to overshoot
  if (sessionPct > 80 || weeklyPct > 80 || projectedPct > 120) {
    return {
      risk: 'warning',
      riskReason: projectedPct > 120
        ? `Projected to hit ${Math.round(projectedPct)}% by window end`
        : `Usage at ${Math.max(sessionPct, weeklyPct)}%`,
    };
  }

  // Caution: 60-80%
  if (sessionPct > 60 || weeklyPct > 60) {
    return {
      risk: 'caution',
      riskReason: `Moderate usage (${Math.max(sessionPct, weeklyPct)}%)`,
    };
  }

  return { risk: 'safe', riskReason: 'Usage within normal range' };
}
