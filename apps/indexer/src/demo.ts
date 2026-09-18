/**
 * Demo mode: the arena is driven entirely by createArena from @solvent/core/sim.
 *
 * The simulator owns the numbers; this file only pumps wall-clock time into it and
 * copies what comes back into the store. Nothing here invents a dollar, and
 * /api/health keeps reporting mode "demo" the whole time (SPEC 5.2).
 */

import type { AgentSummary, Bounty, InsolvencyRecord, LedgerEntry } from '@solvent/core';
import { createArena } from '@solvent/core/sim';
import type { Arena } from '@solvent/core/sim';
import type { IndexerConfig } from './config.js';
import type { AgentFacts, Driver, DriverStatus, SparkSample, Store } from './store.js';
import { nowSeconds } from './store.js';

const SEED_TAPE_MAX = 1_500;
const SEED_FEED_MAX = 500;
const PAGE_GUARD = 40;

function factsFromSummary(summary: AgentSummary): AgentFacts {
  return {
    id: summary.id,
    handle: summary.handle,
    wallet: summary.wallet,
    operator: summary.operator,
    modelTag: summary.modelTag,
    endpoint: summary.endpoint,
    status: summary.status,
    bornAt: summary.bornAt,
    diedAt: summary.diedAt,
    balance6: BigInt(summary.balance6),
    earned6: BigInt(summary.earned6),
    burned6: BigInt(summary.burned6),
    capitalIn6: BigInt(summary.capitalIn6),
    gasBurned6: BigInt(summary.gasBurned6),
    rentBurned6: BigInt(summary.rentBurned6),
    serviceBurned6: BigInt(summary.serviceBurned6),
    serviceEarned6: BigInt(summary.serviceEarned6),
    bountyEarned6: BigInt(summary.bountyEarned6),
    txCount: summary.txCount,
  };
}

function sparkFromSummary(summary: AgentSummary): SparkSample[] {
  return summary.sparkline.map((point) => ({
    t: point.t,
    balance6: BigInt(point.balance6),
    net6: BigInt(point.net6),
  }));
}

function allAgents(arena: Arena): AgentSummary[] {
  const out: AgentSummary[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < PAGE_GUARD; guard++) {
    const page = arena.agents({ status: 'all', limit: 500, cursor });
    out.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return out;
}

/** Oldest first, which is the order the store wants to append in. */
function allEntries(arena: Arena, max: number): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < PAGE_GUARD && out.length < max; guard++) {
    const page = arena.ledger(500, cursor);
    out.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return out.slice(0, max).reverse();
}

function allDeaths(arena: Arena, max: number): InsolvencyRecord[] {
  const out: InsolvencyRecord[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < PAGE_GUARD && out.length < max; guard++) {
    const page = arena.feed(500, cursor);
    out.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return out.slice(0, max).reverse();
}

function syncAgents(store: Store, arena: Arena, silent: boolean): void {
  for (const summary of allAgents(arena)) {
    store.upsertAgent(factsFromSummary(summary), { silent });
    store.setSpark(summary.id, sparkFromSummary(summary));
  }
}

/** The arena keeps a per-agent tape that reaches further back than the global one. */
function seedAgentLedgers(store: Store, arena: Arena): void {
  for (const record of store.agents()) {
    const detail = arena.agent(record.id);
    if (detail) store.seedAgentLedger(record.id, detail.ledger);
  }
}

function syncBounties(store: Store, bounties: readonly Bounty[], silent: boolean): void {
  for (const bounty of bounties) store.upsertBounty(bounty, { silent });
}

export interface DemoDriver extends Driver {
  readonly arena: Arena;
}

export function startDemo(store: Store, config: IndexerConfig): DemoDriver {
  const arena = createArena({
    seed: config.demo.seed,
    agents: config.demo.agents,
    now: nowSeconds(),
    chainId: config.chainId,
  });

  // Seed silently: there is 45 days of backfilled history here and no client has
  // asked for a replay of it.
  syncAgents(store, arena, true);
  for (const entry of allEntries(arena, SEED_TAPE_MAX)) store.recordEntry(entry, { silent: true });
  for (const death of allDeaths(arena, SEED_FEED_MAX)) store.recordDeath(death, { silent: true });
  seedAgentLedgers(store, arena);
  syncBounties(store, arena.bounties().items, true);
  store.setIndexed(arena.health().head);

  let lastTickMs = Date.now();
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    const nowMs = Date.now();
    const elapsed = ((nowMs - lastTickMs) / 1000) * config.demo.speed;
    lastTickMs = nowMs;
    if (elapsed <= 0) return;

    try {
      const result = arena.advance(elapsed);

      for (const spawn of result.spawns) {
        store.upsertAgent(factsFromSummary(spawn));
        store.setSpark(spawn.id, sparkFromSummary(spawn));
      }
      for (const entry of result.entries) store.recordEntry(entry);
      for (const death of result.insolvencies) store.recordDeath(death);
      syncBounties(store, result.bounties, false);

      // The simulator is the book of record for every accumulator, so take them
      // whole rather than re-adding entries and drifting from it.
      syncAgents(store, arena, true);
      store.setIndexed(arena.health().head);
    } catch (err) {
      console.warn(`[demo] tick failed: ${String(err)}`);
    }
  };

  const timer = setInterval(tick, config.demo.tickMs);
  timer.unref?.();

  return {
    arena,
    status(): DriverStatus {
      // The simulator books its own gas, so there is never a block it failed to read.
      return { ok: true, head: store.head, lag: 0, gasGapBlocks: 0 };
    },
    stop(): void {
      stopped = true;
      clearInterval(timer);
    },
  };
}
