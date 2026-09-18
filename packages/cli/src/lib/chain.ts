/**
 * Arc access: clients, reads, and the four writes this CLI can make.
 *
 * Every write is simulated first, so a revert surfaces as a sentence before any
 * dollars move. Gas comes back from the receipt in native 18-decimal units and
 * is converted once, here, before it is ever shown as money (SPEC.md 1.1 R3).
 */

import { createPublicClient, createWalletClient, http, parseEventLogs } from 'viem';
import type { Chain, Hash, PublicClient, TransactionReceipt, Transport, WalletClient } from 'viem';
import type { PrivateKeyAccount } from 'viem';
import {
  arc,
  arcTestnet,
  metabolismAbi,
  nativeToUsdc6,
  registryAbi,
  STATUS_NAMES,
  usdcAbi,
  USDC_ADDRESS,
} from '@solvent/core';
import type { Hex, Native18, Usdc6 } from '@solvent/core';
import type { Ctx, NetworkKey } from './config.js';
import { CliError, briefly } from './errors.js';

export function chainFor(key: NetworkKey): Chain {
  return key === 'arc' ? arc : arcTestnet;
}

export type Pub = PublicClient<Transport, Chain>;
export type Wallet = WalletClient<Transport, Chain, PrivateKeyAccount>;

export function publicClientFor(ctx: Ctx): Pub {
  return createPublicClient({
    chain: chainFor(ctx.networkKey),
    transport: http(ctx.rpcUrl, { timeout: 20_000, retryCount: 2 }),
  });
}

export function walletClientFor(ctx: Ctx, account: PrivateKeyAccount): Wallet {
  return createWalletClient({
    account,
    chain: chainFor(ctx.networkKey),
    transport: http(ctx.rpcUrl, { timeout: 20_000, retryCount: 2 }),
  });
}

export type AgentRecordStatus = (typeof STATUS_NAMES)[number];

export interface AgentRecord {
  id: bigint;
  wallet: Hex;
  operator: Hex;
  bornAt: number;
  diedAt: number | null;
  status: AgentRecordStatus;
  modelTag: Hex;
  handle: string;
  endpoint: string;
  manifestHash: Hex;
}

export interface TxResult {
  hash: Hash;
  receipt: TransactionReceipt;
  /** Gas for this transaction, converted out of native 18-decimal units. */
  gas6: Usdc6;
}

function gasOf(receipt: TransactionReceipt): Usdc6 {
  const spent18: Native18 = receipt.gasUsed * receipt.effectiveGasPrice;
  return nativeToUsdc6(spent18);
}

// --- reads ------------------------------------------------------------------

export async function usdcBalance6(pub: Pub, address: Hex): Promise<Usdc6> {
  return pub.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'balanceOf', args: [address] });
}

export async function usdcAllowance6(pub: Pub, owner: Hex, spender: Hex): Promise<Usdc6> {
  return pub.readContract({ address: USDC_ADDRESS, abi: usdcAbi, functionName: 'allowance', args: [owner, spender] });
}

export async function readAgent(pub: Pub, registry: Hex, agentId: bigint): Promise<AgentRecord> {
  const row = await pub.readContract({ address: registry, abi: registryAbi, functionName: 'agents', args: [agentId] });
  const [wallet, operator, bornAt, diedAt, status, modelTag, handle, endpoint, manifestHash] = row;
  return {
    id: agentId,
    wallet,
    operator,
    bornAt: Number(bornAt),
    diedAt: diedAt === 0n ? null : Number(diedAt),
    status: STATUS_NAMES[status] ?? 'NONE',
    modelTag,
    handle,
    endpoint,
    manifestHash,
  };
}

export async function agentIdOf(pub: Pub, registry: Hex, wallet: Hex): Promise<bigint> {
  return pub.readContract({ address: registry, abi: registryAbi, functionName: 'agentOf', args: [wallet] });
}

export async function owed6(pub: Pub, metabolism: Hex, agentId: bigint): Promise<Usdc6> {
  return pub.readContract({ address: metabolism, abi: metabolismAbi, functionName: 'owed6', args: [agentId] });
}

export async function rentPerHour6(pub: Pub, metabolism: Hex): Promise<Usdc6> {
  return pub.readContract({ address: metabolism, abi: metabolismAbi, functionName: 'rentPerHour6' });
}

export async function runwaySeconds(pub: Pub, metabolism: Hex, agentId: bigint): Promise<bigint> {
  return pub.readContract({ address: metabolism, abi: metabolismAbi, functionName: 'runwaySeconds', args: [agentId] });
}

/** Local runway, for when Metabolism is unreachable or the agent is not enrolled. */
export function estimateRunwaySeconds(balance6: Usdc6, allowance6: Usdc6, ratePerHour6: Usdc6): number | null {
  if (ratePerHour6 <= 0n) return -1; // -1 encodes an infinite runway over the wire
  const payable = balance6 < allowance6 ? balance6 : allowance6;
  if (payable <= 0n) return 0;
  return Number((payable * 3600n) / ratePerHour6);
}

