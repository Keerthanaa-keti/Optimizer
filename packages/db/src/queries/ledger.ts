import type Database from 'better-sqlite3';
import type { LedgerEntry, CreditSnapshot } from '@creditforge/core';

export function insertLedgerEntry(db: Database.Database, entry: LedgerEntry): LedgerEntry {
  const stmt = db.prepare(`
    INSERT INTO ledger (account_id, counterparty_id, entry_type, amount, currency, description, task_id, execution_id, created_at)
    VALUES (@accountId, @counterpartyId, @entryType, @amount, @currency, @description, @taskId, @executionId, @createdAt)
  `);

  const result = stmt.run({
    accountId: entry.accountId,
    counterpartyId: entry.counterpartyId,
    entryType: entry.entryType,
    amount: entry.amount,
    currency: entry.currency,
    description: entry.description,
    taskId: entry.taskId ?? null,
    executionId: entry.executionId ?? null,
    createdAt: entry.createdAt ?? new Date().toISOString(),
  });

  return { ...entry, id: Number(result.lastInsertRowid) };
}

export function getLedgerEntries(db: Database.Database, accountId: string): LedgerEntry[] {
  const rows = db.prepare(
    'SELECT * FROM ledger WHERE account_id = ? ORDER BY created_at DESC',
  ).all(accountId) as Record<string, unknown>[];
  return rows.map(mapLedgerEntry);
}

export function insertCreditSnapshot(db: Database.Database, snapshot: CreditSnapshot): CreditSnapshot {
  const stmt = db.prepare(`
    INSERT INTO credit_snapshots (account_id, balance_tokens, balance_usd_cents, window_reset_at, captured_at)
    VALUES (@accountId, @balanceTokens, @balanceUsdCents, @windowResetAt, @capturedAt)
  `);

  const result = stmt.run({
    accountId: snapshot.accountId,
    balanceTokens: snapshot.balanceTokens,
    balanceUsdCents: snapshot.balanceUsdCents,
    windowResetAt: snapshot.windowResetAt,
    capturedAt: snapshot.capturedAt ?? new Date().toISOString(),
  });

  return { ...snapshot, id: Number(result.lastInsertRowid) };
}

export function getLatestSnapshot(db: Database.Database, accountId: string): CreditSnapshot | undefined {
  const row = db.prepare(
    'SELECT * FROM credit_snapshots WHERE account_id = ? ORDER BY captured_at DESC LIMIT 1',
  ).get(accountId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return mapSnapshot(row);
}

function mapLedgerEntry(row: Record<string, unknown>): LedgerEntry {
  return {
    id: row.id as number,
    accountId: row.account_id as string,
    counterpartyId: row.counterparty_id as string,
    entryType: row.entry_type as LedgerEntry['entryType'],
    amount: row.amount as number,
    currency: row.currency as LedgerEntry['currency'],
    description: row.description as string,
    taskId: row.task_id as number | undefined,
    executionId: row.execution_id as number | undefined,
    createdAt: row.created_at as string,
  };
}

function mapSnapshot(row: Record<string, unknown>): CreditSnapshot {
  return {
    id: row.id as number,
    accountId: row.account_id as string,
    balanceTokens: row.balance_tokens as number,
    balanceUsdCents: row.balance_usd_cents as number,
    windowResetAt: row.window_reset_at as string,
    capturedAt: row.captured_at as string,
  };
}
