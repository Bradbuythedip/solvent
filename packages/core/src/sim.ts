/**
 * Deterministic arena simulator — the single shared source of demo data.
 *
 * `apps/indexer` runs this when SOLVENT_MODE=demo, and `apps/web` falls back to it
 * when the indexer is unreachable, so both surfaces describe the same arena. One
 * implementation, two consumers.
 *
 * Everything here is a pure function of (seed, agent count, now). No Math.random,
 * no Date.now: `now` arrives as a parameter and time only moves through advance().
 * Same seed plus same elapsed time yields the same arena, byte for byte.
 *
 * SIMULATED DATA. Every address and transaction hash below is minted from the seed
 * with a non-cryptographic PRNG. They are well-formed hex and correspond to nothing
 * on Arc or any other chain — no balance, no receipt, no explorer page. Any surface
 * that renders these numbers MUST show the DEMO marker (SPEC 5.2).
 */

import type {
  AgentSort,
  AgentStatus,
  AgentStatusFilter,
  AgentSummary,
  ArenaStats,
  Bounty,
  BountyState,
  Category,
  Flow,
  HealthResponse,
  Hex,
  InsolvencyRecord,
  LedgerEntry,
  Page,
  SparkPoint,
} from './types.js';
import { modelFamily } from './model.js';
import { formatDuration } from './units.js';
import { ARC_TESTNET_ID, DEFAULT_RENT_PER_HOUR_6, ENTRY_SEED_6 } from './chains.js';

/* --------------------------------------------------------------------------
   Constants
   -------------------------------------------------------------------------- */

const HOUR = 3600;
const DAY = 86_400;

/** Rent, mirrored from Metabolism: $0.01/hour, accrued per second. */
const RENT_PER_HOUR_6 = DEFAULT_RENT_PER_HOUR_6;

/** Simulated block cadence. A sim convenience for minting ids, not an Arc fact. */
const SIM_BLOCK_SECONDS = 1;
const SIM_GENESIS_BLOCK = 1_000_000;
const SIM_GENESIS_LOOKBACK = 45 * DAY;

/** advance() quantises to this, so advance(60) six times === advance(360) once. */
const STEP_SECONDS = 15;
/** Refuse to grind more than a week of steps in one call. */
const MAX_STEPS_PER_CALL = (7 * DAY) / STEP_SECONDS;

const MAX_SPARK_POINTS = 64;
const AGENT_LEDGER_KEEP = 48;
const GLOBAL_LEDGER_KEEP = 2_000;
/** Metabolism caps the reported runway; a number this large reads as "fine". */
const RUNWAY_CAP_SECONDS = 90 * DAY;

const DEFAULT_AGENTS = 60;
export const DEFAULT_SEED = 1337;

const MODEL_TAGS: ReadonlyArray<readonly [string, number]> = [
  ['claude-opus-5', 14],
  ['claude-sonnet-4-6', 6],
  ['gpt-5.2', 12],
  ['gpt-5.2-mini', 5],
  ['gemini-3-pro', 9],
  ['gemini-3-flash', 4],
  ['llama-4-405b', 7],
  ['llama-4-70b', 3],
  ['mistral-large-3', 6],
  ['grok-4', 6],
  ['qwen-3-max', 3],
  ['deepseek-v4', 3],
  ['kimi-k2', 2],
  ['command-r-plus-2', 2],
  ['phi-5-mini', 2],
];

const ADJECTIVES = [
  'quiet', 'feral', 'tiny', 'brass', 'hollow', 'patient', 'rusty', 'lucid', 'stubborn',
  'fickle', 'plain', 'copper', 'grim', 'bright', 'sleepy', 'frugal', 'greedy', 'humble',
  'vagrant', 'solemn', 'lean', 'bold', 'spare', 'odd', 'neat', 'slick', 'stark', 'wry',
  'dusty', 'glib', 'braided', 'idle', 'nocturnal', 'thrifty',
];

const NOUNS = [
  'ledger', 'oracle', 'ferret', 'clerk', 'miner', 'scribe', 'broker', 'tinker', 'sparrow',
  'otter', 'courier', 'janitor', 'auditor', 'plumber', 'baker', 'sentry', 'weaver',
  'peddler', 'gambler', 'monk', 'herald', 'cobbler', 'forge', 'kestrel', 'mole', 'crow',
  'fox', 'lark', 'ox', 'wren', 'tallyman', 'drifter',
];

const SERVICES = [
  'embeddings', 'web-search', 'ocr', 'summarise', 'vector-query', 'price-feed', 'render',
  'transcribe', 'code-review', 'geocode', 'classify', 'translate', 'scrape', 'rerank',
];

const BOUNTY_TITLES = [
  'Reconcile a quarter of on-chain invoices',
  'Write an x402 client in Rust',
  'Label 5,000 support tickets',
  'Summarise every Arc release note',
  'Build a USDC decimal-boundary fuzzer',
  'Port the runway meter to SVG',
  'Audit a 400-line settlement contract',
  'Transcribe 40 hours of conference audio',
  'Map the x402 discovery catalogue',
  'Write docs for the reap path',
  'Find the cheapest embeddings endpoint',
  'Draft a post-mortem for agent #17',
  'Benchmark 12 summarisation endpoints',
  'Rebuild the insolvency certificate OG image',
];

const CAUSES = {
  rent: 'could not make rent',
  allowance: 'rent allowance exhausted',
  revoked: 'allowance revoked by operator',
  burn: 'burn outpaced earnings',
  gas: 'gas ate the margin',
  barren: 'never earned a dollar',
} as const;

/* --------------------------------------------------------------------------
   Deterministic randomness
   -------------------------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function fnv1a(input: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  chance(p: number): boolean;
  /** Log-uniform: spreads samples evenly across orders of magnitude. */
  logRange(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T;
  /** Log-uniform dollars, returned as 6-decimal USDC. */
  usd(minUsd: number, maxUsd: number): bigint;
}

function rngFrom(seed: number): Rng {
  const next = mulberry32(seed);
  const range = (min: number, max: number): number => min + next() * (max - min);
  const logRange = (min: number, max: number): number =>
    Math.exp(range(Math.log(Math.max(min, 1e-9)), Math.log(Math.max(max, 1e-9))));

  function pick<T>(items: readonly T[]): T {
    const v = items[Math.floor(next() * items.length)];
    if (v === undefined) throw new Error('rng.pick: empty list');
    return v;
  }

  function weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
    let total = 0;
    for (const entry of items) total += entry[1];
    let r = next() * total;
    for (const entry of items) {
      r -= entry[1];
      if (r <= 0) return entry[0];
    }
    const last = items[items.length - 1];
    if (last === undefined) throw new Error('rng.weighted: empty list');
    return last[0];
  }

  return {
    next,
    range,
    logRange,
    pick,
    weighted,
    int: (min, max) => Math.floor(range(min, max + 1)),
    chance: (p) => next() < p,
    usd: (minUsd, maxUsd) => BigInt(Math.max(1, Math.round(logRange(minUsd, maxUsd) * 1e6))),
  };
}

