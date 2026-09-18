/**
 * Runtime configuration: environment first, CLI flags on top.
 *
 * AgentConfig deliberately contains no secret. The private key is read straight
 * from the environment into a viem account in wallet.ts and never stored here,
 * so this object is safe to print.
 */

import type { Hex, NetworkInfo, Usdc6 } from '@solvent/core';
import { NETWORKS, USDC_ADDRESS, parseUsd } from '@solvent/core';

export type BrainName = 'heuristic' | 'claude' | 'openai' | 'gemini';

export const BRAIN_NAMES: readonly BrainName[] = ['heuristic', 'claude', 'openai', 'gemini'];

export interface ContractAddresses {
  registry: Hex | null;
  metabolism: Hex | null;
  serviceMeter: Hex | null;
  bountyBoard: Hex | null;
  ledger: Hex | null;
  usdc: Hex;
}

export interface AgentConfig {
  network: NetworkInfo;
  rpcUrl: string;
  indexerUrl: string;
  contracts: ContractAddresses;
  /** null means "ask the registry which agent this wallet is". */
  agentId: number | null;
  brain: BrainName;
  /** Seconds between metabolism ticks when the brain does not ask to idle. */
  intervalSeconds: number;
  /** Hard ceiling on what one action may spend. Rail, not a suggestion. */
  maxSpendPerAction6: Usdc6;
  /** What the operator intended to approve to Metabolism. Used for warnings. */
  allowanceCap6: Usdc6;
  /** Price of one call to this agent's own x402 endpoint. */
  price6: Usdc6;
  serve: boolean;
  servePort: number;
  publicUrl: string | null;
  once: boolean;
  dryRun: boolean;
  yesIKnow: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export const DEFAULT_MAX_SPEND_PER_ACTION_6: Usdc6 = 50_000n; // $0.05
export const DEFAULT_ALLOWANCE_CAP_6: Usdc6 = 10_000_000n; // $10.00
export const DEFAULT_PRICE_6: Usdc6 = 10_000n; // $0.01 per request

export class ConfigError extends Error {}

type FlagValue = string | true;

export function parseFlags(argv: readonly string[]): Map<string, FlagValue> {
  const flags = new Map<string, FlagValue>();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === undefined || !raw.startsWith('--')) continue;
    const body = raw.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(body, next);
      i++;
    } else {
      flags.set(body, true);
    }
  }
  return flags;
}

function flagString(flags: Map<string, FlagValue>, name: string): string | null {
  const value = flags.get(name);
  return typeof value === 'string' ? value : null;
}

function flagBool(flags: Map<string, FlagValue>, name: string): boolean {
  const value = flags.get(name);
  if (value === true) return true;
  return value === 'true' || value === '1';
}

export function asAddress(value: string | undefined | null): Hex | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed) ? (trimmed as Hex) : null;
}

function requireAddress(value: string | undefined | null, label: string): Hex {
  const address = asAddress(value);
  if (!address) throw new ConfigError(`${label} is not a 20-byte address: ${String(value)}`);
  return address;
}

function positiveInt(value: string | null, fallback: number, label: string): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new ConfigError(`${label} must be a positive number`);
  return Math.floor(parsed);
}

/** Accepts either raw 6-decimal units ("50000") or a dollar string ("$0.05"). */
export function parseUsdc6(value: string, label: string): Usdc6 {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
  try {
    const parsed = parseUsd(trimmed);
    if (parsed < 0n) throw new ConfigError(`${label} must not be negative`);
    return parsed;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`${label} is not an amount: ${value}`);
  }
}

function money(
  flags: Map<string, FlagValue>,
  flag: string,
  env: NodeJS.ProcessEnv,
  envKey: string,
  fallback: Usdc6,
): Usdc6 {
  const fromFlag = flagString(flags, flag);
  if (fromFlag !== null) return parseUsdc6(fromFlag, `--${flag}`);
  const fromEnv = env[envKey];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return parseUsdc6(fromEnv, envKey);
  return fallback;
}

function pickBrain(value: string | null): BrainName {
  if (value === null) return 'heuristic';
  const found = BRAIN_NAMES.find((name) => name === value.toLowerCase());
  if (!found) throw new ConfigError(`unknown brain "${value}" (expected ${BRAIN_NAMES.join(' | ')})`);
  return found;
}

function pickNetwork(value: string | null): NetworkInfo {
  const key = (value ?? 'arcTestnet').trim();
  if (key === 'arc' || key === 'arcTestnet') return NETWORKS[key];
  throw new ConfigError(`SOLVENT_CHAIN must be "arc" or "arcTestnet", got "${key}"`);
}

