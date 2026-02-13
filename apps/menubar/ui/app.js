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

async function refresh() {
  try {
    const data = await window.creditforge.getUsageData();
    renderUsage(data);

    const alerts = await window.creditforge.getAlerts(JSON.stringify(data));
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
