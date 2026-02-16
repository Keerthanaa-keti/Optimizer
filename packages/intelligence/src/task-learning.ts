/**
 * Task performance analysis — learns from execution history.
 * Computes success rates, cost-per-success, and identifies best/worst categories.
 */

import type Database from 'better-sqlite3';
import { getCategoryPerformance, getRecentExecutionStats } from '@creditforge/db';
import type { CategoryPerformanceRow } from '@creditforge/db';
import type { CategoryStats, TaskLearningSnapshot, BurnTrend } from './types.js';

const MIN_RUNS_FOR_RANKING = 3;

/**
 * Analyze task execution performance from the DB.
 */
export function analyzeTaskPerformance(db: Database.Database): TaskLearningSnapshot {
  const rows = getCategoryPerformance(db);

  if (rows.length === 0) {
    return {
      categoryStats: [],
      overallSuccessRate: 0,
      totalExecutions: 0,
      totalCostCents: 0,
      bestCategories: [],
      worstCategories: [],
      recentTrend: 'steady',
    };
  }

  // Build category stats
  const categoryStats: CategoryStats[] = rows.map((r: CategoryPerformanceRow) => {
    const successRate = r.totalRuns > 0 ? r.successCount / r.totalRuns : 0;
    return {
      category: r.category,
      source: r.source,
      model: r.model,
      totalRuns: r.totalRuns,
      successRate: Math.round(successRate * 1000) / 1000,
      avgCostCents: Math.round(r.avgCost * 100) / 100,
      avgDurationMs: Math.round(r.avgDuration),
      costPerSuccess: successRate > 0
        ? Math.round((r.avgCost / successRate) * 100) / 100
        : Infinity,
    };
  });

  // Overall stats
  let totalExecutions = 0;
  let totalSuccesses = 0;
  let totalCostCents = 0;
  for (const r of rows) {
    totalExecutions += r.totalRuns;
    totalSuccesses += r.successCount;
    totalCostCents += r.avgCost * r.totalRuns;
  }
  const overallSuccessRate = totalExecutions > 0
    ? Math.round((totalSuccesses / totalExecutions) * 1000) / 1000
    : 0;

  // Best/worst categories (aggregate by category, min runs threshold)
  const byCat = aggregateByCategory(categoryStats);
  const ranked = byCat
    .filter(c => c.totalRuns >= MIN_RUNS_FOR_RANKING)
    .sort((a, b) => b.successRate - a.successRate);

  const bestCategories = ranked.slice(0, 3).map(c => c.category);
  const worstCategories = ranked.slice(-3).reverse().map(c => c.category);

  // Recent trend: compare last 5 runs vs previous 5
  const recentTrend = computeRecentTrend(db);

  return {
    categoryStats,
    overallSuccessRate,
    totalExecutions,
    totalCostCents: Math.round(totalCostCents * 100) / 100,
    bestCategories,
    worstCategories,
    recentTrend,
  };
}

function aggregateByCategory(stats: CategoryStats[]): Array<{
  category: string;
  totalRuns: number;
  successRate: number;
}> {
  const map = new Map<string, { total: number; successes: number }>();

  for (const s of stats) {
    const existing = map.get(s.category) ?? { total: 0, successes: 0 };
    existing.total += s.totalRuns;
    existing.successes += Math.round(s.successRate * s.totalRuns);
    map.set(s.category, existing);
  }

  return Array.from(map.entries()).map(([category, { total, successes }]) => ({
    category,
    totalRuns: total,
    successRate: total > 0 ? successes / total : 0,
  }));
}

function computeRecentTrend(db: Database.Database): BurnTrend {
  const recent = getRecentExecutionStats(db, 10);
  if (recent.length < 6) return 'steady';

  const mid = Math.floor(recent.length / 2);
  // recent is ordered DESC, so first half = newer, second half = older
  const newer = recent.slice(0, mid);
  const older = recent.slice(mid);

  const newerSuccessRate = newer.filter((r: { exitCode: number }) => r.exitCode === 0).length / newer.length;
  const olderSuccessRate = older.filter((r: { exitCode: number }) => r.exitCode === 0).length / older.length;

  const diff = newerSuccessRate - olderSuccessRate;
  if (diff > 0.2) return 'accelerating';  // improving
  if (diff < -0.2) return 'decelerating'; // degrading
  return 'steady';
}
