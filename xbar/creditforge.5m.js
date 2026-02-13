#!/opt/homebrew/bin/node

// CreditForge — Claude Token Monitor (xbar plugin)
// Matches Claude's Usage page layout: Current Session + Weekly Limits

const fs = require('fs');
const path = require('path');

const CLAUDE_DIR = path.join(process.env.HOME, '.claude');
const STATS = path.join(CLAUDE_DIR, 'stats-cache.json');
const OPT = path.join(process.env.HOME, 'Documents', 'ClaudeExperiments', 'optimizer');
const CLI = path.join(OPT, 'apps', 'cli', 'dist', 'index.js');

const SESSION_WINDOW_HOURS = 5;

const TIERS = {
  pro:   { session: 500000,  weekly: 3500000,   label: 'Pro $20/mo' },
  max5:  { session: 2500000, weekly: 17500000,  label: 'Max 5\u00d7 $100/mo' },
  max20: { session: 10000000, weekly: 70000000, label: 'Max 20\u00d7 $200/mo' },
};

// ─── JSONL Scanner ────────────────────────────────────

function scanTokens() {
  const now = Date.now();
  const sessionCutoff = new Date(now - SESSION_WINDOW_HOURS * 3600000).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(now - 7 * 86400000).toISOString();
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  const threeMinAgo = now - 3 * 60 * 1000;

  // Collect jsonl files modified in the last 7 days
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
        // Subagents
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

  // Parse: collect last usage per message.id (streaming dedup)
  // key -> { model, input, output, timestamp }
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
      // Last write wins (cumulative output_tokens in streaming)
      byMsgId[key] = {
        model,
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        timestamp,
      };
      if (isActive) activeFiles.add(file.path);
    }
  }

  // Aggregate into session (last 5h) and weekly buckets
  let sessionTokens = 0, weeklyTokens = 0, todayTokens = 0;
  let sessionMsgs = 0, todayMsgs = 0;
  let oldestSessionTs = null;
  const sessionByModel = {};
  const weeklyByModel = {};
  const todayByModel = {};

  for (const entry of Object.values(byMsgId)) {
    const tok = entry.input + entry.output;
    const ts = entry.timestamp;

    // Weekly (last 7 days)
    if (ts >= weekAgo) {
      weeklyTokens += tok;
      weeklyByModel[entry.model] = (weeklyByModel[entry.model] || 0) + tok;
    }

    // Today
    if (ts.startsWith(today)) {
      todayTokens += tok;
      todayMsgs++;
      todayByModel[entry.model] = (todayByModel[entry.model] || 0) + tok;
    }

    // Session window (last 5h)
    if (ts >= sessionCutoff) {
      sessionTokens += tok;
      sessionMsgs++;
      sessionByModel[entry.model] = (sessionByModel[entry.model] || 0) + tok;
      if (!oldestSessionTs || ts < oldestSessionTs) oldestSessionTs = ts;
    }
  }

  return {
    session: { tokens: sessionTokens, msgs: sessionMsgs, byModel: sessionByModel, oldestTs: oldestSessionTs },
    weekly: { tokens: weeklyTokens, byModel: weeklyByModel },
    today: { tokens: todayTokens, msgs: todayMsgs, byModel: todayByModel },
    activeSessions: activeFiles.size,
  };
}

function empty() {
  return {
    session: { tokens: 0, msgs: 0, byModel: {}, oldestTs: null },
    weekly: { tokens: 0, byModel: {} },
    today: { tokens: 0, msgs: 0, byModel: {} },
    activeSessions: 0,
  };
}

// ─── Helpers ──────────────────────────────────────────

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

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
  return '#4a90d9'; // blue like Claude's bars
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
  // Estimate: weekly window resets 7 days from the oldest entry in the window
  // For display, show the next Saturday (Claude typically resets weekly)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const daysToSat = (6 - dayOfWeek + 7) % 7 || 7;
  const resetDate = new Date(now);
  resetDate.setDate(now.getDate() + daysToSat);
  const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][resetDate.getDay()];
  return `Resets ${dayName} ${resetDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
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

  const sessPct = ti.session > 0 ? Math.round(data.session.tokens / ti.session * 1000) / 10 : 0;
  const weekPct = ti.weekly > 0 ? Math.round(data.weekly.tokens / ti.weekly * 1000) / 10 : 0;
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

  // All models
  row('All models', 'size=13');
  row(weeklyResetDay(), 'size=12 color=#666');
  row(`${bar(weekPct, 25)}   ${weekPct}% used`, `font=Menlo size=12 color=${weekCol}`);
  out('---');

  // ── Per-model breakdown ────────────────────────────
  const models = Object.entries(data.session.byModel)
    .sort((a, b) => b[1] - a[1])
    .map(([m, v]) => ({ name: m.replace('claude-', '').replace(/-\d{8}$/, ''), tok: v }));

  if (models.length > 0) {
    for (const m of models) {
      const mPct = ti.session > 0 ? (m.tok / ti.session * 100).toFixed(1) : '0';
      row(`${m.name}:  ${fmt(m.tok)}  (${mPct}%)`, 'size=12');
    }
    out('---');
  }

  // ── Activity summary ───────────────────────────────
  row(`Messages:  ${data.today.msgs} today  /  ${data.session.msgs} session`, 'size=12');
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
