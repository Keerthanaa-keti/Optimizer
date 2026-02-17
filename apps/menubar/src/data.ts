import {
  getUsagePercentages,
  getSessionResetCountdown,
  getWeeklyResetLabel,
  loadStatsCache,
} from '@creditforge/token-monitor';
import type { UsagePercentages } from '@creditforge/token-monitor';
import { getIntelligenceReport, computeActionableInsights } from '@creditforge/intelligence';
import type { IntelligenceReport, ActionableInsight } from '@creditforge/intelligence';
import fs from 'node:fs';
import path from 'node:path';

function getAppRoot(): string {
  if (process.env.CREDITFORGE_ROOT) return process.env.CREDITFORGE_ROOT;
  const cwd = process.cwd();
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    if (pkg.name === 'creditforge') return cwd;
  } catch { /* ignore */ }
  return path.join(process.env.HOME ?? '~', '.creditforge', 'app');
}

function loadTier(): 'pro' | 'max5' | 'max20' {
  const configPaths = [
    path.join(process.env.HOME ?? '~', '.creditforge', 'config.toml'),
    path.join(getAppRoot(), 'creditforge.toml'),
  ];
  for (const p of configPaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8');
      const match = content.match(/tier\s*=\s*"(\w+)"/);
      if (match?.[1] === 'pro' || match?.[1] === 'max5' || match?.[1] === 'max20') {
        return match[1];
      }
    } catch { /* skip */ }
  }
  return 'max5';
}

export interface MenubarUsageData extends UsagePercentages {
  sessionResetLabel: string;
  sessionResetAtMs: number;
  weeklyResetLabel: string;
  sonnetResetLabel: string;
}

export function getUsageData(): MenubarUsageData {
  const tier = loadTier();
  const usage = getUsagePercentages(tier);
  const sessionReset = getSessionResetCountdown(usage.data.session.oldestTs);

  return {
    ...usage,
    sessionResetLabel: sessionReset.label,
    sessionResetAtMs: sessionReset.resetAtMs,
    weeklyResetLabel: getWeeklyResetLabel(6, 14, 30),   // Sat 2:30 PM
    sonnetResetLabel: getWeeklyResetLabel(1, 21, 30),    // Mon 9:30 PM
  };
}

// ─── Subscription View ──────────────────────────────

const TIER_MONTHLY_SUB: Record<string, number> = { pro: 20, max5: 100, max20: 200 };

export interface SubscriptionView {
  tierLabel: string;
  planMonthly: number;
  planWeekly: number;
  weeklyUsedSub: number;
  weeklyRemainingSub: number;
  weeklyPct: number;
  weeklyResetLabel: string;
  weeklyMsgs: number;
  sessionSpentSub: number;
  sessionPct: number;
  sessionResetLabel: string;
  sessionMsgs: number;
  utilizationPct: number;
  wastedWeeklySub: number;
}

export function getSubscriptionView(): SubscriptionView {
  const tier = loadTier();
  const usage = getUsagePercentages(tier);
  const sessionReset = getSessionResetCountdown(usage.data.session.oldestTs);
  const monthly = TIER_MONTHLY_SUB[tier] ?? 100;
  const weekly = monthly * 12 / 52;  // $23.08 for max5

  // Use the percentage as bridge: if 34% of API budget used, 34% of subscription used
  const weeklyUsed = (usage.weeklyPct / 100) * weekly;
  const weeklyRemaining = Math.max(weekly - weeklyUsed, 0);

  // Session: map session cost to subscription dollars via weekly budget ratio
  const sessionSub = usage.tier.weeklyBudget > 0
    ? (usage.data.session.cost / usage.tier.weeklyBudget) * weekly
    : 0;

  return {
    tierLabel: usage.tier.label,
    planMonthly: monthly,
    planWeekly: Math.round(weekly * 100) / 100,
    weeklyUsedSub: Math.round(weeklyUsed * 100) / 100,
    weeklyRemainingSub: Math.round(weeklyRemaining * 100) / 100,
    weeklyPct: usage.weeklyPct,
    weeklyResetLabel: getWeeklyResetLabel(6, 14, 30),
    weeklyMsgs: usage.data.weekly.msgs,
    sessionSpentSub: Math.round(sessionSub * 100) / 100,
    sessionPct: usage.sessionPct,
    sessionResetLabel: sessionReset.label,
    sessionMsgs: usage.data.session.msgs,
    utilizationPct: usage.weeklyPct,
    wastedWeeklySub: Math.round(weeklyRemaining * 100) / 100,
  };
}

// ─── Session Budget Planner ──────────────────────────

// Approximate cost per message by model (USD, based on typical Claude usage)
const MODEL_COST_PER_MSG: Record<string, number> = {
  'claude-opus-4-6': 8.50,
  'claude-sonnet-4-5-20250929': 1.20,
  'claude-haiku-4-5-20251001': 0.30,
  // Fallback aliases
  'opus': 8.50,
  'sonnet': 1.20,
  'haiku': 0.30,
};

export interface BudgetPlan {
  remainingBudget: number;  // USD
  models: Array<{
    name: string;
    displayName: string;
    estimatedMessages: number;
    costPerMsg: number;
  }>;
  recommendation: string;
}

