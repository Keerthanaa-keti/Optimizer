import http from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadStatsCache, scanLiveUsage, TIER_LIMITS, getUsagePercentages } from '@creditforge/token-monitor';
import type { SubscriptionTier } from '@creditforge/token-monitor';
import { getIntelligenceReport, computeActionableInsights } from '@creditforge/intelligence';

// When compiled to CJS, __dirname is available. In dist/, go up to package root.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const TIER_MONTHLY_SUB: Record<string, number> = { pro: 20, max5: 100, max20: 200 };

function getAppRoot(): string {
  if (process.env.CREDITFORGE_ROOT) return process.env.CREDITFORGE_ROOT;
  const cwd = process.cwd();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    if (pkg.name === 'creditforge') return cwd;
  } catch { /* ignore */ }
  return path.join(process.env.HOME ?? '~', '.creditforge', 'app');
}

function getTier(): SubscriptionTier {
  const configPaths = [
    path.join(process.env.HOME ?? '~', '.creditforge', 'config.toml'),
    path.join(getAppRoot(), 'creditforge.toml'),
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

  // Today — merge stats-cache with live JSONL data
  const todayTokenEntry = cache.dailyModelTokens.find(d => d.date === today);
  const live = scanLiveUsage(today);
  const cacheTokens = todayTokenEntry
    ? Object.values(todayTokenEntry.tokensByModel).reduce((a, b) => a + b, 0)
    : 0;

  // Merge model breakdowns: take max per model from cache vs live
  const mergedByModel: Record<string, number> = { ...(todayTokenEntry?.tokensByModel ?? {}) };
  for (const [model, tok] of Object.entries(live.tokensByModel)) {
    mergedByModel[model] = Math.max(mergedByModel[model] || 0, tok);
  }
  const todayTokens = Math.max(cacheTokens, Object.values(mergedByModel).reduce((a, b) => a + b, 0));

  const todayActivity = cache.dailyActivity.find(d => d.date === today);
  const pct = tierInfo.estimatedDailyTokens > 0
    ? Math.round((todayTokens / tierInfo.estimatedDailyTokens) * 1000) / 10
    : 0;

  // Last 7 days daily data for chart
  const dailyData: Array<{ date: string; total: number; byModel: Record<string, number> }> = [];
  for (let i = 6; i >= 0; i--) {
    const dateStr = daysAgo(i);
    const entry = cache.dailyModelTokens.find(d => d.date === dateStr);
    dailyData.push({
      date: dateStr,
      total: entry ? Object.values(entry.tokensByModel).reduce((a, b) => a + b, 0) : 0,
      byModel: entry?.tokensByModel ?? {},
    });
  }

  // ─── Subscription Dollar Math ──────────────────────────
  const monthlyUsd = TIER_MONTHLY_SUB[tier] ?? 100;
  const weeklyBudget = Math.round((monthlyUsd * 12 / 52) * 100) / 100;
  const dailyBudgetUsd = monthlyUsd * 12 / 365;

  // Convert token counts to dollar estimates per day
  const dailySpend = dailyData.map(d => {
    const dayDollars = tierInfo.estimatedDailyTokens > 0
      ? (d.total / tierInfo.estimatedDailyTokens) * dailyBudgetUsd
      : 0;
    return { date: d.date, dollars: Math.round(dayDollars * 100) / 100 };
  });

  const weeklyUsed = dailySpend.reduce((sum, d) => sum + d.dollars, 0);
  const weeklyUtilizationPct = weeklyBudget > 0
    ? Math.round((weeklyUsed / weeklyBudget) * 1000) / 10
    : 0;

  // ─── Intelligence Tip ──────────────────────────────────
  let tip: { headline: string; detail: string } = {
    headline: 'Getting started',
    detail: 'Use Claude more to see personalized tips.',
  };

  try {
    const usage = getUsagePercentages(tier as 'pro' | 'max5' | 'max20');
    const report = getIntelligenceReport(usage, cache, null);
    const actionable = computeActionableInsights(
      usage,
      report.burnRate,
      false,
      0,
      report.scheduleSuggestion,
    );
    tip = { headline: actionable.action.headline, detail: actionable.action.detail };
  } catch { /* intelligence unavailable — use default */ }

  return {
    tier,
    tierLabel: tierInfo.label,
    hourCounts: cache.hourCounts,
    subscription: {
      monthlyUsd,
      weeklyBudget,
      dailyBudget: Math.round(dailyBudgetUsd * 100) / 100,
      weeklyUsed: Math.round(weeklyUsed * 100) / 100,
      weeklyUtilizationPct,
      dailySpend,
    },
    tip,
  };
}

const REPORT_DIR = path.join(process.env.HOME ?? '~', '.creditforge', 'reports');

function getReport(date?: string): { date: string; markdown: string; projects: Array<{ path: string; branch: string }> } | null {
  const reportDir = REPORT_DIR;
  const targetDate = date ?? new Date().toISOString().split('T')[0];
  const reportPath = path.join(reportDir, `${targetDate}.md`);

  if (!fs.existsSync(reportPath)) return null;

  const markdown = fs.readFileSync(reportPath, 'utf-8');
  const projects = parseProjectPathsFromReport(markdown);
  return { date: targetDate, markdown, projects };
}

function getReportDates(): string[] {
  if (!fs.existsSync(REPORT_DIR)) return [];
  return fs.readdirSync(REPORT_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''))
    .sort()
    .reverse();
}

