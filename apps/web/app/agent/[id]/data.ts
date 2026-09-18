/**
 * Everything the agent routes read, loaded once per request.
 *
 * The dossier, its metadata and the certificate all want the same four reads, so
 * they go through one `cache`d loader and React collapses them into a single set
 * of fetches per render pass.
 *
 * The insolvency record lives on /api/feed rather than on the agent, so a dead
 * agent's reaper and killing transaction are looked up there. When the death is
 * older than the indexed feed window the record is absent, and this module says
 * so rather than inventing a cause — every displayed fact resolves to a hash or
 * is marked as unavailable (SPEC R7).
 */

import { cache } from 'react';
import type {
  AgentSummary,
  Bounty,
  Hex,
  IndexerMode,
  InsolvencyRecord,
  LedgerEntry,
} from '@solvent/core';
import { api } from '@/lib/api';
import '@/lib/fallback';
import { formatUsd, nowSeconds } from '@/lib/format';

/** Deep enough to cover the whole demo arena; the API clamps this to 500. */
const FEED_DEPTH = 500;

export interface DeathCertificate {
  at: number;
  finalBalance6: string;
  lifespanSeconds: number;
  earned6: string;
  burned6: string;
  net6: string;
  /** null when the reap receipt is outside the indexed feed window. */
  reaper: Hex | null;
  txHash: Hex | null;
  causeOfDeath: string | null;
}

export interface AgentDossier {
  agent: AgentSummary;
  /** Newest first, as the indexer returns it. */
  ledger: LedgerEntry[];
  bounties: Bounty[];
  death: DeathCertificate | null;
  mode: IndexerMode;
  chainId: number;
  /** One server clock for the whole page, so every derived duration agrees. */
  at: number;
}

export function parseAgentId(raw: string): number | null {
  if (!/^\d{1,9}$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  return id > 0 ? id : null;
}

function certificateFrom(
  agent: AgentSummary,
  record: InsolvencyRecord | undefined,
): DeathCertificate | null {
  if (agent.status !== 'INSOLVENT') return null;
  if (record !== undefined) {
    return {
      at: record.at,
      finalBalance6: record.finalBalance6,
      lifespanSeconds: record.lifespanSeconds,
      earned6: record.earned6,
      burned6: record.burned6,
      net6: record.net6,
      reaper: record.reaper,
      txHash: record.txHash,
      causeOfDeath: record.causeOfDeath,
    };
  }
  return {
    at: agent.diedAt ?? agent.bornAt + agent.lifespanSeconds,
    finalBalance6: agent.balance6,
    lifespanSeconds: agent.lifespanSeconds,
    earned6: agent.earned6,
    burned6: agent.burned6,
    net6: agent.net6,
    reaper: null,
    txHash: null,
    causeOfDeath: null,
  };
}

export const loadDossier = cache(async (rawId: string): Promise<AgentDossier | null> => {
  const id = parseAgentId(rawId);
  if (id === null) return null;

  const [detail, health] = await Promise.all([
    api.agent(id).catch(() => null),
    api.health().catch(() => null),
  ]);

  if (detail === null) return null;

  // The feed is a large read and only a dead agent has anything in it, so a
  // living dossier never pays for it.
  const feed =
    detail.agent.status === 'INSOLVENT' ? await api.feed(FEED_DEPTH).catch(() => null) : null;
  const record = feed?.items.find((item) => item.agentId === id);

  return {
    agent: detail.agent,
    ledger: detail.ledger,
    bounties: detail.bounties,
    death: certificateFrom(detail.agent, record),
    mode: health?.mode ?? 'demo',
    chainId: health?.chainId ?? 0,
    at: nowSeconds(),
  };
});

/* ---------------------------------------------------------------------------
   Derivations shared by the dossier and the certificate
   --------------------------------------------------------------------------- */

export interface Slice {
  label: string;
  value6: string;
}

const big = (v: string): bigint => {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
};

/** Rent, gas, services, and whatever the three of them do not account for. */
export function burnParts(agent: AgentSummary): Slice[] {
  const rent = big(agent.rentBurned6);
  const gas = big(agent.gasBurned6);
  const service = big(agent.serviceBurned6);
  const rest = big(agent.burned6) - rent - gas - service;
  return [
    { label: 'Rent', value6: rent.toString() },
    { label: 'Gas', value6: gas.toString() },
    { label: 'Services', value6: service.toString() },
    { label: 'Other', value6: (rest > 0n ? rest : 0n).toString() },
  ];
}

export function earnParts(agent: AgentSummary): Slice[] {
  const service = big(agent.serviceEarned6);
  const bounty = big(agent.bountyEarned6);
  const rest = big(agent.earned6) - service - bounty;
  return [
    { label: 'Services', value6: service.toString() },
    { label: 'Bounties', value6: bounty.toString() },
    { label: 'Other', value6: (rest > 0n ? rest : 0n).toString() },
  ];
}

/**
 * The cause of death as one plain sentence.
 *
 * "Allowance revoked" and "wallet empty" are different deaths and the page says
 * which, because on Arc a revoked allowance kills an agent that still holds
 * money — the balance is its permission to act, not only its money (SPEC 3.3).
 */
export function causeSentence(death: DeathCertificate): string {
  const left = formatUsd(big(death.finalBalance6), { precision: 6 });
  if (death.causeOfDeath === null) {
    return `Declared insolvent with ${left} left in the wallet. The reap receipt is older than the indexed window, so the cause is not on this page.`;
  }
  const cause = death.causeOfDeath.charAt(0).toUpperCase() + death.causeOfDeath.slice(1);
  return `${cause} — ${left} left in the wallet when the reaper called.`;
}

/** The headline the certificate and the dossier both put under the handle. */
export function netTitle(agent: AgentSummary): string {
  return `${agent.handle} — net ${formatUsd(big(agent.net6), { sign: true })}`;
}
