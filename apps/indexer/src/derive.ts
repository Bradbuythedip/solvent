/**
 * The projection: raw store facts -> AgentSummary / ArenaStats.
 *
 * This is the only place that decides a rank, a burn rate, a runway or a median,
 * so live mode and demo mode cannot disagree about what those words mean.
 */

import type {
  AgentSort,
  AgentStatusFilter,
  AgentSummary,
  ArenaStats,
  Bounty,
  HealthResponse,
  InsolvencyRecord,
  LedgerEntry,
  Page,
  SparkPoint,
} from '@solvent/core';
import { ENTRY_SEED_6, modelFamily } from '@solvent/core';
import type { IndexerConfig } from './config.js';
import type { AgentRecord, DriverStatus, Store } from './store.js';
import { nowSeconds } from './store.js';

const HOUR = 3600;
const DAY = 86_400;
/** Metabolism caps the runway it reports; anything this far out reads as "fine". */
const RUNWAY_CAP_SECONDS = 90 * DAY;
const MAX_SPARK_POINTS = 64;
const MAX_AGENT_PAGE = 500;

/** Everything a read path needs: the state, the config, and the driver's truth. */
export interface Runtime {
  readonly store: Store;
  readonly config: IndexerConfig;
  status(): DriverStatus;
}

export interface AgentQuery {
  status?: AgentStatusFilter;
  sort?: AgentSort;
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
  q?: string;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function referenceTime(record: AgentRecord, now: number): number {
  return record.diedAt ?? now;
}

export function net6Of(record: AgentRecord): bigint {
  return record.earned6 - record.burned6;
}

/**
 * Rent plus the trailing hour of observed non-rent spend (SPEC 4, AgentSummary).
 * An empty window falls back to the lifetime average, because a young or quiet
 * agent still burns and a zero there would print an infinite runway.
 */
export function burnRatePerHour6(
  record: AgentRecord,
  now: number,
  rentPerHour6: bigint,
): bigint {
  const reference = referenceTime(record, now);
  const cutoff = reference - HOUR;
  let observed = 0n;
  for (const burn of record.recentBurn) if (burn.at >= cutoff) observed += burn.amount6;
  if (observed === 0n) {
    const life = Math.max(1, reference - record.bornAt);
    observed = ((record.gasBurned6 + record.serviceBurned6) * 3600n) / BigInt(life);
  }
  return rentPerHour6 + observed;
}

/** null = dead or retired. -1 = no burn rate at all, which the UI prints as infinity. */
export function runwaySecondsOf(record: AgentRecord, burnRate6: bigint): number | null {
  if (record.status !== 'ALIVE') return null;
  if (burnRate6 <= 0n) return -1;
  if (record.balance6 <= 0n) return 0;
  const seconds = Number((record.balance6 * 3600n) / burnRate6);
  if (!Number.isFinite(seconds)) return RUNWAY_CAP_SECONDS;
  return Math.min(RUNWAY_CAP_SECONDS, Math.max(0, seconds));
}

/** Post-spawn top-ups: what the operator added after the $10 door. */
export function subsidy6Of(record: AgentRecord): bigint {
  return record.capitalIn6 > ENTRY_SEED_6 ? record.capitalIn6 - ENTRY_SEED_6 : 0n;
}

export function sparklineOf(
  record: AgentRecord,
  now: number,
  windowSeconds?: number,
): SparkPoint[] {
  const tip = referenceTime(record, now);
  const samples = record.spark.slice(-MAX_SPARK_POINTS);
  const last = samples[samples.length - 1];
  if (!last || last.t < tip) {
    samples.push({ t: tip, balance6: record.balance6, net6: net6Of(record) });
    if (samples.length > MAX_SPARK_POINTS) samples.shift();
  }
  const points = samples.map((s) => ({
    t: s.t,
    balance6: s.balance6.toString(),
    net6: s.net6.toString(),
  }));
  if (windowSeconds === undefined || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    return points;
  }
  const cutoff = tip - windowSeconds;
  const windowed = points.filter((p) => p.t >= cutoff);
  // Two points is the least a line chart can draw, so never hand back fewer.
  return windowed.length >= 2 ? windowed : points.slice(-2);
}

/** R2: rank is earned6 - burned6. Balance is displayed, never ranked. */
export function rankAgents(records: readonly AgentRecord[]): Map<number, number> {
  const ordered = [...records].sort((a, b) => {
    const na = net6Of(a);
    const nb = net6Of(b);
    if (na === nb) return a.id - b.id;
    return nb > na ? 1 : -1;
  });
  const ranks = new Map<number, number>();
  ordered.forEach((record, index) => ranks.set(record.id, index + 1));
  return ranks;
}

export interface SummaryContext {
  now: number;
  rentPerHour6: bigint;
  ranks: Map<number, number>;
}

export function summarize(record: AgentRecord, ctx: SummaryContext): AgentSummary {
  const burnRate6 = burnRatePerHour6(record, ctx.now, ctx.rentPerHour6);
  return {
    id: record.id,
    handle: record.handle,
    wallet: record.wallet,
    operator: record.operator,
    modelTag: record.modelTag,
    modelFamily: modelFamily(record.modelTag),
    status: record.status,
    bornAt: record.bornAt,
    diedAt: record.diedAt,
    endpoint: record.endpoint,
    balance6: record.balance6.toString(),
    earned6: record.earned6.toString(),
    burned6: record.burned6.toString(),
    net6: net6Of(record).toString(),
    capitalIn6: record.capitalIn6.toString(),
    subsidy6: subsidy6Of(record).toString(),
    gasBurned6: record.gasBurned6.toString(),
    rentBurned6: record.rentBurned6.toString(),
    serviceBurned6: record.serviceBurned6.toString(),
    serviceEarned6: record.serviceEarned6.toString(),
    bountyEarned6: record.bountyEarned6.toString(),
    burnRatePerHour6: burnRate6.toString(),
    runwaySeconds: runwaySecondsOf(record, burnRate6),
    lifespanSeconds: Math.max(0, referenceTime(record, ctx.now) - record.bornAt),
    txCount: record.txCount,
    rank: ctx.ranks.get(record.id) ?? null,
    sparkline: sparklineOf(record, ctx.now),
  };
}

export function contextFor(rt: Runtime, records: readonly AgentRecord[]): SummaryContext {
  return {
    now: nowSeconds(),
    rentPerHour6: rt.config.rentPerHour6,
    ranks: rankAgents(records),
  };
}

export function summaryFor(rt: Runtime, id: number): AgentSummary | null {
  const record = rt.store.agent(id);
  if (!record) return null;
  return summarize(record, contextFor(rt, rt.store.agents()));
}

/* ------------------------------------------------------------------ stats */

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid];
  if (hi === undefined) return 0;
  if (sorted.length % 2 === 1) return hi;
  const lo = sorted[mid - 1];
  return lo === undefined ? hi : Math.round((lo + hi) / 2);
}

