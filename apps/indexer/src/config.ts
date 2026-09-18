/**
 * Environment -> configuration.
 *
 * One place decides the mode, and whatever it decides is what /api/health reports
 * (SPEC 5.2). A live run that cannot find a deployment degrades to demo and SAYS
 * demo: the UI keys its DEMO marker off that field, so it may never flatter us.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Deployment, Hex, IndexerMode } from '@solvent/core';
import { DEFAULT_RENT_PER_HOUR_6, NETWORKS } from '@solvent/core';

export type ChainKey = 'arc' | 'arcTestnet';

export const CONTRACT_KEYS = [
  'ledger',
  'registry',
  'metabolism',
  'serviceMeter',
  'bountyBoard',
  'treasury',
] as const;

export type ContractKey = (typeof CONTRACT_KEYS)[number];
export type ContractMap = Record<ContractKey, Hex | null>;

export interface DemoConfig {
  seed: number;
  agents: number;
  /** Wall-clock cadence of the simulator pump. */
  tickMs: number;
  /** Simulated seconds per real second. 1 keeps demo time honest. */
  speed: number;
}

export interface IndexerConfig {
  /** The mode actually running. /api/health reports this and nothing else. */
  mode: IndexerMode;
  /** What the operator asked for, which may differ when live was not possible. */
  requestedMode: IndexerMode;
  /** Why the two differ, for the log line. */
  modeNote: string | null;

  port: number;
  host: string;

  chainKey: ChainKey;
  chainId: number;
  rpcUrl: string;

  deployment: Deployment | null;
  contracts: ContractMap;

  /** First block to index. Deployment block unless overridden. */
  startBlock: bigint;
  /** Bounded log range per getLogs call. */
  chunkBlocks: bigint;
  pollIntervalMs: number;

  /** R3: gas is a burn line. Off only when an operator explicitly says so. */
  gasScan: boolean;
  gasScanMaxBlocks: bigint;

  balanceRefreshMs: number;
  balanceBatch: number;

  dataDir: string;
  snapshotIntervalMs: number;

  heartbeatMs: number;
  statsIntervalMs: number;

  rentPerHour6: bigint;
  demo: DemoConfig;
}

const HEX20 = /^0x[0-9a-fA-F]{40}$/;
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

