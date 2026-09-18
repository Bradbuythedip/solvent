/**
 * Store facts that the live indexer's correctness rests on.
 *
 * Node's type stripping does not remap a ".js" specifier onto a ".ts" file, so
 * this file imports "./store.ts" directly. It is excluded from tsconfig, so the
 * package's ".js" import convention is untouched.
 *
 *   node --test --experimental-strip-types src/store.test.ts
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { Hex, InsolvencyRecord, LedgerEntry } from '@solvent/core';
import { Store } from './store.js';

const CHAIN_ID = 5042002;
const WALLET: Hex = '0x1111111111111111111111111111111111111111';

function newStore(dataDir: string): Store {
  return new Store({ chainId: CHAIN_ID, mode: 'live', dataDir });
}

function entryAt(block: number, id: string): LedgerEntry {
  return {
    id,
    agentId: 7,
    flow: 'BURN',
    category: 'RENT',
    amount6: '10000',
    counterparty: WALLET,
    memo: null,
    at: 1_700_000_000,
    txHash: `0x${'ab'.repeat(32)}` as Hex,
    blockNumber: block,
  };
}

function deathAt(block: number, agentId: number): InsolvencyRecord {
  return {
    agentId,
    handle: `agent-${agentId}`,
    modelTag: 'claude-opus-5',
    modelFamily: 'claude',
    at: 1_700_000_000,
    finalBalance6: '0',
    lifespanSeconds: 100,
    earned6: '0',
    burned6: '10000',
    net6: '-10000',
    reaper: WALLET,
    txHash: `0x${'cd'.repeat(32)}` as Hex,
    blockNumber: block,
    causeOfDeath: 'wallet empty at settlement',
  };
}

describe('the resume watermark', () => {
  it('is not advanced by a log seen mid-range', () => {
    const store = newStore(join(tmpdir(), 'solvent-unused'));

    // The gas scanner is still down at 9_000_000 when this entry is ingested. If
    // the entry moved the watermark, a restart here would resume at 9_001_901 and
    // never book the gas for the 1500 blocks in between (R3).
    store.recordEntry(entryAt(9_001_900, 'a'));
    assert.equal(store.lastIndexedBlock, 0);

    store.setIndexed(9_001_999);
    assert.equal(store.lastIndexedBlock, 9_001_999);

    store.recordEntry(entryAt(9_002_500, 'b'));
    assert.equal(store.lastIndexedBlock, 9_001_999);
  });

  it('is not advanced by a death seen mid-range', () => {
    const store = newStore(join(tmpdir(), 'solvent-unused'));
    store.recordDeath(deathAt(9_001_900, 7));
    assert.equal(store.lastIndexedBlock, 0);
  });
});

describe('gas gaps', () => {
  it('survive a snapshot, because a restart must still owe the block', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solvent-indexer-'));
    try {
      const store = newStore(dataDir);
      store.setIndexed(9_002_000);
      store.markGasGap(9_001_337);
      store.markGasGap(9_001_002);
      assert.deepEqual(store.gasGaps(), [9_001_002, 9_001_337]);

      store.saveSnapshot();

      const restarted = newStore(dataDir);
      assert.equal(restarted.loadSnapshot(), true);
      assert.deepEqual(restarted.gasGaps(), [9_001_002, 9_001_337]);
      assert.equal(restarted.gasGapCount(), 2);

      restarted.clearGasGap(9_001_002);
      assert.deepEqual(restarted.gasGaps(), [9_001_337]);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
