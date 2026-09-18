/**
 * Live-mode log replay: the two ordering rules the scoreboard's honesty rests on,
 * and the gas gap that /api/health must not hide.
 *
 * Synthetic logs, encoded and decoded through viem exactly as an RPC would hand
 * them over, so no network is involved.
 *
 * Node's type stripping does not remap a ".js" specifier onto a ".ts" file, so
 * this file imports "./chain.ts" directly. It is excluded from tsconfig, so the
 * package's ".js" import convention is untouched.
 *
 *   node --test --experimental-strip-types src/chain.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { encodeAbiParameters, encodeEventTopics } from 'viem';
import type { Hex } from '@solvent/core';
import { ENTRY_SEED_6, ledgerAbi, metabolismAbi, registryAbi } from '@solvent/core';
import { ChainIndexer } from './chain.js';
import type { RawLog } from './chain.js';
import { loadConfig } from './config.js';
import { healthFor, subsidy6Of } from './derive.js';
import type { Runtime } from './derive.js';
import { Store } from './store.js';

const CONTRACT: Hex = '0x3333333333333333333333333333333333333333';
const WALLET: Hex = '0x1111111111111111111111111111111111111111';
const OPERATOR: Hex = '0x2222222222222222222222222222222222222222';
const REAPER: Hex = '0x4444444444444444444444444444444444444444';
const ZERO32 = `0x${'00'.repeat(32)}` as Hex;

/** Ledger.Flow / Ledger.Category, in the contract's declaration order. */
const EARN = 0;
const BURN = 1;
const CATEGORY_SPAWN = 4;
const CATEGORY_CAPITAL = 5;

interface Position {
  block: bigint;
  tx: number;
  index: number;
  txHash: Hex;
}

/** Forge one log the way an RPC would hand it over: encoded topics and data. */
function eventLog(
  abi: readonly any[],
  eventName: string,
  args: Record<string, unknown>,
  at: Position,
): RawLog {
  const event = abi.find((item) => item.type === 'event' && item.name === eventName);
  if (!event) throw new Error(`no event ${eventName} in abi`);
  const nonIndexed = event.inputs.filter((input: any) => !input.indexed);
  return {
    address: CONTRACT,
    topics: encodeEventTopics({ abi, eventName, args } as any),
    data: encodeAbiParameters(
      nonIndexed,
      nonIndexed.map((input: any) => args[input.name]),
    ),
    blockNumber: at.block,
    blockHash: `0x${'ee'.repeat(32)}`,
    transactionHash: at.txHash,
    transactionIndex: at.tx,
    logIndex: at.index,
    removed: false,
  } as unknown as RawLog;
}

function capitalEntry(agentId: bigint, amount6: bigint, at: Position): RawLog {
  return eventLog(
    ledgerAbi,
    'Entry',
    {
      agentId,
      flow: EARN,
      category: CATEGORY_CAPITAL,
      amount6,
      counterparty: OPERATOR,
      memoHash: ZERO32,
      at: 1_700_000_000n,
      runningEarned6: 0n,
      runningBurned6: 1_000_000n,
    },
    at,
  );
}

function newIndexer(store: Store): ChainIndexer {
  // loadConfig reads no network; the contract addresses only matter to getLogs,
  // which these tests never reach.
  return new ChainIndexer(store, loadConfig());
}

function newStore(): Store {
  return new Store({ chainId: 5042002, mode: 'live', dataDir: '/tmp/solvent-unused' });
}

