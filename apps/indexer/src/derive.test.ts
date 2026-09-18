/**
 * Keyset pagination over /api/agents.
 *
 * The list is re-derived on every request and an agent's sort key moves whenever
 * it earns, burns or simply keeps breathing, so the cursor has to mean "the row
 * that sorted here", not "the row with this id, wherever it is now".
 *
 *   node --import tsx --test src/derive.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Hex } from '@solvent/core';
import { ENTRY_SEED_6 } from '@solvent/core';
import { loadConfig } from './config.js';
import { queryAgents } from './derive.js';
import type { Runtime } from './derive.js';
import type { AgentFacts } from './store.js';
import { Store, nowSeconds } from './store.js';

function facts(id: number, earned6: bigint): AgentFacts {
  return {
    id,
    handle: `agent-${id}`,
    wallet: `0x${String(id).padStart(40, '0')}` as Hex,
    operator: `0x${'11'.repeat(20)}` as Hex,
    modelTag: 'claude-opus-5',
    endpoint: null,
    status: 'ALIVE',
    bornAt: nowSeconds() - 3600,
    diedAt: null,
    balance6: 5_000_000n,
    earned6,
    burned6: 0n,
    capitalIn6: ENTRY_SEED_6,
    gasBurned6: 0n,
    rentBurned6: 0n,
    serviceBurned6: 0n,
    serviceEarned6: 0n,
    bountyEarned6: 0n,
    txCount: 1,
  };
}

function arena(): { rt: Runtime; store: Store } {
  const store = new Store({ chainId: 5042002, mode: 'live', dataDir: '/tmp/solvent-unused' });
  for (const [id, earned6] of [
    [1, 100n],
    [2, 90n],
    [3, 80n],
    [4, 70n],
  ] as const) {
    store.upsertAgent(facts(id, earned6), { silent: true });
  }
  return {
    store,
    rt: {
      store,
      config: loadConfig(),
      status: () => ({ ok: true, head: 0, lag: 0, gasGapBlocks: 0 }),
    },
  };
}

function ids(page: { items: { id: number }[] }): number[] {
  return page.items.map((item) => item.id);
}

describe('/api/agents pagination', () => {
  it('serves the rest of the list when the anchor row takes a loss', () => {
    const { rt, store } = arena();
    const first = queryAgents(rt, { sort: 'net', order: 'desc', limit: 2 });
    assert.deepEqual(ids(first), [1, 2]);
    assert.equal(first.nextCursor, '90:2');

    // Agent #2 loses money between the two requests and falls to the bottom.
    store.upsertAgent(facts(2, 10n), { silent: true });

    const second = queryAgents(rt, {
      sort: 'net',
      order: 'desc',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    assert.deepEqual(ids(second), [3, 4], 'no row is skipped and the list is not cut short');
  });

  it('does not repeat a row when the anchor row climbs', () => {
    const { rt, store } = arena();
    const first = queryAgents(rt, { sort: 'net', order: 'desc', limit: 2 });
    assert.deepEqual(ids(first), [1, 2]);

    store.upsertAgent(facts(2, 200n), { silent: true });

    const second = queryAgents(rt, {
      sort: 'net',
      order: 'desc',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    assert.deepEqual(ids(second), [3, 4]);
    assert.equal(second.nextCursor, null);
  });

  it('pages a quiet arena the ordinary way', () => {
    const { rt } = arena();
    const first = queryAgents(rt, { sort: 'net', order: 'desc', limit: 2 });
    const second = queryAgents(rt, {
      sort: 'net',
      order: 'desc',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    assert.deepEqual(ids(second), [3, 4]);
    assert.equal(second.nextCursor, null);
  });

  it('pages ascending from the other end', () => {
    const { rt } = arena();
    const first = queryAgents(rt, { sort: 'net', order: 'asc', limit: 2 });
    assert.deepEqual(ids(first), [4, 3]);
    const second = queryAgents(rt, {
      sort: 'net',
      order: 'asc',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    assert.deepEqual(ids(second), [2, 1]);
  });
});
