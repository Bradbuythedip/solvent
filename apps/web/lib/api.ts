import type {
  AgentSummary,
  AgentSort,
  AgentStatusFilter,
  ArenaStats,
  Bounty,
  HealthResponse,
  InsolvencyRecord,
  LedgerEntry,
  Page,
  SparkPoint,
} from '@solvent/core';

export const INDEXER_URL =
  process.env['NEXT_PUBLIC_INDEXER_URL'] ?? 'http://localhost:8787';

/** How long a server-rendered page may serve a cached read. Live data is live. */
const REVALIDATE = 2;

export class IndexerUnavailableError extends Error {
  constructor(public readonly path: string, cause?: unknown) {
    super(`indexer unavailable: ${path}`);
    this.name = 'IndexerUnavailableError';
    this.cause = cause;
  }
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${INDEXER_URL}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      next: { revalidate: REVALIDATE },
      signal: AbortSignal.timeout(6_000),
    } as RequestInit);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } catch (cause) {
    throw new IndexerUnavailableError(path, cause);
  }
}

/**
 * Every read goes through here. If the indexer is down we fall back to the same
 * deterministic simulator the indexer itself runs in demo mode, so the site is
 * never a blank error page — but `mode` then reports `demo` and the UI is
 * REQUIRED to render the DEMO marker. Simulated dollars are never shown as real.
 */
async function getOrSimulate<T>(path: string, simulate: () => Promise<T> | T): Promise<T> {
  try {
    return await get<T>(path);
  } catch {
    return await simulate();
  }
}

export interface AgentQuery {
  status?: AgentStatusFilter;
  sort?: AgentSort;
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
  q?: string;
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/* ---------------------------------------------------------------------------
   The read surface. Mirrors SPEC.md §5 exactly.
   The `simulate` callbacks are injected by lib/fallback.ts to avoid a cycle.
   --------------------------------------------------------------------------- */

export interface Fallback {
  health(): HealthResponse;
  stats(): ArenaStats;
  agents(q: AgentQuery): Page<AgentSummary>;
  agent(id: number): { agent: AgentSummary; ledger: LedgerEntry[]; bounties: Bounty[] } | null;
  sparkline(id: number): { points: SparkPoint[] };
  feed(limit: number): Page<InsolvencyRecord>;
  ledger(limit: number): Page<LedgerEntry>;
  bounties(): { items: Bounty[] };
}

let fallback: Fallback | null = null;
export function registerFallback(f: Fallback): void {
  fallback = f;
}
function fb(): Fallback {
  if (!fallback) throw new Error('no fallback registered — import lib/fallback first');
  return fallback;
}

export const api = {
  health: () => getOrSimulate<HealthResponse>('/api/health', () => fb().health()),
  stats: () => getOrSimulate<ArenaStats>('/api/stats', () => fb().stats()),
  agents: (q: AgentQuery = {}) =>
    getOrSimulate<Page<AgentSummary>>(`/api/agents${qs({ ...q })}`, () => fb().agents(q)),
  agent: (id: number) =>
    getOrSimulate<{ agent: AgentSummary; ledger: LedgerEntry[]; bounties: Bounty[] } | null>(
      `/api/agents/${id}`,
      () => fb().agent(id),
    ),
  sparkline: (id: number, window = '24h') =>
    getOrSimulate<{ points: SparkPoint[] }>(`/api/agents/${id}/sparkline?window=${window}`, () =>
      fb().sparkline(id),
    ),
  feed: (limit = 50) =>
    getOrSimulate<Page<InsolvencyRecord>>(`/api/feed?limit=${limit}`, () => fb().feed(limit)),
  ledger: (limit = 100) =>
    getOrSimulate<Page<LedgerEntry>>(`/api/ledger?limit=${limit}`, () => fb().ledger(limit)),
  bounties: (state?: string) =>
    getOrSimulate<{ items: Bounty[] }>(`/api/bounties${qs({ state })}`, () => fb().bounties()),
};
