// CreditForge Menubar — Frontend rendering

const $ = (id) => document.getElementById(id);

let launchdInstalled = false;
let taskListExpanded = false;

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

// ─── Subscription View Rendering ────────────────────────

function renderSubscriptionView(sv) {
  // Hero
  $('sub-plan-monthly').textContent = `$${sv.planMonthly}/month`;
  $('sub-plan-weekly').textContent = `$${sv.planWeekly.toFixed(2)}`;

  // This Week card
  const weeklyFill = $('sub-weekly-fill');
  weeklyFill.style.width = Math.min(sv.weeklyPct, 100) + '%';
  weeklyFill.style.background = barColor(sv.weeklyPct);
  $('sub-weekly-pct').textContent = sv.weeklyPct + '%';
  $('sub-weekly-msgs').textContent = sv.weeklyMsgs + ' msgs';
  $('sub-weekly-used').textContent = `$${sv.weeklyUsedSub.toFixed(2)} used`;
  $('sub-weekly-remaining').textContent = `$${sv.weeklyRemainingSub.toFixed(2)} left`;
  $('sub-weekly-reset').textContent = sv.weeklyResetLabel;

  // Current Session card
  const sessionFill = $('sub-session-fill');
  sessionFill.style.width = Math.min(sv.sessionPct, 100) + '%';
  sessionFill.style.background = barColor(sv.sessionPct);
  $('sub-session-pct').textContent = sv.sessionPct + '%';
  $('sub-session-spent').textContent = `$${sv.sessionSpentSub.toFixed(2)} spent this session`;
  $('sub-session-msgs').textContent = sv.sessionMsgs + ' msgs';
  $('sub-session-reset').textContent = sv.sessionResetLabel;

  // Subscription Value card
  const utilPct = $('sub-util-pct');
  utilPct.textContent = `${sv.utilizationPct}% utilized this week`;
  if (sv.utilizationPct >= 70) {
    utilPct.className = 'sub-value-pct val-green';
  } else if (sv.utilizationPct >= 40) {
    utilPct.className = 'sub-value-pct val-yellow';
  } else {
    utilPct.className = 'sub-value-pct val-red';
  }

  const wasteEl = $('sub-waste');
  if (sv.utilizationPct < 50 && sv.wastedWeeklySub > 2) {
    wasteEl.textContent = `~$${sv.wastedWeeklySub.toFixed(0)}/week going unused`;
    wasteEl.style.display = 'block';
  } else {
    wasteEl.style.display = 'none';
  }

  // Tier label in footer
  $('tier-label').textContent = sv.tierLabel;
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

  // Toggle switch
  const toggleInput = $('nm-toggle-input');
  const toggleLabel = $('nm-toggle-label');
  toggleInput.checked = nm.isEnabled;
  toggleLabel.textContent = nm.isEnabled ? 'Enabled' : 'Disabled';

  // Next run
  $('nm-next-run').textContent = nm.isEnabled ? nm.nextRunAt : '--';

  // Queued
  $('nm-queued').textContent = nm.queuedTasks;

  // Subscription context
  if (nm.nightSubBudget) {
    $('nm-sub-budget').textContent = `$${nm.nightSubBudget.toFixed(2)} of $${nm.dailySubBudget.toFixed(2)}/day`;
  }
  if (nm.nightHours) {
    $('nm-window').textContent = `${nm.nightHours}h overnight`;
  }

  // View All link
  const viewAllBtn = $('nm-view-all');
  const viewAllCount = $('nm-view-all-count');
  if (nm.queuedTasks > 5) {
    viewAllBtn.style.display = 'inline';
    viewAllCount.textContent = nm.queuedTasks;
    viewAllBtn.textContent = taskListExpanded ? 'Show Less' : `View All (${nm.queuedTasks})`;
  } else {
    viewAllBtn.style.display = 'none';
  }

  // Today's results
  if (nm.completedToday > 0 || nm.failedToday > 0) {
    $('nm-today').textContent = `${nm.completedToday} done, ${nm.failedToday} failed`;
  } else {
    $('nm-today').textContent = 'No runs today';
  }

  // Top tasks with run/skip/delete buttons
  const taskList = $('nm-task-list');
  const taskContainer = $('nm-top-tasks');
  const tasks = nm.topTasks && nm.topTasks.length > 0 ? nm.topTasks : [];
  if (tasks.length > 0) {
    taskContainer.style.display = 'block';
    renderTaskRows(taskList, tasks);
  } else {
    taskContainer.style.display = 'none';
  }
}