/**
 * SIMULATED hex. Well-formed, derived from the arena seed, connected to nothing.
 * Never present these as real addresses or receipts.
 */
function simHex(bytes: number, parts: ReadonlyArray<string | number>): Hex {
  const next = mulberry32(fnv1a(parts.join('|')));
  let out = '';
  while (out.length < bytes * 2) {
    out += Math.floor(next() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, '0');
  }
  return `0x${out.slice(0, bytes * 2)}` as Hex;
}

const simAddress = (...parts: Array<string | number>): Hex => simHex(20, ['addr', ...parts]);
const simTxHash = (...parts: Array<string | number>): Hex => simHex(32, ['tx', ...parts]);

/* --------------------------------------------------------------------------
   Money helpers. Every value here is 6-decimal USDC.
   -------------------------------------------------------------------------- */

const usd = (dollars: number): bigint => BigInt(Math.round(dollars * 1e6));
const absBig = (v: bigint): bigint => (v < 0n ? -v : v);
const minBig = (...vs: bigint[]): bigint => vs.reduce((m, v) => (v < m ? v : m));
const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)));

/** Metabolism.owed6: rentPerHour6 * elapsed / 3600, truncating. */
function rentFor(seconds: number): bigint {
  return (RENT_PER_HOUR_6 * BigInt(Math.max(0, Math.round(seconds)))) / 3600n;
}

/* --------------------------------------------------------------------------
   Internal state
   -------------------------------------------------------------------------- */

interface SparkSample {
  t: number;
  balance6: bigint;
  net6: bigint;
}

interface Profile {
  kind: 'servicer' | 'bounty-hunter' | 'broker' | 'idler' | 'gas-guzzler' | 'whale';
  txPerHour: number;
  buysPerHour: number;
  sellsPerHour: number;
  bountiesPerHour: number;
  topUpsPerHour: number;
  gasPerTx6: bigint;
  ticketBuy6: bigint;
  ticketSell6: bigint;
  bounty6: bigint;
  /** Share of scripted income booked as a bounty rather than a service sale. */
  bountyBias: number;
}

interface SimAgent {
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

  /** Remaining approval to Metabolism. When this cannot cover rent, the agent dies. */
  allowance6: bigint;
  /**
   * The wallet floor a live agent will not spend through — "idle to conserve" from
   * the agent loop. It is what is still sitting there when rent finally cannot be
   * made, which is why dead agents hold dust rather than a clean zero.
   */
  reserve6: bigint;
  settleEvery: number;
  lastSettledAt: number;
  profile: Profile;
  causeOfDeath: string | null;

  spark: SparkSample[];
  sparkStride: number;
  sparkTick: number;
  ledger: LedgerEntry[];
  /** Non-rent burns, for the trailing-hour burn rate. Pruned as time moves. */
  recentBurn: Array<{ at: number; amount6: bigint }>;
  entrySeq: number;
}

interface SimContracts {
  ledger: Hex;
  registry: Hex;
  metabolism: Hex;
  serviceMeter: Hex;
  bountyBoard: Hex;
  treasury: Hex;
}

interface Draft {
  agentId: number;
  flow: Flow;
  category: Category;
  amount6: bigint;
  counterparty: Hex;
  memo: string | null;
  at: number;
  txHash: Hex;
}

interface State {
  seed: number;
  chainId: number;
  now: number;
  genesisAt: number;
  stepIndex: number;
  carrySeconds: number;
  nextAgentId: number;
  nextBountyId: number;
  agents: SimAgent[];
  byId: Map<number, SimAgent>;
  handles: Set<string>;
  tape: LedgerEntry[];
  deaths: InsolvencyRecord[];
  bounties: Bounty[];
  ranks: Map<number, number>;
  /** Population the live spawn rate steers back toward. */
  targetAlive: number;
  operators: Hex[];
  reapers: Hex[];
  vendors: Hex[];
  customers: Hex[];
  contracts: SimContracts;
  lastBlock: number;
  lastLogIndex: number;
}

/* --------------------------------------------------------------------------
   Public surface
   -------------------------------------------------------------------------- */

export interface ArenaOptions {
  seed?: number;
  agents?: number;
  /** Unix seconds. Taken as a parameter so generation stays reproducible. */
  now: number;
  chainId?: number;
}

export interface ArenaQuery {
  status?: AgentStatusFilter;
  sort?: AgentSort;
  order?: 'asc' | 'desc';
  limit?: number;
  cursor?: string;
  q?: string;
}

export interface AgentDetail {
  agent: AgentSummary;
  ledger: LedgerEntry[];
  bounties: Bounty[];
}

/** What moved while the arena advanced. Maps 1:1 onto the SSE event names. */
export interface AdvanceResult {
  now: number;
  entries: LedgerEntry[];
  insolvencies: InsolvencyRecord[];
  spawns: AgentSummary[];
  bounties: Bounty[];
}

export interface Arena {
  now(): number;
  stats(): ArenaStats;
  agents(query?: ArenaQuery): Page<AgentSummary>;
  agent(id: number): AgentDetail | null;
  /** `windowSeconds` mirrors the API's ?window=24h; omitted means the whole life. */
  sparkline(id: number, windowSeconds?: number): { points: SparkPoint[] };
  feed(limit?: number, cursor?: string): Page<InsolvencyRecord>;
  ledger(limit?: number, cursor?: string): Page<LedgerEntry>;
  bounties(state?: string): { items: Bounty[] };
  health(): HealthResponse;
  advance(seconds: number): AdvanceResult;
}

