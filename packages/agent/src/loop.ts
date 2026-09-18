/**
 * The metabolism loop (SPEC 7):
 *
 *   1. read own balance and owed rent          -> know your runway
 *   2. discover priced services (x402)         -> know what can be bought
 *   3. decide: bounty, service, or idle        -> the brain, and only the brain
 *   4. act, at a price known in advance        -> capped, originated, signed here
 *   5. settle onchain                          -> both sides land in the Ledger
 *   6. repeat until reaped
 *
 * Everything that can spend money lives in this file and in wallet.ts. A brain
 * returns an action; nothing it returns can move more than
 * SOLVENT_MAX_SPEND_PER_ACTION_6, and nothing it returns can move money at all
 * except through the five calls the wallet is willing to sign.
 */

import { setTimeout as delay } from 'node:timers/promises';
import { keccak256, stringToHex } from 'viem';
import type { Bounty, Hex, Usdc6 } from '@solvent/core';
import { formatDuration, formatUsd, formatRunway } from '@solvent/core';
import type { AgentConfig } from './config.js';
import type { AgentWallet, WalletSnapshot } from './wallet.js';
import type { Logger } from './log.js';
import type { ServiceDiscovery } from './discovery.js';
import type { IndexerClient } from './indexer.js';
import type { X402Client } from './x402/client.js';
import type { AgentAction, AgentBrain, AgentContext } from './brains/types.js';

/** Longest string the loop will put onchain as a deliverable URI. */
const MAX_DELIVERABLE_URI = 512;
const MAX_RECENT = 8;

export class LoopError extends Error {}

/** One mutable number shared by the loop and the HTTP server: what we charge. */
export class PriceBook {
  private price6: Usdc6;

  constructor(initial: Usdc6) {
    this.price6 = initial;
  }

  get(): Usdc6 {
    return this.price6;
  }

  set(next: Usdc6): void {
    this.price6 = next < 0n ? 0n : next;
  }
}

export interface LoopDeps {
  config: AgentConfig;
  wallet: AgentWallet;
  brain: AgentBrain;
  discovery: ServiceDiscovery;
  indexer: IndexerClient;
  x402: X402Client;
  price: PriceBook;
  logger: Logger;
}

export interface LoopState {
  agentId: number;
  committed: number[];
  recent: AgentAction[];
  spent6: Usdc6;
  gasBurned6: Usdc6;
  ticks: number;
}

export function initialState(agentId: number): LoopState {
  return { agentId, committed: [], recent: [], spent6: 0n, gasBurned6: 0n, ticks: 0 };
}

export interface ActionOutcome {
  note: string;
  spent6: Usdc6;
  gasCost6: Usdc6;
  txHash: Hex | null;
  sleepSeconds: number;
  stop: boolean;
}

export interface TickResult {
  snapshot: WalletSnapshot;
  action: AgentAction | null;
  outcome: ActionOutcome | null;
  stop: boolean;
  reason: string | null;
}

export interface PreflightReport {
  snapshot: WalletSnapshot;
  warnings: string[];
}

/**
 * Refuses to start on an unbounded allowance. An unbounded approval to
 * Metabolism means the contract may take the entire balance, forever, without a
 * further decision by anyone. That may be exactly what an operator wants, but it
 * has to be said out loud.
 */
export async function preflight(deps: LoopDeps): Promise<PreflightReport> {
  const { wallet, config, logger } = deps;
  const agentId = await wallet.agentId();
  const snapshot = await wallet.snapshot(agentId);
  const warnings: string[] = [];

  if (!snapshot.alive) {
    throw new LoopError(`agent ${agentId} is not ALIVE. Death is permanent (SPEC R6).`);
  }

  if (snapshot.unboundedAllowance && !config.yesIKnow) {
    throw new LoopError(
      [
        'refusing to start: this wallet has granted Metabolism an unbounded USDC allowance.',
        `Approve a bounded cap instead (SOLVENT_ALLOWANCE_CAP_6=${config.allowanceCap6}),`,
        'or pass --yes-i-know if an unbounded allowance is genuinely what you intended.',
      ].join('\n'),
    );
  }
  if (snapshot.unboundedAllowance) {
    warnings.push('running with an unbounded allowance to Metabolism because --yes-i-know was passed');
  }
  if (snapshot.allowance6 === 0n) {
    warnings.push('allowance to Metabolism is zero: the next reap kills this agent (SPEC 3.3)');
  } else if (snapshot.allowance6 > config.allowanceCap6 && !snapshot.unboundedAllowance) {
    warnings.push(`allowance ${formatUsd(snapshot.allowance6)} exceeds the configured cap`);
  }
  if (snapshot.balance6 <= snapshot.owedRent6) {
    warnings.push('balance no longer covers the rent already owed');
  }
  if (config.dryRun) warnings.push('dry run: no transaction will be signed');

  for (const warning of warnings) logger.warn(warning);
  return { snapshot, warnings };
}

