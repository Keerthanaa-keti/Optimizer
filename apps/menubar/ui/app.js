// CreditForge Menubar — Frontend rendering

const $ = (id) => document.getElementById(id);

function barColor(pct) {
  if (pct >= 80) return '#ff3b30';
  if (pct >= 60) return '#ff6723';
  if (pct >= 40) return '#ff9f0a';
  return '#34c759';
}

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

function renderNightMode(nm) {
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

  // Top tasks
  const taskList = $('nm-task-list');
  const taskContainer = $('nm-top-tasks');
  if (nm.topTasks && nm.topTasks.length > 0) {
    taskContainer.style.display = 'block';
    taskList.innerHTML = nm.topTasks.map(t =>
      `<div class="nm-task-row">
        <span class="nm-task-name" title="${t.title}">${t.project}: ${truncate(t.title, 35)}</span>
        <span class="nm-task-score">${t.score.toFixed(1)}</span>
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

async function refresh() {
  try {
    const data = await window.creditforge.getUsageData();
    renderUsage(data);

    const nm = await window.creditforge.getNightModeStatus();
    renderNightMode(nm);

    const report = await window.creditforge.getMorningReport();
    renderReport(report);

    const intelligence = await window.creditforge.getIntelligence();
    renderInsights(intelligence);

    // Pass burn rate to alerts for predictive messaging
    const burnRateJson = intelligence?.burnRate ? JSON.stringify(intelligence.burnRate) : undefined;
    const alerts = await window.creditforge.getAlerts(JSON.stringify(data), burnRateJson);
    renderAlerts(alerts);
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

// Event listeners
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
  refresh();
})();
