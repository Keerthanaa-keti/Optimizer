/**
 * Model Router — picks the right model for each task type.
 * Haiku for simple tasks (lint, test, cleanup) saves ~95% cost.
 * Sonnet for complex tasks (bug fixes, refactors).
 * Learns from historical success rates to skip doomed task types.
 */

import type { Task, TaskCategory } from '@creditforge/core';

export interface ModelChoice {
  model: string;
  reason: string;
  maxBudgetUsd: number;
}

export interface HistoricalStats {
  category: string;
  source: string;
  totalRuns: number;
  successRate: number;
}

// ─── Model cost tiers (per million tokens, approximate) ──────
// Haiku:  $1/M input, $5/M output  → ~$0.01–0.05 per task
// Sonnet: $3/M input, $15/M output → ~$0.05–0.50 per task
// Opus:   $15/M input, $75/M output → expensive, only for critical

const HAIKU_CATEGORIES: Set<TaskCategory> = new Set([
  'lint',
  'test',
  'cleanup',
  'docs',
  'build',
  'maintenance',
  'organization',
]);

const SONNET_CATEGORIES: Set<TaskCategory> = new Set([
  'bug-fix',
  'refactor',
  'security',
  'update',
  'system',
]);

/**
 * Pick the best model for a task based on its category and historical performance.
 */
export function routeModel(
  task: Task,
  history: HistoricalStats[] = [],
  defaultModel: string = 'sonnet',
): ModelChoice {
  // Check historical success rate — skip if consistently failing
  const stats = history.find(
    h => h.category === task.category && h.source === task.source,
  );

  if (stats && stats.totalRuns >= 3 && stats.successRate < 0.25) {
    return {
      model: 'skip',
      reason: `Skipping: ${task.category}/${task.source} has ${Math.round(stats.successRate * 100)}% success rate (${stats.totalRuns} runs)`,
      maxBudgetUsd: 0,
    };
  }

  // Simple tasks → Haiku (saves ~95% cost)
  if (HAIKU_CATEGORIES.has(task.category)) {
    return {
      model: 'haiku',
      reason: `${task.category} task — using Haiku ($0.01–0.05)`,
      maxBudgetUsd: 0.10,
    };
  }

  // Complex tasks → Sonnet
  if (SONNET_CATEGORIES.has(task.category)) {
    // High-confidence tasks can use lower budget
    const budget = task.confidence >= 4 ? 0.30 : 0.50;
    return {
      model: 'sonnet',
      reason: `${task.category} task — using Sonnet`,
      maxBudgetUsd: budget,
    };
  }

  // Default
  return {
    model: defaultModel,
    reason: `Default model for ${task.category}`,
    maxBudgetUsd: 0.50,
  };
}

/**
 * Query the DB for historical success rates by category+source.
 * Call this before routing to feed into routeModel().
 */
export function getHistoricalStats(db: any): HistoricalStats[] {
  try {
    const rows = db.prepare(`
      SELECT
        t.category,
        t.source,
        COUNT(*) as total_runs,
        ROUND(AVG(CASE WHEN e.exit_code = 0 THEN 1.0 ELSE 0.0 END), 2) as success_rate
      FROM executions e
      JOIN tasks t ON e.task_id = t.id
      GROUP BY t.category, t.source
      HAVING COUNT(*) >= 2
    `).all() as Array<{ category: string; source: string; total_runs: number; success_rate: number }>;

    return rows.map(r => ({
      category: r.category,
      source: r.source,
      totalRuns: r.total_runs,
      successRate: r.success_rate,
    }));
  } catch {
    return [];
  }
}