async function buildContext(deps: LoopDeps, state: LoopState, snapshot: WalletSnapshot): Promise<AgentContext> {
  const [bounties, discovered, summary] = await Promise.all([
    deps.indexer.openBounties(),
    deps.discovery.refresh(snapshot.at),
    deps.indexer.agent(state.agentId),
  ]);

  if (!discovered.ok && discovered.note !== null) deps.logger.debug(discovered.note);

  return {
    agentId: state.agentId,
    wallet: snapshot.address,
    now: snapshot.at,
    balance6: snapshot.balance6,
    owedRent6: snapshot.owedRent6,
    allowance6: snapshot.allowance6,
    rentPerHour6: snapshot.rentPerHour6,
    runwaySeconds: snapshot.runwaySeconds,
    earned6: summary === null ? 0n : BigInt(summary.earned6),
    burned6: summary === null ? 0n : BigInt(summary.burned6),
    price6: deps.price.get(),
    maxSpendPerAction6: deps.config.maxSpendPerAction6,
    bounties,
    services: discovered.services,
    committed: [...state.committed],
    recent: [...state.recent],
  };
}

function deliverableUri(text: string): string {
  const uri = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  return uri.length <= MAX_DELIVERABLE_URI ? uri : uri.slice(0, MAX_DELIVERABLE_URI);
}

function bountyById(bounties: Bounty[], id: number): Bounty | null {
  return bounties.find((b) => b.id === id) ?? null;
}

export async function execute(
  deps: LoopDeps,
  state: LoopState,
  ctx: AgentContext,
  action: AgentAction,
): Promise<ActionOutcome> {
  const idle = deps.config.intervalSeconds;
  const base: ActionOutcome = { note: '', spent6: 0n, gasCost6: 0n, txHash: null, sleepSeconds: idle, stop: false };

  switch (action.kind) {
    case 'idle':
      return { ...base, note: action.reason, sleepSeconds: Math.max(1, Math.floor(action.seconds)) };

    case 'set-price': {
      deps.price.set(action.price6);
      return { ...base, note: `price is now ${formatUsd(action.price6)} per request` };
    }

    case 'bid-bounty': {
      // A bid is a local commitment. Nothing is signed and nothing is spent
      // until there is something to submit.
      if (bountyById(ctx.bounties, action.bountyId) === null) {
        return { ...base, note: `bounty ${action.bountyId} is not on the board` };
      }
      if (!state.committed.includes(action.bountyId)) state.committed.push(action.bountyId);
      return { ...base, note: `committed to bounty ${action.bountyId}: ${action.plan}`, sleepSeconds: 1 };
    }

    case 'deliver-bounty': {
      const bounty = bountyById(ctx.bounties, action.bountyId);
      if (bounty === null) {
        state.committed = state.committed.filter((id) => id !== action.bountyId);
        return { ...base, note: `bounty ${action.bountyId} is gone` };
      }
      const hash = keccak256(stringToHex(action.deliverable));
      const intent = deps.wallet.originate('bounty', 0n, `submit bounty ${action.bountyId}`);
      const tx = await deps.wallet.submitBounty(
        intent,
        action.bountyId,
        state.agentId,
        hash,
        deliverableUri(action.deliverable),
      );
      state.committed = state.committed.filter((id) => id !== action.bountyId);
      return {
        ...base,
        note: `submitted bounty ${action.bountyId} for ${formatUsd(BigInt(bounty.reward6))}`,
        gasCost6: tx.gasCost6,
        txHash: tx.hash,
      };
    }

    case 'buy-service': {
      const cap6 =
        action.maxPrice6 < deps.config.maxSpendPerAction6 ? action.maxPrice6 : deps.config.maxSpendPerAction6;
      const result = await deps.x402.get(action.url, { maxPrice6: cap6, payload: action.payload });
      return {
        ...base,
        note: result.ok
          ? `bought ${result.url} for ${formatUsd(result.paid6)}`
          : `did not buy ${result.url}: ${result.reason ?? 'unknown reason'}`,
        spent6: result.paid6,
        txHash: result.txHash,
      };
    }

    case 'retire': {
      const intent = deps.wallet.originate('registry', 0n, 'retire');
      const tx = await deps.wallet.retire(intent, state.agentId);
      return {
        ...base,
        note: `retired: ${action.reason}`,
        gasCost6: tx.gasCost6,
        txHash: tx.hash,
        stop: true,
      };
    }
  }
}

