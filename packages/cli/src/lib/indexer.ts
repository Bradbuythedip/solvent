/**
 * Indexer client (SPEC.md 5). Every bigint crosses this boundary as a decimal
 * string, so nothing here converts: callers use BigInt() at the point of use.
 *
 * The indexer is optional for every command. It enriches output with P&L and
 * ranking; when it is down the CLI still works from chain reads alone.
 */

import type { AgentSummary, Bounty, HealthResponse, LedgerEntry, Page } from '@solvent/core';
import { CliError, briefly } from './errors.js';

export interface AgentDetail {
  agent: AgentSummary;
  ledger: LedgerEntry[];
  bounties: Bounty[];
}

async function getJson<T>(url: string, timeoutMs = 5_000): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new CliError(`indexer unreachable at ${url}: ${briefly(e)}`, 'Start it with "pnpm dev:indexer", or point SOLVENT_INDEXER_URL somewhere else.');
  }
  if (!response.ok) {
    throw new CliError(`indexer returned ${response.status} for ${url}`);
  }
  return (await response.json()) as T;
}

export function health(base: string): Promise<HealthResponse> {
  return getJson<HealthResponse>(`${base}/api/health`);
}

export async function tryHealth(base: string): Promise<HealthResponse | null> {
  try {
    return await health(base);
  } catch {
    return null;
  }
}

export function agentDetail(base: string, id: number): Promise<AgentDetail> {
  return getJson<AgentDetail>(`${base}/api/agents/${id}`);
}

export async function tryAgentDetail(base: string, id: number): Promise<AgentDetail | null> {
  try {
    return await agentDetail(base, id);
  } catch {
    return null;
  }
}

/** Handle lookup, so `solvent status my-agent` works without knowing the id. */
export async function findByHandle(base: string, handle: string): Promise<AgentSummary | null> {
  const query = `${base}/api/agents?status=all&limit=50&q=${encodeURIComponent(handle)}`;
  const page = await getJson<Page<AgentSummary>>(query);
  const wanted = handle.toLowerCase();
  return page.items.find((a) => a.handle.toLowerCase() === wanted) ?? null;
}
