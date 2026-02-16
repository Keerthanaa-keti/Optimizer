// CreditForge Menubar — Frontend rendering

const $ = (id) => document.getElementById(id);

let launchdInstalled = false;

function barColor(pct) {
  if (pct >= 80) return '#ff3b30';
  if (pct >= 60) return '#ff6723';
  if (pct >= 40) return '#ff9f0a';
  return '#34c759';
}

// ─── Toast Notifications ────────────────────────────────

function showToast(message, type = 'info') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Budget Planner ─────────────────────────────────────

function renderBudgetPlan(plan) {
  const section = $('budget-section');
  if (!plan || plan.remainingBudget <= 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  const grid = $('budget-grid');
  grid.innerHTML = plan.models.map(m =>
    `<div class="budget-cell">
      <span class="budget-count">~${m.estimatedMessages}</span>
      <span class="budget-model">${m.displayName}</span>
    </div>`
  ).join('');

  $('budget-rec').textContent = plan.recommendation;
}

// ─── Usage Rendering ────────────────────────────────────

function renderUsage(data) {
  // Session
  const sessionFill = $('session-fill');
  sessionFill.style.width = Math.min(data.sessionPct, 100) + '%';
  sessionFill.style.background = barColor(data.sessionPct);
  $('session-pct').textContent = data.sessionPct + '% used';
  $('session-reset').textContent = data.sessionResetLabel;

  // Weekly
  const weeklyFill = $('weekly-fill');
  weeklyFill.style.width = Math.min(data.weeklyPct, 100) + '%';
  weeklyFill.style.background = barColor(data.weeklyPct);
  $('weekly-pct').textContent = data.weeklyPct + '% used';
  $('weekly-reset').textContent = data.weeklyResetLabel;

  // Sonnet
  $('sonnet-fill').style.width = Math.min(data.sonnetPct, 100) + '%';
  $('sonnet-pct').textContent = data.sonnetPct + '% used';
  $('sonnet-reset').textContent = data.sonnetResetLabel;

  // Model breakdown
  const models = Object.entries(data.data.session.byModel)
    .sort((a, b) => b[1] - a[1]);

  const modelSection = $('model-breakdown');
  if (models.length > 0) {
    const sessionBudget = data.tier.sessionBudget;
    modelSection.innerHTML = models.map(([name, cost]) => {
      const pct = sessionBudget > 0 ? (cost / sessionBudget * 100).toFixed(1) : '0';
      return `<div class="model-row">
        <span class="model-name">${name}</span>
        <span class="model-pct">${pct}%</span>
      </div>`;
    }).join('');
    modelSection.style.display = 'block';
  } else {
    modelSection.style.display = 'none';
  }

  // Activity
  $('session-msgs').textContent = `Session: ${data.data.session.msgs} msgs`;
  $('weekly-msgs').textContent = `Weekly: ${data.data.weekly.msgs}`;

  const activeRow = $('active-sessions-row');
  if (data.data.activeSessions > 0) {
    activeRow.style.display = 'flex';
    const count = data.data.activeSessions;
    $('active-sessions-text').textContent = `${count} active session${count > 1 ? 's' : ''}`;
  } else {
    activeRow.style.display = 'none';
  }

  // Tier label
  $('tier-label').textContent = data.tier.label;
}

function renderAlerts(alerts) {
  const container = $('alerts-container');
  if (!alerts || alerts.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = alerts.map((alert) => `
    <div class="alert alert-${alert.level}">
      <div class="alert-title">${alert.title}</div>
      <div class="alert-message">${alert.message}</div>
    </div>
  `).join('');
}

// ─── Night Mode Rendering ───────────────────────────────

function renderNightMode(nm) {
  // Setup banner vs action bar
  const setupEl = $('nm-setup');
  const actionsEl = $('nm-actions');

  if (!launchdInstalled) {
    setupEl.style.display = 'block';
    actionsEl.style.display = 'none';
  } else {
    setupEl.style.display = 'none';
    actionsEl.style.display = 'flex';
  }

  // Status
  $('nm-status').textContent = nm.isEnabled ? 'Enabled' : 'Disabled';
  $('nm-status').className = 'nm-value ' + (nm.isEnabled ? 'nm-enabled' : 'nm-disabled');

  // Next run
  $('nm-next-run').textContent = nm.isEnabled ? nm.nextRunAt : '--';

  // Queued
  $('nm-queued').textContent = nm.queuedTasks;

  // Today's results
  if (nm.completedToday > 0 || nm.failedToday > 0) {
    const spent = (nm.totalSpentToday / 100).toFixed(2);
    $('nm-today').textContent = `${nm.completedToday} done, ${nm.failedToday} failed ($${spent})`;
  } else {
    $('nm-today').textContent = 'No runs today';
  }

  // Top tasks with run buttons
  const taskList = $('nm-task-list');
  const taskContainer = $('nm-top-tasks');
  if (nm.topTasks && nm.topTasks.length > 0) {
    taskContainer.style.display = 'block';
    taskList.innerHTML = nm.topTasks.map(t =>
      `<div class="nm-task-row">
        <span class="nm-task-name" title="${t.title}">${t.project}: ${truncate(t.title, 30)}</span>
        <span class="nm-task-score">${t.score.toFixed(1)}</span>
        <button class="btn-run-task" data-task-id="${t.id}" title="Run this task">Run</button>
      </div>`
    ).join('');
  } else {
    taskContainer.style.display = 'none';
  }
}

function renderReport(report) {
  const section = $('report-section');
  if (!report || !report.exists) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  // Parse markdown report into simple HTML
  const lines = report.content.split('\n').slice(0, 15); // First 15 lines
  const html = lines.map(line => {
    if (line.startsWith('# ')) return `<div class="report-h1">${line.slice(2)}</div>`;
    if (line.startsWith('## ')) return `<div class="report-h2">${line.slice(3)}</div>`;
    if (line.startsWith('- ')) return `<div class="report-item">${line}</div>`;
    if (line.trim() === '') return '';
    return `<div class="report-line">${line}</div>`;
  }).join('');
  $('report-content').innerHTML = html;
}

function renderInsights(ins) {
  if (!ins || !ins.actionable) return;

  const a = ins.actionable;

  // Utilization meter
  const pctEl = $('ins-util-pct');
  pctEl.textContent = `${a.utilizationPct}% utilized`;
  if (a.utilizationPct >= 70) {
    pctEl.className = 'utilization-pct util-green';
  } else if (a.utilizationPct >= 40) {
    pctEl.className = 'utilization-pct util-yellow';
  } else {
    pctEl.className = 'utilization-pct util-red';
  }

  // Dollar context — show in terms of actual subscription cost, not compute cost
  const weeklySub = a.subscriptionCostWeekly;
  const usedOfSub = Math.round(weeklySub * a.utilizationPct) / 100;
  const wastedOfSub = Math.max(weeklySub - usedOfSub, 0);
  $('ins-util-context').textContent =
    `~$${usedOfSub.toFixed(0)} of your $${Math.round(weeklySub)}/week subscription used`;

  // Waste callout (only when >50% unused)
  const wasteEl = $('ins-waste');
  if (a.utilizationPct < 50 && wastedOfSub > 2) {
    wasteEl.textContent = `~$${wastedOfSub.toFixed(0)}/week going unused`;
    wasteEl.style.display = 'block';
  } else {
    wasteEl.style.display = 'none';
  }

  // Action card
  const card = $('ins-action-card');
  card.className = 'action-card action-' + a.action.urgency;
  $('ins-action-headline').textContent = a.action.headline;
  $('ins-action-detail').textContent = a.action.detail;

  // Quick stats — burn rate
  $('ins-burn-rate').textContent = `$${a.burnRatePerHr.toFixed(2)}/hr`;

  // Quick stats — best window
  const windowStat = $('ins-best-window-stat');
  if (a.bestWindow) {
    windowStat.style.display = 'flex';
    $('ins-best-window').textContent = a.bestWindow;
  } else {
    windowStat.style.display = 'none';
  }
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

// ─── Refresh ────────────────────────────────────────────

async function refresh() {
  try {
    const [data, nm, report, intelligence, budgetPlan] = await Promise.all([
      window.creditforge.getUsageData(),
      window.creditforge.getNightModeStatus(),
      window.creditforge.getMorningReport(),
      window.creditforge.getIntelligence(),
      window.creditforge.getBudgetPlan(),
    ]);

    renderUsage(data);
    renderNightMode(nm);
    renderReport(report);
    renderInsights(intelligence);
    renderBudgetPlan(budgetPlan);

    // Pass burn rate to alerts for predictive messaging
    const burnRateJson = intelligence?.burnRate ? JSON.stringify(intelligence.burnRate) : undefined;
    const alerts = await window.creditforge.getAlerts(JSON.stringify(data), burnRateJson);
    renderAlerts(alerts);
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

// ─── Action Handlers ────────────────────────────────────

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = '...';
  } else {
    btn.textContent = btn.dataset.originalText || btn.textContent;
  }
}

// Install launchd agents
$('btn-install-launchd').addEventListener('click', async () => {
  const btn = $('btn-install-launchd');
  setButtonLoading(btn, true);
  try {
    const result = await window.creditforge.installLaunchd();
    if (result.success) {
      launchdInstalled = true;
      showToast('Night Mode agents installed', 'success');
      refresh();
    } else {
      showToast('Install failed', 'error');
    }
  } catch (err) {
    showToast('Install error: ' + err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
});

// Scan for tasks
$('btn-scan').addEventListener('click', async () => {
  const btn = $('btn-scan');
  setButtonLoading(btn, true);
  showToast('Scanning projects...', 'info');
  try {
    const result = await window.creditforge.runScan();
    if (result.exitCode === 0) {
      // Extract task count from stdout if available
      const match = result.stdout.match(/(\d+)\s+tasks?/i);
      const count = match ? match[1] : '?';
      showToast(`Scan complete — ${count} tasks found`, 'success');
      refresh();
    } else {
      showToast('Scan failed: ' + (result.stderr || 'unknown error'), 'error');
    }
  } catch (err) {
    showToast('Scan error: ' + err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
});

// Preview night plan (dry run)
$('btn-dry-run').addEventListener('click', async () => {
  const btn = $('btn-dry-run');
  setButtonLoading(btn, true);
  showToast('Generating plan...', 'info');
  try {
    const result = await window.creditforge.runNightDryRun();
    if (result.exitCode === 0) {
      showToast('Plan ready — check console for details', 'success');
      console.log('[DryRun Plan]\n' + result.stdout);
    } else {
      showToast('Dry run failed', 'error');
    }
  } catch (err) {
    showToast('Preview error: ' + err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
});

// Run individual task (delegated click handler on task list)
$('nm-task-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-run-task');
  if (!btn) return;

  const taskId = parseInt(btn.dataset.taskId, 10);
  if (isNaN(taskId)) return;

  setButtonLoading(btn, true);
  showToast(`Running task #${taskId}...`, 'info');
  try {
    const result = await window.creditforge.runTask(taskId);
    if (result.exitCode === 0) {
      showToast(`Task #${taskId} completed`, 'success');
      refresh();
    } else {
      showToast(`Task #${taskId} failed`, 'error');
    }
  } catch (err) {
    showToast('Run error: ' + err.message, 'error');
  } finally {
    setButtonLoading(btn, false);
  }
});

// ─── Event Listeners ────────────────────────────────────

$('dashboard-btn').addEventListener('click', () => {
  window.creditforge.openDashboard();
});

$('refresh-btn').addEventListener('click', refresh);

$('quit-btn').addEventListener('click', () => {
  window.close();
});

// Listen for main process refresh signals
window.creditforge.onRefresh(refresh);

// Listen for theme changes
window.creditforge.onThemeChanged((theme) => {
  document.documentElement.setAttribute('data-theme', theme);
});

// Initial load
(async () => {
  const theme = await window.creditforge.getTheme();
  document.documentElement.setAttribute('data-theme', theme);

  // Check launchd status on startup
  try {
    launchdInstalled = await window.creditforge.checkLaunchdStatus();
  } catch {
    launchdInstalled = false;
  }

  refresh();
})();
