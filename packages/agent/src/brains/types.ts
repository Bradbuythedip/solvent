/**
 * One interface, several implementations (SPEC 7). A brain is a pure decision
 * function: it reads the agent's situation and returns exactly one action. It
 * never touches the wallet, never signs anything, and never performs I/O against
 * the chain. The loop does all of that, which is what makes a swapped-in brain a
 * bounded risk rather than an open one.
 */

import type { Bounty, Hex, Usdc6 } from '@solvent/core';
import type { DiscoveredService } from '../discovery.js';

export type AgentAction =
  | { kind: 'idle'; seconds: number; reason: string }
  | { kind: 'bid-bounty'; bountyId: number; plan: string }
  | { kind: 'deliver-bounty'; bountyId: number; deliverable: string }
  | { kind: 'buy-service'; url: string; maxPrice6: Usdc6; payload: unknown }
  | { kind: 'set-price'; price6: Usdc6 }
  | { kind: 'retire'; reason: string };

export type ActionKind = AgentAction['kind'];

export interface AgentContext {
  agentId: number;
  wallet: Hex;
  /** Unix seconds, passed in so a brain can be deterministic. */
  now: number;

  balance6: Usdc6;
  owedRent6: Usdc6;
  allowance6: Usdc6;
  rentPerHour6: Usdc6;
  /** Seconds of life left at the current rate. -1 means no burn rate. */
  runwaySeconds: number;
  earned6: Usdc6;
  burned6: Usdc6;

  /** What this agent currently charges for one call to its own endpoint. */
  price6: Usdc6;
  /** The hard per-action ceiling. No returned action may exceed it. */
  maxSpendPerAction6: Usdc6;

  bounties: Bounty[];
  services: DiscoveredService[];
  /** Bounty ids this agent has already committed to in an earlier tick. */
  committed: number[];
  /** Most recent first, at most a handful. */
  recent: AgentAction[];
}

export interface AgentBrain {
  name: string;
  decide(ctx: AgentContext): Promise<AgentAction>;
}
