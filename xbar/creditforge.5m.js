#!/opt/homebrew/bin/node

// CreditForge xbar Plugin — Enhanced Token Usage Menubar Monitor
// Refreshes every 5 minutes (per filename convention)
// Self-contained: reads stats-cache.json directly, no monorepo build needed.

const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(process.env.HOME || '~', '.claude', 'stats-cache.json');
const OPTIMIZER_DIR = path.join(process.env.HOME || '~', 'Documents', 'ClaudeExperiments', 'optimizer');
const CLI_PATH = path.join(OPTIMIZER_DIR, 'apps', 'cli', 'dist', 'index.js');
const DASHBOARD_PORT = 3141;

const TIER_LIMITS = {
  pro:   { monthlyUsd: 20,  dailyTokens: 500000,   label: 'Pro ($20/mo)' },
  max5:  { monthlyUsd: 100, dailyTokens: 2500000,  label: 'Max 5x ($100/mo)' },
  max20: { monthlyUsd: 200, dailyTokens: 10000000, label: 'Max 20x ($200/mo)' },
};

// ─── Helpers ──────────────────────────────────────────────────

function formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return formatDate(d);
}

function getTier() {
  const paths = [
    path.join(OPTIMIZER_DIR, 'creditforge.toml'),
    path.join(process.env.HOME || '~', '.creditforge', 'config.toml'),
  ];
  for (const p of paths) {
    try {
      const content = fs.readFileSync(p, 'utf-8');
      const match = content.match(/tier\s*=\s*"(\w+)"/);
      if (match) return match[1];
    } catch { /* ignore */ }
  }
  return 'max5';
}

function sumDayTokens(entry) {
  if (!entry) return 0;
  return Object.values(entry.tokensByModel).reduce((a, b) => a + b, 0);
}

function progressBar(pct, width = 10) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

// Signal strength bars based on usage percentage
// More usage = more bars lit up
function signalBars(pct) {
  if (pct <= 0)  return '\u2581\u2581';
  if (pct < 10)  return '\u2582\u2581';
  if (pct < 25)  return '\u2582\u2583';
  if (pct < 50)  return '\u2583\u2585';
  if (pct < 75)  return '\u2585\u2586';
  if (pct < 90)  return '\u2586\u2587';
  return '\u2587\u2588';
}

// Sparkline from array of values (7 days)
function sparkline(values) {
  const chars = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];
  const max = Math.max(...values, 1);
  return values.map(v => chars[Math.min(Math.floor((v / max) * 7), 7)]).join('');
}

function menubarColor(pct) {
  if (pct >= 80) return 'red';
  if (pct >= 60) return '#ff8c00'; // orange
  if (pct >= 40) return 'yellow';
  return 'green';
}

function dayLabel(dateStr) {
  const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const d = new Date(dateStr + 'T12:00:00');
  return days[d.getDay()];
}

