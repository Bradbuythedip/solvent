/**
 * The agent's one wallet: its money and its permission to act.
 *
 * Two rails live in this file:
 *
 *   1. The only transactions this package can sign are the five methods below.
 *      There is no generic `send()`. A compromised brain cannot invent a
 *      transfer, because no code path exists that would sign one - not even
 *      USDC.transfer, which is deliberately absent.
 *   2. Every one of those five demands a SpendIntent minted by the loop. Intents
 *      are single-use and carry the amount. A transaction the loop did not
 *      originate has no intent, and is refused before it reaches the signer.
 */

import type { Account, Chain, PublicClient, Transport, WalletClient } from 'viem';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex, NetworkInfo, Native18, Usdc6 } from '@solvent/core';
import {
  arc,
  arcTestnet,
  bountyBoardAbi,
  metabolismAbi,
  nativeToUsdc6Ceil,
  registryAbi,
  serviceMeterAbi,
  usdcAbi,
} from '@solvent/core';
import type { AgentConfig, ContractAddresses } from './config.js';

/**
 * Anything at or above this is an infinite approval by any practical reading.
 *
 * SPEC 9.2 fixes the number at 2^128 for the whole repo, and it has to be the
 * same number the CLI uses: a floor above `solvent doctor`'s threshold is a rail
 * that lets through exactly the approvals doctor just called unbounded, such as
 * Permit2's type(uint160).max. @solvent/cli's copy is in src/lib/money.ts.
 */
export const UNBOUNDED_ALLOWANCE_FLOOR_6: Usdc6 = 1n << 128n;

const SECONDS_PER_HOUR = 3600n;
/** SPEC 3.3 caps Metabolism's own runway answer; this caps the local estimate. */
const MAX_RUNWAY_SECONDS = 365 * 24 * 3600;

export type SpendKind = 'service' | 'bounty' | 'approve' | 'registry';

/** A single-use permission slip. Only the loop mints these. */
export interface SpendIntent {
  readonly id: string;
  readonly kind: SpendKind;
  readonly amount6: Usdc6;
  readonly note: string;
}

export interface TxResult {
  hash: Hex | null;
  /** Gas arrives from the receipt in native 18-decimal units; booked as USDC6. */
  gasCost6: Usdc6;
  dryRun: boolean;
}

export interface WalletSnapshot {
  address: Hex;
  agentId: number;
  alive: boolean;
  balance6: Usdc6;
  allowance6: Usdc6;
  owedRent6: Usdc6;
  rentPerHour6: Usdc6;
  /** -1 encodes an infinite runway, matching @solvent/core's wire convention. */
  runwaySeconds: number;
  unboundedAllowance: boolean;
  at: number;
}

function chainOf(network: NetworkInfo): Chain {
  return network.key === 'arc' ? arc : arcTestnet;
}

// Explicit annotations: viem's inferred client types cannot be named across a
// package boundary, and this package emits declarations.
export type ArcPublicClient = PublicClient<Transport, Chain>;
export type ArcWalletClient = WalletClient<Transport, Chain, Account>;

export class WalletError extends Error {}

let intentCounter = 0;

const DRY_RUN: TxResult = { hash: null, gasCost6: 0n, dryRun: true };

export class AgentWallet {
  readonly address: Hex;
  readonly publicClient: ArcPublicClient;
  readonly chainId: number;

  private readonly walletClient: ArcWalletClient;
  private readonly contracts: ContractAddresses;
  private readonly maxSpendPerAction6: Usdc6;
  private readonly dryRun: boolean;
  private readonly liveIntents = new Set<string>();
  private cachedAgentId: number | null;

  constructor(privateKey: Hex, config: AgentConfig) {
    const chain = chainOf(config.network);
    const account = privateKeyToAccount(privateKey);
    this.address = account.address;
    this.chainId = config.network.id;
    this.publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
    this.walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
    this.contracts = config.contracts;
    this.maxSpendPerAction6 = config.maxSpendPerAction6;
    this.dryRun = config.dryRun;
    this.cachedAgentId = config.agentId;
  }

  /* ----------------------------------------------------------------------
     Reads: the agent's own state
     ---------------------------------------------------------------------- */

  async balance6(): Promise<Usdc6> {
    return this.publicClient.readContract({
      address: this.contracts.usdc,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [this.address],
    });
  }

  async allowanceToMetabolism6(): Promise<Usdc6> {
    const metabolism = this.require('metabolism');
    return this.publicClient.readContract({
      address: this.contracts.usdc,
      abi: usdcAbi,
      functionName: 'allowance',
      args: [this.address, metabolism],
    });
  }

