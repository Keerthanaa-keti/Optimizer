#!/opt/homebrew/bin/node

// CreditForge xbar Plugin — Token Usage Menubar Monitor
// Refreshes every 5 minutes (per filename convention)
// Self-contained: reads stats-cache.json directly, no monorepo build needed.
//
// NOTE: Claude does not expose session %, weekly limits, or reset timers
// in any local file or CLI command. Those values live server-side only
// (returned in API response headers during streaming, never persisted).
// We show what IS available: daily token counts, messages, sessions, trends.

const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(process.env.HOME || '~', '.claude', 'stats-cache.json');
const OPTIMIZER_DIR = path.join(process.env.HOME || '~', 'Documents', 'ClaudeExperiments', 'optimizer');
const CLI_PATH = path.join(OPTIMIZER_DIR, 'apps', 'cli', 'dist', 'index.js');

const TIER_LIMITS = {
  pro:   { monthlyUsd: 20,  dailyTokens: 500000,   label: 'Pro ($20/mo)' },
  max5:  { monthlyUsd: 100, dailyTokens: 2500000,  label: 'Max 5x ($100/mo)' },
  max20: { monthlyUsd: 200, dailyTokens: 10000000, label: 'Max 20x ($200/mo)' },
};

// ─── Helpers ──────────────────────────────────────────────────