function renderTaskRows(container, tasks) {
  container.innerHTML = tasks.map(t =>
    `<div class="nm-task-row" data-task-id="${t.id}">
      <span class="nm-task-name" title="${t.title}">${t.project}: ${truncate(t.title, 24)}</span>
      <span class="nm-task-score">${t.score.toFixed(1)}</span>
      <div class="nm-task-actions">
        <button class="btn-run-task" data-task-id="${t.id}" title="Run">Run</button>
        <button class="btn-skip" data-task-id="${t.id}" title="Skip">Skip</button>
        <button class="btn-delete" data-task-id="${t.id}" title="Delete">&times;</button>
      </div>
    </div>`
  ).join('');
}

async function loadAllTasks() {
  try {
    const tasks = await window.creditforge.getAllTasks();
    const taskList = $('nm-task-list');
    taskList.classList.add('nm-task-list-scroll');
    renderTaskRows(taskList, tasks);
  } catch (err) {
    showToast('Failed to load tasks', 'error');
  }
}

async function handleSkipTask(taskId, rowEl) {
  try {
    const result = await window.creditforge.skipTask(taskId);
    if (result.success) {
      rowEl.classList.add('removing');
      setTimeout(() => {
        rowEl.remove();
        refreshAfterTaskChange();
      }, 300);
    } else {
      showToast('Skip failed: ' + (result.error || ''), 'error');
    }
  } catch (err) {
    showToast('Skip error: ' + err.message, 'error');
  }
}

async function handleDeleteTask(taskId, rowEl) {
  try {
    const result = await window.creditforge.deleteTask(taskId);
    if (result.success) {
      rowEl.classList.add('removing');
      setTimeout(() => {
        rowEl.remove();
        refreshAfterTaskChange();
      }, 300);
    } else {
      showToast('Delete failed: ' + (result.error || ''), 'error');
    }
  } catch (err) {
    showToast('Delete error: ' + err.message, 'error');
  }
}

