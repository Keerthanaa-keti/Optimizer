/**
 * CLI: creditforge insights — display intelligence report.
 */

import { getUsagePercentages } from '@creditforge/token-monitor';
import { loadStatsCache } from '@creditforge/token-monitor';
import { getDb, closeDb } from '@creditforge/db';
import { getIntelligenceReport } from '@creditforge/intelligence';
import type { IntelligenceReport, BurnRateSnapshot, TaskLearningSnapshot, ModelRecommendation, ScheduleSuggestion, DailyUsagePattern } from '@creditforge/intelligence';

export async function runInsights(args: string[]): Promise<void> {
  const jsonMode = args.includes('--json');
  const burnRateOnly = args.includes('--burn-rate');
  const recsOnly = args.includes('--recommendations');

  const usage = getUsagePercentages('max5');
  const cache = loadStatsCache();

  let db = null;
  try {
    db = getDb();
  } catch {
    // DB may not exist yet — that's fine
  }

  const report = getIntelligenceReport(usage, cache, db);

  if (db) closeDb();

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (burnRateOnly) {
    printBurnRate(report.burnRate);
    return;
  }

  if (recsOnly) {
    printRecommendations(report.modelRecommendations);
    return;
  }

  // Full report
  printFullReport(report);
}

function printFullReport(report: IntelligenceReport): void {
  console.log('\n  CreditForge Intelligence Report');
  console.log('  ' + '='.repeat(40));
  console.log(`  Generated: ${new Date(report.generatedAt).toLocaleString()}\n`);

  printBurnRate(report.burnRate);

  if (report.usagePatterns) {
    printUsagePatterns(report.usagePatterns);
  }

  if (report.taskLearning) {
    printTaskLearning(report.taskLearning);
  }

  printRecommendations(report.modelRecommendations);

  if (report.scheduleSuggestion) {
    printSchedule(report.scheduleSuggestion);
  }
}

function printBurnRate(br: BurnRateSnapshot): void {
  const riskColors: Record<string, string> = {
    safe: '\x1b[32m',     // green
    caution: '\x1b[33m',  // yellow
    warning: '\x1b[33m',  // yellow
    critical: '\x1b[31m', // red
  };
  const reset = '\x1b[0m';
  const color = riskColors[br.risk] ?? '';

  console.log('  Burn Rate');
  console.log('  ' + '-'.repeat(40));
  console.log(`  Risk:              ${color}${br.risk.toUpperCase()}${reset} — ${br.riskReason}`);
  console.log(`  Session burn:      $${br.sessionBurnRate.toFixed(2)}/hr`);
  console.log(`  Time to limit:     ${br.sessionTimeToLimit === Infinity ? 'Safe' : br.sessionTimeToLimit + ' min'}`);
  console.log(`  Session forecast:  ${br.sessionProjectedPct}% at window end`);
  console.log(`  Weekly burn:       $${br.weeklyBurnRate.toFixed(2)}/day`);
  console.log(`  Weekly forecast:   ${br.weeklyProjectedPct}% at reset`);
  console.log(`  Trend:             ${br.trend}`);
  console.log();
}

function printUsagePatterns(p: DailyUsagePattern): void {
  console.log('  Usage Patterns');
  console.log('  ' + '-'.repeat(40));
  console.log(`  Peak hours:        ${p.peakHours.map(formatHour).join(', ')}`);
  console.log(`  Quiet hours:       ${p.quietHours.length} hours identified`);
  console.log(`  Active days/week:  ${p.activeDaysPerWeek}`);
  console.log(`  Avg daily cost:    $${p.avgDailyCost.toFixed(2)}`);

  // Day of week breakdown
  const days = Object.entries(p.dayOfWeekPattern) as [string, number][];
  const maxMsgs = Math.max(...days.map(([, v]) => v), 1);
  console.log('  Day of week:');
  for (const [day, count] of days) {
    const bar = '#'.repeat(Math.round((count / maxMsgs) * 20));
    console.log(`    ${day}: ${bar} ${count}`);
  }
  console.log();
}

function printTaskLearning(tl: TaskLearningSnapshot): void {
  console.log('  Task Performance');
  console.log('  ' + '-'.repeat(40));
  console.log(`  Total executions:  ${tl.totalExecutions}`);
  console.log(`  Success rate:      ${Math.round(tl.overallSuccessRate * 100)}%`);
  console.log(`  Total cost:        $${(tl.totalCostCents / 100).toFixed(2)}`);
  console.log(`  Recent trend:      ${tl.recentTrend}`);

  if (tl.bestCategories.length > 0) {
    console.log(`  Best categories:   ${tl.bestCategories.join(', ')}`);
  }
  if (tl.worstCategories.length > 0) {
    console.log(`  Worst categories:  ${tl.worstCategories.join(', ')}`);
  }
  console.log();
}

function printRecommendations(recs: ModelRecommendation[]): void {
  console.log('  Model Recommendations');
  console.log('  ' + '-'.repeat(40));

  if (recs.length === 0) {
    console.log('  No recommendations yet (need more execution data).');
    console.log();
    return;
  }

  for (const rec of recs) {
    console.log(`  [${rec.category}] ${rec.currentModel} -> ${rec.recommendedModel} (save ~${rec.estimatedSavingsPct}%)`);
    console.log(`    ${rec.reason}`);
  }
  console.log();
}

function printSchedule(s: ScheduleSuggestion): void {
  console.log('  Night Mode Schedule');
  console.log('  ' + '-'.repeat(40));
  console.log(`  Suggested window:  ${formatHour(s.startHour)} - ${formatHour(s.endHour)} (${s.durationHours}h)`);
  console.log(`  Confidence:        ${Math.round(s.confidence * 100)}%`);
  console.log(`  Reason:            ${s.reason}`);
  console.log();
}

function formatHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}${period}`;
}
