import { arc, arcTestnet } from 'viem/chains';
import type { Hex } from './types.js';

export { arc, arcTestnet };

/** The USDC ERC-20 precompile. Same address on Arc mainnet and testnet. */
export const USDC_ADDRESS: Hex = '0x3600000000000000000000000000000000000000';

export const ARC_MAINNET_ID = 5042;
export const ARC_TESTNET_ID = 5042002;

export interface NetworkInfo {
  id: number;
  key: 'arc' | 'arcTestnet';
  name: string;
  rpcUrl: string;
  explorer: string;
  faucet: string | null;
}

export const NETWORKS: Record<'arc' | 'arcTestnet', NetworkInfo> = {
  arc: {
    id: ARC_MAINNET_ID,
    key: 'arc',
    name: 'Arc',
    rpcUrl: 'https://rpc.mainnet.arc.io',
    explorer: 'https://explorer.arc.io',
    faucet: null,
  },
  arcTestnet: {
    id: ARC_TESTNET_ID,
    key: 'arcTestnet',
    name: 'Arc Testnet',
    rpcUrl: 'https://rpc.testnet.arc.network',
    explorer: 'https://explorer.testnet.arc.io',
    faucet: 'https://faucet.circle.com',
  },
};

export function networkById(id: number): NetworkInfo | null {
  return Object.values(NETWORKS).find((n) => n.id === id) ?? null;
}

export function txUrl(chainId: number, hash: string): string {
  const n = networkById(chainId);
  return n ? `${n.explorer}/tx/${hash}` : `#${hash}`;
}

export function addressUrl(chainId: number, address: string): string {
  const n = networkById(chainId);
  return n ? `${n.explorer}/address/${address}` : `#${address}`;
}

export interface Deployment {
  chainId: number;
  block: number;
  ledger: Hex;
  registry: Hex;
  metabolism: Hex;
  serviceMeter: Hex;
  bountyBoard: Hex;
  treasury: Hex;
}

/** Circle's keyless x402 service catalogue. No API key, no account. */
export const X402_DISCOVERY_URL = 'https://api.circle.com/v2/x402/discovery/resources';

/** Economic parameters, mirrored from SolventRegistry / Metabolism. */
export const ENTRY_FEE_6 = 10_000_000n; // $10.00
export const LISTING_CUT_6 = 1_000_000n; // $1.00 -> bounty pool
export const ENTRY_SEED_6 = 9_000_000n; // $9.00 -> the agent's wallet
export const DEFAULT_RENT_PER_HOUR_6 = 10_000n; // $0.01 / hour