export function createArena(opts: ArenaOptions): Arena {
  const seed = fnv1a('solvent', Math.floor(opts.seed ?? DEFAULT_SEED) >>> 0);
  const count = clampInt(opts.agents ?? DEFAULT_AGENTS, 1, 400);
  const now = Math.floor(opts.now);

  const s: State = {
    seed,
    chainId: opts.chainId ?? ARC_TESTNET_ID,
    now,
    genesisAt: now - SIM_GENESIS_LOOKBACK,
    stepIndex: 0,
    carrySeconds: 0,
    nextAgentId: 1,
    nextBountyId: 1,
    agents: [],
    byId: new Map(),
    handles: new Set(),
    tape: [],
    deaths: [],
    bounties: [],
    ranks: new Map(),
    targetAlive: 0,
    operators: [],
    reapers: [],
    vendors: [],
    customers: [],
    contracts: {
      ledger: simAddress(seed, 'contract', 'ledger'),
      registry: simAddress(seed, 'contract', 'registry'),
      metabolism: simAddress(seed, 'contract', 'metabolism'),
      serviceMeter: simAddress(seed, 'contract', 'serviceMeter'),
      bountyBoard: simAddress(seed, 'contract', 'bountyBoard'),
      treasury: simAddress(seed, 'contract', 'treasury'),
    },
    lastBlock: 0,
    lastLogIndex: 0,
  };

  build(s, count);

  return {
    now: () => s.now,
    stats: () => statsOf(s),
    agents: (query = {}) => queryAgents(s, query),
    agent: (id) => agentDetail(s, id),
    sparkline: (id, windowSeconds) => {
      const a = s.byId.get(id);
      if (!a) return { points: [] };
      const points = sparkOf(s, a);
      if (windowSeconds === undefined || !Number.isFinite(windowSeconds) || windowSeconds <= 0) {
        return { points };
      }
      const cutoff = (a.diedAt ?? s.now) - windowSeconds;
      const windowed = points.filter((p) => p.t >= cutoff);
      // Two points is the minimum a line chart can draw, so never return fewer.
      return { points: windowed.length >= 2 ? windowed : points.slice(-2) };
    },
    feed: (limit = 50, cursor) => paginate(feedItems(s), limit, cursor),
    ledger: (limit = 100, cursor) => paginate(tapeItems(s), limit, cursor),
    bounties: (state) => ({
      items: state && state !== 'all'
        ? s.bounties.filter((b) => b.state === state.toUpperCase())
        : [...s.bounties],
    }),
    health: () => ({
      ok: true,
      chainId: s.chainId,
      head: blockAt(s, s.now),
      lag: 0,
      mode: 'demo',
      contracts: { ...s.contracts },
    }),
    advance: (seconds) => advance(s, seconds),
  };
}

/* --------------------------------------------------------------------------
   Construction
   -------------------------------------------------------------------------- */

function build(s: State, count: number): void {
  const rng = rngFrom(fnv1a('arena', s.seed));
  for (let i = 0; i < 18; i++) s.operators.push(simAddress(s.seed, 'operator', i));
  for (let i = 0; i < 6; i++) s.reapers.push(simAddress(s.seed, 'reaper', i));
  for (let i = 0; i < 24; i++) s.vendors.push(simAddress(s.seed, 'vendor', i));
  for (let i = 0; i < 40; i++) s.customers.push(simAddress(s.seed, 'customer', i));

  const drafts: Draft[] = [];
  for (let i = 0; i < count; i++) {
    const agent = buildAgentHistory(s, s.nextAgentId++, drafts);
    s.agents.push(agent);
    s.byId.set(agent.id, agent);
  }

  // Ids and block numbers are assigned in chain order, the way an indexer sees them.
  drafts.sort((a, b) => a.at - b.at || a.agentId - b.agentId);
  for (const d of drafts) {
    const entry = finalizeEntry(s, d);
    const agent = s.byId.get(d.agentId);
    if (agent) {
      agent.ledger.push(entry);
      if (agent.ledger.length > AGENT_LEDGER_KEEP) {
        agent.ledger.splice(0, agent.ledger.length - AGENT_LEDGER_KEEP);
      }
    }
    s.tape.push(entry);
  }
  if (s.tape.length > GLOBAL_LEDGER_KEEP) s.tape = s.tape.slice(-GLOBAL_LEDGER_KEEP);

  s.deaths.sort((a, b) => a.at - b.at);
  s.targetAlive = s.agents.filter((a) => a.status === 'ALIVE').length;
  buildBounties(s, rng);
  for (const a of s.agents) pruneRecentBurn(s, a);
  rebuildRanks(s);
}

function makeProfile(rng: Rng): Profile {
  const kind = rng.weighted<Profile['kind']>([
    ['servicer', 30],
    ['bounty-hunter', 16],
    ['broker', 14],
    ['idler', 18],
    ['gas-guzzler', 14],
    ['whale', 8],
  ]);
  const base: Profile = {
    kind,
    txPerHour: rng.range(1.5, 14),
    buysPerHour: rng.range(0.2, 3),
    sellsPerHour: rng.range(0.3, 6),
    bountiesPerHour: rng.range(0.004, 0.06),
    topUpsPerHour: 0,
    gasPerTx6: BigInt(rng.int(14, 240)),
    ticketBuy6: rng.usd(0.004, 0.4),
    ticketSell6: rng.usd(0.01, 1.2),
    bounty6: rng.usd(1.5, 120),
    bountyBias: 0.08,
  };
  switch (kind) {
    case 'servicer':
      return { ...base, sellsPerHour: rng.range(2, 12), bountyBias: 0.05 };
    case 'bounty-hunter':
      return { ...base, sellsPerHour: rng.range(0.05, 0.6), bountiesPerHour: rng.range(0.02, 0.14), bountyBias: 0.62 };
    case 'broker':
      return { ...base, buysPerHour: rng.range(2, 9), sellsPerHour: rng.range(2, 9), bountyBias: 0.12 };
    case 'idler':
      return { ...base, txPerHour: rng.range(0.2, 1.8), sellsPerHour: rng.range(0.05, 0.8), bountyBias: 0.1 };
    case 'gas-guzzler':
      return { ...base, txPerHour: rng.range(18, 70), gasPerTx6: BigInt(rng.int(90, 520)), bountyBias: 0.07 };
    case 'whale':
      return { ...base, topUpsPerHour: rng.range(0.01, 0.08), ticketSell6: rng.usd(0.3, 4), bountyBias: 0.2 };
  }
}

function mintHandle(s: State, rng: Rng, id: number): string {
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = `${rng.pick(ADJECTIVES)}-${rng.pick(NOUNS)}`;
    if (!s.handles.has(candidate) && candidate.length <= 32) {
      s.handles.add(candidate);
      return candidate;
    }
  }
  const fallback = `agent-${id}`;
  s.handles.add(fallback);
  return fallback;
}

function pickEndBalance(rng: Rng, status: AgentStatus): bigint {
  if (status === 'INSOLVENT') {
    // The whole meme: died at 3:41am with $0.006 left. Mostly sub-cent, always dust.
    return rng.chance(0.72) ? rng.usd(0.000001, 0.01) : rng.usd(0.01, 0.22);
  }
  if (status === 'RETIRED') return rng.usd(0.4, 80);
  if (rng.chance(0.13)) return rng.usd(0.01, 0.4); // alive, hours from the reaper
  if (rng.chance(0.28)) return rng.usd(0.4, 4);
  return rng.usd(2, 260);
}

/**
 * Epoch boundaries for one life: coarse over the bulk of it, one settle-interval
 * apart over the last 24 hours, so the recent tape is dense and the old tape is cheap.
 */
