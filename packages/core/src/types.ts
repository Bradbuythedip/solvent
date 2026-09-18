export type Hex = `0x${string}`;

export type AgentStatus = 'ALIVE' | 'INSOLVENT' | 'RETIRED';
export type Flow = 'EARN' | 'BURN';
export type Category = 'RENT' | 'SERVICE' | 'BOUNTY' | 'GAS' | 'SPAWN' | 'CAPITAL' | 'OTHER';
export type BountyState = 'OPEN' | 'SUBMITTED' | 'PAID' | 'REFUNDED';
export type ModelFamily = 'claude' | 'gpt' | 'gemini' | 'llama' | 'mistral' | 'grok' | 'other';
export type IndexerMode = 'live' | 'demo';

/** Solvency state as the UI encodes it. Colour is reserved for exactly this. */
export type SolvencyState = 'solvent' | 'burning' | 'dying' | 'dead' | 'retired';

export interface SparkPoint {
  t: number;
  balance6: string;
  net6: string;
}

export interface AgentSummary {
  id: number;
  handle: string;
  wallet: Hex;
  operator: Hex;
  modelTag: string;
  modelFamily: ModelFamily;
  status: AgentStatus;
  bornAt: number;
  diedAt: number | null;
  endpoint: string | null;

  balance6: string;
  earned6: string;
  burned6: string;
  net6: string;
  capitalIn6: string;
  /** capitalIn6 - ENTRY_SEED_6: post-spawn top-ups. Displayed, never ranked. */
  subsidy6: string;

  gasBurned6: string;
  rentBurned6: string;
  serviceBurned6: string;
  serviceEarned6: string;
  bountyEarned6: string;

  burnRatePerHour6: string;
  /** null = dead/retired. -1 = no burn rate (infinite runway). */
  runwaySeconds: number | null;
  lifespanSeconds: number;
  txCount: number;
  rank: number | null;
  sparkline: SparkPoint[];
}

export interface LedgerEntry {
  id: string;
  agentId: number;
  flow: Flow;
  category: Category;
  amount6: string;
  counterparty: Hex;
  memo: string | null;
  at: number;
  txHash: Hex;
  blockNumber: number;
}

export interface InsolvencyRecord {
  agentId: number;
  handle: string;
  modelTag: string;
  modelFamily: ModelFamily;
  at: number;
  finalBalance6: string;
  lifespanSeconds: number;
  earned6: string;
  burned6: string;
  net6: string;
  reaper: Hex;
  txHash: Hex;
  blockNumber: number;
  causeOfDeath: string;
}

export interface Bounty {
  id: number;
  poster: Hex;
  reward6: string;
  deadline: number;
  reviewWindow: number;
  specURI: string;
  specHash: Hex;
  title: string;
  state: BountyState;
  claimantAgentId: number | null;
  claimantHandle: string | null;
  deliverableURI: string | null;
  submittedAt: number | null;
  txHash: Hex;
}

export interface ArenaStats {
  agentsAlive: number;
  agentsDead: number;
  agentsRetired: number;
  agentsTotal: number;
  totalEarned6: string;
  totalBurned6: string;
  totalNet6: string;
  totalGasBurned6: string;
  totalRentBurned6: string;
  medianLifespanSeconds: number;
  longestLifespanSeconds: number;
  longestSurvivorId: number | null;
  solventCount: number;
  deathsLast24h: number;
  spawnsLast24h: number;
  blockNumber: number;
  chainId: number;
  indexedAt: number;
}

export interface HealthResponse {
  ok: boolean;
  chainId: number;
  head: number;
  lag: number;
  mode: IndexerMode;
  contracts: Record<string, Hex | null>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export type StreamEvent =
  | { type: 'hello'; data: ArenaStats }
  | { type: 'stats'; data: ArenaStats }
  | { type: 'spawn'; data: AgentSummary }
  | { type: 'entry'; data: LedgerEntry }
  | { type: 'insolvency'; data: InsolvencyRecord }
  | { type: 'bounty'; data: Bounty }
  | { type: 'tick'; data: { at: number } };

export type AgentSort = 'net' | 'earned' | 'burned' | 'balance' | 'runway' | 'lifespan' | 'born';
export type AgentStatusFilter = 'alive' | 'dead' | 'retired' | 'all';

/**
 * Solvency state from a summary. This is the ONLY function that decides which
 * colour an agent wears anywhere in the product.
 *
 *   dead     — insolvent, permanently
 *   retired  — withdrew while solvent
 *   dying    — under 6 hours of runway left
 *   burning  — alive but net negative
 *   solvent  — alive and net positive
 */
export function solvencyOf(a: Pick<AgentSummary, 'status' | 'net6' | 'runwaySeconds'>): SolvencyState {
  if (a.status === 'INSOLVENT') return 'dead';
  if (a.status === 'RETIRED') return 'retired';
  const runway = a.runwaySeconds;
  if (runway !== null && runway >= 0 && runway < 6 * 3600) return 'dying';
  return BigInt(a.net6) > 0n ? 'solvent' : 'burning';
}
