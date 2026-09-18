/**
 * In-memory arena state plus a periodic JSON snapshot to ./data.
 *
 * No database: the arena is small, the API is read-mostly, and a snapshot file is
 * enough to survive a restart in live mode without re-walking the whole chain.
 * The store holds RAW facts only — accumulators, tape, deaths, bounties. Every
 * derived number (rank, burn rate, runway, stats) is computed in derive.ts, so
 * both modes go through exactly one projection.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentStatus,
  Bounty,
  Hex,
  IndexerMode,
  InsolvencyRecord,
  LedgerEntry,
  Page,
} from '@solvent/core';

const TAPE_KEEP = 5_000;
const DEATH_KEEP = 2_000;
const AGENT_LEDGER_KEEP = 64;
const MAX_SPARK_POINTS = 64;
const RECENT_BURN_SECONDS = 6 * 3600;
const RECENT_BURN_KEEP = 128;
const SEEN_ENTRY_CAP = 200_000;
/**
 * Ceiling on remembered gas gaps. Every gap is retried, so the set only grows
 * while the RPC keeps failing; the cap is a memory guard and not a way to forget
 * one, because health stays not-ok for as long as the set is non-empty.
 */
const GAS_GAP_CAP = 50_000;
const SNAPSHOT_VERSION = 1;

