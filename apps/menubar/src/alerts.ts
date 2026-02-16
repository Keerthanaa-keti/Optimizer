/**
 * Pacing intelligence engine — smart alerts based on usage patterns.
 * Calculates burn rate, time-to-limit, and model suggestions.
 * Enhanced with burn rate predictions from intelligence layer.
 */

import type { MenubarUsageData } from './data.js';
import type { BurnRateSnapshot } from '@creditforge/intelligence';

export type AlertLevel = 'info' | 'success' | 'warning' | 'danger';

export interface PacingAlert {
  level: AlertLevel;
  title: string;
  message: string;
}

/**
 * Generate smart alerts based on current usage data.
 * Optionally enhanced with burn rate predictions.
 */
export function getAlerts(usage: MenubarUsageData, burnRate?: BurnRateSnapshot): PacingAlert[] {
  const alerts: PacingAlert[] = [];

  // Burn-rate-enhanced session alert (or fallback to basic)
  const sessionAlert = burnRate
    ? getBurnRateAlert(usage, burnRate)
    : getSessionAlert(usage);
  if (sessionAlert) alerts.push(sessionAlert);

  // Weekly budget alert
  const weeklyAlert = getWeeklyAlert(usage, burnRate);
  if (weeklyAlert) alerts.push(weeklyAlert);

  // Model suggestion
  const modelAlert = getModelSuggestion(usage);
  if (modelAlert) alerts.push(modelAlert);

  return alerts;
}

function getBurnRateAlert(usage: MenubarUsageData, br: BurnRateSnapshot): PacingAlert | null {
  const resetMs = usage.sessionResetAtMs - Date.now();
  const resetMins = Math.max(0, Math.floor(resetMs / 60000));
  const resetH = Math.floor(resetMins / 60);
  const resetM = resetMins % 60;
  const countdown = resetH > 0 ? `${resetH}hr ${resetM}min` : `${resetM}min`;

  if (br.risk === 'critical') {
    const ttl = br.sessionTimeToLimit === Infinity
      ? ''
      : ` Limit in ~${br.sessionTimeToLimit}min.`;
    return {
      level: 'danger',
      title: 'Critical burn rate',
      message: `$${br.sessionBurnRate.toFixed(2)}/hr.${ttl} Session resets in ${countdown}. Save Opus for critical work.`,
    };
  }

  if (br.risk === 'warning') {
    return {
      level: 'warning',
      title: 'High burn rate',
      message: `$${br.sessionBurnRate.toFixed(2)}/hr — projected ${br.sessionProjectedPct}% by window end. Resets in ${countdown}.`,
    };
  }

  if (br.risk === 'caution') {
    return {
      level: 'info',
      title: 'Moderate pace',
      message: `$${br.sessionBurnRate.toFixed(2)}/hr — ${br.sessionProjectedPct}% projected. ${countdown} remaining.`,
    };
  }

  if (usage.sessionPct < 20) {
    return {
      level: 'success',
      title: 'Plenty of capacity',
      message: `$${br.sessionBurnRate.toFixed(2)}/hr. Good time for heavy Opus tasks.`,
    };
  }

  return null;
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

  if (pct < 40) return null;

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

function getWeeklyAlert(usage: MenubarUsageData, burnRate?: BurnRateSnapshot): PacingAlert | null {
  const pct = usage.weeklyPct;
  if (pct < 70) return null;

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

  // Enhanced: show projected weekly % if burn rate data available
  const projection = burnRate
    ? ` Projected ${burnRate.weeklyProjectedPct}% at reset.`
    : '';

  return {
    level: 'warning',
    title: 'Weekly budget alert',
    message: `${pct}% used with ${daysLeft} day${daysLeft !== 1 ? 's' : ''} until reset.${projection}`,
  };
}

function getModelSuggestion(usage: MenubarUsageData): PacingAlert | null {
  const byModel = usage.data.session.byModel;
  const totalCost = usage.data.session.cost;
  if (totalCost === 0) return null;

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