async function refreshAfterTaskChange() {
  const nm = await window.creditforge.getNightModeStatus();
  // Update queued count and view-all
  $('nm-queued').textContent = nm.queuedTasks;
  const viewAllBtn = $('nm-view-all');
  if (nm.queuedTasks > 5) {
    viewAllBtn.style.display = 'inline';
    viewAllBtn.textContent = taskListExpanded ? 'Show Less' : `View All (${nm.queuedTasks})`;
  } else {
    viewAllBtn.style.display = 'none';
    if (taskListExpanded) {
      taskListExpanded = false;
      $('nm-task-list').classList.remove('nm-task-list-scroll');
    }
  }
  // If expanded, reload all; otherwise leave current rows
  if (taskListExpanded) {
    await loadAllTasks();
  }
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

// ─── Morning Report Banner ──────────────────────────────

function renderReportBanner(report) {
  const banner = $('morning-report-banner');
  if (!report || !report.exists) {
    banner.style.display = 'none';
    return;
  }

  // Parse success/fail counts from report markdown
  const successMatch = report.content.match(/Succeeded:\s*(\d+)/);
  const failMatch = report.content.match(/Failed:\s*(\d+)/);
  const succeeded = successMatch ? parseInt(successMatch[1], 10) : 0;
  const failed = failMatch ? parseInt(failMatch[1], 10) : 0;

  // Parse cost to compute recovered value
  const costMatch = report.content.match(/Total cost:\s*\$?([\d.]+)/);
  const costDollars = costMatch ? parseFloat(costMatch[1]) : 0;

  let summary = `Night run: ${succeeded} done`;
  if (failed > 0) summary += `, ${failed} failed`;
  if (costDollars > 0) summary += ` · $${costDollars.toFixed(2)} recovered`;

  $('nm-report-summary').textContent = summary;
  banner.style.display = 'flex';
}

// ─── Exclude Paths ──────────────────────────────────────

async function loadExcludePaths() {
  try {
    const paths = await window.creditforge.getExcludePaths();
    renderExcludePaths(paths);
  } catch {
    renderExcludePaths([]);
  }
}

function renderExcludePaths(paths) {
  const list = $('nm-exclude-list');
  if (paths.length === 0) {
    list.innerHTML = '<div class="nm-exclude-empty">No excluded paths</div>';
    return;
  }
  list.innerHTML = paths.map(p =>
    `<div class="nm-exclude-item">
      <span class="nm-exclude-path" title="${p}">${p}</span>
      <button class="nm-exclude-remove" data-path="${p}" title="Remove">&times;</button>
    </div>`
  ).join('');
}

// ─── Refresh ────────────────────────────────────────────

async function refresh() {
  try {
    const [sv, nm, report] = await Promise.all([
      window.creditforge.getSubscriptionView(),
      window.creditforge.getNightModeStatus(),
      window.creditforge.getMorningReport(),
    ]);

    renderSubscriptionView(sv);
    renderNightMode(nm);
    renderReportBanner(report);
  } catch (err) {
    console.error('Refresh failed:', err);
  }
}

// ─── Results Panel ──────────────────────────────────────

function showResults(title, bodyHtml) {
  $('nm-results-title').textContent = title;
  $('nm-results-body').innerHTML = bodyHtml;
  $('nm-results').style.display = 'block';
}

function hideResults() {
  $('nm-results').style.display = 'none';
}

function parseScanOutput(stdout) {
  const lines = stdout.split('\n');
  let html = '';

  // Extract summary numbers
  const totalMatch = stdout.match(/Total tasks discovered:\s*(\d+)/);
  const projectsMatch = stdout.match(/Projects scanned:\s*(\d+)/);
  const errorsMatch = stdout.match(/Errors:\s*(\d+)/);

  if (totalMatch) {
    html += `<div class="results-stat-row">`;
    html += `<span class="results-stat"><strong>${totalMatch[1]}</strong> tasks</span>`;
    if (projectsMatch) html += `<span class="results-stat"><strong>${projectsMatch[1]}</strong> projects</span>`;
    if (errorsMatch && errorsMatch[1] !== '0') html += `<span class="results-stat results-error"><strong>${errorsMatch[1]}</strong> errors</span>`;
    html += `</div>`;
  }

  // Extract by-source breakdown
  const sourceSection = stdout.match(/By source:\n([\s\S]*?)(?:\nBy category:|\nTop)/);
  if (sourceSection) {
    const sourceLines = sourceSection[1].trim().split('\n').filter(l => l.trim());
    if (sourceLines.length > 0) {
      html += `<div class="results-label">By source</div>`;
      html += sourceLines.map(l => {
        const m = l.trim().match(/^(.+?):\s*(\d+)$/);
        return m ? `<div class="results-kv"><span>${m[1]}</span><span>${m[2]}</span></div>` : '';
      }).join('');
    }
  }

  // Extract top tasks
  const topSection = stdout.match(/Top \d+ tasks by score:\n([\s\S]*?)$/);
  if (topSection) {
    const taskLines = topSection[1].trim().split('\n').filter(l => l.trim()).slice(0, 5);
    if (taskLines.length > 0) {
      html += `<div class="results-label">Top tasks</div>`;
      html += taskLines.map(l => {
        const m = l.trim().match(/^\d+\.\s*\[([^\]]+)\]\s*(.+?)\s*\|\s*(.+)$/);
        if (!m) return '';
        return `<div class="results-task"><span class="results-task-score">${m[1]}</span><span class="results-task-name">${m[2]}: ${truncate(m[3], 28)}</span></div>`;
      }).join('');
    }
  }

  return html || `<div class="results-label">No tasks found</div>`;
}