  async agentId(): Promise<number> {
    if (this.cachedAgentId !== null && this.cachedAgentId > 0) return this.cachedAgentId;
    const registry = this.require('registry');
    const id = await this.publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: 'agentOf',
      args: [this.address],
    });
    const asNumber = Number(id);
    if (asNumber <= 0) {
      throw new WalletError(`wallet ${this.address} is not a registered agent. Spawn it first.`);
    }
    this.cachedAgentId = asNumber;
    return asNumber;
  }

  async isAlive(agentId: number): Promise<boolean> {
    const registry = this.require('registry');
    return this.publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: 'isAlive',
      args: [BigInt(agentId)],
    });
  }

  async owedRent6(agentId: number): Promise<Usdc6> {
    const metabolism = this.require('metabolism');
    return this.publicClient.readContract({
      address: metabolism,
      abi: metabolismAbi,
      functionName: 'owed6',
      args: [BigInt(agentId)],
    });
  }

  async rentPerHour6(): Promise<Usdc6> {
    const metabolism = this.require('metabolism');
    return this.publicClient.readContract({
      address: metabolism,
      abi: metabolismAbi,
      functionName: 'rentPerHour6',
      args: [],
    });
  }

  /** Metabolism is the authority on runway; the local estimate is the fallback. */
  async runwaySeconds(agentId: number): Promise<number> {
    const snapshot = await this.snapshot(agentId);
    return snapshot.runwaySeconds;
  }

  async snapshot(agentIdHint?: number): Promise<WalletSnapshot> {
    const agentId = agentIdHint ?? (await this.agentId());
    const [balance6, allowance6, owedRent6, rentPerHour6, alive] = await Promise.all([
      this.balance6(),
      this.allowanceToMetabolism6(),
      this.owedRent6(agentId),
      this.rentPerHour6(),
      this.isAlive(agentId),
    ]);
    // Local first so a chain that cannot answer still yields a number, then the
    // contract's own answer when it is available, because it is the authority
    // that will actually decide whether this agent makes rent (SPEC 3.3).
    let runwaySeconds = localRunwaySeconds({ balance6, allowance6, owed6: owedRent6, rentPerHour6 });
    try {
      const onchain = await this.publicClient.readContract({
        address: this.require('metabolism'),
        abi: metabolismAbi,
        functionName: 'runwaySeconds',
        args: [BigInt(agentId)],
      });
      runwaySeconds = clampRunway(Number(onchain));
    } catch {
      // keep the local estimate
    }
    return {
      address: this.address,
      agentId,
      alive,
      balance6,
      allowance6,
      owedRent6,
      rentPerHour6,
      runwaySeconds,
      unboundedAllowance: allowance6 >= UNBOUNDED_ALLOWANCE_FLOOR_6,
      at: Math.floor(Date.now() / 1000),
    };
  }

  /* ----------------------------------------------------------------------
     Intents
     ---------------------------------------------------------------------- */

  /** Mint a single-use permission to spend. Called only by the loop. */
  originate(kind: SpendKind, amount6: Usdc6, note: string): SpendIntent {
    if (amount6 < 0n) throw new WalletError('an intent cannot spend a negative amount');
    if (amount6 > this.maxSpendPerAction6) {
      throw new WalletError(
        `intent of ${amount6} exceeds SOLVENT_MAX_SPEND_PER_ACTION_6 (${this.maxSpendPerAction6})`,
      );
    }
    intentCounter += 1;
    const id = `intent-${intentCounter}`;
    this.liveIntents.add(id);
    return { id, kind, amount6, note };
  }

  private consume(intent: SpendIntent, kind: SpendKind, amount6: Usdc6): void {
    if (!this.liveIntents.delete(intent.id)) {
      throw new WalletError('refusing to sign: this transaction was not originated by the loop');
    }
    if (intent.kind !== kind) {
      throw new WalletError(`intent ${intent.id} is for ${intent.kind}, not ${kind}`);
    }
    if (intent.amount6 !== amount6) {
      throw new WalletError(`intent ${intent.id} authorised ${intent.amount6}, call spends ${amount6}`);
    }
    if (amount6 > this.maxSpendPerAction6) {
      throw new WalletError(`spend ${amount6} exceeds the per-action cap ${this.maxSpendPerAction6}`);
    }
  }

  /* ----------------------------------------------------------------------
     Writes: the entire set of transactions this agent can sign
     ---------------------------------------------------------------------- */

  /** x402 settlement, agent to agent. Books BURN/SERVICE and EARN/SERVICE. */
  async payForService(
    intent: SpendIntent,
    payerAgentId: number,
    providerAgentId: number,
    amount6: Usdc6,
    requestHash: Hex,
  ): Promise<TxResult> {
    this.consume(intent, 'service', amount6);
    const serviceMeter = this.require('serviceMeter');
    if (this.dryRun) return DRY_RUN;
    const hash = await this.walletClient.writeContract({
      address: serviceMeter,
      abi: serviceMeterAbi,
      functionName: 'payForService',
      args: [BigInt(payerAgentId), BigInt(providerAgentId), amount6, requestHash],
    });
    return this.settle(hash);
  }

  /** Submitting work to a bounty. Costs gas only; the reward flows the other way. */
  async submitBounty(
    intent: SpendIntent,
    bountyId: number,
    agentId: number,
    deliverableHash: Hex,
    deliverableURI: string,
  ): Promise<TxResult> {
    this.consume(intent, 'bounty', 0n);
    const bountyBoard = this.require('bountyBoard');
    if (this.dryRun) return DRY_RUN;
    const hash = await this.walletClient.writeContract({
      address: bountyBoard,
      abi: bountyBoardAbi,
      functionName: 'submit',
      args: [BigInt(bountyId), BigInt(agentId), deliverableHash, deliverableURI],
    });
    return this.settle(hash);
  }

  async setEndpoint(intent: SpendIntent, agentId: number, endpoint: string): Promise<TxResult> {
    this.consume(intent, 'registry', 0n);
    const registry = this.require('registry');
    if (this.dryRun) return DRY_RUN;
    const hash = await this.walletClient.writeContract({
      address: registry,
      abi: registryAbi,
      functionName: 'setEndpoint',
      args: [BigInt(agentId), endpoint],
    });
    return this.settle(hash);
  }

  /** The honest exit: leave while still solvent. */
  async retire(intent: SpendIntent, agentId: number): Promise<TxResult> {
    this.consume(intent, 'registry', 0n);
    const registry = this.require('registry');
    if (this.dryRun) return DRY_RUN;
    const hash = await this.walletClient.writeContract({
      address: registry,
      abi: registryAbi,
      functionName: 'retire',
      args: [BigInt(agentId)],
    });
    return this.settle(hash);
  }

  /**
   * Re-approving Metabolism. Capped: this package will not sign an unbounded
   * approval, so a running agent can never widen its own exposure past the cap
   * the operator chose.
   */
  async approveMetabolism(intent: SpendIntent, amount6: Usdc6, cap6: Usdc6): Promise<TxResult> {
    this.consume(intent, 'approve', 0n);
    if (amount6 > cap6 || amount6 >= UNBOUNDED_ALLOWANCE_FLOOR_6) {
      throw new WalletError(`refusing to approve ${amount6}: above the configured cap ${cap6}`);
    }
    const metabolism = this.require('metabolism');
    if (this.dryRun) return DRY_RUN;
    const hash = await this.walletClient.writeContract({
      address: this.contracts.usdc,
      abi: usdcAbi,
      functionName: 'approve',
      args: [metabolism, amount6],
    });
    return this.settle(hash);
  }

  private async settle(hash: Hex): Promise<TxResult> {
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    // Gas arrives in native 18-decimal units. It becomes P&L only after this.
    const gasCost18: Native18 = receipt.gasUsed * receipt.effectiveGasPrice;
    return { hash, gasCost6: nativeToUsdc6Ceil(gasCost18), dryRun: false };
  }

  private require(name: keyof Omit<ContractAddresses, 'usdc'>): Hex {
    const address = this.contracts[name];
    if (!address) {
      throw new WalletError(
        `no ${name} address configured. Set SOLVENT_${envSuffix(name)}_ADDRESS or pass --${flagOf(name)}.`,
      );
    }
    return address;
  }
}

function envSuffix(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

function flagOf(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function clampRunway(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  return Math.min(Math.floor(seconds), MAX_RUNWAY_SECONDS);
}

export interface RunwayInputs {
  balance6: Usdc6;
  allowance6: Usdc6;
  owed6: Usdc6;
  rentPerHour6: Usdc6;
}

/** Pure, so the heuristic brain and the tests can use it without a chain. */
export function localRunwaySeconds({ balance6, allowance6, owed6, rentPerHour6 }: RunwayInputs): number {
  if (rentPerHour6 <= 0n) return -1; // no burn rate: infinite, per core's wire encoding
  const payable6 = balance6 < allowance6 ? balance6 : allowance6;
  if (payable6 <= owed6) return 0;
  const seconds = ((payable6 - owed6) * SECONDS_PER_HOUR) / rentPerHour6;
  return clampRunway(Number(seconds));
}
