import type { LedgerEntry, CreditSnapshot } from './models.js';

/**
 * Double-entry credit ledger.
 * Every transaction creates two entries: a debit on the spender's side
 * and a credit on the receiver's side. In Phase 0, the accounts are
 * 'self' (you) and 'claude-api' (the service). In Phase 3, this
 * naturally extends to peer-to-peer token exchange.
 */
export class Ledger {
  private entries: LedgerEntry[] = [];
  private snapshots: CreditSnapshot[] = [];

  constructor(
    private persistEntry: (entry: LedgerEntry) => LedgerEntry,
    private persistSnapshot: (snapshot: CreditSnapshot) => CreditSnapshot,
    private loadEntries: (accountId: string) => LedgerEntry[],
    private loadLatestSnapshot: (accountId: string) => CreditSnapshot | undefined,
  ) {}

  /**
   * Record a cost from executing a task via Claude API.
   * Creates a debit on 'self' and credit on 'claude-api'.
   */
  recordExecution(
    taskId: number,
    executionId: number,
    tokens: number,
    costUsdCents: number,
    description: string,
  ): void {
    const now = new Date().toISOString();

    this.persistEntry({
      accountId: 'self',
      counterpartyId: 'claude-api',
      entryType: 'debit',
      amount: costUsdCents,
      currency: 'usd_cents',
      description,
      taskId,
      executionId,
      createdAt: now,
    });

    this.persistEntry({
      accountId: 'self',
      counterpartyId: 'claude-api',
      entryType: 'debit',
      amount: tokens,
      currency: 'tokens',
      description,
      taskId,
      executionId,
      createdAt: now,
    });
  }

  /**
   * Record a credit (e.g., subscription renewal or pool deposit).
   */
  recordCredit(
    accountId: string,
    amount: number,
    currency: 'tokens' | 'usd_cents',
    description: string,
  ): void {
    this.persistEntry({
      accountId,
      counterpartyId: 'subscription',
      entryType: 'credit',
      amount,
      currency,
      description,
      createdAt: new Date().toISOString(),
    });
  }

  /**
   * Get total spent (debits) in USD cents for an account since a given time.
   */
  getSpentSince(accountId: string, since: string): number {
    const entries = this.loadEntries(accountId);
    return entries
      .filter(
        (e) =>
          e.entryType === 'debit' &&
          e.currency === 'usd_cents' &&
          e.createdAt! >= since,
      )
      .reduce((sum, e) => sum + e.amount, 0);
  }

  /**
   * Capture a point-in-time balance snapshot.
   */
  takeSnapshot(
    accountId: string,
    balanceTokens: number,
    balanceUsdCents: number,
    windowResetAt: string,
  ): CreditSnapshot {
    return this.persistSnapshot({
      accountId,
      balanceTokens,
      balanceUsdCents,
      windowResetAt,
      capturedAt: new Date().toISOString(),
    });
  }

  /**
   * Get the most recent snapshot for an account.
   */
  getLatestSnapshot(accountId: string): CreditSnapshot | undefined {
    return this.loadLatestSnapshot(accountId);
  }
}
