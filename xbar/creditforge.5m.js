#!/opt/homebrew/bin/node

// CreditForge — Claude Token Monitor (xbar plugin)
// Refreshes every 5 minutes. Reads stats-cache.json directly.

const fs = require('fs');
const path = require('path');

const STATS = path.join(process.env.HOME, '.claude', 'stats-cache.json');
const CLAUDE_DIR = path.join(process.env.HOME, '.claude');
const OPT = path.join(process.env.HOME, 'Documents', 'ClaudeExperiments', 'optimizer');
const CLI = path.join(OPT, 'apps', 'cli', 'dist', 'index.js');

const TIERS = {
  pro:   { daily: 500000,   label: 'Pro $20/mo' },
  max5:  { daily: 2500000,  label: 'Max 5\u00d7 $100/mo' },
  max20: { daily: 10000000, label: 'Max 20\u00d7 $200/mo' },
};

// ─── Live JSONL Scanner ───────────────────────────────

function scanLiveTokens() {
  const today = new Date().toISOString().slice(0, 10);
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  const tokensByModel = {};
  let total = 0, msgs = 0, activeSessions = 0;
  const threeMinAgo = Date.now() - 3 * 60 * 1000;

  // Collect all .jsonl files modified today
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
            if (st.mtime.toISOString().slice(0, 10) === today) {
              jsonlFiles.push({ path: full, mtime: st.mtimeMs });
            }
          } catch {}
        }
        // Check subagents dir
        const subDir = path.join(full, 'subagents');
        try {
          const subs = fs.readdirSync(subDir);
          for (const sf of subs) {
            if (!sf.endsWith('.jsonl')) continue;
            const sfull = path.join(subDir, sf);
            try {
              const st = fs.statSync(sfull);
              if (st.mtime.toISOString().slice(0, 10) === today) {
                jsonlFiles.push({ path: sfull, mtime: st.mtimeMs });
              }
            } catch {}
          }
        } catch {}
      }
    }
  } catch { return { tokensByModel: {}, total: 0, msgs: 0, activeSessions: 0 }; }

  // Parse each file: collect last usage per requestId (streaming dedup)
  // requestId -> { model, input, output }
  const byRequest = {};
  const sessionActive = new Set();

  for (const file of jsonlFiles) {
    let content;
    try { content = fs.readFileSync(file.path, 'utf-8'); } catch { continue; }
    const isActive = file.mtime > threeMinAgo;

    const lines = content.split('\n');
    for (const line of lines) {
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }

      let timestamp, requestId, model, usage;

      if (obj.type === 'assistant' && obj.message?.usage) {
        timestamp = obj.timestamp;
        requestId = obj.requestId;
        model = obj.message.model;
        usage = obj.message.usage;
      } else if (obj.type === 'progress' && obj.data?.message?.message?.usage) {
        timestamp = obj.data.message.timestamp || obj.timestamp;
        requestId = obj.data.message.requestId;
        model = obj.data.message.message.model;
        usage = obj.data.message.message.usage;
      } else {
        continue;
      }

      if (!timestamp || !timestamp.startsWith(today)) continue;
      if (!model || model === '<synthetic>') continue;
      if (!usage) continue;

      const key = requestId || `${file.path}:${timestamp}`;
      // Last write wins — later lines for same requestId have final output_tokens
      byRequest[key] = {
        model,
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
      };
      if (isActive) sessionActive.add(file.path);
    }
  }

  // Aggregate from deduplicated requests
  for (const { model, input, output } of Object.values(byRequest)) {
    const tok = input + output;
    tokensByModel[model] = (tokensByModel[model] || 0) + tok;
    total += tok;
    msgs++;
  }
  activeSessions = sessionActive.size;

  return { tokensByModel, total, msgs, activeSessions };
}

// ─── Helpers ──────────────────────────────────────────

function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(n);
}

const toDay = () => new Date().toISOString().slice(0, 10);
const dAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const sum = e => e ? Object.values(e.tokensByModel).reduce((a, b) => a + b, 0) : 0;

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
  return '#51cf66';
}

function out(text, params) {
  console.log(params ? `${text} | ${params}` : text);
}

// ─── Main ─────────────────────────────────────────────