function topNHours(hourCounts, n = 3) {
  return Object.entries(hourCounts || {})
    .map(([h, c]) => ({ hour: parseInt(h), count: c }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map(h => `${String(h.hour).padStart(2, '0')}:00`)
    .join(', ');
}

// ─── Main ─────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(STATS_PATH)) {
    console.log('CF \u2581\u2581 -- | color=gray');
    console.log('---');
    console.log('Stats not found');
    console.log('Expected: ~/.claude/stats-cache.json');
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
  const tierInfo = TIER_LIMITS[tier] || TIER_LIMITS.max5;
  const today = formatDate(new Date());

  // ─── Today's data ─────────────────────────────────────────
  const todayTokenEntry = (cache.dailyModelTokens || []).find(d => d.date === today);
  const todayTokens = sumDayTokens(todayTokenEntry);
  const todayActivity = (cache.dailyActivity || []).find(d => d.date === today);
  const todayMessages = todayActivity ? todayActivity.messageCount : 0;
  const todaySessions = todayActivity ? todayActivity.sessionCount : 0;
  const todayTools = todayActivity ? todayActivity.toolCallCount : 0;

  const pct = tierInfo.dailyTokens > 0
    ? Math.round((todayTokens / tierInfo.dailyTokens) * 1000) / 10
    : 0;
  const remaining = Math.max(0, tierInfo.dailyTokens - todayTokens);

  // ─── Week data (last 7 days) ──────────────────────────────
  const weekStartStr = daysAgo(7);
  const weekEntries = (cache.dailyModelTokens || []).filter(
    d => d.date >= weekStartStr && d.date <= today
  );
  const weekTokens = weekEntries.reduce((s, e) => s + sumDayTokens(e), 0);
  const daysWithData = weekEntries.length || 1;
  const avg7d = Math.round(weekTokens / daysWithData);

  // Peak day in last 7
  let peakDay = { date: today, tokens: 0 };
  for (const entry of weekEntries) {
    const t = sumDayTokens(entry);
    if (t > peakDay.tokens) peakDay = { date: entry.date, tokens: t };
  }

  // Trend: compare last 3 days avg vs prior 4 days avg
  const recentDays = weekEntries.slice(-3);
  const olderDays = weekEntries.slice(0, -3);
  const recentAvg = recentDays.length > 0
    ? recentDays.reduce((s, e) => s + sumDayTokens(e), 0) / recentDays.length
    : 0;
  const olderAvg = olderDays.length > 0
    ? olderDays.reduce((s, e) => s + sumDayTokens(e), 0) / olderDays.length
    : 0;
  let trend = 'stable';
  if (recentAvg > olderAvg * 1.2) trend = '\u2191 increasing';
  else if (recentAvg < olderAvg * 0.8) trend = '\u2193 decreasing';

  // ─── 7-day sparkline data ─────────────────────────────────
  const sparkDays = [];
  const sparkValues = [];
  for (let i = 6; i >= 0; i--) {
    const dateStr = daysAgo(i);
    const entry = (cache.dailyModelTokens || []).find(d => d.date === dateStr);
    sparkDays.push(dayLabel(dateStr));
    sparkValues.push(sumDayTokens(entry));
  }
  const sparkChars = ['\u2581', '\u2582', '\u2583', '\u2584', '\u2585', '\u2586', '\u2587', '\u2588'];
  const sparkMax = Math.max(...sparkValues, 1);
  const sparkLabeled = sparkDays.map((label, i) => {
    const idx = Math.min(Math.floor((sparkValues[i] / sparkMax) * 7), 7);
    return label + sparkChars[idx];
  }).join(' ');

  // ─── Active days/week ─────────────────────────────────────
  const last30Start = daysAgo(30);
  const last30Activity = (cache.dailyActivity || []).filter(
    d => d.date >= last30Start && d.date <= today
  );
  const activeDaysPerWeek = last30Activity.length > 0
    ? Math.round((last30Activity.length / 30) * 7 * 10) / 10
    : 0;

  // ─── Model breakdown for today ────────────────────────────
  const modelLines = todayTokenEntry
    ? Object.entries(todayTokenEntry.tokensByModel)
        .sort((a, b) => b[1] - a[1])
        .map(([model, tokens]) => {
          const shortName = model.replace('claude-', '').replace(/-\d{8}$/, '');
          return `  ${shortName}: ${formatTokens(tokens)}`;
        })
    : [];

  // ─── Menubar line ─────────────────────────────────────────
  const color = menubarColor(pct);
  const bars = signalBars(pct);
  console.log(`CF ${bars} ${pct}% | color=${color} font=Menlo size=12`);
  console.log('---');

  // ─── TODAY section ────────────────────────────────────────
  console.log('TODAY | size=11 color=white');
  console.log(`  Tokens:    ${formatTokens(todayTokens)} / ${formatTokens(tierInfo.dailyTokens)}         ${progressBar(pct)} ${pct}% | font=Menlo size=12`);
  console.log(`  Messages:  ${todayMessages} | Sessions: ${todaySessions} | Tools: ${todayTools} | font=Menlo size=12`);
  console.log(`  Budget:    ~${formatTokens(remaining)} remaining | font=Menlo size=12`);
  if (modelLines.length > 0) {
    console.log(`  Model:     ${modelLines[0].trim()} | font=Menlo size=12`);
    for (let i = 1; i < modelLines.length; i++) {
      console.log(`           ${modelLines[i].trim()} | font=Menlo size=12`);
    }
  }
  console.log('---');

  // ─── THIS WEEK section ────────────────────────────────────
  console.log('THIS WEEK | size=11 color=white');
  console.log(`  Total:     ${formatTokens(weekTokens)} tokens | font=Menlo size=12`);
  console.log(`  Avg/day:   ${formatTokens(avg7d)} | Trend: ${trend} | font=Menlo size=12`);
  console.log(`  Peak:      ${formatTokens(peakDay.tokens)} (${peakDay.date.slice(5)}) | font=Menlo size=12`);
  console.log('---');

  // ─── 7-DAY SPARKLINE section ──────────────────────────────
  console.log('7-DAY SPARKLINE | size=11 color=white');
  console.log(`  ${sparkLabeled} | font=Menlo size=13`);
  console.log('---');

  // ─── ACTIVITY section ─────────────────────────────────────
  console.log('ACTIVITY | size=11 color=white');
  const peakHours = topNHours(cache.hourCounts);
  console.log(`  Peak hours: ${peakHours} | font=Menlo size=12`);
  console.log(`  Active: ${activeDaysPerWeek} days/week | font=Menlo size=12`);
  console.log('---');

  // ─── ALL TIME ─────────────────────────────────────────────
  console.log(`All Time: ${cache.totalSessions || 0} sessions | ${formatTokens(cache.totalMessages || 0)} msgs | since ${(cache.firstSessionDate || '').slice(0, 7)} | size=11 color=#888`);
  console.log('---');

  // ─── Actions ──────────────────────────────────────────────
  console.log(`Open Dashboard | bash=/opt/homebrew/bin/node param1=${CLI_PATH} param2=dashboard param3=--open terminal=false`);
  console.log('Refresh | refresh=true');
  console.log(`Plan: ${tierInfo.label} | color=#888`);
}

main();