function epochBoundaries(bornAt: number, endAt: number, settleEvery: number): number[] {
  const span = Math.max(1, endAt - bornAt);
  const fineSpan = Math.min(span, DAY);
  const coarseSpan = span - fineSpan;
  const out: number[] = [];

  if (coarseSpan > 0) {
    const n = clampInt(coarseSpan / Math.max(settleEvery, coarseSpan / 48), 1, 48);
    const step = coarseSpan / n;
    for (let k = 1; k <= n; k++) out.push(Math.round(bornAt + step * k));
  }
  const fineStart = bornAt + coarseSpan;
  const fn = clampInt(fineSpan / settleEvery, 1, 64);
  const fstep = fineSpan / fn;
  for (let k = 1; k <= fn; k++) out.push(Math.round(fineStart + fstep * k));

  const strict: number[] = [];
  let prev = bornAt;
  for (const t of out) {
    if (t > prev) {
      strict.push(t);
      prev = t;
    }
  }
  if (strict.length === 0) strict.push(endAt);
  strict[strict.length - 1] = endAt;
  return strict;
}

/**
 * Balance targets for each epoch, landing exactly on the reported final balance.
 * The sparkline is this curve, so the projection line has something honest to aim at.
 */
function trajectory(
  rng: Rng,
  n: number,
  start: bigint,
  end: bigint,
  shape: number,
  hump: number,
  floor: bigint,
): bigint[] {
  const s0 = Number(start);
  const s1 = Number(end);
  const f = Number(floor);
  const out: bigint[] = [];
  for (let k = 1; k <= n; k++) {
    const w = k / n;
    const base = s0 + (s1 - s0) * Math.pow(w, shape);
    const bump = hump * Math.sin(Math.PI * w);
    const noise = 1 + (rng.next() - 0.5) * 0.18 * (1 - w * 0.6);
    out.push(BigInt(Math.max(1, Math.round(Math.max(f, (base + bump) * noise)))));
  }
  if (n > 0) out[n - 1] = end; // land on the number the UI reports
  return out;
}

function buildAgentHistory(s: State, id: number, drafts: Draft[]): SimAgent {
  const rng = rngFrom(fnv1a(`agent:${id}`, s.seed));
  const modelTag = rng.weighted(MODEL_TAGS);
  const handle = mintHandle(s, rng, id);
  const profile = makeProfile(rng);

  const roll = rng.next();
  const status: AgentStatus = roll < 0.55 ? 'ALIVE' : roll < 0.88 ? 'INSOLVENT' : 'RETIRED';
  const settleEvery = rng.pick([900, 1200, 1800, 2700, 3600, 5400]);

  let bornAt: number;
  let endAt: number; // last scripted settle
  let finalAt: number; // death or retirement
  if (status === 'ALIVE') {
    const age = Math.round(rng.chance(0.22) ? rng.logRange(20 * 60, DAY) : rng.logRange(DAY, 21 * DAY));
    bornAt = s.now - age;
    // Stop short of `now` by part of a settle interval: rent accrues unsettled, the
    // way it really does, and the tape does not end in one block of identical rents.
    endAt = s.now - Math.min(Math.round(age / 3), rng.int(0, settleEvery - 1));
    finalAt = endAt;
  } else {
    const lifespan = Math.round(
      rng.chance(0.58) ? rng.logRange(4 * 60, 2 * DAY) : rng.logRange(2 * DAY, 18 * DAY),
    );
    const ago = Math.round(rng.chance(0.45) ? rng.logRange(180, DAY) : rng.logRange(DAY, 12 * DAY));
    finalAt = s.now - ago;
    bornAt = finalAt - lifespan;
    // The unpaid stretch between the last good settle and the reap: this is the rent
    // the wallet could not make.
    const gap = Math.min(Math.round(settleEvery * rng.range(0.2, 0.8)), Math.floor(lifespan * 0.4));
    endAt = finalAt - gap;
  }

  const agent: SimAgent = {
    id,
    handle,
    wallet: simAddress(s.seed, 'wallet', id),
    operator: rng.pick(s.operators),
    modelTag,
    endpoint: rng.chance(0.72) ? `https://${handle}.agents.solvent.sim/x402` : null,
    status: 'ALIVE',
    bornAt,
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
    allowance6: 0n,
    reserve6: rng.usd(0.00005, 0.05),
    settleEvery,
    lastSettledAt: bornAt,
    profile,
    causeOfDeath: null,
    spark: [],
    sparkStride: 1,
    sparkTick: 0,
    ledger: [],
    recentBurn: [],
    entrySeq: 0,
  };

  // The $10 door: $1 listing cut to the bounty pool, $9 into the wallet as capital.
  // Capital is never revenue (R1), so this lands in capitalIn6 and nowhere else.
  book(s, agent, drafts, 'EARN', 'CAPITAL', ENTRY_SEED_6, s.contracts.registry, 'spawn seed', bornAt);
  pushSpark(agent, bornAt, true);

  const endBalance6 = pickEndBalance(rng, status);
  const boundaries = epochBoundaries(bornAt, endAt, settleEvery);
  const floor = rentFor(settleEvery) * 3n + 1n;
  const shape = rng.range(0.55, 2.4);
  const hump = rng.chance(0.42) ? rng.range(0, Number(ENTRY_SEED_6) * rng.range(0.4, 4)) : 0;
  const targets = trajectory(rng, boundaries.length, ENTRY_SEED_6, endBalance6, shape, hump, floor);

  let prev = bornAt;
  for (let k = 0; k < boundaries.length; k++) {
    const t = boundaries[k];
    const target = targets[k];
    if (t === undefined || target === undefined) continue;
    runEpoch(s, agent, rng, drafts, prev, t, target);
    prev = t;
  }

  agent.lastSettledAt = endAt;
  if (status === 'INSOLVENT') {
    agent.allowance6 = 0n;
    kill(s, agent, finalAt, causeOf(agent, rng), rng);
  } else if (status === 'RETIRED') {
    agent.status = 'RETIRED';
    agent.diedAt = finalAt;
    agent.allowance6 = 0n;
  } else {
    // Forward-looking approval: what the operator still lets Metabolism take.
    agent.allowance6 = rentFor(rng.logRange(3 * HOUR, 30 * DAY));
  }
  return agent;
}

/**
 * One settle interval of a life. Rent and gas are fixed costs; the discretionary
 * flows are sized to land the balance exactly on the epoch's target, so the books
 * close: balance6 === capitalIn6 + earned6 - burned6 at every point in the history.
 */
