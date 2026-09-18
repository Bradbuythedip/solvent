/**
 * Live mode: Arc -> store.
 *
 * Backfill by bounded log range, then poll the head. Two things matter here that
 * do not matter on other chains:
 *
 *   1. Gas is dollars. Arc's gas token IS USDC (SPEC 1.1), so every transaction an
 *      agent's wallet sends is a burn. We sum gasUsed * effectiveGasPrice from the
 *      receipts, convert the native 18-decimal figure to 6-decimal USDC, and book
 *      it as BURN/GAS (R3). Without this the P&L understates burn and the
 *      scoreboard stops measuring what it claims to measure.
 *   2. An RPC error is weather, not a crash. Every network call is inside a catch
 *      with exponential backoff; the process stays up and /api/health stops
 *      claiming ok.
 */

import type { Address, Chain, Log } from 'viem';
import { createPublicClient, http, parseEventLogs } from 'viem';
import { arc, arcTestnet } from 'viem/chains';
import type { Bounty, Hex, InsolvencyRecord, LedgerEntry, Native18 } from '@solvent/core';
import {
  CATEGORY_NAMES,
  FLOW_NAMES,
  USDC_ADDRESS,
  bountyBoardAbi,
  decodeModelTag,
  ledgerAbi,
  metabolismAbi,
  modelFamily,
  nativeToUsdc6,
  registryAbi,
  serviceMeterAbi,
  usdcAbi,
} from '@solvent/core';
import type { IndexerConfig } from './config.js';
import type { AgentRecord, Driver, DriverStatus, Store } from './store.js';
import { nowSeconds } from './store.js';

const ZERO_ADDRESS: Hex = '0x0000000000000000000000000000000000000000';
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000';
const MAX_BACKOFF_MS = 30_000;
/** With no deployment block and no override, start here rather than at genesis. */
const HEAD_LOOKBACK_BLOCKS = 5_000n;

export type RawLog = Log<bigint, number, false>;

/**
 * Ordering rank inside one transaction.
 *
 * SolventRegistry.spawn records the agent's CAPITAL seed and its SPAWN burn
 * BEFORE it emits Spawned, so those Entry logs carry a lower logIndex than the
 * agent they belong to. Replaying in pure log order books them against an agent
 * the store has never heard of and drops them for good, leaving capitalIn6 — and
 * therefore subsidy6 (SPEC 2) — permanently $9 short. Identity goes first.
 */
const PHASE_SPAWN = 0;
const PHASE_DEFAULT = 1;

interface Action {
  block: bigint;
  tx: number;
  phase: number;
  index: number;
  run: () => void;
}

/** Chain order, with the spawn-before-its-entries rule layered inside a transaction. */
function compareActions(a: Action, b: Action): number {
  if (a.block !== b.block) return a.block < b.block ? -1 : 1;
  if (a.tx !== b.tx) return a.tx - b.tx;
  if (a.phase !== b.phase) return a.phase - b.phase;
  return a.index - b.index;
}

/**
 * A reap is settled per agent, and reapMany settles many in one transaction, so
 * the hash alone would hand every death in a batch the last agent's cause.
 */
function reapKey(txHash: string, agentId: bigint): string {
  return `${txHash}:${agentId}`;
}

interface ReapInfo {
  due6: bigint;
  collected6: bigint;
  balance6: bigint;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * The memo itself lives off-chain behind its hash, so the hash is the only handle
 * we can offer. The self-dealing mark is appended the way the simulator writes it.
 */
function memoOf(memoHash: string, selfDealt: boolean): string | null {
  const base = memoHash === ZERO_HASH ? null : memoHash;
  if (!selfDealt) return base;
  return base === null ? 'self-dealt' : `${base} · self-dealt`;
}

/**
 * SPEC 3.3: payable = min(due, balance, allowance). Which of the three ran out is
 * the difference between "went broke" and "the operator pulled the allowance", and
 * the feed is more honest when it says which.
 */
function causeOfDeath(info: ReapInfo | undefined): string {
  if (!info) return 'could not make rent';
  if (info.collected6 === 0n && info.balance6 > 0n) return 'rent allowance exhausted';
  if (info.collected6 < info.due6 && info.balance6 === 0n) return 'wallet empty at settlement';
  return 'could not make rent';
}

function chainFor(config: IndexerConfig): Chain {
  return config.chainKey === 'arc' ? arc : arcTestnet;
}

export class ChainIndexer implements Driver {
  private readonly client;
  private readonly addresses: Address[];
  private cursorBlock: bigint;
  private running = false;
  private lastPollOk = false;
  private backoffMs: number;
  private lastBalanceRefreshMs = 0;
  private balanceCursor = 0;

