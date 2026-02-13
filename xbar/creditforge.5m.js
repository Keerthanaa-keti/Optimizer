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
  let trendIcon = '\u2192', trendWord = 'stable', trendCol = '#868e96';
  if (oA > 0 && rA > oA * 1.2) { trendIcon = '\u2191'; trendWord = 'up'; trendCol = '#ffa94d'; }
  else if (oA > 0 && rA < oA * 0.8) { trendIcon = '\u2193'; trendWord = 'down'; trendCol = '#51cf66'; }

  // ── Sparkline ──────────────────────────────────────
  const spk = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';
  const vals = [];
  for (let i = 6; i >= 0; i--) vals.push(sum((c.dailyModelTokens || []).find(d => d.date === dAgo(i))));
  const mx = Math.max(...vals, 1);
  const dayChars = 'SMTWTFS';
  const sparkStr = vals.map((v, i) => {
    const ch = dayChars[new Date(dAgo(6 - i) + 'T12:00:00').getDay()];
    return ch + spk[Math.min(Math.floor(v / mx * 7), 7)];
  }).join(' ');

  // ── Activity ───────────────────────────────────────
  const topHrs = Object.entries(c.hourCounts || {}).sort((a, b) => b[1] - a[1])
    .slice(0, 3).map(([h]) => h.padStart(2, '0') + 'h').join('  ');
  const a30 = (c.dailyActivity || []).filter(d => d.date >= dAgo(30));
  const actDays = a30.length > 0 ? Math.round(a30.length / 30 * 7 * 10) / 10 : 0;

  // ── Models today (merged) ──────────────────────────
  const models = Object.keys(mergedByModel).length > 0
    ? Object.entries(mergedByModel).sort((a, b) => b[1] - a[1])
        .map(([m, v]) => ({ name: m.replace('claude-', '').replace(/-\d{8}$/, ''), tok: v }))
    : [];

  // ══════════════════════════════════════════════════
  // OUTPUT
  // ══════════════════════════════════════════════════

  // ── Menubar ────────────────────────────────────────
  const activeInd = liveActive > 0 ? ' *' : '';
  out(`CF ${pct}%${activeInd}`, `font=Menlo size=12 color=${col}`);
  out('---');

  // ── Hero: Progress bar ─────────────────────────────
  const barW = 25;
  const filled = Math.round(Math.min(pct, 100) / 100 * barW);
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(barW - filled);
  out(bar, `font=Menlo size=14 color=${col}`);
  out(`${fmt(tokens)} / ${fmt(ti.daily)}  \u00b7  ${pct}% used`, 'font=Menlo size=12');
  out('---');

  // ── Today compact ──────────────────────────────────
  out(`\u2709 ${msgs}    \u25C8 ${sess}    \u2692 ${tools}`, 'font=Menlo size=12');
  out(`~${fmt(rem)} remaining`, `font=Menlo size=11 color=${col}`);
  if (liveActive > 0) {
    out(`\u25CF ${liveActive} active session${liveActive > 1 ? 's' : ''} (live)`, 'font=Menlo size=10 color=#3fb950');
  }
  if (models.length > 0) {
    for (const m of models) {
      const mPct = ti.daily > 0 ? Math.round(m.tok / ti.daily * 100) : 0;
      const mBar = '\u2588'.repeat(Math.max(Math.round(mPct / 10), m.tok > 0 ? 1 : 0));
      out(`  ${m.name}  ${fmt(m.tok)}  ${mBar}`, `font=Menlo size=10 color=#999`);
    }
  }
  out('---');

  // ── Week ───────────────────────────────────────────
  out(`7d  ${fmt(wkTot)} total  \u00b7  ${fmt(wkAvg)}/day`, 'font=Menlo size=12');
  out(`Peak ${fmt(peak.tok)} (${peak.date.slice(5)})  \u00b7  ${trendIcon} ${trendWord}`, `font=Menlo size=11 color=${trendCol}`);
  out(sparkStr, 'font=Menlo size=13');
  out('---');

  // ── Activity ───────────────────────────────────────
  out(`Peak  ${topHrs}  \u00b7  ${actDays}d/wk`, 'font=Menlo size=11');
  out('---');

  // ── All-time (muted footer) ────────────────────────
  const since = (c.firstSessionDate || '').slice(0, 10);
  out(`${c.totalSessions || 0} sessions \u00b7 ${fmt(c.totalMessages || 0)} msgs \u00b7 since ${since}`, 'size=10 color=#999');
  out('---');

  // ── Actions ────────────────────────────────────────
  out('Open Dashboard', `bash=/opt/homebrew/bin/node param1=${CLI} param2=dashboard param3=--open terminal=false`);
  out('Refresh', 'refresh=true');
  out(`\u2500\u2500  ${ti.label}  \u2500\u2500`, 'size=10 color=#aaa');
}

main();