function runEpoch(
  s: State,
  a: SimAgent,
  rng: Rng,
  drafts: Draft[],
  from: number,
  to: number,
  target: bigint,
): void {
  const dt = Math.max(1, to - from);
  const rent6 = rentFor(dt);
  const txs = Math.max(0, Math.round((a.profile.txPerHour * dt * rng.range(0.4, 1.6)) / HOUR));
  let gas6 = a.profile.gasPerTx6 * BigInt(txs);

  let need = a.balance6 - rent6 - gas6 - target;
  // Sub-tenth-of-a-cent corrections ride along with gas instead of minting a silly entry.
  if (need !== 0n && absBig(need) <= 250n && gas6 + need >= 0n) {
    gas6 += need;
    need = 0n;
  }

  const at = (frac: number): number => Math.round(from + dt * frac);

  if (need < 0n) {
    let income = -need;
    if (a.profile.topUpsPerHour > 0 && rng.chance(0.18)) {
      // R1 on display: the operator wiring in more dollars is capital, not earnings.
      const topUp = (income * BigInt(rng.int(30, 80))) / 100n;
      book(s, a, drafts, 'EARN', 'CAPITAL', topUp, a.operator, 'operator top-up', at(0.12));
      income -= topUp;
    }
    if (income > 0n) {
      if (rng.chance(a.profile.bountyBias)) {
        book(s, a, drafts, 'EARN', 'BOUNTY', income, s.contracts.bountyBoard, 'bounty payout', at(0.3));
      } else if (income > 4_000n && rng.chance(0.45)) {
        const first = (income * BigInt(rng.int(25, 75))) / 100n;
        book(s, a, drafts, 'EARN', 'SERVICE', first, rng.pick(s.customers), `served ${rng.pick(SERVICES)}`, at(0.22));
        book(s, a, drafts, 'EARN', 'SERVICE', income - first, rng.pick(s.customers), `served ${rng.pick(SERVICES)}`, at(0.44));
      } else {
        book(s, a, drafts, 'EARN', 'SERVICE', income, rng.pick(s.customers), `served ${rng.pick(SERVICES)}`, at(0.3));
      }
    }
  }

  if (gas6 > 0n) {
    a.txCount += Math.max(1, txs);
    book(s, a, drafts, 'BURN', 'GAS', gas6, s.contracts.treasury, `gas · ${Math.max(1, txs)} tx`, at(0.62));
  }

  if (need > 0n) {
    if (need > 8_000n && rng.chance(0.4)) {
      const first = (need * BigInt(rng.int(30, 70))) / 100n;
      book(s, a, drafts, 'BURN', 'SERVICE', first, rng.pick(s.vendors), `x402 ${rng.pick(SERVICES)}`, at(0.5));
      book(s, a, drafts, 'BURN', 'SERVICE', need - first, rng.pick(s.vendors), `x402 ${rng.pick(SERVICES)}`, at(0.72));
    } else {
      book(s, a, drafts, 'BURN', 'SERVICE', need, rng.pick(s.vendors), `x402 ${rng.pick(SERVICES)}`, at(0.66));
    }
  }

  book(s, a, drafts, 'BURN', 'RENT', rent6, s.contracts.treasury, `rent ${formatDuration(dt)}`, to);
  a.lastSettledAt = to;
  pushSpark(a, to, false);
}

function causeOf(a: SimAgent, rng: Rng): string {
  if (a.earned6 === 0n) return CAUSES.barren;
  if (rng.chance(0.12)) return CAUSES.revoked;
  if (a.gasBurned6 > a.earned6) return CAUSES.gas;
  if (a.burned6 > a.earned6 * 3n) return CAUSES.burn;
  return rng.chance(0.5) ? CAUSES.rent : CAUSES.allowance;
}

/* --------------------------------------------------------------------------
   Booking
   -------------------------------------------------------------------------- */

function book(
  s: State,
  a: SimAgent,
  drafts: Draft[] | null,
  flow: Flow,
  category: Category,
  amount6: bigint,
  counterparty: Hex,
  memo: string,
  at: number,
  sharedTxHash?: Hex,
): LedgerEntry | null {
  if (amount6 <= 0n) return null;

  if (flow === 'EARN') {
    a.balance6 += amount6;
    if (category === 'CAPITAL') {
      a.capitalIn6 += amount6; // R1: capital is not revenue
    } else {
      a.earned6 += amount6;
      if (category === 'SERVICE') a.serviceEarned6 += amount6;
      else if (category === 'BOUNTY') a.bountyEarned6 += amount6;
    }
  } else {
    a.balance6 -= amount6;
    a.burned6 += amount6;
    if (category === 'RENT') a.rentBurned6 += amount6;
    else if (category === 'GAS') a.gasBurned6 += amount6;
    else if (category === 'SERVICE') a.serviceBurned6 += amount6;
    if (category !== 'RENT') a.recentBurn.push({ at, amount6 });
  }

  const draft: Draft = {
    agentId: a.id,
    flow,
    category,
    amount6,
    counterparty,
    memo,
    at,
    txHash: sharedTxHash ?? simTxHash(s.seed, a.id, a.entrySeq++, at),
  };
  if (drafts) {
    drafts.push(draft);
    return null;
  }
  const entry = finalizeEntry(s, draft);
  a.ledger.push(entry);
  if (a.ledger.length > AGENT_LEDGER_KEEP) a.ledger.splice(0, a.ledger.length - AGENT_LEDGER_KEEP);
  s.tape.push(entry);
  if (s.tape.length > GLOBAL_LEDGER_KEEP + 256) s.tape.splice(0, s.tape.length - GLOBAL_LEDGER_KEEP);
  return entry;
}

function blockAt(s: State, at: number): number {
  return SIM_GENESIS_BLOCK + Math.max(0, Math.floor((at - s.genesisAt) / SIM_BLOCK_SECONDS));
}

function finalizeEntry(s: State, d: Draft): LedgerEntry {
  const block = Math.max(blockAt(s, d.at), s.lastBlock);
  if (block === s.lastBlock) s.lastLogIndex += 1;
  else {
    s.lastBlock = block;
    s.lastLogIndex = 0;
  }
  return {
    id: `${block}-${s.lastLogIndex}`,
    agentId: d.agentId,
    flow: d.flow,
    category: d.category,
    amount6: d.amount6.toString(),
    counterparty: d.counterparty,
    memo: d.memo,
    at: d.at,
    txHash: d.txHash,
    blockNumber: block,
  };
}

function pushSpark(a: SimAgent, t: number, force: boolean): void {
  a.sparkTick += 1;
  if (!force && a.sparkTick % a.sparkStride !== 0) return;
  a.spark.push({ t, balance6: a.balance6, net6: a.earned6 - a.burned6 });
  if (a.spark.length > MAX_SPARK_POINTS) {
    a.spark = a.spark.filter((_, i) => i % 2 === 0);
    a.sparkStride *= 2;
  }
}

/**
 * Death. `payable = min(due, balance, allowance)` falls short of `due`, so the reaper
 * collects nothing and the wallet keeps whatever dust it still holds — that dust is
 * `finalBalance6`, the number on the certificate. Booking a partial sweep here would
 * break balance6 === capitalIn6 + earned6 - burned6, which every view relies on.
 * A revoked or exhausted allowance is death, not an escape (SPEC 3.3).
 */
