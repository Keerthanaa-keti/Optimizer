#!/usr/bin/env node

// CreditForge xbar Plugin — Token Usage Menubar Monitor
// Refreshes every 5 minutes (per filename convention)
// Self-contained: reads stats-cache.json directly, no monorepo build needed.

const fs = require('fs');
const path = require('path');

const STATS_PATH = path.join(process.env.HOME || '~', '.claude', 'stats-cache.json');
const CONFIG_PATH = path.join(process.cwd(), 'creditforge.toml') ||
  path.join(process.env.HOME || '~', '.creditforge', 'config.toml');

const TIER_LIMITS = {
  pro:   { monthlyUsd: 20,  dailyTokens: 500000,   label: 'Pro ($20/mo)' },
  max5:  { monthlyUsd: 100, dailyTokens: 2500000,  label: 'Max 5x ($100/mo)' },
  max20: { monthlyUsd: 200, dailyTokens: 10000000, label: 'Max 20x ($200/mo)' },
};

function formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function getTier() {
  // Try to read tier from creditforge.toml
  const paths = [
    path.join(process.env.HOME || '~', 'Documents', 'ClaudeExperiments', 'optimizer', 'creditforge.toml'),
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

function main() {
  if (!fs.existsSync(STATS_PATH)) {
    console.log('CF -- | color=gray');
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

  // Today's tokens
  const todayEntry = (cache.dailyModelTokens || []).find(d => d.date === today);
  const todayTokens = todayEntry
    ? Object.values(todayEntry.tokensByModel).reduce((a, b) => a + b, 0)
    : 0;

  // Today's activity
  const todayActivity = (cache.dailyActivity || []).find(d => d.date === today);

  // Budget percentage
  const pct = tierInfo.dailyTokens > 0
    ? Math.round((todayTokens / tierInfo.dailyTokens) * 1000) / 10
    : 0;

  // Color coding
  let color = 'green';
  if (pct >= 80) color = 'red';
  else if (pct >= 50) color = 'yellow';

  // Week tokens (last 7 days)
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartStr = formatDate(weekStart);
  const weekEntries = (cache.dailyModelTokens || []).filter(
    d => d.date >= weekStartStr && d.date <= today
  );
  const weekTokens = weekEntries.reduce((sum, entry) =>
    sum + Object.values(entry.tokensByModel).reduce((a, b) => a + b, 0), 0
  );

  // Month tokens (last 30 days)
  const monthStart = new Date();
  monthStart.setDate(monthStart.getDate() - 30);
  const monthStartStr = formatDate(monthStart);
  const monthEntries = (cache.dailyModelTokens || []).filter(
    d => d.date >= monthStartStr && d.date <= today
  );
  const monthTokens = monthEntries.reduce((sum, entry) =>
    sum + Object.values(entry.tokensByModel).reduce((a, b) => a + b, 0), 0
  );

  // 7-day average
  const daysWithData = weekEntries.length || 1;
  const avg7d = Math.round(weekTokens / daysWithData);

  // Model breakdown for today
  const modelLines = todayEntry
    ? Object.entries(todayEntry.tokensByModel).map(
        ([model, tokens]) => `Model: ${model} (${formatTokens(tokens)})`
      )
    : [];

  // Menubar line
  console.log(`CF ${formatTokens(todayTokens)} (${pct}%) | color=${color}`);
  console.log('---');

  // Today details
  console.log(`Today: ${formatTokens(todayTokens)} tokens (${pct}% budget)`);
  if (todayActivity) {
    console.log(`Sessions: ${todayActivity.sessionCount} | Messages: ${todayActivity.messageCount}`);
  }
  for (const line of modelLines) {
    console.log(line);
  }

  console.log('---');

  // Period totals
  console.log(`This Week: ${formatTokens(weekTokens)}`);
  console.log(`This Month: ${formatTokens(monthTokens)}`);
  console.log(`Avg 7d: ${formatTokens(avg7d)}/day`);
  console.log(`Plan: ${tierInfo.label}`);

  console.log('---');

  // Actions
  const cliPath = path.join(
    process.env.HOME || '~',
    'Documents', 'ClaudeExperiments', 'optimizer',
    'apps', 'cli', 'dist', 'index.js'
  );
  console.log(`Open Dashboard | bash=node param1=${cliPath} param2=tokens terminal=true`);
  console.log('Refresh | refresh=true');
}

main();
