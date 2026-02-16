import { Notification } from 'electron';
import type { MenubarUsageData, NightModeStatus } from './data.js';

export interface NotificationState {
  lastSessionThreshold: number;   // last threshold crossed (0, 60, 80, 95)
  lastReportDate: string | null;  // date of last report notification
  lastIdleNotifyDate: string | null; // date of last idle warning
}

const THRESHOLDS = [60, 80, 95] as const;

function sendNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

/**
 * Check usage data against thresholds and fire macOS notifications.
 * Called every 30s from the tray refresh interval.
 */
export function checkAndNotify(
  usage: MenubarUsageData,
  nm: NightModeStatus,
  state: NotificationState,
): void {
  const pct = usage.sessionPct;
  const today = new Date().toISOString().split('T')[0];

  // 1. Session threshold crossing (only fire when crossing UP)
  for (const threshold of THRESHOLDS) {
    if (pct >= threshold && state.lastSessionThreshold < threshold) {
      const model = pct >= 80 ? 'Switch to Haiku' : 'Consider Sonnet';
      sendNotification(
        `Session at ${pct}%`,
        `${model}. ${usage.sessionResetLabel}.`,
      );
      state.lastSessionThreshold = threshold;
      break; // Only fire the highest new threshold
    }
  }

  // Reset threshold tracking when session resets (pct drops below previous threshold)
  if (pct < 60 && state.lastSessionThreshold >= 60) {
    state.lastSessionThreshold = 0;
  }

  // 2. Morning report notification (once per day)
  if (nm.completedToday > 0 && state.lastReportDate !== today) {
    const spent = (nm.totalSpentToday / 100).toFixed(2);
    sendNotification(
      'Night mode completed',
      `${nm.completedToday} tasks done, $${spent} spent`,
    );
    state.lastReportDate = today;
  }

  // 3. Daily idle warning if utilization < 30%
  if (
    pct < 30 &&
    nm.queuedTasks > 0 &&
    state.lastIdleNotifyDate !== today &&
    new Date().getHours() >= 10 // Only after 10am
  ) {
    sendNotification(
      'Subscription underused',
      `${nm.queuedTasks} tasks ready to run. Enable Night Mode to optimize.`,
    );
    state.lastIdleNotifyDate = today;
  }
}
