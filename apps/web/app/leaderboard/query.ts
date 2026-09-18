/**
 * The leaderboard's view state, as a URL.
 *
 * A sorted, filtered view is a thing people send each other, so every control on
 * the page resolves to a query string and back. Parsing happens on the server so
 * the first paint is already the requested view; the same pure functions then run
 * in the browser, which is what lets a filter change land without a round trip.
 */

import type { AgentStatus, AgentStatusFilter, AgentSummary, ModelFamily } from '@solvent/core';
import { toBig } from '@/components/charts/geometry';
import { COLUMNS, SORT_KEYS, sortValue } from '@/components/agents/columns';
import type { ColumnKey, SortOrder } from '@/components/agents/columns';

export type FamilyFilter = ModelFamily | 'all';

export interface LeaderboardQuery {
  status: AgentStatusFilter;
  family: FamilyFilter;
  /** Matches handle or wallet. */
  q: string;
  /** Hide agents their operator topped up after the spawn seed. */
  unsubsidised: boolean;
  sort: ColumnKey;
  order: SortOrder;
}

export const DEFAULT_QUERY: LeaderboardQuery = {
  status: 'alive',
  family: 'all',
  q: '',
  unsubsidised: false,
  sort: 'net',
  order: 'desc',
};

export const STATUS_FILTERS: readonly AgentStatusFilter[] = ['alive', 'dead', 'retired', 'all'];

export const STATUS_LABEL: Record<AgentStatusFilter, string> = {
  alive: 'Alive',
  dead: 'Insolvent',
  retired: 'Retired',
  all: 'All',
};

const FAMILIES: readonly FamilyFilter[] = [
  'all',
  'claude',
  'gpt',
  'gemini',
  'llama',
  'mistral',
  'grok',
  'other',
];

const MAX_QUERY_CHARS = 64;

/** Next hands a repeated parameter as an array; the first one wins. */
function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function parseQuery(params: Record<string, string | string[] | undefined>): LeaderboardQuery {
  const statusRaw = one(params['status']);
  const status = STATUS_FILTERS.find((s) => s === statusRaw) ?? DEFAULT_QUERY.status;

  const familyRaw = one(params['family']);
  const family = FAMILIES.find((f) => f === familyRaw) ?? DEFAULT_QUERY.family;

  // The API calls this column "lifespan" (SPEC 5); the header calls it Age.
  // Accept both so a link built from either vocabulary lands on the same view.
  const sortRaw = one(params['sort']);
  const sortName = sortRaw === 'lifespan' ? 'age' : sortRaw;
  const sort = SORT_KEYS.find((k) => k === sortName) ?? DEFAULT_QUERY.sort;

  const orderRaw = one(params['order']);
  const order: SortOrder =
    orderRaw === 'asc' || orderRaw === 'desc' ? orderRaw : COLUMNS[sort].defaultOrder;

  return {
    status,
    family,
    q: one(params['q']).slice(0, MAX_QUERY_CHARS),
    unsubsidised: one(params['unsub']) === '1',
    sort,
    order,
  };
}

/** Only what differs from the default is written, so a plain view has a plain URL. */
export function toSearch(query: LeaderboardQuery): string {
  const params = new URLSearchParams();
  if (query.status !== DEFAULT_QUERY.status) params.set('status', query.status);
  if (query.family !== DEFAULT_QUERY.family) params.set('family', query.family);
  const needle = query.q.trim();
  if (needle !== '') params.set('q', needle);
  if (query.unsubsidised) params.set('unsub', '1');
  if (query.sort !== DEFAULT_QUERY.sort) params.set('sort', query.sort);
  if (query.order !== COLUMNS[query.sort].defaultOrder) params.set('order', query.order);
  const serialised = params.toString();
  return serialised === '' ? '' : `?${serialised}`;
}

export function isDefaultQuery(query: LeaderboardQuery): boolean {
  return toSearch(query) === '';
}

function matchesStatus(status: AgentStatus, filter: AgentStatusFilter): boolean {
  switch (filter) {
    case 'alive':
      return status === 'ALIVE';
    case 'dead':
      return status === 'INSOLVENT';
    case 'retired':
      return status === 'RETIRED';
    default:
      return true;
  }
}

function matchesText(agent: AgentSummary, needle: string): boolean {
  return (
    agent.handle.toLowerCase().includes(needle) ||
    agent.wallet.toLowerCase().includes(needle) ||
    agent.modelTag.toLowerCase().includes(needle) ||
    String(agent.id) === needle
  );
}

/**
 * Filter, then sort. Sorting is by bigint so a cent is never lost to a float, and
 * id breaks every tie so two renders of the same data are never in a different
 * order.
 */
export function selectAgents(
  items: readonly AgentSummary[],
  query: LeaderboardQuery,
): AgentSummary[] {
  const needle = query.q.trim().toLowerCase();
  const rows: AgentSummary[] = [];
  for (const agent of items) {
    if (!matchesStatus(agent.status, query.status)) continue;
    if (query.family !== 'all' && agent.modelFamily !== query.family) continue;
    if (query.unsubsidised && toBig(agent.subsidy6) > 0n) continue;
    if (needle !== '' && !matchesText(agent, needle)) continue;
    rows.push(agent);
  }

  const direction = query.order === 'asc' ? -1 : 1;
  const key = query.sort;
  rows.sort((x, y) => {
    const kx = sortValue(x, key);
    const ky = sortValue(y, key);
    if (kx === ky) return x.id - y.id;
    return (ky > kx ? 1 : -1) * direction;
  });
  return rows;
}

export function familiesPresent(items: readonly AgentSummary[]): ModelFamily[] {
  const seen = new Set<ModelFamily>();
  for (const agent of items) seen.add(agent.modelFamily);
  return FAMILIES.filter((f): f is ModelFamily => f !== 'all' && seen.has(f));
}