function main() {
  if (!fs.existsSync(STATS)) {
    out('CF --', 'font=Menlo size=12 color=gray');
    out('---');
    out('Waiting for data...', 'size=12');
    out('Start a Claude Code session to begin tracking', 'size=11 color=#888');
    return;
  }

  let c;
  try { c = JSON.parse(fs.readFileSync(STATS, 'utf-8')); }
  catch { out('CF \u2715', 'font=Menlo size=12 color=red'); return; }

  const t = getTier();
  const ti = TIERS[t];
  const td = toDay();

  // ── Live JSONL data ───────────────────────────────────
  const live = scanLiveTokens();

  // ── Today (merge stats-cache with live JSONL) ──────
  const tEntry = (c.dailyModelTokens || []).find(d => d.date === td);
  const tAct = (c.dailyActivity || []).find(d => d.date === td);
  const cacheTokens = sum(tEntry);

  // Merge model breakdowns: take max per model from cache vs live
  const mergedByModel = { ...(tEntry?.tokensByModel || {}) };
  for (const [model, tok] of Object.entries(live.tokensByModel)) {
    mergedByModel[model] = Math.max(mergedByModel[model] || 0, tok);
  }
  const tokens = Math.max(cacheTokens, Object.values(mergedByModel).reduce((a, b) => a + b, 0));

  const msgs = Math.max(tAct?.messageCount || 0, live.msgs);
  const sess = tAct?.sessionCount || 0;
  const tools = tAct?.toolCallCount || 0;
  const liveActive = live.activeSessions;
  const pct = ti.daily > 0 ? Math.round(tokens / ti.daily * 1000) / 10 : 0;
  const rem = Math.max(0, ti.daily - tokens);
  const col = usageColor(pct);

  // ── Week ───────────────────────────────────────────
  const wk = (c.dailyModelTokens || []).filter(d => d.date >= dAgo(7) && d.date <= td);
  const wkTot = wk.reduce((s, e) => s + sum(e), 0);
  const wkAvg = Math.round(wkTot / Math.max(wk.length, 1));

  let peak = { date: td, tok: 0 };
  for (const e of wk) { const v = sum(e); if (v > peak.tok) peak = { date: e.date, tok: v }; }

  const r3 = wk.slice(-3), ol = wk.slice(0, -3);
  const rA = r3.length ? r3.reduce((s, e) => s + sum(e), 0) / r3.length : 0;
  const oA = ol.length ? ol.reduce((s, e) => s + sum(e), 0) / ol.length : 0;
  let trendWord = 'Stable';
  if (oA > 0 && rA > oA * 1.2) trendWord = 'Trending Up';
  else if (oA > 0 && rA < oA * 0.8) trendWord = 'Trending Down';

  // ── Activity ───────────────────────────────────────
  const a30 = (c.dailyActivity || []).filter(d => d.date >= dAgo(30));
  const actDays = a30.length > 0 ? Math.round(a30.length / 30 * 7 * 10) / 10 : 0;

  // ── Models today (merged) ──────────────────────────
  const models = Object.keys(mergedByModel).length > 0
    ? Object.entries(mergedByModel).sort((a, b) => b[1] - a[1])
        .map(([m, v]) => ({ name: m.replace('claude-', '').replace(/-\d{8}$/, ''), tok: v }))
    : [];

  // ── Weekly % ────────────────────────────────────────
  const wkBudget = ti.daily * 7;
  const wkPct = wkBudget > 0 ? Math.round(wkTot / wkBudget * 1000) / 10 : 0;

  // ══════════════════════════════════════════════════
  // OUTPUT
  // ══════════════════════════════════════════════════

  // Helper: build a progress bar string
  function bar(percent, width) {
    const filled = Math.round(Math.min(percent, 100) / 100 * width);
    return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
  }

  // ── Menubar line ───────────────────────────────────
  const activeInd = liveActive > 0 ? ' *' : '';
  out(`CF ${pct}%${activeInd}`, `size=13 color=${col}`);
  out('---');

  const K = 'color=#111111'; // force dark text (xbar defaults to grey)

  // ── Daily Usage (progress bar) ─────────────────────
  out('Daily Usage', `size=14 ${K}`);
  out(`${bar(pct, 20)}  ${pct}%`, `font=Menlo size=13 color=${col}`);
  out(`${fmt(tokens)} of ${fmt(ti.daily)} tokens`, `size=13 ${K}`);
  out('---');

  // ── Weekly Usage (progress bar) ────────────────────
  const wkCol = usageColor(wkPct);
  out('Weekly Usage', `size=14 ${K}`);
  out(`${bar(wkPct, 20)}  ${wkPct}%`, `font=Menlo size=13 color=${wkCol}`);
  out(`${fmt(wkTot)} of ${fmt(wkBudget)} tokens`, `size=13 ${K}`);
  out('---');

  // ── Today ──────────────────────────────────────────
  out('Today', `size=14 ${K}`);
  out(`Messages:          ${msgs}`, `size=13 ${K}`);
  out(`Sessions:          ${sess}`, `size=13 ${K}`);
  out(`Tool Calls:        ${tools}`, `size=13 ${K}`);
  out(`Remaining:         ${fmt(rem)}`, `size=13 ${K}`);
  if (liveActive > 0) {
    out(`Active Now:        ${liveActive}`, 'size=13 color=#34a853');
  }
  out('---');

  // ── Models ─────────────────────────────────────────
  if (models.length > 0) {
    out('Models', `size=14 ${K}`);
    for (const m of models) {
      const mPct = ti.daily > 0 ? (m.tok / ti.daily * 100).toFixed(1) : '0';
      out(`${m.name}:  ${fmt(m.tok)}  (${mPct}%)`, `size=13 ${K}`);
    }
    out('---');
  }

  // ── This Week ──────────────────────────────────────
  out('This Week', `size=14 ${K}`);
  out(`Total:             ${fmt(wkTot)}`, `size=13 ${K}`);
  out(`Daily Average:     ${fmt(wkAvg)}`, `size=13 ${K}`);
  out(`Peak Day:          ${fmt(peak.tok)} (${peak.date.slice(5)})`, `size=13 ${K}`);
  out(`Trend:             ${trendWord}`, `size=13 ${K}`);
  out('---');

  // ── All Time ───────────────────────────────────────
  const since = (c.firstSessionDate || '').slice(0, 10);
  out('All Time', `size=14 ${K}`);
  out(`Sessions:          ${c.totalSessions || 0}`, `size=13 ${K}`);
  out(`Messages:          ${fmt(c.totalMessages || 0)}`, `size=13 ${K}`);
  out(`Active Days:       ${actDays}/wk`, `size=13 ${K}`);
  out(`Since:             ${since}`, `size=13 ${K}`);
  out('---');

  // ── Actions ────────────────────────────────────────
  out('Open Dashboard', `bash=/opt/homebrew/bin/node param1=${CLI} param2=dashboard param3=--open terminal=false`);
  out('Refresh', 'refresh=true');
  out('---');
  out(`${ti.label}`, 'size=11 color=#999');
}

main();