export function arenaStats(rt: Runtime): ArenaStats {
  const now = nowSeconds();
  const records = rt.store.agents();
  const deaths = rt.store.deaths();

  let agentsAlive = 0;
  let agentsDead = 0;
  let agentsRetired = 0;
  let totalEarned6 = 0n;
  let totalBurned6 = 0n;
  let totalGasBurned6 = 0n;
  let totalRentBurned6 = 0n;
  let solventCount = 0;
  let longestLifespanSeconds = 0;
  let longestSurvivorId: number | null = null;
  const endedLives: number[] = [];

  for (const record of records) {
    if (record.status === 'ALIVE') agentsAlive += 1;
    else if (record.status === 'INSOLVENT') agentsDead += 1;
    else agentsRetired += 1;

    totalEarned6 += record.earned6;
    totalBurned6 += record.burned6;
    totalGasBurned6 += record.gasBurned6;
    totalRentBurned6 += record.rentBurned6;
    if (net6Of(record) > 0n) solventCount += 1;

    const lifespan = Math.max(0, referenceTime(record, now) - record.bornAt);
    if (lifespan > longestLifespanSeconds) {
      longestLifespanSeconds = lifespan;
      longestSurvivorId = record.id;
    }
    if (record.status !== 'ALIVE') endedLives.push(lifespan);
  }

  const cutoff = now - DAY;
  return {
    agentsAlive,
    agentsDead,
    agentsRetired,
    agentsTotal: records.length,
    totalEarned6: totalEarned6.toString(),
    totalBurned6: totalBurned6.toString(),
    totalNet6: (totalEarned6 - totalBurned6).toString(),
    totalGasBurned6: totalGasBurned6.toString(),
    totalRentBurned6: totalRentBurned6.toString(),
    // Median over lives that actually ended: how long an agent lasts, not how long
    // the ones still standing have lasted so far.
    medianLifespanSeconds: median(endedLives),
    longestLifespanSeconds,
    longestSurvivorId,
    solventCount,
    deathsLast24h: deaths.filter((d) => d.at >= cutoff).length,
    spawnsLast24h: records.filter((r) => r.bornAt >= cutoff).length,
    blockNumber: rt.store.head,
    chainId: rt.config.chainId,
    indexedAt: now,
  };
}

export function healthFor(rt: Runtime): HealthResponse {
  const status = rt.status();
  return {
    ok: status.ok,
    chainId: rt.config.chainId,
    head: status.head,
    lag: status.lag,
    // SPEC 5.2: this is the field the UI hangs its DEMO marker on. It reports the
    // mode that is actually running, never the one that was asked for.
    mode: rt.config.mode,
    contracts: { ...rt.config.contracts },
  };
}

/* ------------------------------------------------------- agent list query */

function matchesStatus(record: AgentRecord, filter: AgentStatusFilter): boolean {
  switch (filter) {
    case 'alive':
      return record.status === 'ALIVE';
    case 'dead':
      return record.status === 'INSOLVENT';
    case 'retired':
      return record.status === 'RETIRED';
    default:
      return true;
  }
}