export function loadConfig(argv: readonly string[] = [], env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const flags = parseFlags(argv);

  // A key on the command line ends up in shell history and in `ps`. Refuse it.
  if (flags.has('private-key') || flags.has('key')) {
    throw new ConfigError('pass the key as PRIVATE_KEY in the environment, never as a CLI flag');
  }

  const network = pickNetwork(flagString(flags, 'chain') ?? env['SOLVENT_CHAIN'] ?? null);
  const rpcEnvKey = network.key === 'arc' ? 'ARC_MAINNET_RPC_URL' : 'ARC_TESTNET_RPC_URL';
  const rpcUrl = flagString(flags, 'rpc') ?? env[rpcEnvKey] ?? network.rpcUrl;

  const agentIdRaw = flagString(flags, 'agent-id') ?? env['SOLVENT_AGENT_ID'] ?? null;
  const agentId = agentIdRaw === null || agentIdRaw.trim() === '' ? null : positiveInt(agentIdRaw, 0, 'agent id');

  const logLevelRaw = (flagString(flags, 'log-level') ?? env['SOLVENT_LOG_LEVEL'] ?? 'info').toLowerCase();
  const logLevel =
    logLevelRaw === 'debug' || logLevelRaw === 'warn' || logLevelRaw === 'error' ? logLevelRaw : 'info';

  return {
    network,
    rpcUrl,
    indexerUrl: (flagString(flags, 'indexer') ?? env['SOLVENT_INDEXER_URL'] ?? 'http://localhost:8787').replace(
      /\/+$/,
      '',
    ),
    contracts: {
      registry: asAddress(flagString(flags, 'registry') ?? env['SOLVENT_REGISTRY_ADDRESS']),
      metabolism: asAddress(flagString(flags, 'metabolism') ?? env['SOLVENT_METABOLISM_ADDRESS']),
      serviceMeter: asAddress(flagString(flags, 'service-meter') ?? env['SOLVENT_SERVICE_METER_ADDRESS']),
      bountyBoard: asAddress(flagString(flags, 'bounty-board') ?? env['SOLVENT_BOUNTY_BOARD_ADDRESS']),
      ledger: asAddress(flagString(flags, 'ledger') ?? env['SOLVENT_LEDGER_ADDRESS']),
      usdc: requireAddress(env['SOLVENT_USDC_ADDRESS'] ?? USDC_ADDRESS, 'USDC address'),
    },
    agentId,
    brain: pickBrain(flagString(flags, 'brain') ?? env['SOLVENT_BRAIN'] ?? null),
    intervalSeconds: positiveInt(
      flagString(flags, 'interval') ?? env['SOLVENT_TICK_SECONDS'] ?? null,
      60,
      'interval',
    ),
    maxSpendPerAction6: money(flags, 'max-spend', env, 'SOLVENT_MAX_SPEND_PER_ACTION_6', DEFAULT_MAX_SPEND_PER_ACTION_6),
    allowanceCap6: money(flags, 'allowance-cap', env, 'SOLVENT_ALLOWANCE_CAP_6', DEFAULT_ALLOWANCE_CAP_6),
    price6: money(flags, 'price', env, 'SOLVENT_PRICE_6', DEFAULT_PRICE_6),
    serve: !flagBool(flags, 'no-serve') && (flagBool(flags, 'serve') || env['SOLVENT_SERVE'] !== '0'),
    servePort: positiveInt(flagString(flags, 'port') ?? env['SOLVENT_AGENT_PORT'] ?? null, 8402, 'port'),
    publicUrl: flagString(flags, 'public-url') ?? env['SOLVENT_AGENT_PUBLIC_URL'] ?? null,
    once: flagBool(flags, 'once'),
    dryRun: flagBool(flags, 'dry-run'),
    yesIKnow: flagBool(flags, 'yes-i-know'),
    logLevel,
  };
}

/** The key is read here and nowhere else. It is never returned in AgentConfig. */
export function readPrivateKey(env: NodeJS.ProcessEnv = process.env): Hex {
  const raw = env['PRIVATE_KEY'];
  if (!raw || raw.trim() === '') {
    throw new ConfigError('PRIVATE_KEY is not set. Generate one with `npx @solvent/cli spawn`.');
  }
  const trimmed = raw.trim();
  const prefixed = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(prefixed)) {
    throw new ConfigError('PRIVATE_KEY is not a 32-byte hex key');
  }
  return prefixed as Hex;
}