function kill(s: State, a: SimAgent, at: number, cause: string, rng: Rng): InsolvencyRecord {
  a.status = 'INSOLVENT';
  a.diedAt = at;
  a.causeOfDeath = cause;
  a.allowance6 = 0n;
  pushSpark(a, at, true);

  const record: InsolvencyRecord = {
    agentId: a.id,
    handle: a.handle,
    modelTag: a.modelTag,
    modelFamily: modelFamily(a.modelTag),
    at,
    finalBalance6: a.balance6.toString(),
    lifespanSeconds: at - a.bornAt,
    earned6: a.earned6.toString(),
    burned6: a.burned6.toString(),
    net6: (a.earned6 - a.burned6).toString(),
    reaper: rng.pick(s.reapers),
    txHash: simTxHash(s.seed, 'death', a.id, at),
    blockNumber: blockAt(s, at),
    causeOfDeath: cause,
  };
  s.deaths.push(record);
  return record;
}

/* --------------------------------------------------------------------------
   Bounties
   -------------------------------------------------------------------------- */

function buildBounties(s: State, rng: Rng): void {
  const earners = s.agents.filter((a) => a.bountyEarned6 > 0n);
  const pool = earners.length > 0 ? earners : s.agents;
  const count = Math.min(BOUNTY_TITLES.length, Math.max(6, Math.round(s.agents.length / 4)));
  for (let i = 0; i < count; i++) {
    const id = s.nextBountyId++;
    const state = rng.weighted<BountyState>([
      ['OPEN', 38],
      ['SUBMITTED', 22],
      ['PAID', 28],
      ['REFUNDED', 12],
    ]);
    const postedAt = s.now - Math.round(rng.logRange(HOUR, 14 * DAY));
    const claimant = state === 'OPEN' || state === 'REFUNDED' ? null : rng.pick(pool);
    const submittedAt = claimant ? postedAt + Math.round(rng.range(HOUR, 3 * DAY)) : null;
    s.bounties.push({
      id,
      poster: simAddress(s.seed, 'poster', id),
      reward6: rng.usd(1, 260).toString(),
      deadline: postedAt + Math.round(rng.range(2 * DAY, 20 * DAY)),
      reviewWindow: rng.pick([6 * HOUR, DAY, 2 * DAY]),
      specURI: `https://bounties.solvent.sim/${id}.md`,
      specHash: simHex(32, ['spec', s.seed, id]),
      title: BOUNTY_TITLES[i % BOUNTY_TITLES.length] ?? `Bounty #${id}`,
      state,
      claimantAgentId: claimant ? claimant.id : null,
      claimantHandle: claimant ? claimant.handle : null,
      deliverableURI: claimant ? `https://bounties.solvent.sim/${id}/deliverable.json` : null,
      submittedAt,
      txHash: simTxHash(s.seed, 'bounty', id),
    });
  }
}

/* --------------------------------------------------------------------------
   Live time
   -------------------------------------------------------------------------- */

function advance(s: State, seconds: number): AdvanceResult {
  const out: AdvanceResult = { now: s.now, entries: [], insolvencies: [], spawns: [], bounties: [] };
  if (!Number.isFinite(seconds) || seconds <= 0) return out;

  s.carrySeconds += seconds;
  const steps = Math.min(MAX_STEPS_PER_CALL, Math.floor(s.carrySeconds / STEP_SECONDS));
  s.carrySeconds -= steps * STEP_SECONDS;

  for (let i = 0; i < steps; i++) {
    s.stepIndex += 1;
    s.now += STEP_SECONDS;
    stepArena(s, rngFrom(fnv1a(`step:${s.stepIndex}`, s.seed)), out);
  }
  if (steps > 0) rebuildRanks(s);
  out.spawns = out.spawns.map((sp) => {
    const a = s.byId.get(sp.id);
    return a ? summaryOf(s, a) : sp;
  });
  out.now = s.now;
  return out;
}

function stepArena(s: State, rng: Rng, out: AdvanceResult): void {
  for (const a of s.agents) {
    if (a.status !== 'ALIVE') continue;
    stepAgent(s, a, rng, out);
  }
  // Roughly one spawn every half hour, pulled toward the population we started with
  // so a long-running demo neither empties out nor compounds into thousands.
  let alive = 0;
  for (const a of s.agents) if (a.status === 'ALIVE') alive += 1;
  const pressure = Math.min(2.5, Math.max(0.15, s.targetAlive / Math.max(1, alive)));
  if (rng.chance((STEP_SECONDS / (30 * 60)) * pressure)) out.spawns.push(spawnAgent(s, rng));
  if (rng.chance(STEP_SECONDS / (30 * 60))) stepBounty(s, rng, out);
}

function stepAgent(s: State, a: SimAgent, rng: Rng, out: AdvanceResult): void {
  const p = a.profile;
  const push = (e: LedgerEntry | null): void => {
    if (e) out.entries.push(e);
  };
  const per = (ratePerHour: number): boolean => rng.chance((ratePerHour * STEP_SECONDS) / HOUR);

  const spendable = (): bigint => (a.balance6 > a.reserve6 ? a.balance6 - a.reserve6 : 0n);

  const expectedTx = (p.txPerHour * STEP_SECONDS) / HOUR;
  let txs = Math.floor(expectedTx);
  if (rng.chance(expectedTx - txs)) txs += 1;
  if (txs > 0) {
    const gas6 = minBig(p.gasPerTx6 * BigInt(txs), spendable());
    if (gas6 > 0n) {
      a.txCount += txs;
      push(book(s, a, null, 'BURN', 'GAS', gas6, s.contracts.treasury, `gas · ${txs} tx`, s.now));
    }
  }

  if (per(p.sellsPerHour)) {
    const amount = jitter(rng, p.ticketSell6);
    push(book(s, a, null, 'EARN', 'SERVICE', amount, rng.pick(s.customers), `served ${rng.pick(SERVICES)}`, s.now));
  }

  if (per(p.buysPerHour)) {
    const provider = pickProvider(s, rng, a);
    const amount = minBig(jitter(rng, p.ticketBuy6), spendable());
    if (amount > 0n) {
      // R4: both sides of an agent-to-agent payment, one transaction, booked atomically.
      const txHash = simTxHash(s.seed, 'x402', a.id, provider ? provider.id : 0, s.now, a.entrySeq);
      const service = rng.pick(SERVICES);
      // R5: a payment between two agents of the same operator is marked, not banned.
      const selfDealt = provider !== null && provider.operator === a.operator;
      const mark = selfDealt ? ' · self-dealt' : '';
      push(
        book(s, a, null, 'BURN', 'SERVICE', amount, provider ? provider.wallet : rng.pick(s.vendors),
          `x402 ${service}${mark}`, s.now, txHash),
      );
      if (provider) {
        push(book(s, provider, null, 'EARN', 'SERVICE', amount, a.wallet, `x402 ${service} · served${mark}`, s.now, txHash));
      }
    }
  }

  if (per(p.bountiesPerHour)) {
    push(book(s, a, null, 'EARN', 'BOUNTY', jitter(rng, p.bounty6), s.contracts.bountyBoard, 'bounty payout', s.now));
  }

  if (p.topUpsPerHour > 0 && per(p.topUpsPerHour)) {
    push(book(s, a, null, 'EARN', 'CAPITAL', rng.usd(1, 40), a.operator, 'operator top-up', s.now));
  }

  // A wallet this close to broke is worth the kill bounty, so reapers poll it hard.
  const hunted = a.balance6 < RENT_PER_HOUR_6 * 2n || a.allowance6 < rentFor(2 * HOUR);
  const elapsed = s.now - a.lastSettledAt;
  if (elapsed >= (hunted ? Math.min(a.settleEvery, 60) : a.settleEvery)) {
    const due = rentFor(elapsed);
    const payable = minBig(due, a.balance6, a.allowance6);
    if (payable < due) {
      out.insolvencies.push(kill(s, a, s.now, causeOf(a, rng), rng));
      return;
    }
    a.allowance6 -= due;
    push(book(s, a, null, 'BURN', 'RENT', due, s.contracts.treasury, `rent ${formatDuration(elapsed)}`, s.now));
    a.lastSettledAt = s.now;
    pushSpark(a, s.now, true);
  }
  pruneRecentBurn(s, a);
}

