import {
  getUsagePercentages,
  getSessionResetCountdown,
  getWeeklyResetLabel,
} from '@creditforge/token-monitor';
import type { UsagePercentages } from '@creditforge/token-monitor';
import fs from 'node:fs';
import path from 'node:path';

function loadTier(): 'pro' | 'max5' | 'max20' {
  const configPaths = [
    path.join(process.env.HOME ?? '~', 'Documents', 'ClaudeExperiments', 'optimizer', 'creditforge.toml'),
    path.join(process.env.HOME ?? '~', '.creditforge', 'config.toml'),
  ];
  for (const p of configPaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8');
      const match = content.match(/tier\s*=\s*"(\w+)"/);
      if (match?.[1] === 'pro' || match?.[1] === 'max5' || match?.[1] === 'max20') {
        return match[1];
      }
    } catch { /* skip */ }
  }
  return 'max5';
}

export interface MenubarUsageData extends UsagePercentages {
  sessionResetLabel: string;
  sessionResetAtMs: number;
  weeklyResetLabel: string;
  sonnetResetLabel: string;
}

export function getUsageData(): MenubarUsageData {
  const tier = loadTier();
  const usage = getUsagePercentages(tier);
  const sessionReset = getSessionResetCountdown(usage.data.session.oldestTs);

  return {
    ...usage,
    sessionResetLabel: sessionReset.label,
    sessionResetAtMs: sessionReset.resetAtMs,
    weeklyResetLabel: getWeeklyResetLabel(6, 14, 30),   // Sat 2:30 PM
    sonnetResetLabel: getWeeklyResetLabel(1, 21, 30),    // Mon 9:30 PM
  };
}