function env(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function envFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = env(name);
  if (raw === undefined) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function envBigInt(name: string, fallback: bigint): bigint {
  const raw = env(name);
  if (raw === undefined) return fallback;
  try {
    const parsed = BigInt(raw);
    return parsed < 0n ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = env(name)?.toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

function envHex(name: string): Hex | null {
  const raw = env(name);
  if (raw === undefined || !HEX20.test(raw)) return null;
  return raw.toLowerCase() as Hex;
}

function asHex(value: unknown): Hex | null {
  return typeof value === 'string' && HEX20.test(value) ? (value.toLowerCase() as Hex) : null;
}

/** Search order: explicit env, then the monorepo layout walking up from this file. */
export function deploymentSearchDirs(): string[] {
  const dirs: string[] = [];
  const explicit = env('SOLVENT_DEPLOYMENTS_DIR');
  if (explicit) dirs.push(resolve(explicit));

  let cursor = MODULE_DIR;
  for (let depth = 0; depth < 8; depth++) {
    dirs.push(join(cursor, 'packages', 'core', 'src', 'deployments'));
    dirs.push(join(cursor, 'packages', 'core', 'dist', 'deployments'));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  dirs.push(join(process.cwd(), 'packages', 'core', 'src', 'deployments'));
  return dirs;
}

function coerceDeployment(raw: unknown, chainId: number): Deployment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const ledger = asHex(rec['ledger']);
  const registry = asHex(rec['registry']);
  const metabolism = asHex(rec['metabolism']);
  const serviceMeter = asHex(rec['serviceMeter']);
  const bountyBoard = asHex(rec['bountyBoard']);
  const treasury = asHex(rec['treasury']);
  if (!ledger || !registry || !metabolism || !serviceMeter || !bountyBoard || !treasury) return null;

  const block = typeof rec['block'] === 'number' ? rec['block'] : 0;
  const declared = typeof rec['chainId'] === 'number' ? rec['chainId'] : chainId;
  return {
    chainId: declared,
    block,
    ledger,
    registry,
    metabolism,
    serviceMeter,
    bountyBoard,
    treasury,
  };
}

/** packages/core/src/deployments/<chainId>.json, if the contracts are deployed yet. */
export function loadDeployment(chainId: number): Deployment | null {
  for (const dir of deploymentSearchDirs()) {
    const file = join(dir, `${chainId}.json`);
    if (!existsSync(file)) continue;
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
      const deployment = coerceDeployment(parsed, chainId);
      if (deployment) return deployment;
      console.warn(`[config] ${file} is not a complete deployment, ignoring`);
    } catch (err) {
      console.warn(`[config] could not read ${file}: ${String(err)}`);
    }
  }
  return null;
}

function resolveChain(): { chainKey: ChainKey; chainId: number; rpcUrl: string } {
  const requested = env('SOLVENT_CHAIN')?.toLowerCase();
  const chainKey: ChainKey = requested === 'arc' || requested === 'mainnet' ? 'arc' : 'arcTestnet';
  const network = NETWORKS[chainKey];
  const override =
    env('SOLVENT_RPC_URL') ??
    (chainKey === 'arc' ? env('ARC_MAINNET_RPC_URL') : env('ARC_TESTNET_RPC_URL'));
  return {
    chainKey,
    chainId: network.id,
    rpcUrl: override ?? network.rpcUrl,
  };
}

function resolveContracts(deployment: Deployment | null): ContractMap {
  return {
    ledger: envHex('SOLVENT_LEDGER_ADDRESS') ?? deployment?.ledger ?? null,
    registry: envHex('SOLVENT_REGISTRY_ADDRESS') ?? deployment?.registry ?? null,
    metabolism: envHex('SOLVENT_METABOLISM_ADDRESS') ?? deployment?.metabolism ?? null,
    serviceMeter: envHex('SOLVENT_SERVICE_METER_ADDRESS') ?? deployment?.serviceMeter ?? null,
    bountyBoard: envHex('SOLVENT_BOUNTY_BOARD_ADDRESS') ?? deployment?.bountyBoard ?? null,
    treasury: envHex('SOLVENT_TREASURY_ADDRESS') ?? deployment?.treasury ?? null,
  };
}

export function loadConfig(): IndexerConfig {
  const requestedMode: IndexerMode = env('SOLVENT_MODE')?.toLowerCase() === 'live' ? 'live' : 'demo';
  const { chainKey, chainId, rpcUrl } = resolveChain();
  const deployment = loadDeployment(chainId);
  const contracts = resolveContracts(deployment);

  // Live needs, at minimum, a Ledger and a Registry to read. Without them there is
  // nothing to index and pretending otherwise would put a lie in /api/health.
  let mode: IndexerMode = requestedMode;
  let modeNote: string | null = null;
  if (requestedMode === 'live' && (contracts.ledger === null || contracts.registry === null)) {
    mode = 'demo';
    modeNote = `no deployment for chain ${chainId} (looked for packages/core/src/deployments/${chainId}.json); serving demo`;
  }

  const startBlock = envBigInt('SOLVENT_START_BLOCK', BigInt(deployment?.block ?? 0));

  return {
    mode,
    requestedMode,
    modeNote,
    port: envInt('PORT', envInt('SOLVENT_INDEXER_PORT', 8787, 1, 65_535), 1, 65_535),
    host: env('HOST') ?? '0.0.0.0',
    chainKey,
    chainId,
    rpcUrl,
    deployment,
    contracts,
    startBlock,
    chunkBlocks: envBigInt('SOLVENT_CHUNK_BLOCKS', 2_000n),
    pollIntervalMs: envInt('SOLVENT_POLL_MS', 2_000, 250, 60_000),
    gasScan: envBool('SOLVENT_GAS_SCAN', true),
    gasScanMaxBlocks: envBigInt('SOLVENT_GAS_SCAN_MAX_BLOCKS', 2_000n),
    balanceRefreshMs: envInt('SOLVENT_BALANCE_REFRESH_MS', 30_000, 1_000, 600_000),
    balanceBatch: envInt('SOLVENT_BALANCE_BATCH', 25, 1, 200),
    dataDir: resolve(env('SOLVENT_DATA_DIR') ?? './data'),
    snapshotIntervalMs: envInt('SOLVENT_SNAPSHOT_MS', 30_000, 1_000, 3_600_000),
    heartbeatMs: envInt('SOLVENT_SSE_HEARTBEAT_MS', 15_000, 1_000, 120_000),
    statsIntervalMs: envInt('SOLVENT_STATS_MS', 5_000, 500, 120_000),
    rentPerHour6: envBigInt('SOLVENT_RENT_PER_HOUR_6', DEFAULT_RENT_PER_HOUR_6),
    demo: {
      seed: envInt('SOLVENT_DEMO_SEED', 1337, 0, 2_147_483_647),
      agents: envInt('SOLVENT_DEMO_AGENTS', 60, 1, 400),
      tickMs: envInt('SOLVENT_DEMO_TICK_MS', 2_000, 200, 60_000),
      speed: envFloat('SOLVENT_DEMO_SPEED', 1, 0.1, 600),
    },
  };
}

export function describeConfig(config: IndexerConfig): string {
  const parts = [
    `mode=${config.mode}`,
    `chain=${config.chainKey}(${config.chainId})`,
    `port=${config.port}`,
  ];
  if (config.mode === 'live') parts.push(`rpc=${config.rpcUrl}`, `startBlock=${config.startBlock}`);
  else parts.push(`seed=${config.demo.seed}`, `agents=${config.demo.agents}`);
  return parts.join(' ');
}
