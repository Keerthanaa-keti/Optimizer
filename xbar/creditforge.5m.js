#!/opt/homebrew/bin/node

// CreditForge — Claude Token Monitor (xbar plugin)
// Matches Claude's Usage page: Current Session + Weekly Limits + Sonnet Only
// Uses cost-weighted token formula to match Claude's percentages

const fs = require('fs');
const path = require('path');

const CLAUDE_DIR = path.join(process.env.HOME, '.claude');
const OPT = path.join(process.env.HOME, 'Documents', 'ClaudeExperiments', 'optimizer');
const CLI = path.join(OPT, 'apps', 'cli', 'dist', 'index.js');

const SESSION_WINDOW_HOURS = 5;

// Cost per million tokens by model (USD)
const MODEL_PRICING = {
  'claude-opus-4-6':            { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4-5-20250620':   { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-5-20250929': { input: 3,    output: 15,  cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5-20251001':  { input: 0.8,  output: 4,   cacheWrite: 1.0,   cacheRead: 0.08 },
};
const DEFAULT_PRICING = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 };

const SONNET_MODELS = new Set(['claude-sonnet-4-5-20250929']);

// Calibrated budgets (internal compute cost USD, not subscription price)
const TIERS = {
  pro:   { sessionBudget: 21,  weeklyBudget: 1620, sonnetWeeklyBudget: 810,  label: 'Pro $20/mo' },
  max5:  { sessionBudget: 104, weeklyBudget: 1620, sonnetWeeklyBudget: 810,  label: 'Max 5\u00d7 $100/mo' },
  max20: { sessionBudget: 416, weeklyBudget: 6480, sonnetWeeklyBudget: 3240, label: 'Max 20\u00d7 $200/mo' },
};

// ─── JSONL Scanner ────────────────────────────────────

function scanTokens() {
  const now = Date.now();
  const sessionCutoff = new Date(now - SESSION_WINDOW_HOURS * 3600000).toISOString();
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  const threeMinAgo = now - 3 * 60 * 1000;

  const jsonlFiles = [];
  try {
    const projects = fs.readdirSync(projectsDir);
    for (const proj of projects) {
      const projPath = path.join(projectsDir, proj);
      let entries;
      try { entries = fs.readdirSync(projPath); } catch { continue; }
      for (const entry of entries) {
        const full = path.join(projPath, entry);
        if (entry.endsWith('.jsonl')) {
          try {
            const st = fs.statSync(full);
            if (st.mtimeMs > now - 7 * 86400000) {
              jsonlFiles.push({ path: full, mtime: st.mtimeMs });
            }
          } catch {}
        }
        const subDir = path.join(full, 'subagents');
        try {
          for (const sf of fs.readdirSync(subDir)) {
            if (!sf.endsWith('.jsonl')) continue;
            const sfull = path.join(subDir, sf);
            try {
              const st = fs.statSync(sfull);
              if (st.mtimeMs > now - 7 * 86400000) {
                jsonlFiles.push({ path: sfull, mtime: st.mtimeMs });
              }
            } catch {}
          }
        } catch {}
      }
    }
  } catch {
    return empty();
  }

  // Parse: last usage per message.id + track ALL timestamps for session window
  const byMsgId = {};
  const activeFiles = new Set();
  let oldestActivityTs = null; // earliest user/assistant timestamp in session window

  for (const file of jsonlFiles) {
    let content;
    try { content = fs.readFileSync(file.path, 'utf-8'); } catch { continue; }
    const isActive = file.mtime > threeMinAgo;

    for (const line of content.split('\n')) {
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      // Track earliest activity timestamp (any type) in session window
      if (obj.timestamp && obj.timestamp >= sessionCutoff) {
        if ((obj.type === 'user' || obj.type === 'assistant') &&
            (!oldestActivityTs || obj.timestamp < oldestActivityTs)) {
          oldestActivityTs = obj.timestamp;
        }
      }

      // Extract token usage from assistant/progress messages
      let timestamp, msgId, model, usage;

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
      byMsgId[key] = {
        model, timestamp,
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cacheCreate: usage.cache_creation_input_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
      };
      if (isActive) activeFiles.add(file.path);
    }
  }

  function costOf(entry) {
    const p = MODEL_PRICING[entry.model] || DEFAULT_PRICING;
    return (
      entry.input * p.input +
      entry.output * p.output +
      entry.cacheCreate * p.cacheWrite +
      entry.cacheRead * p.cacheRead
    ) / 1e6;
  }

  let sessionCost = 0, weeklyCost = 0, sonnetWeeklyCost = 0;
  let sessionMsgs = 0, weeklyMsgs = 0;
  const sessionByModel = {};

  for (const entry of Object.values(byMsgId)) {
    const ts = entry.timestamp;
    const cost = costOf(entry);
    const isSonnet = SONNET_MODELS.has(entry.model);

    if (ts >= weekAgo) {
      weeklyCost += cost;
      weeklyMsgs++;
      if (isSonnet) sonnetWeeklyCost += cost;
    }

    if (ts >= sessionCutoff) {
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

function empty() {
  return {
    session: { cost: 0, msgs: 0, byModel: {}, oldestTs: null },
    weekly: { cost: 0, msgs: 0 },
    sonnetWeekly: { cost: 0 },
    activeSessions: 0,
  };
}

// ─── Helpers ──────────────────────────────────────────

function getTier() {
  for (const p of [path.join(OPT, 'creditforge.toml'), path.join(process.env.HOME, '.creditforge', 'config.toml')]) {
    try { const m = fs.readFileSync(p, 'utf-8').match(/tier\s*=\s*"(\w+)"/); if (m?.[1] in TIERS) return m[1]; } catch {}
  }
  return 'max5';
}

function usageColor(pct) {
  if (pct >= 80) return '#ff6b6b';
  if (pct >= 60) return '#ffa94d';
  if (pct >= 40) return '#fcc419';
  return '#4a90d9';
}

function bar(percent, width) {
  const clamped = Math.min(Math.max(percent, 0), 100);
  const filled = Math.round(clamped / 100 * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function resetCountdown(oldestTs) {
  if (!oldestTs) return `Resets in ${SESSION_WINDOW_HOURS}h 0min`;
  const resetAt = new Date(oldestTs).getTime() + SESSION_WINDOW_HOURS * 3600000;
  const diff = resetAt - Date.now();
  if (diff <= 0) return 'Resets soon';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `Resets in ${h} hr ${m} min`;
}

function nextResetDay(targetDay, hour, minute) {
  // targetDay: 0=Sun..6=Sat
  const now = new Date();
  const dayOfWeek = now.getDay();
  let daysUntil = (targetDay - dayOfWeek + 7) % 7;
  if (daysUntil === 0) {
    // Same day — check if time already passed
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

function fmtCost(n) {
  if (n >= 1) return '$' + n.toFixed(2);
  return '$' + n.toFixed(3);
}

function out(text, params) {
  console.log(params ? `${text} | ${params}` : text);
}

function row(text, params) {
  const p = params ? `${params} href=#` : 'href=#';
  console.log(`${text} | ${p}`);
}

// ─── Main ─────────────────────────────────────────────

function main() {
  const t = getTier();
  const ti = TIERS[t];
  const data = scanTokens();

  const sessPct = ti.sessionBudget > 0 ? Math.round(data.session.cost / ti.sessionBudget * 1000) / 10 : 0;
  const weekPct = ti.weeklyBudget > 0 ? Math.round(data.weekly.cost / ti.weeklyBudget * 1000) / 10 : 0;
  const sonnetPct = ti.sonnetWeeklyBudget > 0 ? Math.round(data.sonnetWeekly.cost / ti.sonnetWeeklyBudget * 1000) / 10 : 0;
  const sessCol = usageColor(sessPct);
  const weekCol = usageColor(weekPct);
  const sonnetCol = usageColor(sonnetPct);

  // ── Menubar ────────────────────────────────────────
  const activeInd = data.activeSessions > 0 ? ' *' : '';
  out(`CF ${sessPct}%${activeInd}`, `size=13 color=${sessCol}`);
  out('---');

  // ── Plan usage limits ──────────────────────────────
  row('Plan usage limits', 'size=14');
  out('---');

  // ── Current session ────────────────────────────────
  row('Current session', 'size=14');
  row(resetCountdown(data.session.oldestTs), 'size=12 color=#666');
  row(`${bar(sessPct, 25)}   ${sessPct}% used`, `font=Menlo size=12 color=${sessCol}`);
  out('---');

  // ── Weekly limits ──────────────────────────────────
  row('Weekly limits', 'size=14');
  out('---');

  // All models
  row('All models', 'size=13');
  row(nextResetDay(6, 14, 30), 'size=12 color=#666'); // Sat 2:30 PM
  row(`${bar(weekPct, 25)}   ${weekPct}% used`, `font=Menlo size=12 color=${weekCol}`);
  out('---');

  // Sonnet only
  row('Sonnet only', 'size=13');
  row(nextResetDay(1, 21, 30), 'size=12 color=#666'); // Mon 9:30 PM
  row(`${bar(sonnetPct, 25)}   ${sonnetPct}% used`, `font=Menlo size=12 color=${sonnetCol}`);
  out('---');

  // ── Per-model session breakdown ──────────────────────
  const models = Object.entries(data.session.byModel)
    .sort((a, b) => b[1] - a[1])
    .map(([name, cost]) => ({ name, cost }));

  if (models.length > 0) {
    for (const m of models) {
      const mPct = ti.sessionBudget > 0 ? (m.cost / ti.sessionBudget * 100).toFixed(1) : '0';
      row(`${m.name}:  ${mPct}%`, 'size=12');
    }
    out('---');
  }

  // ── Activity ───────────────────────────────────────
  row(`Session: ${data.session.msgs} messages`, 'size=12');
  row(`Weekly:  ${data.weekly.msgs} messages`, 'size=12');
  if (data.activeSessions > 0) {
    row(`Active:  ${data.activeSessions} session${data.activeSessions > 1 ? 's' : ''} now`, 'size=12 color=#34a853');
  }
  out('---');

  // ── Actions ────────────────────────────────────────
  out('Open Dashboard', `bash=/opt/homebrew/bin/node param1=${CLI} param2=dashboard param3=--open terminal=false`);
  out('Refresh', 'refresh=true');
  out('---');
  out(`${ti.label}`, 'size=11 color=#999');
}

main();