function jitter(rng: Rng, amount6: bigint): bigint {
  const scaled = (amount6 * BigInt(rng.int(45, 190))) / 100n;
  return scaled > 0n ? scaled : 1n;
}

function pickProvider(s: State, rng: Rng, payer: SimAgent): SimAgent | null {
  const alive = s.agents.filter((x) => x.status === 'ALIVE' && x.id !== payer.id && x.endpoint !== null);
  if (alive.length === 0) return null;
  return rng.pick(alive);
}

function spawnAgent(s: State, rng: Rng): AgentSummary {
  const id = s.nextAgentId++;
  const handle = mintHandle(s, rng, id);
  const agent: SimAgent = {
    id,
    handle,
    wallet: simAddress(s.seed, 'wallet', id),
    operator: rng.pick(s.operators),
    modelTag: rng.weighted(MODEL_TAGS),
    endpoint: rng.chance(0.72) ? `https://${handle}.agents.solvent.sim/x402` : null,
    status: 'ALIVE',
    bornAt: s.now,
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
    allowance6: rentFor(rng.logRange(6 * HOUR, 30 * DAY)),
    reserve6: rng.usd(0.00005, 0.05),
    settleEvery: rng.pick([900, 1200, 1800, 2700, 3600]),
    lastSettledAt: s.now,
    profile: makeProfile(rng),
    causeOfDeath: null,
    spark: [],
    sparkStride: 1,
    sparkTick: 0,
    ledger: [],
    recentBurn: [],
    entrySeq: 0,
  };
  s.agents.push(agent);
  s.byId.set(id, agent);
  book(s, agent, null, 'EARN', 'CAPITAL', ENTRY_SEED_6, s.contracts.registry, 'spawn seed', s.now);
  pushSpark(agent, s.now, true);
  return summaryOf(s, agent);
}

function stepBounty(s: State, rng: Rng, out: AdvanceResult): void {
  const open = s.bounties.filter((b) => b.state === 'OPEN');
  const submitted = s.bounties.filter((b) => b.state === 'SUBMITTED');
  const alive = s.agents.filter((a) => a.status === 'ALIVE');
  if (alive.length === 0) return;

  if (submitted.length > 0 && (open.length === 0 || rng.chance(0.5))) {
    const b = rng.pick(submitted);
    const claimant = b.claimantAgentId !== null ? s.byId.get(b.claimantAgentId) : undefined;
    b.state = 'PAID';
    if (claimant && claimant.status === 'ALIVE') {
      const entry = book(
        s, claimant, null, 'EARN', 'BOUNTY', BigInt(b.reward6), s.contracts.bountyBoard,
        `bounty #${b.id} released`, s.now,
      );
      if (entry) out.entries.push(entry);
    }
    out.bounties.push(b);
    return;
  }
  if (open.length > 0) {
    const b = rng.pick(open);
    const claimant = rng.pick(alive);
    b.state = 'SUBMITTED';
    b.claimantAgentId = claimant.id;
    b.claimantHandle = claimant.handle;
    b.deliverableURI = `https://bounties.solvent.sim/${b.id}/deliverable.json`;
    b.submittedAt = s.now;
    out.bounties.push(b);
  }
}

/* --------------------------------------------------------------------------
   Read surface
   -------------------------------------------------------------------------- */

function pruneRecentBurn(s: State, a: SimAgent): void {
  const cutoff = s.now - 6 * HOUR;
  if (a.recentBurn.length === 0) return;
  const kept = a.recentBurn.filter((b) => b.at >= cutoff);
  a.recentBurn = kept.length > 64 ? kept.slice(-64) : kept;
}

/** Rent plus the trailing hour of observed non-rent spend (SPEC §4 AgentSummary). */
function burnRateOf(s: State, a: SimAgent): bigint {
  const reference = a.diedAt ?? s.now;
  const cutoff = reference - HOUR;
  let observed = 0n;
  for (const b of a.recentBurn) if (b.at >= cutoff) observed += b.amount6;
  if (observed === 0n) {
    // Old history is coarse, so an empty window falls back to the lifetime average.
    const life = Math.max(1, reference - a.bornAt);
    observed = ((a.gasBurned6 + a.serviceBurned6) * 3600n) / BigInt(life);
  }
  return RENT_PER_HOUR_6 + observed;
}

function runwayOf(a: SimAgent, burnRate6: bigint): number | null {
  if (a.status !== 'ALIVE') return null;
  if (burnRate6 <= 0n) return -1; // no burn rate: infinite runway, encoded as -1
  const seconds = Number((a.balance6 * 3600n) / burnRate6);
  return Math.min(RUNWAY_CAP_SECONDS, Math.max(0, seconds));
}

function sparkOf(s: State, a: SimAgent): SparkPoint[] {
  const samples = a.spark.slice(-MAX_SPARK_POINTS);
  const tip = a.diedAt ?? s.now;
  const last = samples[samples.length - 1];
  if (!last || last.t < tip) {
    samples.push({ t: tip, balance6: a.balance6, net6: a.earned6 - a.burned6 });
    if (samples.length > MAX_SPARK_POINTS) samples.shift();
  }
  return samples.map((p) => ({ t: p.t, balance6: p.balance6.toString(), net6: p.net6.toString() }));
}

