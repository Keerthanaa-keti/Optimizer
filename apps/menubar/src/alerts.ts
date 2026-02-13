/**
 * Pacing intelligence engine — smart alerts based on usage patterns.
 * Calculates burn rate, time-to-limit, and model suggestions.
 */

import type { MenubarUsageData } from './data.js';

export type AlertLevel = 'info' | 'success' | 'warning' | 'danger';

export interface PacingAlert {
  level: AlertLevel;
  title: string;
  message: string;
}

/**
 * Generate smart alerts based on current usage data.
 */
export function getAlerts(usage: MenubarUsageData): PacingAlert[] {
  const alerts: PacingAlert[] = [];

  // Session-based alerts
  const sessionAlert = getSessionAlert(usage);
  if (sessionAlert) alerts.push(sessionAlert);

  // Weekly budget alert
  const weeklyAlert = getWeeklyAlert(usage);
  if (weeklyAlert) alerts.push(weeklyAlert);

  // Model suggestion
  const modelAlert = getModelSuggestion(usage);
  if (modelAlert) alerts.push(modelAlert);

  return alerts;
}

function getSessionAlert(usage: MenubarUsageData): PacingAlert | null {
  const pct = usage.sessionPct;
  const resetMs = usage.sessionResetAtMs - Date.now();
  const resetMins = Math.max(0, Math.floor(resetMs / 60000));
  const resetH = Math.floor(resetMins / 60);
  const resetM = resetMins % 60;
  const countdown = resetH > 0 ? `${resetH}hr ${resetM}min` : `${resetM}min`;

  if (pct < 20) {
    return {
      level: 'success',
      title: 'Plenty of capacity',
      message: 'Good time for heavy Opus tasks.',
    };
  }

  if (pct < 40) {
    return null; // No alert needed — cruising
  }

  if (pct < 60) {
    return {
      level: 'info',
      title: 'On pace',
      message: `${countdown} until session limit.`,
    };
  }

  if (pct < 80) {
    return {
      level: 'warning',
      title: 'Approaching limit',
      message: `Session resets in ${countdown}. Consider Haiku for routine tasks.`,
    };
  }

  return {
    level: 'danger',
    title: 'Near limit!',
    message: `Session resets in ${countdown}. Save Opus for critical work.`,
  };
}

function getWeeklyAlert(usage: MenubarUsageData): PacingAlert | null {
  const pct = usage.weeklyPct;

  if (pct < 70) return null;

  // Estimate days remaining until weekly reset (Saturday)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysLeft = (6 - dayOfWeek + 7) % 7 || 7;

  if (pct >= 90) {
    return {
      level: 'danger',
      title: 'Weekly budget critical',
      message: `${pct}% used with ${daysLeft} day${daysLeft !== 1 ? 's' : ''} left. Prioritize essential tasks only.`,
    };
  }

  return {
    level: 'warning',
    title: 'Weekly budget alert',
    message: `${pct}% used with ${daysLeft} day${daysLeft !== 1 ? 's' : ''} until reset.`,
  };
}

function getModelSuggestion(usage: MenubarUsageData): PacingAlert | null {
  const byModel = usage.data.session.byModel;
  const totalCost = usage.data.session.cost;
  if (totalCost === 0) return null;

  // Calculate Opus percentage of session cost
  let opusCost = 0;
  for (const [model, cost] of Object.entries(byModel)) {
    if (model.includes('opus')) {
      opusCost += cost;
    }
  }

  const opusPct = (opusCost / totalCost) * 100;

  if (opusPct > 80 && usage.sessionPct > 40) {
    return {
      level: 'info',
      title: 'Model suggestion',
      message: `${Math.round(opusPct)}% of session cost is Opus. Switch to Haiku for simple tasks to extend capacity.`,
    };
  }

  return null;
}
