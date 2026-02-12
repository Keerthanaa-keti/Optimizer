import fs from 'node:fs';
import path from 'node:path';
import type { StatsCache, DailyActivity, DailyModelTokens } from './types.js';

const STATS_CACHE_PATH = path.join(
  process.env.HOME ?? '~',
  '.claude',
  'stats-cache.json',
);

/**
 * Loads and parses Claude's stats-cache.json.
 * Returns null if file doesn't exist or is malformed.
 */
export function loadStatsCache(cachePath?: string): StatsCache | null {
  const filePath = cachePath ?? STATS_CACHE_PATH;
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (data.version !== 2) return null;
    return data as StatsCache;
  } catch {
    return null;
  }
}

/**
 * Get daily activity for a specific date.
 */
export function getActivityForDate(
  cache: StatsCache,
  date: string,
): DailyActivity | undefined {
  return cache.dailyActivity.find((d) => d.date === date);
}

/**
 * Get daily token data for a specific date.
 */
export function getTokensForDate(
  cache: StatsCache,
  date: string,
): DailyModelTokens | undefined {
  return cache.dailyModelTokens.find((d) => d.date === date);
}

/**
 * Get daily token entries within a date range (inclusive).
 */
export function getTokensInRange(
  cache: StatsCache,
  startDate: string,
  endDate: string,
): DailyModelTokens[] {
  return cache.dailyModelTokens.filter(
    (d) => d.date >= startDate && d.date <= endDate,
  );
}

/**
 * Get daily activity entries within a date range (inclusive).
 */
export function getActivityInRange(
  cache: StatsCache,
  startDate: string,
  endDate: string,
): DailyActivity[] {
  return cache.dailyActivity.filter(
    (d) => d.date >= startDate && d.date <= endDate,
  );
}

/**
 * Sum total tokens across all models for a set of daily entries.
 */
export function sumTokens(entries: DailyModelTokens[]): number {
  let total = 0;
  for (const entry of entries) {
    for (const count of Object.values(entry.tokensByModel)) {
      total += count;
    }
  }
  return total;
}

/**
 * Format a date as YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Get date string for N days ago.
 */
export function daysAgo(n: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return formatDate(d);
}
