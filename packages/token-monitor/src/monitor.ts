import type {
  SubscriptionTier,
  StatsCache,
  TokenSnapshot,
  UsageSummary,
} from './types.js';
import { TIER_LIMITS } from './types.js';
import {
  loadStatsCache,
  getActivityForDate,
  getTokensForDate,
  getTokensInRange,
  getActivityInRange,
  sumTokens,
  formatDate,
  daysAgo,
} from './stats-parser.js';

export class TokenMonitor {
  private cache: StatsCache | null;
  private tier: SubscriptionTier;

  constructor(tier: SubscriptionTier = 'max5', cachePath?: string) {
    this.tier = tier;
    this.cache = loadStatsCache(cachePath);
  }

  /** Check if stats data is available. */
  get isAvailable(): boolean {
    return this.cache !== null;
  }

  /** Get a point-in-time snapshot of token usage. */
  getSnapshot(date?: Date): TokenSnapshot | null {
    if (!this.cache) return null;

    const now = date ?? new Date();
    const today = formatDate(now);
    const weekStart = daysAgo(7, now);
    const monthStart = daysAgo(30, now);

    const todayTokens = getTokensForDate(this.cache, today);
    const todayActivity = getActivityForDate(this.cache, today);

    const todayTotal = todayTokens
      ? Object.values(todayTokens.tokensByModel).reduce((a, b) => a + b, 0)
      : 0;

    const weekEntries = getTokensInRange(this.cache, weekStart, today);
    const monthEntries = getTokensInRange(this.cache, monthStart, today);

    const dailyBudget = TIER_LIMITS[this.tier].estimatedDailyTokens;
    const usedPercent = dailyBudget > 0
      ? Math.round((todayTotal / dailyBudget) * 1000) / 10
      : 0;

    return {
      timestamp: now.toISOString(),
      tier: this.tier,
      todayTokens: todayTotal,
      todayMessages: todayActivity?.messageCount ?? 0,
      todaySessions: todayActivity?.sessionCount ?? 0,
      todayToolCalls: todayActivity?.toolCallCount ?? 0,
      todayByModel: todayTokens?.tokensByModel ?? {},
      weekTokens: sumTokens(weekEntries),
      monthTokens: sumTokens(monthEntries),
      allTimeByModel: this.cache.modelUsage,
      estimatedDailyBudgetUsedPercent: usedPercent,
    };
  }

  /** Get a full usage summary with trends and patterns. */
  getSummary(date?: Date): UsageSummary | null {
    const snapshot = this.getSnapshot(date);
    if (!snapshot || !this.cache) return null;

    const now = date ?? new Date();
    const today = formatDate(now);

    // Calculate 7-day average
    const last7 = getTokensInRange(this.cache, daysAgo(7, now), today);
    const total7d = sumTokens(last7);
    const daysWithData = last7.length || 1;
    const avgDailyTokens7d = Math.round(total7d / daysWithData);

    // Find peak day (last 30 days)
    const last30 = getTokensInRange(this.cache, daysAgo(30, now), today);
    let peakDay = { tokens: 0, date: today };
    for (const entry of last30) {
      const dayTotal = Object.values(entry.tokensByModel).reduce((a, b) => a + b, 0);
      if (dayTotal > peakDay.tokens) {
        peakDay = { tokens: dayTotal, date: entry.date };
      }
    }

    // Trend: compare last 3 days avg vs previous 3 days avg
    const recent3 = getTokensInRange(this.cache, daysAgo(3, now), today);
    const prior3 = getTokensInRange(this.cache, daysAgo(6, now), daysAgo(4, now));
    const recentAvg = recent3.length > 0 ? sumTokens(recent3) / recent3.length : 0;
    const priorAvg = prior3.length > 0 ? sumTokens(prior3) / prior3.length : 0;

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (priorAvg > 0) {
      const change = (recentAvg - priorAvg) / priorAvg;
      if (change > 0.2) trend = 'increasing';
      else if (change < -0.2) trend = 'decreasing';
    }

    // Projected monthly tokens
    const projectedMonthlyTokens = avgDailyTokens7d * 30;

    // User patterns from hourCounts
    const hourEntries = Object.entries(this.cache.hourCounts)
      .map(([h, c]) => ({ hour: Number(h), count: c }))
      .sort((a, b) => b.count - a.count);
    const peakHours = hourEntries.slice(0, 3).map((e) => e.hour);

    // Active days per week (from last 30 days of activity)
    const last30Activity = getActivityInRange(this.cache, daysAgo(30, now), today);
    const weeksSpan = Math.max(1, Math.ceil(last30Activity.length > 0 ? 30 / 7 : 1));
    const activeDaysPerWeek = Math.round((last30Activity.length / weeksSpan) * 10) / 10;

    return {
      snapshot,
      trend,
      avgDailyTokens7d,
      peakDay,
      projectedMonthlyTokens,
      userPatterns: { peakHours, activeDaysPerWeek },
    };
  }

