/**
 * Cost-weighted JSONL scanner — single source of truth for usage percentages.
 * Matches Claude's Usage page: session (5h window), weekly, and sonnet-only limits.
 * Extracted from xbar/creditforge.5m.js for reuse in Electron menubar + CLI.
 */

import fs from 'node:fs';
import path from 'node:path';

// ─── Model Pricing (cost per million tokens, USD) ─────────────

export const MODEL_PRICING: Record<string, TokenPricing> = {
  'claude-opus-4-6':            { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4-5-20250620':   { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-5-20250929': { input: 3,    output: 15,  cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5-20251001':  { input: 0.8,  output: 4,   cacheWrite: 1.0,   cacheRead: 0.08 },
};

const DEFAULT_PRICING: TokenPricing = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 };

const SONNET_MODELS = new Set(['claude-sonnet-4-5-20250929']);

// ─── Subscription Tiers ───────────────────────────────────────

export const COST_TIERS: Record<CostTier, TierBudget> = {
  pro:   { sessionBudget: 21,  weeklyBudget: 1620, sonnetWeeklyBudget: 810,  label: 'Pro $20/mo' },
  max5:  { sessionBudget: 104, weeklyBudget: 1620, sonnetWeeklyBudget: 810,  label: 'Max 5\u00d7 $100/mo' },
  max20: { sessionBudget: 416, weeklyBudget: 6480, sonnetWeeklyBudget: 3240, label: 'Max 20\u00d7 $200/mo' },
};

// ─── Types ────────────────────────────────────────────────────

export type CostTier = 'pro' | 'max5' | 'max20';

export interface TokenPricing {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface TierBudget {
  sessionBudget: number;
  weeklyBudget: number;
  sonnetWeeklyBudget: number;
  label: string;
}

export interface TokenEntry {
  model: string;
  timestamp: string;
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface SessionData {
  cost: number;
  msgs: number;
  byModel: Record<string, number>;
  oldestTs: string | null;
}

export interface UsageData {
  session: SessionData;
  weekly: { cost: number; msgs: number };
  sonnetWeekly: { cost: number };
  activeSessions: number;
}

export interface UsagePercentages {
  sessionPct: number;
  weeklyPct: number;
  sonnetPct: number;
  tier: TierBudget;
  data: UsageData;
}

// ─── Constants ────────────────────────────────────────────────

const SESSION_WINDOW_HOURS = 5;
const WEEK_MS = 7 * 86400000;
const ACTIVE_THRESHOLD_MS = 3 * 60 * 1000;

// ─── Scanner ──────────────────────────────────────────────────

function getClaudeProjectsDir(): string {
  return path.join(process.env.HOME ?? '~', '.claude', 'projects');
}

function findJsonlFiles(projectsDir: string, maxAgeMs: number): Array<{ path: string; mtime: number }> {
  const now = Date.now();
  const cutoff = now - maxAgeMs;
  const files: Array<{ path: string; mtime: number }> = [];

  let projects: string[];
  try { projects = fs.readdirSync(projectsDir); } catch { return files; }

  for (const proj of projects) {
    const projPath = path.join(projectsDir, proj);
    let entries: string[];
    try { entries = fs.readdirSync(projPath); } catch { continue; }

    for (const entry of entries) {
      const full = path.join(projPath, entry);

      // Direct .jsonl files
      if (entry.endsWith('.jsonl')) {
        try {
          const st = fs.statSync(full);
          if (st.mtimeMs > cutoff) {
            files.push({ path: full, mtime: st.mtimeMs });
          }
        } catch { /* skip */ }
      }

      // Subagent files: <session-uuid>/subagents/*.jsonl
      const subDir = path.join(full, 'subagents');
      try {
        for (const sf of fs.readdirSync(subDir)) {
          if (!sf.endsWith('.jsonl')) continue;
          const sfull = path.join(subDir, sf);
          try {
            const st = fs.statSync(sfull);
            if (st.mtimeMs > cutoff) {
              files.push({ path: sfull, mtime: st.mtimeMs });
            }
          } catch { /* skip */ }
        }
      } catch { /* no subagents dir */ }
    }
  }

  return files;
}

function costOf(entry: TokenEntry): number {
  const p = MODEL_PRICING[entry.model] || DEFAULT_PRICING;
  return (
    entry.input * p.input +
    entry.output * p.output +
    entry.cacheCreate * p.cacheWrite +
    entry.cacheRead * p.cacheRead
  ) / 1e6;
}

/**
 * Scan Claude JSONL session files and compute cost-weighted usage.
 * Returns session (5h window), weekly (7 day), and sonnet-only costs + metadata.
 */
export function scanUsage(): UsageData {
  const now = Date.now();
  const sessionCutoff = new Date(now - SESSION_WINDOW_HOURS * 3600000).toISOString();
  const weekAgo = new Date(now - WEEK_MS).toISOString();
  const threeMinAgo = now - ACTIVE_THRESHOLD_MS;

  const projectsDir = getClaudeProjectsDir();
  const jsonlFiles = findJsonlFiles(projectsDir, WEEK_MS);

  // Parse: last usage per message ID, track timestamps for session window
  const byMsgId = new Map<string, TokenEntry>();
  const activeFiles = new Set<string>();
  let oldestActivityTs: string | null = null;

  for (const file of jsonlFiles) {
    let content: string;
    try { content = fs.readFileSync(file.path, 'utf-8'); } catch { continue; }
    const isActive = file.mtime > threeMinAgo;

    for (const line of content.split('\n')) {
      if (!line) continue;
      let obj: any;
      try { obj = JSON.parse(line); } catch { continue; }

      // Track earliest activity in session window for reset countdown
      if (obj.timestamp && obj.timestamp >= sessionCutoff) {
        if ((obj.type === 'user' || obj.type === 'assistant') &&
            (!oldestActivityTs || obj.timestamp < oldestActivityTs)) {
          oldestActivityTs = obj.timestamp;
        }
      }

      // Extract token usage from assistant/progress messages
      let timestamp: string | undefined;
      let msgId: string | undefined;
      let model: string | undefined;
      let usage: any;

      if (obj.type === 'assistant' && obj.message?.usage) {
        timestamp = obj.timestamp;
        msgId = obj.message?.id || obj.requestId;
        model = obj.message.model;
        usage = obj.message.usage;
      } else if (obj.type === 'progress' && obj.data?.message?.message?.usage) {
        timestamp = obj.data.message.timestamp || obj.timestamp;
        msgId = obj.data.message.message?.id || obj.data.message.requestId;
        model = obj.data.message.message.model;
        usage = obj.data.message.message.usage;
      } else {
        continue;
      }

      if (!timestamp || !model || model === '<synthetic>' || !usage) continue;

      const key = msgId || `${file.path}:${timestamp}`;
      byMsgId.set(key, {
        model,
        timestamp,
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cacheCreate: usage.cache_creation_input_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
      });

      if (isActive) activeFiles.add(file.path);
    }
  }

  // Aggregate costs by time window
  let sessionCost = 0;
  let weeklyCost = 0;
  let sonnetWeeklyCost = 0;
  let sessionMsgs = 0;
  let weeklyMsgs = 0;
  const sessionByModel: Record<string, number> = {};

  for (const entry of byMsgId.values()) {
    const cost = costOf(entry);

    if (entry.timestamp >= weekAgo) {
      weeklyCost += cost;
      weeklyMsgs++;
      if (SONNET_MODELS.has(entry.model)) {
        sonnetWeeklyCost += cost;
      }
    }

    if (entry.timestamp >= sessionCutoff) {
      sessionCost += cost;
      sessionMsgs++;
      const shortModel = entry.model.replace('claude-', '').replace(/-\d{8}$/, '');
      sessionByModel[shortModel] = (sessionByModel[shortModel] || 0) + cost;
    }
  }

  return {
    session: { cost: sessionCost, msgs: sessionMsgs, byModel: sessionByModel, oldestTs: oldestActivityTs },
    weekly: { cost: weeklyCost, msgs: weeklyMsgs },
    sonnetWeekly: { cost: sonnetWeeklyCost },
    activeSessions: activeFiles.size,
  };
}

/**
 * Compute usage percentages against tier budgets.
 */
export function getUsagePercentages(tier: CostTier = 'max5'): UsagePercentages {
  const budget = COST_TIERS[tier];
  const data = scanUsage();

  const sessionPct = budget.sessionBudget > 0
    ? Math.round(data.session.cost / budget.sessionBudget * 1000) / 10
    : 0;
  const weeklyPct = budget.weeklyBudget > 0
    ? Math.round(data.weekly.cost / budget.weeklyBudget * 1000) / 10
    : 0;
  const sonnetPct = budget.sonnetWeeklyBudget > 0
    ? Math.round(data.sonnetWeekly.cost / budget.sonnetWeeklyBudget * 1000) / 10
    : 0;

  return { sessionPct, weeklyPct, sonnetPct, tier: budget, data };
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Session reset countdown based on oldest activity timestamp.
 */
export function getSessionResetCountdown(oldestTs: string | null): { label: string; resetAtMs: number } {
  if (!oldestTs) {
    return {
      label: `Resets in ${SESSION_WINDOW_HOURS}h 0min`,
      resetAtMs: Date.now() + SESSION_WINDOW_HOURS * 3600000,
    };
  }
  const resetAt = new Date(oldestTs).getTime() + SESSION_WINDOW_HOURS * 3600000;
  const diff = resetAt - Date.now();
  if (diff <= 0) return { label: 'Resets soon', resetAtMs: resetAt };
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return { label: `Resets in ${h} hr ${m} min`, resetAtMs: resetAt };
}

/**
 * Next weekly reset day label (e.g., "Resets Sat 2:30 PM").
 */
export function getWeeklyResetLabel(targetDay: number, hour: number, minute: number): string {
  const now = new Date();
  let daysUntil = (targetDay - now.getDay() + 7) % 7;
  if (daysUntil === 0) {
    const target = new Date(now);
    target.setHours(hour, minute, 0, 0);
    if (now >= target) daysUntil = 7;
  }
  const resetDate = new Date(now);
  resetDate.setDate(now.getDate() + daysUntil);
  resetDate.setHours(hour, minute, 0, 0);
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][resetDate.getDay()];
  return `Resets ${dayName} ${resetDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export { SESSION_WINDOW_HOURS };
