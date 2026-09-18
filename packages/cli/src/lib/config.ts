/**
 * Where the CLI gets its network, its contract addresses and its URLs.
 *
 * Precedence is always: explicit flag, then environment (.env merged with the
 * process env), then the repo's generated deployment file, then the defaults in
 * @solvent/core.
 */

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { isAddress, getAddress } from 'viem';
import { ARC_MAINNET_ID, NETWORKS } from '@solvent/core';
import type { Hex, NetworkInfo } from '@solvent/core';
import { flag, str, type Values } from './args.js';
import { get, loadEnv, type EnvMap } from './env.js';
import { CliError } from './errors.js';

export type NetworkKey = 'arc' | 'arcTestnet';

export type ContractName = 'ledger' | 'registry' | 'metabolism' | 'serviceMeter' | 'bountyBoard' | 'treasury';

export interface Addresses {
  chainId: number;
  block: number | null;
  ledger: Hex | null;
  registry: Hex | null;
  metabolism: Hex | null;
  serviceMeter: Hex | null;
  bountyBoard: Hex | null;
  treasury: Hex | null;
  /** Human description of where these came from, for doctor and for errors. */
  source: string;
}

export interface Ctx {
  argv: string[];
  values: Values;
  network: NetworkInfo;
  networkKey: NetworkKey;
  rpcUrl: string;
  indexerUrl: string;
  siteUrl: string;
  envPath: string;
  env: EnvMap;
  json: boolean;
  yes: boolean;
  addresses: Addresses;
}

function normaliseNetwork(raw: string, origin: string): NetworkKey {
  const key = raw.trim().toLowerCase();
  if (key === 'arc') return 'arc';
  if (key === 'arctestnet' || key === 'arc-testnet') return 'arcTestnet';
  throw new CliError(`unknown network "${raw}" (${origin})`, 'Use --network arc or --network arcTestnet.');
}

const ENV_ADDRESS_KEYS: Record<ContractName, string> = {
  ledger: 'SOLVENT_LEDGER_ADDRESS',
  registry: 'SOLVENT_REGISTRY_ADDRESS',
  metabolism: 'SOLVENT_METABOLISM_ADDRESS',
  serviceMeter: 'SOLVENT_SERVICE_METER_ADDRESS',
  bountyBoard: 'SOLVENT_BOUNTY_BOARD_ADDRESS',
  treasury: 'SOLVENT_TREASURY_ADDRESS',
};

function asAddress(value: string | undefined, label: string): Hex | null {
  if (value === undefined) return null;
  if (!isAddress(value)) throw new CliError(`${label} is not an address: ${value}`);
  return getAddress(value);
}

/**
 * The deploy script writes packages/core/src/deployments/<chainId>.json. Resolve
 * it through the installed @solvent/core, then fall back to walking up from the
 * working directory so the CLI also works from inside a checkout.
 */
