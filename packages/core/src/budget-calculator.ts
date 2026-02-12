// ─── Budget Calculator ────────────────────────────────────────
// Converts real token usage into remaining USD budget for the governor.

export type BudgetTier = 'pro' | 'max5' | 'max20';

const TIER_MONTHLY_USD: Record<BudgetTier, number> = {
  pro: 20,
  max5: 100,
  max20: 200,
};

const TIER_DAILY_TOKENS: Record<BudgetTier, number> = {
  pro: 500_000,
  max5: 2_500_000,
  max20: 10_000_000,
};

/**
 * Estimate remaining daily budget in USD cents based on real token usage.
 *
 * Formula:
 *   dailyBudgetCents = (monthlyUsd * 100) / 30
 *   usedFraction = todayTokens / dailyTokenLimit
 *   remaining = dailyBudgetCents * (1 - usedFraction)
 */
export function estimateRemainingBudget(
  tier: BudgetTier,
  todayTokens: number,
): number {
  const monthlyUsd = TIER_MONTHLY_USD[tier] ?? TIER_MONTHLY_USD.max5;
  const dailyBudgetCents = Math.round((monthlyUsd * 100) / 30);
  const dailyTokenLimit = TIER_DAILY_TOKENS[tier] ?? TIER_DAILY_TOKENS.max5;

  const usedFraction = dailyTokenLimit > 0 ? todayTokens / dailyTokenLimit : 0;
  const remaining = Math.round(dailyBudgetCents * (1 - usedFraction));
  return Math.max(0, remaining);
}

/**
 * Get the daily budget in USD cents for a tier (before any usage).
 */
export function getDailyBudgetCents(tier: BudgetTier): number {
  const monthlyUsd = TIER_MONTHLY_USD[tier] ?? TIER_MONTHLY_USD.max5;
  return Math.round((monthlyUsd * 100) / 30);
}