export function getSessionBudgetPlan(): BudgetPlan {
  const tier = loadTier();
  const usage = getUsagePercentages(tier);
  const remaining = Math.max(usage.tier.sessionBudget - usage.data.session.cost, 0);

  // Compute per-model average from actual session data, fall back to defaults
  const byModel = usage.data.session.byModel;
  const msgs = usage.data.session.msgs;

  function avgCostForModel(modelKey: string): number {
    // Try to find actual cost from session data
    for (const [name, cost] of Object.entries(byModel)) {
      if (name.toLowerCase().includes(modelKey)) {
        // Count messages for this model (approximate: split proportionally)
        const modelShare = cost / Math.max(usage.data.session.cost, 0.01);
        const modelMsgs = Math.round(msgs * modelShare);
        if (modelMsgs > 0) return cost / modelMsgs;
      }
    }
    return MODEL_COST_PER_MSG[modelKey] ?? 1.0;
  }

  const models = [
    { name: 'opus', displayName: 'Opus', costPerMsg: avgCostForModel('opus') },
    { name: 'sonnet', displayName: 'Sonnet', costPerMsg: avgCostForModel('sonnet') },
    { name: 'haiku', displayName: 'Haiku', costPerMsg: avgCostForModel('haiku') },
  ].map(m => ({
    ...m,
    estimatedMessages: m.costPerMsg > 0 ? Math.floor(remaining / m.costPerMsg) : 0,
  }));

  const opusMsgs = models[0].estimatedMessages;
  const haikuMsgs = models[2].estimatedMessages;
  const recommendation = remaining <= 0
    ? 'Session budget exhausted — resets soon'
    : `~${opusMsgs} Opus or ~${haikuMsgs} Haiku messages left`;

  return { remainingBudget: remaining, models, recommendation };
}

// ─── Night Mode / Task Queue Data ──────────────────────────

export interface QueuedTask {
  id: number;
  title: string;
  project: string;
  score: number;
  source: string;
  category: string;
}

export interface NightModeStatus {
  queuedTasks: number;
  completedToday: number;
  failedToday: number;
  totalSpentToday: number;  // USD cents
  lastRunAt: string | null;
  lastRunSuccess: boolean | null;
  nextRunAt: string;
  isEnabled: boolean;
  topTasks: Array<{ id: number; title: string; project: string; score: number }>;
  // Subscription context
  dailySubBudget: number;   // e.g. $3.29 for max5
  nightSubBudget: number;   // 75% of daily = $2.47
  nightHours: number;       // e.g. 7 (11PM-6AM)
}

function getNightModeSubContext() {
  const tier = loadTier();
  const monthly = TIER_MONTHLY_SUB[tier] ?? 100;
  const dailySub = Math.round((monthly * 12 / 365) * 100) / 100;
  // Read night mode config for cap % and hours
  let capPct = 75;
  let startHour = 23;
  let endHour = 6;
  try {
    const content = fs.readFileSync(getConfigPath(), 'utf-8');
    const capMatch = content.match(/credit_cap_percent\s*=\s*(\d+)/);
    if (capMatch) capPct = parseInt(capMatch[1], 10);
    const startMatch = content.match(/start_hour\s*=\s*(\d+)/);
    if (startMatch) startHour = parseInt(startMatch[1], 10);
    const endMatch = content.match(/end_hour\s*=\s*(\d+)/);
    if (endMatch) endHour = parseInt(endMatch[1], 10);
  } catch { /* use defaults */ }
  const nightHours = (endHour + 24 - startHour) % 24;
  const nightSubBudget = Math.round(dailySub * (capPct / 100) * 100) / 100;
  return { dailySubBudget: dailySub, nightSubBudget, nightHours };
}

export function getNightModeStatus(): NightModeStatus {
  const cfDir = path.join(process.env.HOME ?? '~', '.creditforge');
  const dbPath = path.join(cfDir, 'creditforge.db');
  const subCtx = getNightModeSubContext();

  // Default response if DB doesn't exist
  const defaults: NightModeStatus = {
    queuedTasks: 0,
    completedToday: 0,
    failedToday: 0,
    totalSpentToday: 0,
    lastRunAt: null,
    lastRunSuccess: null,
    nextRunAt: getNextRunTime(),
    isEnabled: isNightModeEnabled(),
    topTasks: [],
    ...subCtx,
  };

  if (!fs.existsSync(dbPath)) return defaults;

  try {
    // Use better-sqlite3 directly (avoid singleton conflicts with CLI)
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);

    const today = new Date().toISOString().split('T')[0];

    // Queued task count
    const queued = db.prepare('SELECT COUNT(*) as count FROM tasks WHERE status = ?').get('queued') as { count: number };

    // Today's completed/failed
    const completed = db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE status = 'completed' AND updated_at >= ?"
    ).get(today) as { count: number };

    const failed = db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE status = 'failed' AND updated_at >= ?"
    ).get(today) as { count: number };

    // Today's spend
    const spent = db.prepare(
      'SELECT COALESCE(SUM(cost_usd_cents), 0) as total FROM executions WHERE started_at >= ?'
    ).get(today) as { total: number };

    // Last execution
    const lastExec = db.prepare(
      'SELECT started_at, exit_code FROM executions ORDER BY started_at DESC LIMIT 1'
    ).get() as { started_at: string; exit_code: number } | undefined;

    // Top 5 queued tasks by score
    const topRows = db.prepare(
      'SELECT id, title, project_name, score FROM tasks WHERE status = ? ORDER BY score DESC LIMIT 5'
    ).all('queued') as Array<{ id: number; title: string; project_name: string; score: number }>;

    db.close();

    return {
      queuedTasks: queued.count,
      completedToday: completed.count,
      failedToday: failed.count,
      totalSpentToday: spent.total,
      lastRunAt: lastExec?.started_at ?? null,
      lastRunSuccess: lastExec ? lastExec.exit_code === 0 : null,
      nextRunAt: getNextRunTime(),
      isEnabled: isNightModeEnabled(),
      topTasks: topRows.map(r => ({ id: r.id, title: r.title, project: r.project_name, score: r.score })),
      ...subCtx,
    };
  } catch {
    return defaults;
  }
}

