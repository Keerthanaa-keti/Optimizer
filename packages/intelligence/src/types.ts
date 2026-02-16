// ─── Usage Pattern Types ──────────────────────────────────────

export interface HourlyUsage {
  hour: number;       // 0-23
  count: number;      // messages/sessions in that hour
  percentage: number;  // % of total activity
}

export interface DailyUsagePattern {
  peakHours: number[];        // top 3 hours by activity
  quietHours: number[];       // hours with <5% of max activity
  activeDaysPerWeek: number;  // avg distinct active days
  avgDailyCost: number;       // USD estimated daily cost
  dayOfWeekPattern: Record<string, number>;  // e.g. { Mon: 42, Tue: 38, ... }
  hourlyBreakdown: HourlyUsage[];
}

// ─── Burn Rate Types ──────────────────────────────────────────

export type BurnRisk = 'safe' | 'caution' | 'warning' | 'critical';
export type BurnTrend = 'accelerating' | 'decelerating' | 'steady';

export interface BurnRateSnapshot {
  sessionBurnRate: number;      // USD per hour in current session
  sessionTimeToLimit: number;   // minutes until session limit hit (Infinity if safe)
  sessionProjectedPct: number;  // projected % at window end
  weeklyBurnRate: number;       // USD per day this week
  weeklyProjectedPct: number;   // projected % at weekly reset
  trend: BurnTrend;
  risk: BurnRisk;
  riskReason: string;
}

// ─── Task Learning Types ──────────────────────────────────────

export interface CategoryStats {
  category: string;
  source: string;
  model: string;
  totalRuns: number;
  successRate: number;          // 0.0 - 1.0
  avgCostCents: number;
  avgDurationMs: number;
  costPerSuccess: number;       // avgCost / successRate
}

export interface TaskLearningSnapshot {
  categoryStats: CategoryStats[];
  overallSuccessRate: number;
  totalExecutions: number;
  totalCostCents: number;
  bestCategories: string[];    // top 3 by success rate (min 3 runs)
  worstCategories: string[];   // bottom 3 by success rate (min 3 runs)
  recentTrend: BurnTrend;      // recent 5 vs previous 5 runs
}

// ─── Model Advisor Types ──────────────────────────────────────

export interface ModelRecommendation {
  category: string;
  currentModel: string;
  recommendedModel: string;
  estimatedSavingsPct: number;  // % cost reduction
  reason: string;
}

// ─── Schedule Optimizer Types ─────────────────────────────────

export interface ScheduleSuggestion {
  startHour: number;
  endHour: number;
  durationHours: number;
  reason: string;
  confidence: number;  // 0.0 - 1.0
}

// ─── Actionable Insight Types ─────────────────────────────────

export type ActionType = 'slow-down' | 'over-budget' | 'enable-nightmode' | 'switch-model' | 'recover-waste' | 'on-track';
export type ActionUrgency = 'danger' | 'warning' | 'info' | 'success';

export interface ActionableInsight {
  utilizationPct: number;       // weekly % used
  weeklyUsedUsd: number;        // compute dollars used
  weeklyBudgetUsd: number;      // total compute available
  subscriptionCostWeekly: number; // what user pays ($23/week for Max 5x)
  unusedCapacityUsd: number;    // budget - used
  action: {
    type: ActionType;
    urgency: ActionUrgency;
    headline: string;
    detail: string;
  };
  burnRatePerHr: number;
  bestWindow: string | null;
}

// ─── Combined Report ──────────────────────────────────────────

export interface IntelligenceReport {
  generatedAt: string;
  usagePatterns: DailyUsagePattern | null;
  burnRate: BurnRateSnapshot;
  taskLearning: TaskLearningSnapshot | null;
  modelRecommendations: ModelRecommendation[];
  scheduleSuggestion: ScheduleSuggestion | null;
}