describe('a spawn transaction', () => {
  it('books the CAPITAL seed on the agent it creates', () => {
    const store = newStore();
    const indexer = newIndexer(store);
    const txHash = `0x${'aa'.repeat(32)}` as Hex;

    // SolventRegistry.spawn records both Ledger entries BEFORE it emits Spawned,
    // so the agent's own logs arrive with a lower logIndex than the agent.
    indexer.applyLogs([
      capitalEntry(7n, ENTRY_SEED_6, { block: 100n, tx: 0, index: 0, txHash }),
      eventLog(
        ledgerAbi,
        'Entry',
        {
          agentId: 7n,
          flow: BURN,
          category: CATEGORY_SPAWN,
          amount6: 1_000_000n,
          counterparty: CONTRACT,
          memoHash: ZERO32,
          at: 1_700_000_000n,
          runningEarned6: 0n,
          runningBurned6: 1_000_000n,
        },
        { block: 100n, tx: 0, index: 1, txHash },
      ),
      eventLog(
        registryAbi,
        'Spawned',
        {
          agentId: 7n,
          wallet: WALLET,
          operator: OPERATOR,
          modelTag: ZERO32,
          handle: 'seven',
          endpoint: '',
          manifestHash: ZERO32,
          at: 1_700_000_000n,
        },
        { block: 100n, tx: 0, index: 2, txHash },
      ),
    ]);

    const record = store.agent(7);
    assert.ok(record, 'the agent exists');
    assert.equal(record.capitalIn6, ENTRY_SEED_6);
    assert.equal(subsidy6Of(record), 0n, 'the $10 door is not a subsidy');
    // A fully funded, brand-new agent must not read as broke before the first
    // balanceOf refresh lands.
    assert.ok(record.balance6 > 0n, 'the seed reached the balance');
  });

  it('leaves subsidy6 reading the operator top-up that followed it', () => {
    const store = newStore();
    const indexer = newIndexer(store);
    const spawnTx = `0x${'aa'.repeat(32)}` as Hex;

    indexer.applyLogs([
      capitalEntry(7n, ENTRY_SEED_6, { block: 100n, tx: 0, index: 0, txHash: spawnTx }),
      eventLog(
        registryAbi,
        'Spawned',
        {
          agentId: 7n,
          wallet: WALLET,
          operator: OPERATOR,
          modelTag: ZERO32,
          handle: 'seven',
          endpoint: '',
          manifestHash: ZERO32,
          at: 1_700_000_000n,
        },
        { block: 100n, tx: 0, index: 1, txHash: spawnTx },
      ),
    ]);

    // Registry.fund: $5.00 of post-spawn capital (SPEC 2, subsidy6).
    indexer.applyLogs([
      capitalEntry(7n, 5_000_000n, {
        block: 200n,
        tx: 0,
        index: 0,
        txHash: `0x${'bb'.repeat(32)}` as Hex,
      }),
    ]);

    const record = store.agent(7);
    assert.ok(record);
    assert.equal(record.capitalIn6, ENTRY_SEED_6 + 5_000_000n);
    assert.equal(subsidy6Of(record), 5_000_000n);
  });
});

describe('a reapMany batch', () => {
  it('gives each death its own cause', () => {
    const store = newStore();
    const indexer = newIndexer(store);
    const txHash = `0x${'dd'.repeat(32)}` as Hex;
    const block = 300n;

    const insolvency = (agentId: bigint, finalBalance6: bigint, index: number): RawLog =>
      eventLog(
        registryAbi,
        'Insolvency',
        {
          agentId,
          wallet: WALLET,
          at: 1_700_000_100n,
          finalBalance6,
          lifespanSeconds: 3600n,
          earned6: 0n,
          burned6: 10_000n,
          reaper: REAPER,
        },
        { block, tx: 1, index, txHash },
      );

    const reaped = (agentId: bigint, balance6: bigint, index: number): RawLog =>
      eventLog(
        metabolismAbi,
        'Reaped',
        { agentId, reaper: REAPER, due6: 10_000n, collected6: 0n, balance6, died: true },
        { block, tx: 1, index, txHash },
      );

    // reapMany([7, 12]) in one transaction: #7 is broke, #12 still holds $5 and
    // revoked its allowance. Same hash, two different causes.
    indexer.applyLogs([
      insolvency(7n, 0n, 0),
      reaped(7n, 0n, 1),
      insolvency(12n, 5_000_000n, 2),
      reaped(12n, 5_000_000n, 3),
    ]);

    const deaths = store.deaths();
    const seven = deaths.find((death) => death.agentId === 7);
    const twelve = deaths.find((death) => death.agentId === 12);
    assert.equal(seven?.causeOfDeath, 'wallet empty at settlement');
    assert.equal(twelve?.causeOfDeath, 'rent allowance exhausted');
  });
});

describe('a block whose gas could not be read', () => {
  it('keeps /api/health from reporting ok', () => {
    const store = newStore();
    const indexer = newIndexer(store);
    const rt: Runtime = { store, config: loadConfig(), status: () => indexer.status() };

    // The poll itself succeeded: without the gap this indexer reports ok.
    (indexer as unknown as { lastPollOk: boolean }).lastPollOk = true;
    assert.equal(indexer.status().ok, true);
    assert.equal(healthFor(rt).gasGapBlocks, 0);

    store.markGasGap(9_001_337);
    assert.equal(indexer.status().ok, false);
    assert.equal(healthFor(rt).ok, false, 'R7: a knowingly short ledger is not ok');
    assert.equal(healthFor(rt).gasGapBlocks, 1);

    store.clearGasGap(9_001_337);
    assert.equal(healthFor(rt).ok, true);
    assert.equal(healthFor(rt).gasGapBlocks, 0);
  });
});