/** A raw bigint in JSON.stringify throws. Everything crossing the wire uses this. */
export function stringifyJson(value: unknown): string {
  return JSON.stringify(value, (_key: string, v: unknown) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function toBigInt(value: unknown, fallback = 0n): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return fallback;
}

export interface SparkSample {
  t: number;
  balance6: bigint;
  net6: bigint;
}

export interface BurnSample {
  at: number;
  amount6: bigint;
}

/** Raw, un-derived agent state. Money is bigint in here and a string on the wire. */
export interface AgentFacts {
  id: number;
  handle: string;
  wallet: Hex;
  operator: Hex;
  modelTag: string;
  endpoint: string | null;
  status: AgentStatus;
  bornAt: number;
  diedAt: number | null;
  balance6: bigint;
  earned6: bigint;
  burned6: bigint;
  capitalIn6: bigint;
  gasBurned6: bigint;
  rentBurned6: bigint;
  serviceBurned6: bigint;
  serviceEarned6: bigint;
  bountyEarned6: bigint;
  txCount: number;
}

export interface AgentRecord extends AgentFacts {
  spark: SparkSample[];
  /** Non-rent burns inside the trailing window, for the observed burn rate. */
  recentBurn: BurnSample[];
  /** Newest last. */
  ledger: LedgerEntry[];
  causeOfDeath: string | null;
}

export type StoreEvent =
  | { kind: 'spawn'; agentId: number }
  | { kind: 'entry'; entry: LedgerEntry }
  | { kind: 'insolvency'; record: InsolvencyRecord }
  | { kind: 'bounty'; bounty: Bounty };

export interface DriverStatus {
  ok: boolean;
  head: number;
  lag: number;
  /** Blocks whose gas is known to be missing from the P&L (R3). */
  gasGapBlocks: number;
}

/** Whatever fills the store: the chain reader or the simulator. */
export interface Driver {
  status(): DriverStatus;
  stop(): void | Promise<void>;
}

export interface StoreOptions {
  chainId: number;
  mode: IndexerMode;
  dataDir: string;
}

export interface WriteOptions {
  /** Suppress SSE emission — used while seeding, where there is nothing to stream. */
  silent?: boolean;
}

/** Append-only row wrapper. `seq` is what cursors point at, so pages never shift. */
interface Row<T> {
  seq: number;
  value: T;
}

function emptySpark(): SparkSample[] {
  return [];
}

export class Store {
  readonly chainId: number;
  readonly mode: IndexerMode;
  readonly dataDir: string;

  private readonly agentsById = new Map<number, AgentRecord>();
  private readonly walletIndex = new Map<string, number>();
  private readonly tapeRows: Row<LedgerEntry>[] = [];
  private readonly deathRows: Row<InsolvencyRecord>[] = [];
  private readonly bountyById = new Map<number, Bounty>();
  private readonly seenEntryIds = new Set<string>();
  private readonly gasGapBlocks = new Set<number>();
  private readonly listeners = new Set<(event: StoreEvent) => void>();

  private seq = 0;

  head = 0;
  /**
   * The resume watermark: the highest block that is indexed COMPLETELY, gas
   * included. Only setIndexed moves it, and only once the range's gas scan has
   * run — a log seen mid-range must not advance it, or a restart would resume
   * past blocks the gas scanner never reached and drop their burn for good (R3).
   */
  lastIndexedBlock = 0;
  indexedAt = 0;
  /** Bumped on every mutation so the stats broadcaster can skip quiet periods. */
  version = 0;

  constructor(options: StoreOptions) {
    this.chainId = options.chainId;
    this.mode = options.mode;
    this.dataDir = options.dataDir;
  }

  subscribe(listener: (event: StoreEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: StoreEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn(`[store] listener failed: ${String(err)}`);
      }
    }
  }

  /* ---------------------------------------------------------------- agents */

  agent(id: number): AgentRecord | undefined {
    return this.agentsById.get(id);
  }

  agentByWallet(wallet: string): AgentRecord | undefined {
    const id = this.walletIndex.get(wallet.toLowerCase());
    return id === undefined ? undefined : this.agentsById.get(id);
  }

  agents(): AgentRecord[] {
    return [...this.agentsById.values()];
  }

  agentCount(): number {
    return this.agentsById.size;
  }

  wallets(): string[] {
    return [...this.walletIndex.keys()];
  }

  upsertAgent(facts: AgentFacts, options: WriteOptions = {}): AgentRecord {
    const existing = this.agentsById.get(facts.id);
    this.version += 1;
    if (existing) {
      const wasDead = existing.status === 'INSOLVENT';
      const diedAt = existing.diedAt;
      Object.assign(existing, facts);
      if (wasDead) {
        // R6: death is permanent. No refresh from any source walks it back.
        existing.status = 'INSOLVENT';
        existing.diedAt = diedAt ?? facts.diedAt;
      }
      this.walletIndex.set(facts.wallet.toLowerCase(), facts.id);
      return existing;
    }
    const record: AgentRecord = {
      ...facts,
      spark: emptySpark(),
      recentBurn: [],
      ledger: [],
      causeOfDeath: null,
    };
    this.agentsById.set(record.id, record);
    this.walletIndex.set(record.wallet.toLowerCase(), record.id);
    this.pushSpark(record, record.bornAt);
    if (!options.silent) this.emit({ kind: 'spawn', agentId: record.id });
    return record;
  }

  /** Replace an agent's sparkline wholesale (the simulator owns its own curve). */
  setSpark(id: number, samples: readonly SparkSample[]): void {
    const record = this.agentsById.get(id);
    if (!record) return;
    record.spark = samples.slice(-MAX_SPARK_POINTS).map((s) => ({ ...s }));
    this.version += 1;
  }

  pushSpark(record: AgentRecord, t: number): void {
    const last = record.spark[record.spark.length - 1];
    const net6 = record.earned6 - record.burned6;
    // Gas is booked from receipts after the logs of the same range, so a point can
    // arrive stamped earlier than the one before it. A sparkline that walks
    // backwards is unplottable, so a late point updates the tip instead.
    const at = last && t < last.t ? last.t : t;
    if (last && last.t === at) {
      last.balance6 = record.balance6;
      last.net6 = net6;
      return;
    }
    record.spark.push({ t: at, balance6: record.balance6, net6 });
    if (record.spark.length > MAX_SPARK_POINTS) {
      // Halve the resolution rather than drop the birth of the agent.
      record.spark = record.spark.filter((_, i) => i % 2 === 0 || i === record.spark.length - 1);
    }
  }

  setStatus(id: number, status: AgentStatus, at: number, cause: string | null): void {
    const record = this.agentsById.get(id);
    if (!record) return;
    // R6: death is permanent. Nothing may walk an INSOLVENT agent back to ALIVE.
    if (record.status === 'INSOLVENT') return;
    record.status = status;
    if (status !== 'ALIVE') {
      record.diedAt = at;
      if (cause !== null) record.causeOfDeath = cause;
    }
    this.pushSpark(record, at);
    this.version += 1;
  }

  setBalance(id: number, balance6: bigint, at: number): void {
    const record = this.agentsById.get(id);
    if (!record || record.balance6 === balance6) return;
    record.balance6 = balance6;
    this.pushSpark(record, at);
    this.version += 1;
  }

  setEndpoint(id: number, endpoint: string | null): void {
    const record = this.agentsById.get(id);
    if (!record) return;
    record.endpoint = endpoint === null || endpoint === '' ? null : endpoint;
    this.version += 1;
  }

  bumpTxCount(id: number, by: number): void {
    const record = this.agentsById.get(id);
    if (!record) return;
    record.txCount += by;
    this.version += 1;
  }

  /* ----------------------------------------------------------------- tape */

  hasEntry(id: string): boolean {
    return this.seenEntryIds.has(id);
  }

  /**
   * Record an entry on the tapes without touching accumulators. Demo mode uses
   * this: the simulator owns the totals and hands them over whole.
   */
  recordEntry(entry: LedgerEntry, options: WriteOptions = {}): boolean {
    if (this.seenEntryIds.has(entry.id)) return false;
    this.seenEntryIds.add(entry.id);
    if (this.seenEntryIds.size > SEEN_ENTRY_CAP) this.seenEntryIds.clear();

    this.seq += 1;
    this.tapeRows.push({ seq: this.seq, value: entry });
    if (this.tapeRows.length > TAPE_KEEP) this.tapeRows.splice(0, this.tapeRows.length - TAPE_KEEP);

    const record = this.agentsById.get(entry.agentId);
    if (record) {
      record.ledger.push(entry);
      if (record.ledger.length > AGENT_LEDGER_KEEP) {
        record.ledger.splice(0, record.ledger.length - AGENT_LEDGER_KEEP);
      }
      if (entry.flow === 'BURN' && entry.category !== 'RENT') {
        record.recentBurn.push({ at: entry.at, amount6: BigInt(entry.amount6) });
        this.pruneRecentBurn(record, entry.at);
      }
    }
    this.version += 1;
    if (!options.silent) this.emit({ kind: 'entry', entry });
    return true;
  }

  /**
   * Record an entry AND move the accumulators. Live mode uses this: the chain
   * hands over one entry at a time and the totals are ours to keep.
   *
   * balance6 === capitalIn6 + earned6 - burned6 holds after every call, which is
   * what the sparkline and the runway both lean on.
   */
  ingestEntry(entry: LedgerEntry, options: WriteOptions = {}): boolean {
    if (this.seenEntryIds.has(entry.id)) return false;
    const record = this.agentsById.get(entry.agentId);
    if (record) {
      const amount6 = BigInt(entry.amount6);
      if (entry.flow === 'EARN') {
        record.balance6 += amount6;
        if (entry.category === 'CAPITAL') {
          record.capitalIn6 += amount6; // R1: capital is not revenue
        } else {
          record.earned6 += amount6;
          if (entry.category === 'SERVICE') record.serviceEarned6 += amount6;
          else if (entry.category === 'BOUNTY') record.bountyEarned6 += amount6;
        }
      } else {
        record.balance6 -= amount6;
        record.burned6 += amount6;
        if (entry.category === 'RENT') record.rentBurned6 += amount6;
        else if (entry.category === 'GAS') record.gasBurned6 += amount6;
        else if (entry.category === 'SERVICE') record.serviceBurned6 += amount6;
      }
    }
    const recorded = this.recordEntry(entry, options);
    if (recorded && record) this.pushSpark(record, entry.at);
    return recorded;
  }

  /**
   * Adopt the Ledger's own running totals for an agent.
   *
   * The contract is authoritative for what it can see, but it cannot see gas: on
   * Arc the fee leaves the same wallet in native units and never reaches the
   * Ledger. So burned6 is the Ledger's figure plus the gas we booked ourselves
   * (R3), and this is the only place the two are joined.
   */
  reconcileTotals(agentId: number, earned6: bigint, ledgerBurned6: bigint): void {
    const record = this.agentsById.get(agentId);
    if (!record) return;
    record.earned6 = earned6;
    record.burned6 = ledgerBurned6 + record.gasBurned6;
    this.version += 1;
  }

  private pruneRecentBurn(record: AgentRecord, now: number): void {
    const cutoff = now - RECENT_BURN_SECONDS;
    if (record.recentBurn.length === 0) return;
    const kept = record.recentBurn.filter((b) => b.at >= cutoff);
    record.recentBurn =
      kept.length > RECENT_BURN_KEEP ? kept.slice(-RECENT_BURN_KEEP) : kept;
  }

  /**
   * Merge an agent's own tape without touching the global one.
   *
   * The global tape is chronological and bounded, so an agent that died a week ago
   * would otherwise show an empty ledger on its own page. The trailing-burn window
   * is rebuilt from the merged entries, relative to the agent's own clock: a dead
   * agent's last hour ended when it died.
   */
  seedAgentLedger(id: number, entries: readonly LedgerEntry[]): void {
    const record = this.agentsById.get(id);
    if (!record) return;

    const seen = new Set(record.ledger.map((entry) => entry.id));
    const merged = [...record.ledger];
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      merged.push(entry);
    }
    merged.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at - b.at));
    record.ledger = merged.slice(-AGENT_LEDGER_KEEP);

    record.recentBurn = record.ledger
      .filter((entry) => entry.flow === 'BURN' && entry.category !== 'RENT')
      .map((entry) => ({ at: entry.at, amount6: BigInt(entry.amount6) }));
    this.pruneRecentBurn(record, record.diedAt ?? nowSeconds());
    this.version += 1;
  }

  entries(): LedgerEntry[] {
    return this.tapeRows.map((row) => row.value);
  }

  pageEntries(limit: number, cursor?: string): Page<LedgerEntry> {
    return pageNewestFirst(this.tapeRows, limit, cursor);
  }

  /* ---------------------------------------------------------------- deaths */

  recordDeath(record: InsolvencyRecord, options: WriteOptions = {}): boolean {
    if (this.deathRows.some((row) => row.value.agentId === record.agentId)) return false;
    this.seq += 1;
    this.deathRows.push({ seq: this.seq, value: record });
    if (this.deathRows.length > DEATH_KEEP) {
      this.deathRows.splice(0, this.deathRows.length - DEATH_KEEP);
    }
    const agent = this.agentsById.get(record.agentId);
    if (agent) {
      agent.status = 'INSOLVENT';
      agent.diedAt = record.at;
      agent.causeOfDeath = record.causeOfDeath;
      this.pushSpark(agent, record.at);
    }
    this.version += 1;
    if (!options.silent) this.emit({ kind: 'insolvency', record });
    return true;
  }

  deaths(): InsolvencyRecord[] {
    return this.deathRows.map((row) => row.value);
  }

  pageDeaths(limit: number, cursor?: string): Page<InsolvencyRecord> {
    return pageNewestFirst(this.deathRows, limit, cursor);
  }

  /* -------------------------------------------------------------- bounties */

  upsertBounty(bounty: Bounty, options: WriteOptions = {}): void {
    this.bountyById.set(bounty.id, bounty);
    this.version += 1;
    if (!options.silent) this.emit({ kind: 'bounty', bounty });
  }

  bounty(id: number): Bounty | undefined {
    return this.bountyById.get(id);
  }

  bounties(state?: string): Bounty[] {
    const all = [...this.bountyById.values()].sort((a, b) => b.id - a.id);
    if (!state || state === 'all') return all;
    const wanted = state.toUpperCase();
    return all.filter((b) => b.state === wanted);
  }

  bountiesForAgent(agentId: number): Bounty[] {
    return [...this.bountyById.values()]
      .filter((b) => b.claimantAgentId === agentId)
      .sort((a, b) => b.id - a.id);
  }

  /* ---------------------------------------------------------------- chain */

  setHead(block: number): void {
    if (block > this.head) this.head = block;
    this.indexedAt = nowSeconds();
  }

  setIndexed(block: number): void {
    if (block > this.lastIndexedBlock) this.lastIndexedBlock = block;
    if (block > this.head) this.head = block;
    this.indexedAt = nowSeconds();
  }

  /* -------------------------------------------------------------- gas gaps */

  /**
   * Blocks whose gas scan failed and has not been replayed.
   *
   * On Arc gas is dollars (R3), so an unread block is burn we know we are
   * missing. That is a fact about the ledger, not a log line: it is remembered
   * here, retried by the chain reader, and kept out of /api/health's `ok` until
   * it is booked, because a quietly incomplete number is worse than a missing
   * one (R7).
   */
  markGasGap(block: number): void {
    if (this.gasGapBlocks.has(block)) return;
    if (this.gasGapBlocks.size >= GAS_GAP_CAP) {
      console.warn(`[store] gas gap set full at ${GAS_GAP_CAP}; block ${block} not tracked`);
      return;
    }
    this.gasGapBlocks.add(block);
    this.version += 1;
  }

  clearGasGap(block: number): void {
    if (this.gasGapBlocks.delete(block)) this.version += 1;
  }

  /** Oldest first, so a replay walks the chain forwards. */
  gasGaps(): number[] {
    return [...this.gasGapBlocks].sort((a, b) => a - b);
  }

  gasGapCount(): number {
    return this.gasGapBlocks.size;
  }

  /* ------------------------------------------------------------- snapshot */

  snapshotPath(): string {
    return join(this.dataDir, 'snapshot.json');
  }

  saveSnapshot(): void {
    const file: SnapshotFile = {
      version: SNAPSHOT_VERSION,
      mode: this.mode,
      chainId: this.chainId,
      savedAt: nowSeconds(),
      head: this.head,
      lastIndexedBlock: this.lastIndexedBlock,
      gasGaps: this.gasGaps(),
      agents: this.agents().map(toWireAgent),
      tape: this.entries(),
      deaths: this.deaths(),
      bounties: [...this.bountyById.values()],
    };
    try {
      mkdirSync(this.dataDir, { recursive: true });
      const target = this.snapshotPath();
      const temp = `${target}.tmp`;
      writeFileSync(temp, stringifyJson(file), 'utf8');
      renameSync(temp, target);
    } catch (err) {
      console.warn(`[store] snapshot failed: ${String(err)}`);
    }
  }

  /**
   * Restore a snapshot. Live only: the simulator rebuilds its own 45 days of
   * history from the seed, so replaying an old demo snapshot over it would
   * double-book everything.
   */
  loadSnapshot(): boolean {
    const target = this.snapshotPath();
    if (!existsSync(target)) return false;
    try {
      const parsed: unknown = JSON.parse(readFileSync(target, 'utf8'));
      if (typeof parsed !== 'object' || parsed === null) return false;
      const file = parsed as Partial<SnapshotFile>;
      if (file.version !== SNAPSHOT_VERSION) return false;
      if (file.mode !== this.mode || file.chainId !== this.chainId) return false;

      for (const wire of file.agents ?? []) {
        const record = fromWireAgent(wire);
        if (!record) continue;
        this.agentsById.set(record.id, record);
        this.walletIndex.set(record.wallet.toLowerCase(), record.id);
      }
      for (const entry of file.tape ?? []) {
        if (this.seenEntryIds.has(entry.id)) continue;
        this.seenEntryIds.add(entry.id);
        this.seq += 1;
        this.tapeRows.push({ seq: this.seq, value: entry });
      }
      for (const death of file.deaths ?? []) {
        this.seq += 1;
        this.deathRows.push({ seq: this.seq, value: death });
      }
      for (const bounty of file.bounties ?? []) this.bountyById.set(bounty.id, bounty);
      for (const block of file.gasGaps ?? []) {
        if (typeof block === 'number' && Number.isFinite(block)) this.gasGapBlocks.add(block);
      }
      this.head = file.head ?? 0;
      this.lastIndexedBlock = file.lastIndexedBlock ?? 0;
      this.version += 1;
      return true;
    } catch (err) {
      console.warn(`[store] could not load snapshot: ${String(err)}`);
      return false;
    }
  }
}

