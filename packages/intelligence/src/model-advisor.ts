/**
 * Model advisor — recommends cheaper models when quality is comparable.
 * Compares costPerSuccess across models for each category.
 */

import type { CategoryStats, ModelRecommendation } from './types.js';

const HAIKU_MODELS = ['claude-haiku-4-5-20251001'];
const SONNET_MODELS = ['claude-sonnet-4-5-20250929'];
const OPUS_MODELS = ['claude-opus-4-6', 'claude-opus-4-5-20250620'];

const SUCCESS_RATE_TOLERANCE = 0.10; // recommend cheaper model if within 10%
const MIN_RUNS = 3;

/**
 * Generate model recommendations based on task performance data.
 * Recommends Haiku when success rate is within tolerance of more expensive models.
 */
export function getModelRecommendations(
  categoryStats: CategoryStats[],
): ModelRecommendation[] {
  const recommendations: ModelRecommendation[] = [];

  // Group stats by category
  const byCategory = new Map<string, CategoryStats[]>();
  for (const stat of categoryStats) {
    const existing = byCategory.get(stat.category) ?? [];
    existing.push(stat);
    byCategory.set(stat.category, existing);
  }

  for (const [category, stats] of byCategory) {
    const opusStat = stats.find(s => OPUS_MODELS.includes(s.model) && s.totalRuns >= MIN_RUNS);
    const sonnetStat = stats.find(s => SONNET_MODELS.includes(s.model) && s.totalRuns >= MIN_RUNS);
    const haikuStat = stats.find(s => HAIKU_MODELS.includes(s.model) && s.totalRuns >= MIN_RUNS);

    // Recommend Haiku over Opus
    if (opusStat && haikuStat) {
      const successDiff = opusStat.successRate - haikuStat.successRate;
      if (successDiff <= SUCCESS_RATE_TOLERANCE && haikuStat.avgCostCents < opusStat.avgCostCents) {
        const savings = Math.round((1 - haikuStat.avgCostCents / opusStat.avgCostCents) * 100);
        recommendations.push({
          category,
          currentModel: shortModel(opusStat.model),
          recommendedModel: shortModel(haikuStat.model),
          estimatedSavingsPct: savings,
          reason: `Haiku succeeds ${Math.round(haikuStat.successRate * 100)}% vs Opus ${Math.round(opusStat.successRate * 100)}% for ${category} tasks, saving ~${savings}%`,
        });
      }
    }

    // Recommend Haiku over Sonnet
    if (sonnetStat && haikuStat && !opusStat) {
      const successDiff = sonnetStat.successRate - haikuStat.successRate;
      if (successDiff <= SUCCESS_RATE_TOLERANCE && haikuStat.avgCostCents < sonnetStat.avgCostCents) {
        const savings = Math.round((1 - haikuStat.avgCostCents / sonnetStat.avgCostCents) * 100);
        recommendations.push({
          category,
          currentModel: shortModel(sonnetStat.model),
          recommendedModel: shortModel(haikuStat.model),
          estimatedSavingsPct: savings,
          reason: `Haiku succeeds ${Math.round(haikuStat.successRate * 100)}% vs Sonnet ${Math.round(sonnetStat.successRate * 100)}% for ${category} tasks, saving ~${savings}%`,
        });
      }
    }

    // Recommend Sonnet over Opus
    if (opusStat && sonnetStat && !recommendations.find(r => r.category === category)) {
      const successDiff = opusStat.successRate - sonnetStat.successRate;
      if (successDiff <= SUCCESS_RATE_TOLERANCE && sonnetStat.avgCostCents < opusStat.avgCostCents) {
        const savings = Math.round((1 - sonnetStat.avgCostCents / opusStat.avgCostCents) * 100);
        recommendations.push({
          category,
          currentModel: shortModel(opusStat.model),
          recommendedModel: shortModel(sonnetStat.model),
          estimatedSavingsPct: savings,
          reason: `Sonnet succeeds ${Math.round(sonnetStat.successRate * 100)}% vs Opus ${Math.round(opusStat.successRate * 100)}% for ${category} tasks, saving ~${savings}%`,
        });
      }
    }
  }

  return recommendations.sort((a, b) => b.estimatedSavingsPct - a.estimatedSavingsPct);
}

function shortModel(model: string): string {
  return model.replace('claude-', '').replace(/-\d{8}$/, '');
}
