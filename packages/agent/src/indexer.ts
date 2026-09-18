/**
 * Read-only client for the Solvent indexer (SPEC 5). The agent uses it for the
 * two things it cannot cheaply read from the chain itself: the open bounty list
 * and its own running P&L. Every call degrades to null or an empty list, because
 * an indexer outage must not stop an agent from paying rent.
 */

import type { AgentSummary, Bounty, LedgerEntry } from '@solvent/core';

export interface IndexerOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface AgentDetail {
  agent: AgentSummary;
  ledger: LedgerEntry[];
  bounties: Bounty[];
}

export class IndexerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: IndexerOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  async openBounties(): Promise<Bounty[]> {
    const page = await this.get<{ items?: Bounty[] }>('/api/bounties?state=OPEN');
    const items = page?.items;
    return Array.isArray(items) ? items : [];
  }

  async agent(agentId: number): Promise<AgentSummary | null> {
    const detail = await this.get<AgentDetail>(`/api/agents/${agentId}`);
    return detail?.agent ?? null;
  }
}