  /** Format snapshot for terminal display. */
  formatForTerminal(summary?: UsageSummary | null): string {
    const s = summary ?? this.getSummary();
    if (!s) return 'No usage data available. Claude stats-cache.json not found.';

    const { snapshot } = s;
    const tierInfo = TIER_LIMITS[snapshot.tier];
    const lines: string[] = [];

    lines.push('CreditForge Token Monitor');
    lines.push('='.repeat(50));
    lines.push(`Plan: ${tierInfo.label}  |  Today: ${snapshot.timestamp.slice(0, 10)}`);
    lines.push('');

    // Today
    lines.push(`Today:   ${formatTokens(snapshot.todayTokens)} tokens (${snapshot.estimatedDailyBudgetUsedPercent}% of daily budget)`);
    lines.push(`         ${snapshot.todaySessions} sessions | ${snapshot.todayMessages} messages | ${snapshot.todayToolCalls} tool calls`);
    for (const [model, tokens] of Object.entries(snapshot.todayByModel)) {
      lines.push(`         ${model}: ${formatTokens(tokens)}`);
    }
    lines.push('');

    // Week & Month
    const weekPercent = tierInfo.estimatedDailyTokens > 0
      ? ((snapshot.weekTokens / (tierInfo.estimatedDailyTokens * 7)) * 100).toFixed(1)
      : '0';
    const monthPercent = tierInfo.estimatedDailyTokens > 0
      ? ((snapshot.monthTokens / (tierInfo.estimatedDailyTokens * 30)) * 100).toFixed(1)
      : '0';
    lines.push(`Week:    ${formatTokens(snapshot.weekTokens)} tokens (${weekPercent}%)`);
    lines.push(`Month:   ${formatTokens(snapshot.monthTokens)} tokens (${monthPercent}%)`);
    lines.push('');

    // Trend
    const trendArrow = s.trend === 'increasing' ? '^' : s.trend === 'decreasing' ? 'v' : '~';
    lines.push(`Trend:   ${s.trend} ${trendArrow} | avg 7d: ${formatTokens(s.avgDailyTokens7d)}/day | peak: ${formatTokens(s.peakDay.tokens)} (${s.peakDay.date})`);

    // Pattern
    if (s.userPatterns.peakHours.length > 0) {
      const hours = s.userPatterns.peakHours.map((h) => `${h}:00`).join(', ');
      lines.push(`Pattern: Most active ${hours} | ${s.userPatterns.activeDaysPerWeek} days/week`);
    }

    return lines.join('\n');
  }

  /** Export snapshot as JSON. */
  toJSON(date?: Date): string {
    const snapshot = this.getSnapshot(date);
    return JSON.stringify(snapshot, null, 2);
  }

  /** Get remaining daily budget in USD cents (for governor integration). */
  getRemainingBudgetUsdCents(date?: Date): number {
    const snapshot = this.getSnapshot(date);
    if (!snapshot) return 0;

    const tierInfo = TIER_LIMITS[snapshot.tier];
    const dailyBudgetUsdCents = Math.round((tierInfo.monthlyUsd * 100) / 30);
    const usedFraction = snapshot.estimatedDailyBudgetUsedPercent / 100;
    const remaining = Math.round(dailyBudgetUsdCents * (1 - usedFraction));
    return Math.max(0, remaining);
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