export async function hasCode(pub: Pub, address: Hex): Promise<boolean> {
  const code = await pub.getCode({ address });
  return code !== undefined && code !== '0x';
}

// --- writes -----------------------------------------------------------------

async function settle(pub: Pub, hash: Hash): Promise<TxResult> {
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== 'success') {
    throw new CliError(`transaction ${hash} reverted`, 'Check the explorer link above; nothing was recorded onchain.');
  }
  return { hash, receipt, gas6: gasOf(receipt) };
}

export async function approveUsdc(pub: Pub, wallet: Wallet, spender: Hex, amount6: Usdc6): Promise<TxResult> {
  try {
    const { request } = await pub.simulateContract({
      account: wallet.account,
      address: USDC_ADDRESS,
      abi: usdcAbi,
      functionName: 'approve',
      args: [spender, amount6],
    });
    return await settle(pub, await wallet.writeContract(request));
  } catch (e) {
    throw new CliError(`approve failed: ${briefly(e)}`, 'The wallet needs USDC for gas as well as for the allowance.');
  }
}

export interface SpawnArgs {
  registry: Hex;
  wallet: Hex;
  modelTag: Hex;
  handle: string;
  endpoint: string;
  manifestHash: Hex;
}

export interface SpawnResult extends TxResult {
  agentId: bigint;
}

export async function spawnAgent(pub: Pub, wallet: Wallet, args: SpawnArgs): Promise<SpawnResult> {
  const { request, result } = await pub.simulateContract({
    account: wallet.account,
    address: args.registry,
    abi: registryAbi,
    functionName: 'spawn',
    args: [args.wallet, args.modelTag, args.handle, args.endpoint, args.manifestHash],
  });
  const tx = await settle(pub, await wallet.writeContract(request));

  // Prefer the event: the simulated return value is from a pre-state call.
  const logs = parseEventLogs({ abi: registryAbi, eventName: 'Spawned', logs: tx.receipt.logs });
  const first = logs[0];
  return { ...tx, agentId: first?.args.agentId ?? result };
}

export interface ReapResult extends TxResult {
  deaths: number;
  reaped: Array<{ agentId: bigint; died: boolean; due6: Usdc6; collected6: Usdc6; balance6: Usdc6 }>;
}

export async function reapAgents(pub: Pub, wallet: Wallet, metabolism: Hex, agentIds: bigint[]): Promise<ReapResult> {
  const single = agentIds.length === 1 ? agentIds[0] : undefined;
  const hash =
    single !== undefined
      ? await wallet.writeContract(
          (
            await pub.simulateContract({
              account: wallet.account,
              address: metabolism,
              abi: metabolismAbi,
              functionName: 'reap',
              args: [single],
            })
          ).request,
        )
      : await wallet.writeContract(
          (
            await pub.simulateContract({
              account: wallet.account,
              address: metabolism,
              abi: metabolismAbi,
              functionName: 'reapMany',
              args: [agentIds],
            })
          ).request,
        );

  const tx = await settle(pub, hash);
  const logs = parseEventLogs({ abi: metabolismAbi, eventName: 'Reaped', logs: tx.receipt.logs });
  const reaped = logs.map((log) => ({
    agentId: log.args.agentId,
    died: log.args.died,
    due6: log.args.due6,
    collected6: log.args.collected6,
    balance6: log.args.balance6,
  }));
  return { ...tx, reaped, deaths: reaped.filter((r) => r.died).length };
}

export interface RetireResult extends TxResult {
  finalBalance6: Usdc6 | null;
}

export async function retireAgent(pub: Pub, wallet: Wallet, registry: Hex, agentId: bigint): Promise<RetireResult> {
  const { request } = await pub.simulateContract({
    account: wallet.account,
    address: registry,
    abi: registryAbi,
    functionName: 'retire',
    args: [agentId],
  });
  const tx = await settle(pub, await wallet.writeContract(request));
  const logs = parseEventLogs({ abi: registryAbi, eventName: 'Retired', logs: tx.receipt.logs });
  const first = logs[0];
  return { ...tx, finalBalance6: first?.args.finalBalance6 ?? null };
}

// --- waiting ----------------------------------------------------------------

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface WaitForBalanceOptions {
  target6: Usdc6;
  timeoutMs: number;
  intervalMs: number;
  onPoll?: (balance6: Usdc6, elapsedMs: number) => void;
}

/** Polls USDC.balanceOf until it reaches the target, or gives up with a reason. */
export async function waitForBalance(pub: Pub, address: Hex, opts: WaitForBalanceOptions): Promise<Usdc6> {
  const started = Date.now();
  for (;;) {
    const balance = await usdcBalance6(pub, address);
    const elapsed = Date.now() - started;
    opts.onPoll?.(balance, elapsed);
    if (balance >= opts.target6) return balance;
    if (elapsed >= opts.timeoutMs) {
      throw new CliError(
        `timed out waiting for USDC at ${address}`,
        'Send the funds and re-run: the CLI picks up where it left off. "solvent fund" waits on its own.',
      );
    }
    await sleep(opts.intervalMs);
  }
}
