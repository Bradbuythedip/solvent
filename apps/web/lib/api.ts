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
 * Is the indexer reachable at all right now?
 *
 * This exists to keep the fallback ALL-OR-NOTHING. Falling back per endpoint was
 * the worst bug this product could carry: if /api/health succeeded (reporting
 * `live`) while /api/agents happened to fail, the page rendered simulated
 * dollars underneath a LIVE marker. Simulated money must never be presented as
 * real, so the rule is now: either the indexer is up and an endpoint failure is
 * an honest error, or it is down and EVERYTHING — health included — comes from
 * the simulator, which makes `mode` report `demo` and puts the marker on screen.
 *
 * Deliberately not memoised across requests: a process that was healthy once
 * must not keep claiming it.
 */
async function indexerIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${INDEXER_URL}/api/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getOrSimulate<T>(path: string, simulate: () => Promise<T> | T): Promise<T> {
  try {
    return await get<T>(path);
  } catch (error) {
    // One endpoint failed. If the indexer is otherwise alive this is a real
    // error and must surface as one — substituting simulated data here is how
    // fake dollars end up wearing a LIVE badge.
    if (await indexerIsUp()) throw error;
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