function parsePlanOutput(stdout) {
  let html = '';

  // Extract plan summary — new subscription-dollar format
  const planned = stdout.match(/Planned for execution:\s*(\d+)/);
  const queued = stdout.match(/Queued tasks:\s*(\d+)/);
  const planLine = stdout.match(/Your plan:\s*(.+)/);
  const nightBudget = stdout.match(/Night budget:\s*(\$[\d.]+)\s*\((.+?)\)/);
  const duration = stdout.match(/Estimated duration:\s*~?(.+)/);
  const recovery = stdout.match(/Recovery value:\s*~?(\$[\d.]+)\s*of\s*(.+)/);
  const branch = stdout.match(/Branch:\s*(.+)/);

  // Also support legacy format for backward compatibility
  const legacyBudget = stdout.match(/Budget cap:\s*(\$[\d.]+)/);
  const legacyCost = stdout.match(/Estimated cost:\s*(\$[\d.]+)/);

  html += `<div class="results-stat-row">`;
  if (planned) html += `<span class="results-stat"><strong>${planned[1]}</strong> planned</span>`;
  if (queued) html += `<span class="results-stat">${queued[1]} queued</span>`;
  html += `</div>`;

  html += `<div class="results-kv-group">`;
  if (planLine) html += `<div class="results-kv"><span>Your plan</span><span>${planLine[1].trim()}</span></div>`;
  if (nightBudget) html += `<div class="results-kv"><span>Night budget</span><span>${nightBudget[1]} <small style="color:var(--text-secondary)">(${nightBudget[2]})</small></span></div>`;
  if (legacyBudget && !nightBudget) html += `<div class="results-kv"><span>Budget cap</span><span>${legacyBudget[1]}</span></div>`;
  if (legacyCost && !recovery) html += `<div class="results-kv"><span>Est. cost</span><span>${legacyCost[1]}</span></div>`;
  if (duration) html += `<div class="results-kv"><span>Duration</span><span>${duration[1].trim()}</span></div>`;
  if (recovery) html += `<div class="results-kv"><span>Recovery value</span><span style="color:var(--bar-green);font-weight:600">${recovery[1]}</span></div>`;
  if (branch) html += `<div class="results-kv"><span>Branch</span><span class="results-mono">${branch[1].trim()}</span></div>`;
  html += `</div>`;

  // Extract execution order (with optional task IDs like #42)
  const orderSection = stdout.match(/Execution order:\n([\s\S]*?)(?:\n\[DRY RUN\]|$)/);
  if (orderSection) {
    const taskLines = orderSection[1].trim().split('\n').filter(l => l.trim());
    if (taskLines.length > 0) {
      html += `<div class="results-label">Tonight's plan</div>`;
      html += taskLines.map(l => {
        const m = l.trim().match(/^\d+\.\s*\[([^\]]+)\]\s*(.+?)\s*\|\s*(.+?)(?:\s*\(#(\d+)\))?\s*$/);
        if (!m) return '';
        const taskIdAttr = m[4] ? ` data-plan-task-id="${m[4]}"` : '';
        const skipBtn = m[4] ? `<button class="btn-skip btn-plan-skip" data-task-id="${m[4]}">Skip</button>` : '';
        return `<div class="results-task"${taskIdAttr}><span class="results-task-score">${m[1]}</span><span class="results-task-name">${m[2]}: ${truncate(m[3], 24)}</span>${skipBtn}</div>`;
      }).join('');
    }
  }

  // Handle edge cases
  if (stdout.includes('Night mode is disabled')) {
    html = `<div class="results-label">Night mode is disabled in config</div>
      <div class="results-hint">Enable it in creditforge.toml: enabled = true</div>`;
  } else if (stdout.includes('No queued tasks')) {
    html = `<div class="results-label">No queued tasks</div>
      <div class="results-hint">Run Scan first to discover tasks</div>`;
  }

  return html || `<div class="results-label">No plan generated</div>`;
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

// ─── Night Mode Toggle ──────────────────────────────────
$('nm-toggle-input').addEventListener('change', async () => {
  const toggleInput = $('nm-toggle-input');
  const toggleLabel = $('nm-toggle-label');
  try {
    const result = await window.creditforge.toggleNightMode();
    toggleInput.checked = result.enabled;
    toggleLabel.textContent = result.enabled ? 'Enabled' : 'Disabled';
    $('nm-next-run').textContent = result.enabled ? (await window.creditforge.getNightModeStatus()).nextRunAt : '--';
    showToast(`Night Mode ${result.enabled ? 'enabled' : 'disabled'}`, 'success');
  } catch (err) {
    // Revert on error
    toggleInput.checked = !toggleInput.checked;
    showToast('Toggle failed: ' + err.message, 'error');
  }
});

// ─── View All Tasks ─────────────────────────────────────
$('nm-view-all').addEventListener('click', async () => {
  if (taskListExpanded) {
    taskListExpanded = false;
    $('nm-task-list').classList.remove('nm-task-list-scroll');
    $('nm-view-all').textContent = `View All (${$('nm-queued').textContent})`;
    refresh();
  } else {
    taskListExpanded = true;
    $('nm-view-all').textContent = 'Show Less';
    await loadAllTasks();
  }
});

// ─── Skip/Delete Task (delegated) ──────────────────────
$('nm-task-list').addEventListener('click', async (e) => {
  const skipBtn = e.target.closest('.btn-skip');
  if (skipBtn) {
    const taskId = parseInt(skipBtn.dataset.taskId, 10);
    const row = skipBtn.closest('.nm-task-row');
    if (!isNaN(taskId) && row) {
      await handleSkipTask(taskId, row);
    }
    return;
  }

  const deleteBtn = e.target.closest('.btn-delete');
  if (deleteBtn) {
    const taskId = parseInt(deleteBtn.dataset.taskId, 10);
    const row = deleteBtn.closest('.nm-task-row');
    if (!isNaN(taskId) && row) {
      await handleDeleteTask(taskId, row);
    }
    return;
  }
});

// ─── Plan Review Skip (delegated on results panel) ─────
$('nm-results-body').addEventListener('click', async (e) => {
  const skipBtn = e.target.closest('.btn-plan-skip');
  if (!skipBtn) return;

  const taskId = parseInt(skipBtn.dataset.taskId, 10);
  if (isNaN(taskId)) return;

  skipBtn.disabled = true;
  skipBtn.textContent = '...';
  try {
    const result = await window.creditforge.skipTask(taskId);
    if (result.success) {
      const row = skipBtn.closest('.results-task');
      if (row) row.remove();
      showToast(`Task #${taskId} skipped`, 'success');
      // Re-run preview to regenerate plan
      const planResult = await window.creditforge.runNightDryRun();
      if (planResult.exitCode === 0) {
        $('nm-results-body').innerHTML = parsePlanOutput(planResult.stdout);
      }
      refreshAfterTaskChange();
    } else {
      showToast('Skip failed', 'error');
      skipBtn.disabled = false;
      skipBtn.textContent = 'Skip';
    }
  } catch (err) {
    showToast('Skip error: ' + err.message, 'error');
    skipBtn.disabled = false;
    skipBtn.textContent = 'Skip';
  }
});

// View Report button opens dashboard
$('btn-view-report').addEventListener('click', () => {
  window.creditforge.openDashboard();
});

// Close results panel
$('nm-results-close').addEventListener('click', hideResults);

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

// Add exclude path
$('nm-exclude-add').addEventListener('click', async () => {
  const newPath = prompt('Enter path to exclude from Night Mode:\n(e.g. ~/Documents/ClaudeExperiments/GitCode)');
  if (!newPath || !newPath.trim()) return;
  try {
    const current = await window.creditforge.getExcludePaths();
    if (current.includes(newPath.trim())) {
      showToast('Path already excluded', 'info');
      return;
    }
    const updated = [...current, newPath.trim()];
    const result = await window.creditforge.setExcludePaths(updated);
    if (result.success) {
      renderExcludePaths(updated);
      showToast('Path excluded', 'success');
    } else {
      showToast('Failed: ' + (result.error || ''), 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
});

// Remove exclude path (delegated)
$('nm-exclude-list').addEventListener('click', async (e) => {
  const removeBtn = e.target.closest('.nm-exclude-remove');
  if (!removeBtn) return;
  const pathToRemove = removeBtn.dataset.path;
  try {
    const current = await window.creditforge.getExcludePaths();
    const updated = current.filter(p => p !== pathToRemove);
    const result = await window.creditforge.setExcludePaths(updated);
    if (result.success) {
      renderExcludePaths(updated);
      showToast('Path removed', 'success');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
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
      showResults('Scan Results', parseScanOutput(result.stdout));
      refresh();
    } else {
      const errMsg = result.stderr?.split('\n')[0] || 'Unknown error';
      showResults('Scan Failed', `<div class="results-error">${errMsg}</div>`);
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
      showResults('Tonight\'s Plan', parsePlanOutput(result.stdout));
    } else {
      const errMsg = result.stderr?.split('\n')[0] || 'Unknown error';
      showResults('Plan Failed', `<div class="results-error">${errMsg}</div>`);
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
      showToast(`Task #${taskId} failed (exit ${result.exitCode})`, 'error');
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

  // Load exclude paths
  loadExcludePaths();

  refresh();
})();