function deploymentCandidates(chainId: number, env: EnvMap): string[] {
  const file = `${chainId}.json`;
  const out: string[] = [];
  const dir = get(env, 'SOLVENT_DEPLOYMENTS_DIR');
  if (dir !== undefined) out.push(join(resolve(dir), file));

  try {
    const require_ = createRequire(import.meta.url);
    const entry = require_.resolve('@solvent/core');
    const pkgRoot = dirname(dirname(entry)); // <root>/dist/index.js -> <root>
    out.push(join(pkgRoot, 'src', 'deployments', file));
    out.push(join(pkgRoot, 'dist', 'deployments', file));
  } catch {
    // Not installed as a dependency; the checkout walk below still applies.
  }

  let cursor = process.cwd();
  for (let i = 0; i < 6; i++) {
    out.push(join(cursor, 'packages', 'core', 'src', 'deployments', file));
    out.push(join(cursor, 'deployments', file));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return out;
}

function readDeploymentFile(chainId: number, env: EnvMap): { addresses: Addresses; path: string } | null {
  for (const candidate of deploymentCandidates(chainId, env)) {
    if (!existsSync(candidate)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(candidate, 'utf8'));
    } catch (e) {
      throw new CliError(`${candidate} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new CliError(`${candidate} does not describe a deployment`);
    }
    const record = parsed as Record<string, unknown>;
    const pick = (name: ContractName): Hex | null => {
      const value = record[name];
      return typeof value === 'string' ? asAddress(value, `${candidate} ${name}`) : null;
    };
    const block = typeof record['block'] === 'number' ? record['block'] : null;
    return {
      path: candidate,
      addresses: {
        chainId,
        block,
        ledger: pick('ledger'),
        registry: pick('registry'),
        metabolism: pick('metabolism'),
        serviceMeter: pick('serviceMeter'),
        bountyBoard: pick('bountyBoard'),
        treasury: pick('treasury'),
        source: candidate,
      },
    };
  }
  return null;
}

export function loadAddresses(chainId: number, env: EnvMap): Addresses {
  const fromFile = readDeploymentFile(chainId, env);
  const base: Addresses = fromFile?.addresses ?? {
    chainId,
    block: null,
    ledger: null,
    registry: null,
    metabolism: null,
    serviceMeter: null,
    bountyBoard: null,
    treasury: null,
    source: 'none',
  };

  let overridden = false;
  for (const name of Object.keys(ENV_ADDRESS_KEYS) as ContractName[]) {
    const envKey = ENV_ADDRESS_KEYS[name];
    const value = asAddress(get(env, envKey), envKey);
    if (value !== null) {
      base[name] = value;
      overridden = true;
    }
  }
  if (overridden) base.source = base.source === 'none' ? 'environment' : `${base.source} + environment`;
  return base;
}

export function requireAddress(addresses: Addresses, name: ContractName): Hex {
  const value = addresses[name];
  if (value === null) {
    throw new CliError(
      `no ${name} address for chain ${addresses.chainId} (source: ${addresses.source})`,
      `Deploy the contracts, or set ${ENV_ADDRESS_KEYS[name]} in your .env.`,
    );
  }
  return value;
}

export function envAddressKey(name: ContractName): string {
  return ENV_ADDRESS_KEYS[name];
}

export function createContext(argv: string[], values: Values): Ctx {
  const envPath = resolve(str(values, 'env') ?? process.env['SOLVENT_ENV_FILE'] ?? '.env');
  const env = loadEnv(envPath);

  const networkFlag = str(values, 'network');
  const networkKey =
    networkFlag !== undefined
      ? normaliseNetwork(networkFlag, '--network')
      : normaliseNetwork(get(env, 'SOLVENT_CHAIN') ?? 'arcTestnet', 'SOLVENT_CHAIN');
  const network = NETWORKS[networkKey];

  const rpcEnvKey = network.id === ARC_MAINNET_ID ? 'ARC_MAINNET_RPC_URL' : 'ARC_TESTNET_RPC_URL';
  const rpcUrl = str(values, 'rpc') ?? get(env, rpcEnvKey) ?? network.rpcUrl;

  const indexerUrl = (str(values, 'indexer') ?? get(env, 'SOLVENT_INDEXER_URL') ?? 'http://localhost:8787').replace(/\/+$/, '');
  const siteUrl = (get(env, 'NEXT_PUBLIC_SITE_URL') ?? get(env, 'SOLVENT_SITE_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');

  return {
    argv,
    values,
    network,
    networkKey,
    rpcUrl,
    indexerUrl,
    siteUrl,
    envPath,
    env,
    json: flag(values, 'json'),
    yes: flag(values, 'yes'),
    addresses: loadAddresses(network.id, env),
  };
}

export function agentPageUrl(ctx: Ctx, agentId: number | bigint): string {
  return `${ctx.siteUrl}/agent/${agentId.toString()}`;
}

export const RPC_ENV_KEY = (chainId: number): string =>
  chainId === ARC_MAINNET_ID ? 'ARC_MAINNET_RPC_URL' : 'ARC_TESTNET_RPC_URL';
