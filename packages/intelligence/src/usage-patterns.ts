/**
 * Usage pattern analysis — hourly/daily patterns from StatsCache.
 * Identifies peak hours, quiet hours, and cost trends.
 */

import type { StatsCache } from '@creditforge/token-monitor';
import { MODEL_PRICING } from '@creditforge/token-monitor';
import type { DailyUsagePattern, HourlyUsage } from './types.js';

const DEFAULT_PRICING_PER_TOKEN = 15 / 1e6; // Opus input price as fallback

/**
 * Analyze usage patterns from Claude's stats cache.
 * Looks at the last `lookbackDays` of data.
 */
export function analyzeUsagePatterns(
  cache: StatsCache,
  lookbackDays: number = 14,
): DailyUsagePattern {
  // Parse hourly usage from cache.hourCounts (keys like "0", "1", ... "23")
  const hourlyBreakdown = buildHourlyBreakdown(cache);
  const maxCount = Math.max(...hourlyBreakdown.map(h => h.count), 1);

  // Peak hours: top 3 by count
  const sorted = [...hourlyBreakdown].sort((a, b) => b.count - a.count);
  const peakHours = sorted.slice(0, 3).map(h => h.hour);

  // Quiet hours: <5% of max activity
  const quietThreshold = maxCount * 0.05;
  const quietHours = hourlyBreakdown
    .filter(h => h.count < quietThreshold)
    .map(h => h.hour);

  // Active days per week from dailyActivity
  const cutoffDate = daysAgoStr(lookbackDays);
  const recentActivity = cache.dailyActivity.filter(d => d.date >= cutoffDate);
  const distinctDates = new Set(recentActivity.map(d => d.date));
  const weeksInRange = Math.max(lookbackDays / 7, 1);
  const activeDaysPerWeek = Math.round((distinctDates.size / weeksInRange) * 10) / 10;

  // Average daily cost from dailyModelTokens
  const recentTokens = cache.dailyModelTokens.filter(d => d.date >= cutoffDate);
  const totalCost = computeTotalCost(recentTokens);
  const daysWithData = Math.max(recentTokens.length, 1);
  const avgDailyCost = Math.round((totalCost / daysWithData) * 100) / 100;

  // Day-of-week pattern
  const dayOfWeekPattern = buildDayOfWeekPattern(recentActivity);

  return {
    peakHours,
    quietHours,
    activeDaysPerWeek,
    avgDailyCost,
    dayOfWeekPattern,
    hourlyBreakdown,
  };
}

function buildHourlyBreakdown(cache: StatsCache): HourlyUsage[] {
  const counts: number[] = new Array(24).fill(0);
  if (cache.hourCounts) {
    for (const [hourStr, count] of Object.entries(cache.hourCounts)) {
      const hour = parseInt(hourStr, 10);
      if (hour >= 0 && hour < 24) {
        counts[hour] = count;
      }
    }
  }

  const total = counts.reduce((sum, c) => sum + c, 0) || 1;
  return counts.map((count, hour) => ({
    hour,
    count,
    percentage: Math.round((count / total) * 1000) / 10,
  }));
}

function computeTotalCost(
  entries: Array<{ date: string; tokensByModel: Record<string, number> }>,
): number {
  let totalCost = 0;
  for (const entry of entries) {
    for (const [model, tokens] of Object.entries(entry.tokensByModel)) {
      // Estimate cost: use average of input price (tokens count includes both in/out)
      const pricing = MODEL_PRICING[model];
      const pricePerToken = pricing
        ? (pricing.input + pricing.output) / 2 / 1e6
        : DEFAULT_PRICING_PER_TOKEN;
      totalCost += tokens * pricePerToken;
    }
  }
  return totalCost;
}

function buildDayOfWeekPattern(
  activities: Array<{ date: string; messageCount: number }>,
): Record<string, number> {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const counts: Record<string, number> = {};
  for (const name of dayNames) counts[name] = 0;

  for (const activity of activities) {
    const day = new Date(activity.date + 'T12:00:00').getDay();
    counts[dayNames[day]] += activity.messageCount;
  }

  return counts;
}

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