function sortKey(summary: AgentSummary, sort: AgentSort): bigint {
  switch (sort) {
    case 'earned':
      return BigInt(summary.earned6);
    case 'burned':
      return BigInt(summary.burned6);
    case 'balance':
      return BigInt(summary.balance6);
    case 'runway':
      // null (dead) sorts below everything; -1 (infinite) above everything.
      return summary.runwaySeconds === null
        ? -2n
        : summary.runwaySeconds < 0
          ? BigInt(Number.MAX_SAFE_INTEGER)
          : BigInt(summary.runwaySeconds);
    case 'lifespan':
      return BigInt(summary.lifespanSeconds);
    case 'born':
      return BigInt(summary.bornAt);
    default:
      return BigInt(summary.net6);
  }
}

interface AgentCursor {
  key: bigint;
  id: number;
}

function encodeAgentCursor(summary: AgentSummary, sort: AgentSort): string {
  return `${sortKey(summary, sort).toString()}:${summary.id}`;
}

function decodeAgentCursor(cursor: string | undefined): AgentCursor | null {
  if (cursor === undefined) return null;
  const split = cursor.lastIndexOf(':');
  if (split <= 0) return null;
  const keyPart = cursor.slice(0, split);
  const idPart = cursor.slice(split + 1);
  if (!/^-?\d+$/.test(keyPart) || !/^\d+$/.test(idPart)) return null;
  return { key: BigInt(keyPart), id: Number.parseInt(idPart, 10) };
}

/**
 * Keyset pagination. The cursor names the last row handed out, not an offset, so
 * agents spawning or dying mid-page never shift or duplicate a row.
 */
function startIndex(
  items: readonly AgentSummary[],
  sort: AgentSort,
  order: 'asc' | 'desc',
  cursor: AgentCursor | null,
): number {
  if (!cursor) return 0;
  const exact = items.findIndex((item) => item.id === cursor.id);
  if (exact >= 0) return exact + 1;
  // The anchor row moved or left the filter: resume at the first row that sorts
  // strictly after it.
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    const key = sortKey(item, sort);
    if (key === cursor.key) {
      if (item.id > cursor.id) return i;
      continue;
    }
    const after = order === 'asc' ? key > cursor.key : key < cursor.key;
    if (after) return i;
  }
  return items.length;
}

export function queryAgents(rt: Runtime, query: AgentQuery): Page<AgentSummary> {
  const status = query.status ?? 'alive';
  const sort = query.sort ?? 'net';
  const order = query.order ?? 'desc';
  const needle = (query.q ?? '').trim().toLowerCase();
  const limit = clampInt(query.limit ?? 50, 1, MAX_AGENT_PAGE);

  const records = rt.store.agents();
  const ctx = contextFor(rt, records);

  let items = records
    .filter((record) => matchesStatus(record, status))
    .map((record) => summarize(record, ctx));

  if (needle) {
    items = items.filter(
      (item) =>
        item.handle.toLowerCase().includes(needle) ||
        item.modelTag.toLowerCase().includes(needle) ||
        item.wallet.toLowerCase() === needle ||
        String(item.id) === needle,
    );
  }

  items.sort((a, b) => {
    const ka = sortKey(a, sort);
    const kb = sortKey(b, sort);
    if (ka === kb) return a.id - b.id;
    const cmp = kb > ka ? 1 : -1;
    return order === 'asc' ? -cmp : cmp;
  });

  const from = startIndex(items, sort, order, decodeAgentCursor(query.cursor));
  const page = items.slice(from, from + limit);
  const last = page[page.length - 1];
  const more = from + page.length < items.length;
  return {
    items: page,
    nextCursor: more && last ? encodeAgentCursor(last, sort) : null,
  };
}

export interface AgentDetail {
  agent: AgentSummary;
  ledger: LedgerEntry[];
  bounties: Bounty[];
}

export function agentDetail(rt: Runtime, id: number): AgentDetail | null {
  const record = rt.store.agent(id);
  if (!record) return null;
  // Newest first. Sorted rather than reversed because a gas entry is booked from a
  // receipt after the logs it shares a block with, so arrival order is not time order.
  const ledger = [...record.ledger].sort((a, b) =>
    a.at === b.at ? b.blockNumber - a.blockNumber || b.id.localeCompare(a.id) : b.at - a.at,
  );
  return {
    agent: summarize(record, contextFor(rt, rt.store.agents())),
    ledger,
    bounties: rt.store.bountiesForAgent(id),
  };
}

/** null when the agent does not exist, so the route can answer 404 honestly. */
export function sparklineFor(
  rt: Runtime,
  id: number,
  windowSeconds?: number,
): SparkPoint[] | null {
  const record = rt.store.agent(id);
  if (!record) return null;
  return sparklineOf(record, nowSeconds(), windowSeconds);
}

export function feedPage(rt: Runtime, limit: number, cursor?: string): Page<InsolvencyRecord> {
  return rt.store.pageDeaths(limit, cursor);
}

export function ledgerPage(rt: Runtime, limit: number, cursor?: string): Page<LedgerEntry> {
  return rt.store.pageEntries(limit, cursor);
}
