import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadStatsCache, TIER_LIMITS } from '@creditforge/token-monitor';
import type { SubscriptionTier } from '@creditforge/token-monitor';

// When compiled to CJS, __dirname is available. In dist/, go up to package root.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function getTier(): SubscriptionTier {
  const configPaths = [
    path.join(process.env.HOME ?? '~', 'Documents', 'ClaudeExperiments', 'optimizer', 'creditforge.toml'),
    path.join(process.env.HOME ?? '~', '.creditforge', 'config.toml'),
  ];
  for (const p of configPaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8');
      const match = content.match(/tier\s*=\s*"(\w+)"/);
      if (match && match[1] in TIER_LIMITS) return match[1] as SubscriptionTier;
    } catch { /* ignore */ }
  }
  return 'max5';
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

function buildApiStats(): object | null {
  const cache = loadStatsCache();
  if (!cache) return null;

  const tier = getTier();
  const tierInfo = TIER_LIMITS[tier];
  const today = formatDate(new Date());

  // Today
  const todayTokenEntry = cache.dailyModelTokens.find(d => d.date === today);
  const todayTokens = todayTokenEntry
    ? Object.values(todayTokenEntry.tokensByModel).reduce((a, b) => a + b, 0)
    : 0;
  const todayActivity = cache.dailyActivity.find(d => d.date === today);
  const pct = tierInfo.estimatedDailyTokens > 0
    ? Math.round((todayTokens / tierInfo.estimatedDailyTokens) * 1000) / 10
    : 0;

  // Week
  const weekStart = daysAgo(7);
  const weekEntries = cache.dailyModelTokens.filter(d => d.date >= weekStart && d.date <= today);
  const weekTokens = weekEntries.reduce((s, e) =>
    s + Object.values(e.tokensByModel).reduce((a, b) => a + b, 0), 0);
  const avg7d = weekEntries.length > 0 ? Math.round(weekTokens / weekEntries.length) : 0;

  // Trend
  const recent = weekEntries.slice(-3);
  const older = weekEntries.slice(0, -3);
  const recentAvg = recent.length > 0
    ? recent.reduce((s, e) => s + Object.values(e.tokensByModel).reduce((a, b) => a + b, 0), 0) / recent.length
    : 0;
  const olderAvg = older.length > 0
    ? older.reduce((s, e) => s + Object.values(e.tokensByModel).reduce((a, b) => a + b, 0), 0) / older.length
    : 0;
  let trend = 'stable';
  if (olderAvg > 0 && recentAvg > olderAvg * 1.2) trend = 'increasing';
  else if (olderAvg > 0 && recentAvg < olderAvg * 0.8) trend = 'decreasing';

  // Last 30 days daily data for chart
  const thirtyDaysAgo = daysAgo(30);
  const dailyData: Array<{ date: string; total: number; byModel: Record<string, number> }> = [];
  for (let i = 30; i >= 0; i--) {
    const dateStr = daysAgo(i);
    const entry = cache.dailyModelTokens.find(d => d.date === dateStr);
    dailyData.push({
      date: dateStr,
      total: entry ? Object.values(entry.tokensByModel).reduce((a, b) => a + b, 0) : 0,
      byModel: entry?.tokensByModel ?? {},
    });
  }

  // All unique models across all daily data
  const allModels = new Set<string>();
  for (const entry of cache.dailyModelTokens) {
    for (const model of Object.keys(entry.tokensByModel)) {
      allModels.add(model);
    }
  }

  // Peak day in 30d
  let peakDay = { date: today, tokens: 0 };
  for (const d of dailyData) {
    if (d.total > peakDay.tokens) peakDay = { date: d.date, tokens: d.total };
  }

  // Model totals for all time
  const modelTotals: Record<string, number> = {};
  for (const [model, usage] of Object.entries(cache.modelUsage)) {
    modelTotals[model] = usage.inputTokens + usage.outputTokens;
  }

  return {
    tier,
    tierLabel: tierInfo.label,
    dailyBudget: tierInfo.estimatedDailyTokens,
    today: {
      date: today,
      tokens: todayTokens,
      pct,
      messages: todayActivity?.messageCount ?? 0,
      sessions: todayActivity?.sessionCount ?? 0,
      toolCalls: todayActivity?.toolCallCount ?? 0,
      byModel: todayTokenEntry?.tokensByModel ?? {},
    },
    week: {
      tokens: weekTokens,
      avg: avg7d,
      trend,
      peak: peakDay,
    },
    dailyData,
    allModels: [...allModels],
    hourCounts: cache.hourCounts,
    modelTotals,
    modelUsage: cache.modelUsage,
    allTime: {
      sessions: cache.totalSessions,
      messages: cache.totalMessages,
      firstSession: cache.firstSessionDate,
    },
  };
}

export function startServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/stats') {
      const stats = buildApiStats();
      res.writeHead(stats ? 200 : 503, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(stats ?? { error: 'Stats not available' }));
      return;
    }

    // Serve index.html for root and any other path
    const htmlPath = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(htmlPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Dashboard HTML not found. Run npm run build first.');
      return;
    }

    const html = fs.readFileSync(htmlPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  server.listen(port, () => {
    console.log(`CreditForge Dashboard running at http://localhost:${port}`);
  });

  return server;
}