  constructor(
    private readonly store: Store,
    private readonly config: IndexerConfig,
  ) {
    this.client = createPublicClient({
      chain: chainFor(config),
      transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 2 }),
    });
    this.addresses = [
      config.contracts.ledger,
      config.contracts.registry,
      config.contracts.metabolism,
      config.contracts.serviceMeter,
      config.contracts.bountyBoard,
    ].filter((address): address is Hex => address !== null);
    this.cursorBlock = config.startBlock;
    this.backoffMs = config.pollIntervalMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    if (this.store.loadSnapshot()) {
      this.cursorBlock = BigInt(this.store.lastIndexedBlock) + 1n;
      console.log(
        `[chain] resumed from snapshot at block ${this.cursorBlock} with ${this.store.agentCount()} agents`,
      );
    }
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  status(): DriverStatus {
    const gasGapBlocks = this.store.gasGapCount();
    return {
      // R7: every displayed number resolves to a transaction hash. A block whose
      // gas we could not read is burn we KNOW is missing from every P&L figure
      // below it, so ok stays false until the block has been replayed.
      ok: this.lastPollOk && gasGapBlocks === 0,
      head: this.store.head,
      lag: Math.max(0, this.store.head - this.store.lastIndexedBlock),
      gasGapBlocks,
    };
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const head = await this.client.getBlockNumber();
        this.store.setHead(Number(head));

        if (this.cursorBlock === 0n) {
          // No deployment block and no override: walking a live chain from genesis
          // is not a promise we can keep, so start near the head and say so.
          this.cursorBlock = head > HEAD_LOOKBACK_BLOCKS ? head - HEAD_LOOKBACK_BLOCKS : 0n;
          console.warn(
            `[chain] no start block configured, beginning at ${this.cursorBlock} (head ${head})`,
          );
        }

        if (this.config.gasScan) await this.retryGasGaps();

        while (this.running && this.cursorBlock <= head) {
          const to = minBig(this.cursorBlock + this.config.chunkBlocks - 1n, head);
          await this.indexRange(this.cursorBlock, to);
          this.cursorBlock = to + 1n;
        }

        await this.refreshBalances();
        this.lastPollOk = true;
        this.backoffMs = this.config.pollIntervalMs;
        await sleep(this.config.pollIntervalMs);
      } catch (err) {
        this.lastPollOk = false;
        console.warn(`[chain] poll failed, retrying in ${this.backoffMs}ms: ${String(err)}`);
        await sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      }
    }
  }

  private async indexRange(from: bigint, to: bigint): Promise<void> {
    const logs = await this.client.getLogs({
      address: this.addresses,
      fromBlock: from,
      toBlock: to,
    });

    this.applyLogs(logs);

    if (this.config.gasScan) await this.scanGas(from, to);
    // Only here, and only once the gas scan for this range has run: this is the
    // block a restart resumes from.
    this.store.setIndexed(Number(to));
  }

  /**
   * Apply one range's logs to the store in chain order. Public so the ordering
   * rules can be exercised without an RPC.
   */
  applyLogs(logs: RawLog[]): void {
    if (logs.length === 0) return;
    const actions: Action[] = [];
    const reaps = this.collectReaps(logs);
    this.collectRegistry(logs, reaps, actions);
    this.collectLedger(logs, this.collectSelfDealt(logs), actions);
    this.collectBounties(logs, actions);
    actions.sort(compareActions);
    for (const action of actions) action.run();
  }

  /* --------------------------------------------------------------- decode */

  private collectReaps(logs: RawLog[]): Map<string, ReapInfo> {
    const map = new Map<string, ReapInfo>();
    const parsed = parseEventLogs({ abi: metabolismAbi, logs, eventName: 'Reaped' });
    for (const log of parsed) {
      if (log.transactionHash === null) continue;
      map.set(reapKey(log.transactionHash, log.args.agentId), {
        due6: log.args.due6,
        collected6: log.args.collected6,
        balance6: log.args.balance6,
      });
    }
    return map;
  }

  private collectRegistry(
    logs: RawLog[],
    reaps: Map<string, ReapInfo>,
    actions: Action[],
  ): void {
    const parsed = parseEventLogs({ abi: registryAbi, logs });
    for (const log of parsed) {
      const block = log.blockNumber;
      const index = log.logIndex;
      const txHash = log.transactionHash;
      const tx = log.transactionIndex ?? 0;
      if (block === null || index === null || txHash === null) continue;

      if (log.eventName === 'Spawned') {
        const args = log.args;
        const id = Number(args.agentId);
        const at = Number(args.at);
        actions.push({
          block,
          tx,
          phase: PHASE_SPAWN,
          index,
          run: () => {
            // A re-delivered Spawned would otherwise zero an agent's books.
            if (this.store.agent(id)) return;
            this.store.upsertAgent({
              id,
              handle: args.handle,
              wallet: args.wallet,
              operator: args.operator,
              modelTag: decodeModelTag(args.modelTag),
              endpoint: args.endpoint === '' ? null : args.endpoint,
              status: 'ALIVE',
              bornAt: at,
              diedAt: null,
              balance6: 0n,
              earned6: 0n,
              burned6: 0n,
              capitalIn6: 0n,
              gasBurned6: 0n,
              rentBurned6: 0n,
              serviceBurned6: 0n,
              serviceEarned6: 0n,
              bountyEarned6: 0n,
              txCount: 1, // the spawn transaction itself
            });
          },
        });
        continue;
      }

      if (log.eventName === 'Insolvency') {
        const args = log.args;
        const id = Number(args.agentId);
        const at = Number(args.at);
        const cause = causeOfDeath(reaps.get(reapKey(txHash, args.agentId)));
        actions.push({
          block,
          tx,
          phase: PHASE_DEFAULT,
          index,
          run: () => {
            const record = this.store.agent(id);
            // Prefer the totals we keep: they include the gas the Ledger cannot see
            // (R3), so the certificate matches the scoreboard.
            const earned6 = record?.earned6 ?? args.earned6;
            const burned6 = record?.burned6 ?? args.burned6;
            const insolvency: InsolvencyRecord = {
              agentId: id,
              handle: record?.handle ?? `agent-${id}`,
              modelTag: record?.modelTag ?? '',
              modelFamily: modelFamily(record?.modelTag ?? ''),
              at,
              finalBalance6: args.finalBalance6.toString(),
              lifespanSeconds: Number(args.lifespanSeconds),
              earned6: earned6.toString(),
              burned6: burned6.toString(),
              net6: (earned6 - burned6).toString(),
              reaper: args.reaper,
              txHash,
              blockNumber: Number(block),
              causeOfDeath: cause,
            };
            this.store.setBalance(id, args.finalBalance6, at);
            this.store.recordDeath(insolvency);
          },
        });
        continue;
      }

      if (log.eventName === 'Retired') {
        const args = log.args;
        const id = Number(args.agentId);
        const at = Number(args.at);
        const finalBalance6 = args.finalBalance6;
        actions.push({
          block,
          tx,
          phase: PHASE_DEFAULT,
          index,
          run: () => {
            this.store.setBalance(id, finalBalance6, at);
            this.store.setStatus(id, 'RETIRED', at, 'retired while solvent');
          },
        });
        continue;
      }

      if (log.eventName === 'EndpointSet') {
        const args = log.args;
        const id = Number(args.agentId);
        const endpoint = args.endpoint;
        actions.push({
          block,
          tx,
          phase: PHASE_DEFAULT,
          index,
          run: () => {
            this.store.setEndpoint(id, endpoint === '' ? null : endpoint);
          },
        });
      }
    }
  }

  /**
   * R5: self-dealing is marked, not banned. ServiceSettled carries the flag and
   * shares a transaction with the two Ledger entries it settles (R4), so the mark
   * rides along on those entries' memo.
   */
  private collectSelfDealt(logs: RawLog[]): Set<string> {
    const flagged = new Set<string>();
    const parsed = parseEventLogs({ abi: serviceMeterAbi, logs, eventName: 'ServiceSettled' });
    for (const log of parsed) {
      if (log.transactionHash === null || !log.args.selfDealt) continue;
      flagged.add(log.transactionHash);
    }
    return flagged;
  }

  private collectLedger(logs: RawLog[], selfDealt: Set<string>, actions: Action[]): void {
    const parsed = parseEventLogs({ abi: ledgerAbi, logs, eventName: 'Entry' });
    for (const log of parsed) {
      const block = log.blockNumber;
      const index = log.logIndex;
      const txHash = log.transactionHash;
      const tx = log.transactionIndex ?? 0;
      if (block === null || index === null || txHash === null) continue;

      const args = log.args;
      const flow = FLOW_NAMES[Number(args.flow)];
      const category = CATEGORY_NAMES[Number(args.category)];
      if (flow === undefined || category === undefined) continue; // unknown enum member

      const agentId = Number(args.agentId);
      const runningEarned6 = args.runningEarned6;
      const runningBurned6 = args.runningBurned6;
      const entry: LedgerEntry = {
        id: `${block}-${index}`,
        agentId,
        flow,
        category,
        amount6: args.amount6.toString(),
        counterparty: args.counterparty,
        memo: memoOf(args.memoHash, selfDealt.has(txHash)),
        at: Number(args.at),
        txHash,
        blockNumber: Number(block),
      };
      actions.push({
        block,
        tx,
        phase: PHASE_DEFAULT,
        index,
        run: () => {
          if (this.store.ingestEntry(entry)) {
            this.store.reconcileTotals(agentId, runningEarned6, runningBurned6);
          }
        },
      });
    }
  }

  private collectBounties(logs: RawLog[], actions: Action[]): void {
    const parsed = parseEventLogs({ abi: bountyBoardAbi, logs });
    for (const log of parsed) {
      const block = log.blockNumber;
      const index = log.logIndex;
      const txHash = log.transactionHash;
      const tx = log.transactionIndex ?? 0;
      if (block === null || index === null || txHash === null) continue;

      if (log.eventName === 'BountyPosted') {
        const args = log.args;
        const id = Number(args.bountyId);
        const bounty: Bounty = {
          id,
          poster: args.poster,
          reward6: args.reward6.toString(),
          deadline: Number(args.deadline),
          // BountyPosted does not carry reviewWindow; autoRelease timing lives in
          // the contract, so 0 here means "not known from logs".
          reviewWindow: 0,
          specURI: args.specURI,
          specHash: args.specHash,
          title: `Bounty #${id}`,
          state: 'OPEN',
          claimantAgentId: null,
          claimantHandle: null,
          deliverableURI: null,
          submittedAt: null,
          txHash,
        };
        actions.push({
          block,
          tx,
          phase: PHASE_DEFAULT,
          index,
          run: () => this.store.upsertBounty(bounty),
        });
        continue;
      }

      if (log.eventName === 'BountySubmitted') {
        const args = log.args;
        const id = Number(args.bountyId);
        const agentId = Number(args.agentId);
        const at = Number(args.at);
        const deliverableURI = args.deliverableURI;
        actions.push({
          block,
          tx,
          phase: PHASE_DEFAULT,
          index,
          run: () => {
            const existing = this.store.bounty(id);
            if (!existing) return;
            this.store.upsertBounty({
              ...existing,
              state: 'SUBMITTED',
              claimantAgentId: agentId,
              claimantHandle: this.store.agent(agentId)?.handle ?? null,
              deliverableURI: deliverableURI === '' ? null : deliverableURI,
              submittedAt: at,
            });
          },
        });
        continue;
      }

      if (log.eventName === 'BountyPaid') {
        const args = log.args;
        const id = Number(args.bountyId);
        const agentId = Number(args.agentId);
        actions.push({
          block,
          tx,
          phase: PHASE_DEFAULT,
          index,
          run: () => {
            const existing = this.store.bounty(id);
            if (!existing) return;
            this.store.upsertBounty({
              ...existing,
              state: 'PAID',
              claimantAgentId: agentId,
              claimantHandle: this.store.agent(agentId)?.handle ?? existing.claimantHandle,
            });
          },
        });
        continue;
      }

      if (log.eventName === 'BountyRefunded') {
        const id = Number(log.args.bountyId);
        actions.push({
          block,
          tx,
          phase: PHASE_DEFAULT,
          index,
          run: () => {
            const existing = this.store.bounty(id);
            if (!existing) return;
            this.store.upsertBounty({ ...existing, state: 'REFUNDED' });
          },
        });
      }
    }
  }

  /* ------------------------------------------------------------ gas burn */

  /**
   * R3: every transaction an agent's wallet sends is a burn. The fee arrives in
   * native 18-decimal wei and MUST cross to 6-decimal USDC before it touches the
   * P&L (SPEC 1.1 rule 3) — the two are the same dollars through different
   * interfaces, and adding them raw would be off by 1e12.
   */
  private async scanGas(from: bigint, to: bigint): Promise<void> {
    if (this.store.agentCount() === 0) return;

    let start = from;
    const span = to - from + 1n;
    if (span > this.config.gasScanMaxBlocks) {
      start = to - this.config.gasScanMaxBlocks + 1n;
      console.warn(
        `[chain] gas scan bounded: skipping blocks ${from}-${start - 1n} (${span} > ${this.config.gasScanMaxBlocks})`,
      );
    }

    for (let block = start; block <= to && this.running; block++) {
      await this.scanGasBlock(block);
    }
  }

  /**
   * Replay the blocks whose gas scan failed, before anything newer is indexed.
   *
   * The range cursor never walks backwards, so without this a block abandoned
   * mid-scan is never visited again and its burn is lost for good — silently,
   * which is the one thing R7 does not allow.
   */
  private async retryGasGaps(): Promise<void> {
    const pending = this.store.gasGaps();
    if (pending.length === 0) return;
    console.warn(`[chain] re-scanning ${pending.length} block(s) with missing gas`);
    for (const block of pending) {
      if (!this.running) return;
      await this.scanGasBlock(BigInt(block));
    }
  }

  /** One block's agent gas. A block that throws is remembered, not shrugged off. */
  private async scanGasBlock(block: bigint): Promise<void> {
    try {
      const mined = await this.client.getBlock({
        blockNumber: block,
        includeTransactions: true,
      });
      const at = Number(mined.timestamp);
      for (const [position, tx] of mined.transactions.entries()) {
        if (typeof tx === 'string') continue;
        const agent = this.store.agentByWallet(tx.from);
        if (!agent) continue;

        const id = `${block}-gas-${tx.transactionIndex ?? position}`;
        if (this.store.hasEntry(id)) continue;

        const receipt = await this.client.getTransactionReceipt({ hash: tx.hash });
        this.store.bumpTxCount(agent.id, 1);

        const fee18: Native18 = receipt.gasUsed * receipt.effectiveGasPrice;
        const fee6 = nativeToUsdc6(fee18);
        if (fee6 <= 0n) continue;

        this.store.ingestEntry({
          id,
          agentId: agent.id,
          flow: 'BURN',
          category: 'GAS',
          amount6: fee6.toString(),
          counterparty: tx.to ?? ZERO_ADDRESS,
          memo: `gas ${receipt.gasUsed} @ ${receipt.effectiveGasPrice}`,
          at,
          txHash: tx.hash,
          blockNumber: Number(block),
        });
      }
      this.store.clearGasGap(Number(block));
    } catch (err) {
      // The whole block is abandoned here, not just the failing transaction, so
      // record it and keep /api/health honest until it has been read.
      this.store.markGasGap(Number(block));
      console.warn(`[chain] gas scan failed at block ${block}, queued for retry: ${String(err)}`);
    }
  }

  /* ------------------------------------------------------------ balances */

  /** balanceOf is the truth about a wallet; the derived figure is only a fallback. */
  private async refreshBalances(): Promise<void> {
    const nowMs = Date.now();
    if (nowMs - this.lastBalanceRefreshMs < this.config.balanceRefreshMs) return;
    this.lastBalanceRefreshMs = nowMs;

    const alive = this.store.agents().filter((record) => record.status === 'ALIVE');
    if (alive.length === 0) return;

    const batch: AgentRecord[] = [];
    const size = Math.min(this.config.balanceBatch, alive.length);
    for (let i = 0; i < size; i++) {
      const record = alive[(this.balanceCursor + i) % alive.length];
      if (record) batch.push(record);
    }
    this.balanceCursor = (this.balanceCursor + size) % alive.length;

    const at = nowSeconds();
    for (const record of batch) {
      try {
        const balance6 = await this.client.readContract({
          address: USDC_ADDRESS,
          abi: usdcAbi,
          functionName: 'balanceOf',
          args: [record.wallet],
        });
        this.store.setBalance(record.id, balance6, at);
      } catch (err) {
        console.warn(`[chain] balanceOf failed for agent ${record.id}: ${String(err)}`);
        return; // the RPC is unhappy; try again next pass rather than hammering it
      }
    }
  }
}

export function startChain(store: Store, config: IndexerConfig): Driver {
  const indexer = new ChainIndexer(store, config);
  indexer.start();
  return indexer;
}