function fmt(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function fmtDate(d) { return d.toISOString().slice(0, 10); }

function ago(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmtDate(d);
}

function getTier() {
  const paths = [
    path.join(OPTIMIZER_DIR, 'creditforge.toml'),
    path.join(process.env.HOME || '~', '.creditforge', 'config.toml'),
  ];
  for (const p of paths) {
    try {
      const content = fs.readFileSync(p, 'utf-8');
      const m = content.match(/tier\s*=\s*"(\w+)"/);
      if (m) return m[1];
    } catch { /* ignore */ }
  }
  return 'max5';
}

function sumDay(entry) {
  if (!entry) return 0;
  return Object.values(entry.tokensByModel).reduce((a, b) => a + b, 0);
}

function bar(pct, w = 10) {
  const f = Math.round((pct / 100) * w);
  return '\u2588'.repeat(f) + '\u2591'.repeat(w - f);
}

function signalBars(pct) {
  if (pct <= 0)  return '\u2581\u2581';
  if (pct < 10)  return '\u2582\u2581';
  if (pct < 25)  return '\u2582\u2583';
  if (pct < 50)  return '\u2583\u2585';
  if (pct < 75)  return '\u2585\u2586';
  if (pct < 90)  return '\u2586\u2587';
  return '\u2587\u2588';
}

function menuColor(pct) {
  if (pct >= 80) return 'red';
  if (pct >= 60) return '#ff8c00';
  if (pct >= 40) return 'yellow';
  return 'green';
}

function dayChar(dateStr) {
  return ['S','M','T','W','T','F','S'][new Date(dateStr + 'T12:00:00').getDay()];
}

// xbar uses | as param separator, so display text must not contain |
// Use \u007c (pipe) only as the separator before params at end of line
function line(text, params) {
  if (params) return `${text} | ${params}`;
  return text;
}

// ─── Main ─────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(STATS_PATH)) {
    console.log('CF -- | color=gray');
    console.log('---');
    console.log('Stats not found');
    console.log('Run Claude Code to generate ~/.claude/stats-cache.json');
    return;
  }

  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8'));
  } catch {
    console.log('CF ERR | color=red');
    console.log('---');
    console.log('Failed to parse stats-cache.json');
    return;
  }

  const tier = getTier();
  const ti = TIER_LIMITS[tier] || TIER_LIMITS.max5;
  const today = fmtDate(new Date());

  // ── Today ───────────────────────────────────────────────────
  const todayTok = (cache.dailyModelTokens || []).find(d => d.date === today);
  const todayAct = (cache.dailyActivity || []).find(d => d.date === today);
  const tTokens = sumDay(todayTok);
  const tMsgs = todayAct ? todayAct.messageCount : 0;
  const tSess = todayAct ? todayAct.sessionCount : 0;
  const tTools = todayAct ? todayAct.toolCallCount : 0;

  const pct = ti.dailyTokens > 0
    ? Math.round((tTokens / ti.dailyTokens) * 1000) / 10
    : 0;
  const remaining = Math.max(0, ti.dailyTokens - tTokens);

  // ── Week (7 days) ───────────────────────────────────────────
  const wStart = ago(7);
  const wEntries = (cache.dailyModelTokens || []).filter(d => d.date >= wStart && d.date <= today);
  const wTokens = wEntries.reduce((s, e) => s + sumDay(e), 0);
  const wDays = wEntries.length || 1;
  const wAvg = Math.round(wTokens / wDays);

  let peak = { date: today, tokens: 0 };
  for (const e of wEntries) {
    const t = sumDay(e);
    if (t > peak.tokens) peak = { date: e.date, tokens: t };
  }

  const recent = wEntries.slice(-3);
  const older = wEntries.slice(0, -3);
  const rAvg = recent.length > 0 ? recent.reduce((s, e) => s + sumDay(e), 0) / recent.length : 0;
  const oAvg = older.length > 0 ? older.reduce((s, e) => s + sumDay(e), 0) / older.length : 0;
  let trend = '\u2192 stable';
  if (oAvg > 0 && rAvg > oAvg * 1.2) trend = '\u2191 increasing';
  else if (oAvg > 0 && rAvg < oAvg * 0.8) trend = '\u2193 decreasing';

  // ── Sparkline ───────────────────────────────────────────────
  const spk = ['\u2581','\u2582','\u2583','\u2584','\u2585','\u2586','\u2587','\u2588'];
  const sparkVals = [];
  const sparkLabels = [];
  for (let i = 6; i >= 0; i--) {
    const ds = ago(i);
    sparkLabels.push(dayChar(ds));
    sparkVals.push(sumDay((cache.dailyModelTokens || []).find(d => d.date === ds)));
  }
  const sMax = Math.max(...sparkVals, 1);
  const sparkStr = sparkLabels.map((l, i) =>
    l + spk[Math.min(Math.floor((sparkVals[i] / sMax) * 7), 7)]
  ).join(' ');

  // ── Activity ────────────────────────────────────────────────
  const a30 = (cache.dailyActivity || []).filter(d => d.date >= ago(30) && d.date <= today);
  const aDays = a30.length > 0 ? Math.round((a30.length / 30) * 7 * 10) / 10 : 0;

  const topHours = Object.entries(cache.hourCounts || {})
    .map(([h, c]) => ({ h: parseInt(h), c }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 3)
    .map(x => `${String(x.h).padStart(2, '0')}:00`)
    .join(', ');

  // ── Models today ────────────────────────────────────────────
  const models = todayTok
    ? Object.entries(todayTok.tokensByModel)
        .sort((a, b) => b[1] - a[1])
        .map(([m, t]) => `${m.replace('claude-', '').replace(/-\d{8}$/, '')}: ${fmt(t)}`)
    : [];

  // ── Last updated ────────────────────────────────────────────
  const lastUpdated = cache.lastComputedDate || 'unknown';

  // ═══════════════════════════════════════════════════════════
  // OUTPUT (no | in display text — only before params)
  // ═══════════════════════════════════════════════════════════

  // Menubar
  console.log(line(`CF ${signalBars(pct)} ${pct}%`, `color=${menuColor(pct)} font=Menlo size=12`));
  console.log('---');

  // Today header
  console.log(line('\u25C9 TODAY', 'size=12 color=white'));
  console.log(line(`  Tokens: ${fmt(tTokens)} / ${fmt(ti.dailyTokens)}  ${bar(pct)} ${pct}%`, 'font=Menlo size=12'));
  console.log(line(`  Messages: ${tMsgs}`, 'font=Menlo size=12'));
  console.log(line(`  Sessions: ${tSess}`, 'font=Menlo size=12'));
  console.log(line(`  Tool calls: ${tTools}`, 'font=Menlo size=12'));
  console.log(line(`  Remaining: ~${fmt(remaining)} est.`, 'font=Menlo size=12'));
  if (models.length > 0) {
    for (const m of models) {
      console.log(line(`  \u2022 ${m}`, 'font=Menlo size=11 color=#8b949e'));
    }
  }
  console.log('---');

  // Week
  console.log(line('\u25C9 THIS WEEK', 'size=12 color=white'));
  console.log(line(`  Total: ${fmt(wTokens)} tokens`, 'font=Menlo size=12'));
  console.log(line(`  Avg/day: ${fmt(wAvg)}`, 'font=Menlo size=12'));
  console.log(line(`  Peak: ${fmt(peak.tokens)} (${peak.date.slice(5)})`, 'font=Menlo size=12'));
  console.log(line(`  Trend: ${trend}`, 'font=Menlo size=12'));
  console.log('---');

  // Sparkline
  console.log(line('\u25C9 7-DAY SPARKLINE', 'size=12 color=white'));
  console.log(line(`  ${sparkStr}`, 'font=Menlo size=13'));
  console.log('---');

  // Activity
  console.log(line('\u25C9 ACTIVITY', 'size=12 color=white'));
  console.log(line(`  Peak hours: ${topHours}`, 'font=Menlo size=12'));
  console.log(line(`  Active: ${aDays} days/week`, 'font=Menlo size=12'));
  console.log('---');

  // All time
  const since = (cache.firstSessionDate || '').slice(0, 10);
  console.log(line(`All time: ${cache.totalSessions || 0} sessions \u00b7 ${fmt(cache.totalMessages || 0)} msgs \u00b7 since ${since}`, 'size=11 color=#8b949e'));
  console.log(line(`Data from: ${lastUpdated} (updates on session start)`, 'size=10 color=#6e7681'));
  console.log('---');

  // Note about limitations
  console.log(line('\u26A0 Session % and weekly limits are server-side only', 'size=10 color=#6e7681'));
  console.log(line('  Not available in any local file or CLI', 'size=10 color=#6e7681'));
  console.log('---');

  // Actions
  console.log(line('Open Dashboard', `bash=/opt/homebrew/bin/node param1=${CLI_PATH} param2=dashboard param3=--open terminal=false`));
  console.log(line('Refresh', 'refresh=true'));
  console.log(line(`Plan: ${ti.label}`, 'color=#8b949e'));
}

main();
