import type { PoolTransaction } from './models.js';

/**
 * ITokenPool: interface for the Phase 3 token marketplace.
 * Stubbed out now so the architecture supports it from day 1.
 */
export interface ITokenPool {
  /** Offer capacity to the pool */
  offerCapacity(providerId: string, tokensAvailable: number): Promise<string>;

  /** Request capacity from the pool */
  requestCapacity(consumerId: string, tokensNeeded: number): Promise<PoolTransaction | null>;

  /** Mark a transaction as complete */
  settleTransaction(transactionId: number, tokensUsed: number): Promise<void>;

  /** Dispute a transaction */
  disputeTransaction(transactionId: number, reason: string): Promise<void>;

  /** Get pool stats */
  getPoolStats(): Promise<PoolStats>;
}

export interface PoolStats {
  totalProviders: number;
  totalConsumers: number;
  availableTokens: number;
  activeTransactions: number;
  completedToday: number;
}

/**
 * LocalPool: Phase 0 implementation that only tracks personal usage.
 * No actual P2P — just the interface contract.
 */
export class LocalPool implements ITokenPool {
  async offerCapacity(_providerId: string, _tokensAvailable: number): Promise<string> {
    return 'local-pool-not-active';
  }

  async requestCapacity(_consumerId: string, _tokensNeeded: number): Promise<PoolTransaction | null> {
    return null;
  }

  async settleTransaction(_transactionId: number, _tokensUsed: number): Promise<void> {
    // no-op in Phase 0
  }

  async disputeTransaction(_transactionId: number, _reason: string): Promise<void> {
    // no-op in Phase 0
  }

  async getPoolStats(): Promise<PoolStats> {
    return {
      totalProviders: 0,
      totalConsumers: 0,
      availableTokens: 0,
      activeTransactions: 0,
      completedToday: 0,
    };
  }
}