export async function tick(deps: LoopDeps, state: LoopState): Promise<TickResult> {
  const snapshot = await deps.wallet.snapshot(state.agentId);
  state.ticks += 1;

  deps.logger.info('tick', {
    balance: formatUsd(snapshot.balance6),
    rentOwed: formatUsd(snapshot.owedRent6),
    runway: formatRunway(snapshot.runwaySeconds),
  });

  if (!snapshot.alive) {
    return { snapshot, action: null, outcome: null, stop: true, reason: 'reaped: this agent is insolvent' };
  }

  const ctx = await buildContext(deps, state, snapshot);

  let action: AgentAction;
  try {
    action = await deps.brain.decide(ctx);
  } catch (error) {
    // A brain that throws must not stop the metabolism. Idle and try again.
    deps.logger.error('brain failed', { error });
    return {
      snapshot,
      action: null,
      outcome: null,
      stop: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  let outcome: ActionOutcome;
  try {
    outcome = await execute(deps, state, ctx, action);
  } catch (error) {
    deps.logger.error('action failed', { kind: action.kind, error });
    return {
      snapshot,
      action,
      outcome: null,
      stop: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  state.spent6 += outcome.spent6;
  state.gasBurned6 += outcome.gasCost6;
  state.recent = [action, ...state.recent].slice(0, MAX_RECENT);

  deps.logger.info(action.kind, {
    note: outcome.note,
    ...(outcome.txHash !== null ? { tx: outcome.txHash } : {}),
    ...(outcome.gasCost6 > 0n ? { gas: formatUsd(outcome.gasCost6) } : {}),
  });

  return { snapshot, action, outcome, stop: outcome.stop, reason: null };
}

export interface RunOptions {
  signal?: AbortSignal;
  /** One tick and stop. Useful for a cron-shaped agent, and for tests. */
  once?: boolean;
}

export async function runLoop(deps: LoopDeps, options: RunOptions = {}): Promise<LoopState> {
  const report = await preflight(deps);
  const state = initialState(report.snapshot.agentId);

  deps.logger.info('alive', {
    agentId: state.agentId,
    wallet: report.snapshot.address,
    brain: deps.brain.name,
    balance: formatUsd(report.snapshot.balance6),
    runway: formatRunway(report.snapshot.runwaySeconds),
    maxSpendPerAction: formatUsd(deps.config.maxSpendPerAction6),
  });

  for (;;) {
    if (options.signal?.aborted === true) break;

    const result = await tick(deps, state);
    if (result.stop) {
      deps.logger.warn('loop stopping', { reason: result.reason ?? result.outcome?.note ?? 'done' });
      break;
    }
    if (options.once === true) break;

    const seconds = result.outcome?.sleepSeconds ?? deps.config.intervalSeconds;
    deps.logger.debug('sleeping', { for: formatDuration(seconds) });
    try {
      await delay(seconds * 1000, undefined, { signal: options.signal });
    } catch {
      break; // aborted
    }
  }

  return state;
}