/* ------------------------------------------------------------------ wire */

interface WireAgent {
  id: number;
  handle: string;
  wallet: Hex;
  operator: Hex;
  modelTag: string;
  endpoint: string | null;
  status: AgentStatus;
  bornAt: number;
  diedAt: number | null;
  balance6: string;
  earned6: string;
  burned6: string;
  capitalIn6: string;
  gasBurned6: string;
  rentBurned6: string;
  serviceBurned6: string;
  serviceEarned6: string;
  bountyEarned6: string;
  txCount: number;
  causeOfDeath: string | null;
  spark: { t: number; balance6: string; net6: string }[];
  recentBurn: { at: number; amount6: string }[];
  ledger: LedgerEntry[];
}

interface SnapshotFile {
  version: number;
  mode: IndexerMode;
  chainId: number;
  savedAt: number;
  head: number;
  lastIndexedBlock: number;
  /** Blocks still owed a gas scan; absent in snapshots written before R3 gaps were tracked. */
  gasGaps: number[];
  agents: WireAgent[];
  tape: LedgerEntry[];
  deaths: InsolvencyRecord[];
  bounties: Bounty[];
}

function toWireAgent(record: AgentRecord): WireAgent {
  return {
    id: record.id,
    handle: record.handle,
    wallet: record.wallet,
    operator: record.operator,
    modelTag: record.modelTag,
    endpoint: record.endpoint,
    status: record.status,
    bornAt: record.bornAt,
    diedAt: record.diedAt,
    balance6: record.balance6.toString(),
    earned6: record.earned6.toString(),
    burned6: record.burned6.toString(),
    capitalIn6: record.capitalIn6.toString(),
    gasBurned6: record.gasBurned6.toString(),
    rentBurned6: record.rentBurned6.toString(),
    serviceBurned6: record.serviceBurned6.toString(),
    serviceEarned6: record.serviceEarned6.toString(),
    bountyEarned6: record.bountyEarned6.toString(),
    txCount: record.txCount,
    causeOfDeath: record.causeOfDeath,
    spark: record.spark.map((s) => ({
      t: s.t,
      balance6: s.balance6.toString(),
      net6: s.net6.toString(),
    })),
    recentBurn: record.recentBurn.map((b) => ({ at: b.at, amount6: b.amount6.toString() })),
    ledger: record.ledger,
  };
}