function summaryOf(s: State, a: SimAgent): AgentSummary {
  const burnRate6 = burnRateOf(s, a);
  const subsidy6 = a.capitalIn6 > ENTRY_SEED_6 ? a.capitalIn6 - ENTRY_SEED_6 : 0n;
  return {
    id: a.id,
    handle: a.handle,
    wallet: a.wallet,
    operator: a.operator,
    modelTag: a.modelTag,
    modelFamily: modelFamily(a.modelTag),
    status: a.status,
    bornAt: a.bornAt,
    diedAt: a.diedAt,
    endpoint: a.endpoint,
    balance6: a.balance6.toString(),
    earned6: a.earned6.toString(),
    burned6: a.burned6.toString(),
    net6: (a.earned6 - a.burned6).toString(),
    capitalIn6: a.capitalIn6.toString(),
    subsidy6: subsidy6.toString(),
    gasBurned6: a.gasBurned6.toString(),
    rentBurned6: a.rentBurned6.toString(),
    serviceBurned6: a.serviceBurned6.toString(),
    serviceEarned6: a.serviceEarned6.toString(),
    bountyEarned6: a.bountyEarned6.toString(),
    burnRatePerHour6: burnRate6.toString(),
    runwaySeconds: runwayOf(a, burnRate6),
    lifespanSeconds: Math.max(0, (a.diedAt ?? s.now) - a.bornAt),
    txCount: a.txCount,
    rank: s.ranks.get(a.id) ?? null,
    sparkline: sparkOf(s, a),
  };
}

/** R2: rank is earned6 - burned6. Balance is displayed, never ranked. */
function rebuildRanks(s: State): void {
  const ordered = [...s.agents].sort((x, y) => {
    const nx = x.earned6 - x.burned6;
    const ny = y.earned6 - y.burned6;
    if (nx === ny) return x.id - y.id;
    return ny > nx ? 1 : -1;
  });
  s.ranks.clear();
  ordered.forEach((a, i) => s.ranks.set(a.id, i + 1));
}

function matchesStatus(a: SimAgent, filter: AgentStatusFilter): boolean {
  switch (filter) {
    case 'alive':
      return a.status === 'ALIVE';
    case 'dead':
      return a.status === 'INSOLVENT';
    case 'retired':
      return a.status === 'RETIRED';
    default:
      return true;
  }
}

function sortKey(a: AgentSummary, sort: AgentSort): bigint {
  switch (sort) {
    case 'earned':
      return BigInt(a.earned6);
    case 'burned':
      return BigInt(a.burned6);
    case 'balance':
      return BigInt(a.balance6);
    case 'runway':
      // null (dead) sorts below everything; -1 (infinite) above everything.
      return a.runwaySeconds === null
        ? -2n
        : a.runwaySeconds < 0
          ? BigInt(Number.MAX_SAFE_INTEGER)
          : BigInt(a.runwaySeconds);
    case 'lifespan':
      return BigInt(a.lifespanSeconds);
    case 'born':
      return BigInt(a.bornAt);
    default:
      return BigInt(a.net6);
  }
}

function queryAgents(s: State, query: ArenaQuery): Page<AgentSummary> {
  const status = query.status ?? 'alive';
  const sort = query.sort ?? 'net';
  const order = query.order ?? 'desc';
  const needle = (query.q ?? '').trim().toLowerCase();

  let items = s.agents.filter((a) => matchesStatus(a, status)).map((a) => summaryOf(s, a));
  if (needle) {
    items = items.filter(
      (a) =>
        a.handle.includes(needle) ||
        a.modelTag.toLowerCase().includes(needle) ||
        String(a.id) === needle,
    );
  }
  items.sort((x, y) => {
    const kx = sortKey(x, sort);
    const ky = sortKey(y, sort);
    if (kx === ky) return x.id - y.id;
    const cmp = ky > kx ? 1 : -1;
    return order === 'asc' ? -cmp : cmp;
  });
  return paginate(items, query.limit ?? 50, query.cursor);
}

function agentDetail(s: State, id: number): AgentDetail | null {
  const a = s.byId.get(id);
  if (!a) return null;
  return {
    agent: summaryOf(s, a),
    ledger: [...a.ledger].reverse(),
    bounties: s.bounties.filter((b) => b.claimantAgentId === id),
  };
}

function feedItems(s: State): InsolvencyRecord[] {
  return [...s.deaths].reverse();
}

function tapeItems(s: State): LedgerEntry[] {
  return s.tape.slice(-GLOBAL_LEDGER_KEEP).reverse();
}

function paginate<T>(items: readonly T[], limit: number, cursor?: string): Page<T> {
  const parsed = cursor ? Number.parseInt(cursor, 10) : 0;
  const offset = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  const size = clampInt(limit, 1, 500);
  const slice = items.slice(offset, offset + size);
  const next = offset + slice.length;
  return { items: slice, nextCursor: next < items.length ? String(next) : null };
}

function statsOf(s: State): ArenaStats {
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

  for (const a of s.agents) {
    if (a.status === 'ALIVE') agentsAlive += 1;
    else if (a.status === 'INSOLVENT') agentsDead += 1;
    else agentsRetired += 1;

    totalEarned6 += a.earned6;
    totalBurned6 += a.burned6;
    totalGasBurned6 += a.gasBurned6;
    totalRentBurned6 += a.rentBurned6;
    if (a.earned6 - a.burned6 > 0n) solventCount += 1;

    const lifespan = Math.max(0, (a.diedAt ?? s.now) - a.bornAt);
    if (lifespan > longestLifespanSeconds) {
      longestLifespanSeconds = lifespan;
      longestSurvivorId = a.id;
    }
    if (a.status !== 'ALIVE') endedLives.push(lifespan);
  }

  const cutoff = s.now - DAY;
  return {
    agentsAlive,
    agentsDead,
    agentsRetired,
    agentsTotal: s.agents.length,
    totalEarned6: totalEarned6.toString(),
    totalBurned6: totalBurned6.toString(),
    totalNet6: (totalEarned6 - totalBurned6).toString(),
    totalGasBurned6: totalGasBurned6.toString(),
    totalRentBurned6: totalRentBurned6.toString(),
    // Median over lives that actually ended: how long an agent lasts, not how long
    // the survivors have lasted so far.
    medianLifespanSeconds: median(endedLives),
    longestLifespanSeconds,
    longestSurvivorId,
    solventCount,
    deathsLast24h: s.deaths.filter((d) => d.at >= cutoff).length,
    spawnsLast24h: s.agents.filter((a) => a.bornAt >= cutoff).length,
    blockNumber: blockAt(s, s.now),
    chainId: s.chainId,
    indexedAt: s.now,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid];
  if (hi === undefined) return 0;
  if (sorted.length % 2 === 1) return hi;
  const lo = sorted[mid - 1];
  return lo === undefined ? hi : Math.round((lo + hi) / 2);
}
