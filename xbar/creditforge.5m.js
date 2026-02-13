#!/opt/homebrew/bin/node

// CreditForge — Claude Token Monitor (xbar plugin)
// Matches Claude's Usage page: Current Session + Weekly Limits
// Uses cost-weighted token formula to match Claude's percentages

const fs = require('fs');
const path = require('path');

const CLAUDE_DIR = path.join(process.env.HOME, '.claude');
const OPT = path.join(process.env.HOME, 'Documents', 'ClaudeExperiments', 'optimizer');
const CLI = path.join(OPT, 'apps', 'cli', 'dist', 'index.js');

const SESSION_WINDOW_HOURS = 5;

// Cost per million tokens by model (USD) — used for rate limit calculation
const MODEL_PRICING = {
  'claude-opus-4-6':          { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-opus-4-5-20250620': { input: 15,   output: 75,  cacheWrite: 18.75, cacheRead: 1.50 },
  'claude-sonnet-4-5-20250929': { input: 3,  output: 15,  cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5-20251001':  { input: 0.8, output: 4,  cacheWrite: 1.0,   cacheRead: 0.08 },
};
const DEFAULT_PRICING = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.50 };

// Calibrated budgets (internal compute cost, not subscription price)
const TIERS = {
  pro:   { sessionBudget: 21,   weeklyBudget: 325,  label: 'Pro $20/mo' },
  max5:  { sessionBudget: 104,  weeklyBudget: 1620, label: 'Max 5\u00d7 $100/mo' },
  max20: { sessionBudget: 416,  weeklyBudget: 6480, label: 'Max 20\u00d7 $200/mo' },
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
          const subs = fs.readdirSync(subDir);
          for (const sf of subs) {
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

  // Parse: last usage per message.id (streaming dedup)
  const byMsgId = {};
  const activeFiles = new Set();

  for (const file of jsonlFiles) {
    let content;
    try { content = fs.readFileSync(file.path, 'utf-8'); } catch { continue; }
    const isActive = file.mtime > threeMinAgo;

    for (const line of content.split('\n')) {
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

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

  // Cost function: estimate USD spend for a set of tokens
  function costOf(entry) {
    const p = MODEL_PRICING[entry.model] || DEFAULT_PRICING;
    return (
      entry.input * p.input +
      entry.output * p.output +
      entry.cacheCreate * p.cacheWrite +
      entry.cacheRead * p.cacheRead
    ) / 1e6;
  }

  // Aggregate
  let sessionCost = 0, weeklyCost = 0;
  let sessionMsgs = 0, weeklyMsgs = 0;
  let oldestSessionTs = null;
  const sessionByModel = {};

  for (const entry of Object.values(byMsgId)) {
    const ts = entry.timestamp;
    const cost = costOf(entry);

    if (ts >= weekAgo) {
      weeklyCost += cost;
      weeklyMsgs++;
    }

    if (ts >= sessionCutoff) {
      sessionCost += cost;
      sessionMsgs++;
      const shortModel = entry.model.replace('claude-', '').replace(/-\d{8}$/, '');
      sessionByModel[shortModel] = (sessionByModel[shortModel] || 0) + cost;
      if (!oldestSessionTs || ts < oldestSessionTs) oldestSessionTs = ts;
    }
  }

  return {
    session: { cost: sessionCost, msgs: sessionMsgs, byModel: sessionByModel, oldestTs: oldestSessionTs },
    weekly: { cost: weeklyCost, msgs: weeklyMsgs },
    activeSessions: activeFiles.size,
  };
}

function empty() {
  return {
    session: { cost: 0, msgs: 0, byModel: {}, oldestTs: null },
    weekly: { cost: 0, msgs: 0 },
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

function weeklyResetDay() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToSat = (6 - dayOfWeek + 7) % 7 || 7;
  const resetDate = new Date(now);
  resetDate.setDate(now.getDate() + daysToSat);
  resetDate.setHours(14, 30, 0, 0); // approximate
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
  const sessCol = usageColor(sessPct);
  const weekCol = usageColor(weekPct);

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

  row('All models', 'size=13');
  row(weeklyResetDay(), 'size=12 color=#666');
  row(`${bar(weekPct, 25)}   ${weekPct}% used`, `font=Menlo size=12 color=${weekCol}`);
  out('---');

  // ── Per-model cost breakdown ───────────────────────
  const models = Object.entries(data.session.byModel)
    .sort((a, b) => b[1] - a[1])
    .map(([name, cost]) => ({ name, cost }));

  if (models.length > 0) {
    for (const m of models) {
      const mPct = ti.sessionBudget > 0 ? (m.cost / ti.sessionBudget * 100).toFixed(1) : '0';
      row(`${m.name}:  ${fmtCost(m.cost)}  (${mPct}%)`, 'size=12');
    }
    out('---');
  }

  // ── Activity ───────────────────────────────────────
  row(`Session: ${data.session.msgs} msgs  (${fmtCost(data.session.cost)})`, 'size=12');
  row(`Weekly:  ${data.weekly.msgs} msgs  (${fmtCost(data.weekly.cost)})`, 'size=12');
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