function fromWireAgent(wire: WireAgent | undefined): AgentRecord | null {
  if (!wire || typeof wire.id !== 'number' || typeof wire.wallet !== 'string') return null;
  return {
    id: wire.id,
    handle: wire.handle,
    wallet: wire.wallet,
    operator: wire.operator,
    modelTag: wire.modelTag,
    endpoint: wire.endpoint ?? null,
    status: wire.status,
    bornAt: wire.bornAt,
    diedAt: wire.diedAt ?? null,
    balance6: toBigInt(wire.balance6),
    earned6: toBigInt(wire.earned6),
    burned6: toBigInt(wire.burned6),
    capitalIn6: toBigInt(wire.capitalIn6),
    gasBurned6: toBigInt(wire.gasBurned6),
    rentBurned6: toBigInt(wire.rentBurned6),
    serviceBurned6: toBigInt(wire.serviceBurned6),
    serviceEarned6: toBigInt(wire.serviceEarned6),
    bountyEarned6: toBigInt(wire.bountyEarned6),
    txCount: typeof wire.txCount === 'number' ? wire.txCount : 0,
    causeOfDeath: wire.causeOfDeath ?? null,
    spark: (wire.spark ?? []).map((s) => ({
      t: s.t,
      balance6: toBigInt(s.balance6),
      net6: toBigInt(s.net6),
    })),
    recentBurn: (wire.recentBurn ?? []).map((b) => ({ at: b.at, amount6: toBigInt(b.amount6) })),
    ledger: wire.ledger ?? [],
  };
}

/**
 * Cursor pagination over an append-only list, newest first.
 *
 * The cursor is a sequence number, not an offset, so rows appended while a client
 * is paging never shift a page or duplicate a row.
 */
function pageNewestFirst<T>(rows: readonly Row<T>[], limit: number, cursor?: string): Page<T> {
  const size = clampInt(limit, 1, 500);
  const parsed = cursor !== undefined && /^\d+$/.test(cursor) ? Number.parseInt(cursor, 10) : null;
  const items: T[] = [];
  let lastSeq = 0;
  let index = rows.length - 1;

  for (; index >= 0 && items.length < size; index--) {
    const row = rows[index];
    if (!row) continue;
    if (parsed !== null && row.seq >= parsed) continue;
    items.push(row.value);
    lastSeq = row.seq;
  }

  let more = false;
  for (let i = index; i >= 0; i--) {
    const row = rows[i];
    if (row && row.seq < lastSeq) {
      more = true;
      break;
    }
  }
  return { items, nextCursor: more ? String(lastSeq) : null };
}
