// ─── Task Discovery ────────────────────────────────────────────

export type TaskSource =
  | 'claude-md'
  | 'todo-comment'
  | 'bugs-codex'
  | 'fix-md'
  | 'npm-audit'
  | 'tsc-errors'
  | 'missing-tests'
  | 'package-json'
  | 'git-stale-branch'
  | 'system-maintenance'
  | 'file-organization'
  | 'dev-tooling'
  | 'productivity';

export type TaskStatus = 'queued' | 'scheduled' | 'running' | 'completed' | 'failed' | 'skipped';

export type TaskCategory = 'bug-fix' | 'test' | 'lint' | 'security' | 'refactor' | 'docs' | 'cleanup' | 'build' | 'system' | 'maintenance' | 'organization' | 'update';

export interface Task {
  id?: number;
  projectPath: string;
  projectName: string;
  source: TaskSource;
  category: TaskCategory;
  title: string;
  description: string;
  filePath?: string;
  lineNumber?: number;
  impact: number;       // 1-5
  confidence: number;   // 1-5
  risk: number;         // 1-5
  duration: number;     // 1-5 (estimated cost units)
  score?: number;       // computed: (impact*3 + confidence*2) / (risk*2 + duration)
  status: TaskStatus;
  prompt?: string;      // Claude CLI prompt to execute this task
  createdAt?: string;
  updatedAt?: string;
}

export function computeScore(task: Pick<Task, 'impact' | 'confidence' | 'risk' | 'duration'>): number {
  const numerator = task.impact * 3 + task.confidence * 2;
  const denominator = task.risk * 2 + task.duration;
  return Math.round((numerator / denominator) * 100) / 100;
}

// ─── Credit Ledger ─────────────────────────────────────────────

export type LedgerEntryType = 'debit' | 'credit';

export interface LedgerEntry {
  id?: number;
  accountId: string;          // 'self' for Phase 0, user IDs in Phase 3
  counterpartyId: string;     // 'claude-api' for execution costs, peer IDs in Phase 3
  entryType: LedgerEntryType;
  amount: number;             // tokens or USD cents
  currency: 'tokens' | 'usd_cents';
  description: string;
  taskId?: number;
  executionId?: number;
  createdAt?: string;
}

export interface CreditSnapshot {
  id?: number;
  accountId: string;
  balanceTokens: number;
  balanceUsdCents: number;
  windowResetAt: string;      // when the subscription credit window resets
  capturedAt?: string;
}

// ─── Governor ──────────────────────────────────────────────────

export interface GovernorDecision {
  allowed: boolean;
  reason: string;
  remainingBudgetUsdCents: number;
  cappedBudgetUsdCents: number;  // after 75% cap
  tasksApproved: number;
  tasksRejected: number;
}

export interface GovernorConfig {
  creditCapPercent: number;       // default 75
  maxBudgetPerTaskUsdCents: number; // default 50 ($0.50)
  hardStopMinutesBeforeReset: number; // default 30
  windowResetHour: number;        // hour of day when credits reset
}

// ─── Execution ─────────────────────────────────────────────────

export interface Execution {
  id?: number;
  taskId: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsdCents: number;
  durationMs: number;
  exitCode: number;
  stdout: string;
  stderr: string;
  branch: string;           // nightmode/YYYY-MM-DD
  commitHash?: string;
  startedAt?: string;
  completedAt?: string;
}

// ─── Project ───────────────────────────────────────────────────

export interface Project {
  id?: number;
  path: string;
  name: string;
  lastScannedAt?: string;
  taskCount: number;
  hasClaudeMd: boolean;
  hasBugsCodex: boolean;
  hasPackageJson: boolean;
  isGitRepo: boolean;
}

// ─── Night Mode ────────────────────────────────────────────────

export interface NightModeConfig {
  enabled: boolean;
  startHour: number;
  endHour: number;
  creditCapPercent: number;
  modelPreference: string;
  maxBudgetPerTaskUsd: number;
}

export interface BatchPlan {
  tasks: Task[];
  totalEstimatedCostUsdCents: number;
  budgetCapUsdCents: number;
  tasksSkipped: number;
  executionOrder: number[];  // task IDs in order
}

// ─── Pool Protocol (Phase 3 stub) ─────────────────────────────

export interface PoolTransaction {
  id?: number;
  providerId: string;
  consumerId: string;
  taskId: number;
  tokensAllocated: number;
  tokensUsed: number;
  status: 'pending' | 'active' | 'completed' | 'disputed';
  escrowUsdCents: number;
  createdAt?: string;
  settledAt?: string;
}
