import fs from 'node:fs';
import path from 'node:path';
import type { JsonlDaySummary, JsonlTokenUsage, JsonlSessionInfo } from './types.js';

const CLAUDE_PROJECTS_DIR = path.join(
  process.env.HOME ?? '~',
  '.claude',
  'projects',
);

const ACTIVE_SESSION_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

interface ParsedRequest {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

interface JsonlFileInfo {
  filePath: string;
  project: string;
  mtimeMs: number;
}

/**
 * Scan all JSONL session files for live token usage on a given date.
 * Deduplicates streaming entries by requestId (last-write-wins).
 */
export function scanLiveUsage(date?: string): JsonlDaySummary {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const files = findJsonlFilesForDate(targetDate);
  const now = Date.now();

  // Global dedup map: requestId -> ParsedRequest
  const byRequest = new Map<string, ParsedRequest>();
  // Per-file tracking for session info
  const fileRequests = new Map<string, Set<string>>();

  for (const file of files) {
    const requests = parseJsonlFile(file.filePath, targetDate);
    const fileKeys = new Set<string>();

    for (const [key, req] of requests) {
      byRequest.set(key, req); // last-write-wins across files too
      fileKeys.add(key);
    }

    if (fileKeys.size > 0) {
      fileRequests.set(file.filePath, fileKeys);
    }
  }

  // Aggregate totals
  const tokensByModel: Record<string, number> = {};
  const detailedByModel: Record<string, JsonlTokenUsage> = {};
  let totalInputOutput = 0;
  let messageCount = 0;

  for (const req of byRequest.values()) {
    const tok = req.inputTokens + req.outputTokens;
    tokensByModel[req.model] = (tokensByModel[req.model] || 0) + tok;
    totalInputOutput += tok;
    messageCount++;

    if (!detailedByModel[req.model]) {
      detailedByModel[req.model] = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      };
    }
    const d = detailedByModel[req.model];
    d.inputTokens += req.inputTokens;
    d.outputTokens += req.outputTokens;
    d.cacheCreationTokens += req.cacheCreationTokens;
    d.cacheReadTokens += req.cacheReadTokens;
  }

  // Build session info
  const sessions: JsonlSessionInfo[] = [];
  let activeSessions = 0;

  for (const file of files) {
    const keys = fileRequests.get(file.filePath);
    if (!keys || keys.size === 0) continue;

    const isActive = (now - file.mtimeMs) < ACTIVE_SESSION_THRESHOLD_MS;
    if (isActive) activeSessions++;

    // Determine dominant model and total tokens for this session file
    const sessionModels: Record<string, number> = {};
    let sessionTokens = 0;

    for (const key of keys) {
      const req = byRequest.get(key);
      if (!req) continue;
      const tok = req.inputTokens + req.outputTokens;
      sessionModels[req.model] = (sessionModels[req.model] || 0) + tok;
      sessionTokens += tok;
    }

    const topModel = Object.entries(sessionModels)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

    sessions.push({
      filePath: file.filePath,
      project: file.project,
      model: topModel,
      tokens: sessionTokens,
      messages: keys.size,
      isActive,
    });
  }

  // Sort sessions by tokens desc
  sessions.sort((a, b) => b.tokens - a.tokens);

  return {
    date: targetDate,
    totalInputOutput,
    tokensByModel,
    detailedByModel,
    sessions,
    messageCount,
    activeSessions,
  };
}

/**
 * Find all .jsonl files (including subagent files) modified on the given date.
 */
export function findJsonlFilesForDate(date: string): JsonlFileInfo[] {
  const results: JsonlFileInfo[] = [];

  let projects: string[];
  try {
    projects = fs.readdirSync(CLAUDE_PROJECTS_DIR);
  } catch {
    return results;
  }

  for (const proj of projects) {
    const projPath = path.join(CLAUDE_PROJECTS_DIR, proj);
    let entries: string[];
    try { entries = fs.readdirSync(projPath); } catch { continue; }

    for (const entry of entries) {
      const full = path.join(projPath, entry);

      // Direct .jsonl files
      if (entry.endsWith('.jsonl')) {
        try {
          const st = fs.statSync(full);
          if (st.mtime.toISOString().slice(0, 10) === date) {
            results.push({ filePath: full, project: proj, mtimeMs: st.mtimeMs });
          }
        } catch { /* skip */ }
      }

      // Subagent files: <session-uuid>/subagents/*.jsonl
      const subDir = path.join(full, 'subagents');
      try {
        const subs = fs.readdirSync(subDir);
        for (const sf of subs) {
          if (!sf.endsWith('.jsonl')) continue;
          const sfull = path.join(subDir, sf);
          try {
            const st = fs.statSync(sfull);
            if (st.mtime.toISOString().slice(0, 10) === date) {
              results.push({ filePath: sfull, project: proj, mtimeMs: st.mtimeMs });
            }
          } catch { /* skip */ }
        }
      } catch { /* no subagents dir */ }
    }
  }

  return results;
}

/**
 * Parse a single JSONL file, returning deduplicated request entries for the given date.
 * Returns Map<requestId, ParsedRequest> with last-write-wins semantics.
 */
export function parseJsonlFile(
  filePath: string,
  datePrefix: string,
): Map<string, ParsedRequest> {
  const byRequest = new Map<string, ParsedRequest>();

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return byRequest;
  }

  const lines = content.split('\n');
  for (const line of lines) {
    if (!line) continue;

    let obj: any;
    try { obj = JSON.parse(line); } catch { continue; }

    let timestamp: string | undefined;
    let requestId: string | undefined;
    let model: string | undefined;
    let usage: any;

    if (obj.type === 'assistant' && obj.message?.usage) {
      timestamp = obj.timestamp;
      requestId = obj.requestId;
      model = obj.message.model;
      usage = obj.message.usage;
    } else if (obj.type === 'progress' && obj.data?.message?.message?.usage) {
      timestamp = obj.data?.message?.timestamp || obj.timestamp;
      requestId = obj.data?.message?.requestId;
      model = obj.data.message.message.model;
      usage = obj.data.message.message.usage;
    } else {
      continue;
    }

    if (!timestamp || !timestamp.startsWith(datePrefix)) continue;
    if (!model || model === '<synthetic>') continue;
    if (!usage) continue;

    const key = requestId || `${filePath}:${timestamp}`;

    // Last write wins — streaming lines for same request have increasing output_tokens
    byRequest.set(key, {
      model,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
    });
  }

  return byRequest;
}
