// ─── Subscription Tiers ───────────────────────────────────────

export type SubscriptionTier = 'pro' | 'max5' | 'max20';

export const TIER_LIMITS: Record<SubscriptionTier, {
  monthlyUsd: number;
  estimatedDailyTokens: number;
  label: string;
}> = {
  pro:   { monthlyUsd: 20,  estimatedDailyTokens: 500_000,   label: 'Pro ($20/mo)' },
  max5:  { monthlyUsd: 100, estimatedDailyTokens: 2_500_000, label: 'Max 5x ($100/mo)' },
  max20: { monthlyUsd: 200, estimatedDailyTokens: 10_000_000, label: 'Max 20x ($200/mo)' },
};

// ─── Stats Cache Format (Claude ~/.claude/stats-cache.json) ──

export interface StatsCache {
  version: number;
  lastComputedDate: string;
  dailyActivity: DailyActivity[];
  dailyModelTokens: DailyModelTokens[];
  modelUsage: Record<string, ModelUsage>;
  hourCounts: Record<string, number>;
  totalSessions: number;
  totalMessages: number;
  firstSessionDate: string;
  longestSession: {
    sessionId: string;
    duration: number;
    messageCount: number;
    timestamp: string;
  };
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface DailyModelTokens {
  date: string;
  tokensByModel: Record<string, number>;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}

// ─── Token Monitor Output ─────────────────────────────────────

export interface TokenSnapshot {
  timestamp: string;
  tier: SubscriptionTier;
  todayTokens: number;
  todayMessages: number;
  todaySessions: number;
  todayToolCalls: number;
  todayByModel: Record<string, number>;
  weekTokens: number;
  monthTokens: number;
  allTimeByModel: Record<string, ModelUsage>;
  estimatedDailyBudgetUsedPercent: number;
}

export interface UsageSummary {
  snapshot: TokenSnapshot;
  trend: 'increasing' | 'decreasing' | 'stable';
  avgDailyTokens7d: number;
  peakDay: { tokens: number; date: string };
  projectedMonthlyTokens: number;
  userPatterns: { peakHours: number[]; activeDaysPerWeek: number };
}