function getConfigPath(): string {
  const userConfig = path.join(process.env.HOME ?? '~', '.creditforge', 'config.toml');
  if (fs.existsSync(userConfig)) return userConfig;
  return path.join(getAppRoot(), 'creditforge.toml');
}

function isNightModeEnabled(): boolean {
  try {
    const content = fs.readFileSync(getConfigPath(), 'utf-8');
    return /enabled\s*=\s*true/.test(content);
  } catch {
    return false;
  }
}

export function toggleNightModeConfig(): boolean {
  const configPath = getConfigPath();
  try {
    let content = fs.readFileSync(configPath, 'utf-8');
    const wasEnabled = /enabled\s*=\s*true/.test(content);
    if (wasEnabled) {
      content = content.replace(/enabled\s*=\s*true/, 'enabled = false');
    } else {
      content = content.replace(/enabled\s*=\s*false/, 'enabled = true');
    }
    fs.writeFileSync(configPath, content, 'utf-8');
    return !wasEnabled;
  } catch {
    return false;
  }
}

export function getAllQueuedTasks(): QueuedTask[] {
  const dbPath = path.join(process.env.HOME ?? '~', '.creditforge', 'creditforge.db');
  if (!fs.existsSync(dbPath)) return [];

  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);

    const rows = db.prepare(
      'SELECT id, title, project_name, score, source, category FROM tasks WHERE status = ? ORDER BY score DESC'
    ).all('queued') as Array<{ id: number; title: string; project_name: string; score: number; source: string; category: string }>;

    db.close();
    return rows.map(r => ({
      id: r.id,
      title: r.title,
      project: r.project_name,
      score: r.score,
      source: r.source,
      category: r.category,
    }));
  } catch {
    return [];
  }
}

function getNextRunTime(): string {
  const now = new Date();
  const next = new Date(now);
  next.setHours(23, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  const diffMs = next.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) return `in ${hours}h ${mins}m`;
  return `in ${mins}m`;
}

// ─── Morning Report ──────────────────────────

export interface MorningReport {
  date: string;
  content: string;
  exists: boolean;
}

export function getMorningReport(): MorningReport {
  const today = new Date().toISOString().split('T')[0];
  const reportPath = path.join(process.env.HOME ?? '~', '.creditforge', 'reports', `${today}.md`);

  if (fs.existsSync(reportPath)) {
    return {
      date: today,
      content: fs.readFileSync(reportPath, 'utf-8'),
      exists: true,
    };
  }

  // Check yesterday's report
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const yesterdayPath = path.join(process.env.HOME ?? '~', '.creditforge', 'reports', `${yesterday}.md`);

  if (fs.existsSync(yesterdayPath)) {
    return {
      date: yesterday,
      content: fs.readFileSync(yesterdayPath, 'utf-8'),
      exists: true,
    };
  }

  return { date: today, content: '', exists: false };
}

// ─── Intelligence Data ──────────────────────────

export interface IntelligenceDataWithActionable extends IntelligenceReport {
  actionable: ActionableInsight;
}

export function getIntelligenceData(): IntelligenceDataWithActionable {
  const tier = loadTier();
  const usage = getUsagePercentages(tier);
  const cache = loadStatsCache();

  // Open DB readonly (same pattern as getNightModeStatus)
  const dbPath = path.join(process.env.HOME ?? '~', '.creditforge', 'creditforge.db');
  let db = null;

  if (fs.existsSync(dbPath)) {
    try {
      const Database = require('better-sqlite3');
      db = new Database(dbPath);
    } catch {
      // DB unavailable — proceed without task learning
    }
  }

  try {
    const report = getIntelligenceReport(usage, cache, db);

    // Get night mode info for actionable insights
    const nm = getNightModeStatus();

    const actionable = computeActionableInsights(
      usage,
      report.burnRate,
      nm.isEnabled,
      nm.queuedTasks,
      report.scheduleSuggestion,
    );

    return { ...report, actionable };
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
}
