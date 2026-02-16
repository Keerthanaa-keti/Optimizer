/**
 * Schedule optimizer — suggests optimal night mode timing based on usage patterns.
 * Finds the longest contiguous block of quiet hours for task execution.
 */

import type { DailyUsagePattern, ScheduleSuggestion } from './types.js';

const MIN_BLOCK_HOURS = 3;
const MAX_BLOCK_HOURS = 8;

/**
 * Suggest the optimal night mode window based on usage patterns.
 * Returns null if no suitable quiet block is found.
 */
export function suggestOptimalSchedule(
  patterns: DailyUsagePattern,
): ScheduleSuggestion | null {
  const quietHours = new Set(patterns.quietHours);

  if (quietHours.size < MIN_BLOCK_HOURS) return null;

  // Find longest contiguous block of quiet hours (wrapping around midnight)
  const best = findLongestContiguousBlock(quietHours);

  if (!best || best.length < MIN_BLOCK_HOURS) return null;

  const startHour = best.start;
  const durationHours = Math.min(best.length, MAX_BLOCK_HOURS);
  const endHour = (startHour + durationHours) % 24;

  // Confidence based on how much data we have and block size
  const confidence = Math.min(
    (durationHours / MAX_BLOCK_HOURS) * 0.7 + 0.3,
    1.0,
  );

  return {
    startHour,
    endHour,
    durationHours,
    reason: `${durationHours}h quiet window found (${formatHour(startHour)}-${formatHour(endHour)}), minimal user activity`,
    confidence: Math.round(confidence * 100) / 100,
  };
}

function findLongestContiguousBlock(
  quietHours: Set<number>,
): { start: number; length: number } | null {
  if (quietHours.size === 0) return null;

  // Duplicate the 24h cycle to handle wrapping (e.g., 23-2)
  const hours: boolean[] = new Array(48).fill(false);
  for (const h of quietHours) {
    hours[h] = true;
    hours[h + 24] = true;
  }

  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < 48; i++) {
    if (hours[i]) {
      if (curLen === 0) curStart = i;
      curLen++;
      // Cap at 24 to avoid counting the same hours twice
      if (curLen > bestLen && curLen <= 24) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curLen = 0;
    }
  }

  if (bestStart < 0) return null;

  return {
    start: bestStart % 24,
    length: bestLen,
  };
}

function formatHour(h: number): string {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}${period}`;
}