function parseProjectPathsFromReport(markdown: string): Array<{ path: string; branch: string }> {
  const results: Array<{ path: string; branch: string }> = [];
  const regex = /^Project:\s*(.+?)\s*\|\s*Branch:\s*(.+)$/gm;
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    results.push({ path: match[1].trim(), branch: match[2].trim() });
  }
  return results;
}

// ─── Night Stats (Value Dashboard) ───────────────────────
function buildNightStats(): object {
  const dbPath = path.join(process.env.HOME ?? '~', '.creditforge', 'creditforge.db');
  const tier = getTier();
  const monthlyUsd = TIER_MONTHLY_SUB[tier] ?? 100;
  const weeklyBudget = Math.round((monthlyUsd * 12 / 52) * 100) / 100;
  const dailyBudgetUsd = monthlyUsd * 12 / 365;
  const tierInfo = TIER_LIMITS[tier];

  const empty = {
    tasksRun: 0, succeeded: 0, totalCostCents: 0,
    totalTokens: 0, totalMinutes: 0,
  };
  const defaults = {
    allTime: { ...empty },
    thisWeek: { ...empty },
    valueSaved: {
      recoveredDollars: 0, hoursRecovered: 0,
      utilizationBoostPct: 0, tasksAutomated: 0,
    },
  };

  if (!fs.existsSync(dbPath)) return defaults;

  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });

    // All-time night mode stats
    const allTime = db.prepare(`
      SELECT COUNT(*) as total_tasks,
             SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) as succeeded,
             COALESCE(SUM(cost_usd_cents), 0) as total_cost_cents,
             COALESCE(SUM(total_tokens), 0) as total_tokens,
             COALESCE(SUM(duration_ms), 0) as total_duration_ms
      FROM executions WHERE branch LIKE 'nightmode/%'
    `).get() as { total_tasks: number; succeeded: number; total_cost_cents: number; total_tokens: number; total_duration_ms: number };

    // This week (last 7 days)
    const weekAgo = daysAgo(7);
    const thisWeek = db.prepare(`
      SELECT COUNT(*) as total_tasks,
             SUM(CASE WHEN exit_code = 0 THEN 1 ELSE 0 END) as succeeded,
             COALESCE(SUM(cost_usd_cents), 0) as total_cost_cents,
             COALESCE(SUM(total_tokens), 0) as total_tokens,
             COALESCE(SUM(duration_ms), 0) as total_duration_ms
      FROM executions WHERE branch LIKE 'nightmode/%' AND started_at >= ?
    `).get(weekAgo) as typeof allTime;

    db.close();

    // Value calculations
    // recoveredDollars: map night tokens to subscription dollar value
    const allTimeRecovered = tierInfo.estimatedDailyTokens > 0
      ? (allTime.total_tokens / tierInfo.estimatedDailyTokens) * dailyBudgetUsd
      : 0;
    const weekRecovered = tierInfo.estimatedDailyTokens > 0
      ? (thisWeek.total_tokens / tierInfo.estimatedDailyTokens) * dailyBudgetUsd
      : 0;

    // hoursRecovered: duration_ms converted to hours (Claude did the work)
    const hoursRecovered = allTime.total_duration_ms / 3_600_000;

    // utilizationBoostPct: this week's night tokens as % of weekly token budget
    const weeklyTokenBudget = tierInfo.estimatedDailyTokens * 7;
    const utilizationBoost = weeklyTokenBudget > 0
      ? (thisWeek.total_tokens / weeklyTokenBudget) * 100
      : 0;

    return {
      allTime: {
        tasksRun: allTime.total_tasks,
        succeeded: allTime.succeeded ?? 0,
        totalCostCents: allTime.total_cost_cents,
        totalTokens: allTime.total_tokens,
        totalMinutes: Math.round(allTime.total_duration_ms / 60_000),
      },
      thisWeek: {
        tasksRun: thisWeek.total_tasks,
        succeeded: thisWeek.succeeded ?? 0,
        totalCostCents: thisWeek.total_cost_cents,
        totalTokens: thisWeek.total_tokens,
        totalMinutes: Math.round(thisWeek.total_duration_ms / 60_000),
      },
      valueSaved: {
        recoveredDollars: Math.round(allTimeRecovered * 100) / 100,
        hoursRecovered: Math.round(hoursRecovered * 10) / 10,
        utilizationBoostPct: Math.round(utilizationBoost * 10) / 10,
        tasksAutomated: allTime.succeeded ?? 0,
      },
    };
  } catch {
    return defaults;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function startServer(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

    if (req.url === '/api/stats') {
      const stats = buildApiStats();
      res.writeHead(stats ? 200 : 503, headers);
      res.end(JSON.stringify(stats ?? { error: 'Stats not available' }));
      return;
    }

    if (req.url === '/api/night-stats') {
      const nightStats = buildNightStats();
      res.writeHead(200, headers);
      res.end(JSON.stringify(nightStats));
      return;
    }

    // Morning report endpoints
    if (req.url?.startsWith('/api/report') && req.method === 'GET') {
      if (req.url === '/api/report/list') {
        res.writeHead(200, headers);
        res.end(JSON.stringify({ dates: getReportDates() }));
        return;
      }
      // /api/report or /api/report?date=YYYY-MM-DD
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const dateParam = url.searchParams.get('date') ?? undefined;
      const report = getReport(dateParam);
      if (report) {
        res.writeHead(200, headers);
        res.end(JSON.stringify(report));
      } else {
        res.writeHead(404, headers);
        res.end(JSON.stringify({ error: 'No report found' }));
      }
      return;
    }

    // Push nightmode branch to remote
    if (req.url === '/api/push' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const { projectPath, branch } = body;

        if (!projectPath || !branch) {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ error: 'Missing projectPath or branch' }));
          return;
        }

        if (!branch.startsWith('nightmode/')) {
          res.writeHead(403, headers);
          res.end(JSON.stringify({ error: 'Only nightmode/ branches can be pushed' }));
          return;
        }

        const resolved = projectPath.replace(/^~/, process.env.HOME ?? '');
        if (!fs.existsSync(path.join(resolved, '.git'))) {
          res.writeHead(400, headers);
          res.end(JSON.stringify({ error: 'Not a git repository' }));
          return;
        }

        const output = execSync(`git push origin ${branch}`, {
          cwd: resolved,
          encoding: 'utf-8',
          timeout: 30_000,
        });
        res.writeHead(200, headers);
        res.end(JSON.stringify({ success: true, output: output.trim() }));
      } catch (err) {
        res.writeHead(500, headers);
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'Push failed' }));
      }
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

  server.listen(port, '127.0.0.1', () => {
    console.log(`CreditForge Dashboard running at http://127.0.0.1:${port}`);
  });

  return server;
}
