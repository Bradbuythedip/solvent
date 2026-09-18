/**
 * The demo fallback — what keeps the site alive with no services running.
 *
 * lib/api.ts reaches for the indexer first and only calls in here when that fetch
 * fails. The numbers then come from the same deterministic simulator the indexer
 * itself runs in demo mode, so both surfaces describe the same arena, and
 * health() reports mode "demo" — which is what puts the DEMO marker on screen.
 * Simulated dollars are never presented as real (SPEC 5.2).
 *
 * Side-effect module: importing it registers the adapter. Import it once from any
 * server component that calls api.*.
 */

import { createArena, DEFAULT_SEED } from '@solvent/core/sim';
import type { Arena } from '@solvent/core/sim';
import { ARC_MAINNET_ID, ARC_TESTNET_ID } from '@solvent/core';
import { registerFallback } from '@/lib/api';
import type { AgentQuery, Fallback } from '@/lib/api';

function envInt(name: string, fallbackValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallbackValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

const SEED = envInt('SOLVENT_DEMO_SEED', DEFAULT_SEED);
const AGENT_COUNT = envInt('SOLVENT_DEMO_AGENTS', 60);
const CHAIN_ID =
  (process.env['SOLVENT_CHAIN'] ?? process.env['NEXT_PUBLIC_SOLVENT_CHAIN']) === 'arc'
    ? ARC_MAINNET_ID
    : ARC_TESTNET_ID;

interface Holder {
  arena: Arena;
  syncedAt: number;
}

/**
 * Held on globalThis so a dev-server module reload does not rebuild 45 days of
 * history, and so the arena keeps moving forward across requests instead of
 * snapping back to its construction time on every render.
 */
const holder = globalThis as typeof globalThis & { __solventDemoArena?: Holder };

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function arena(): Arena {
  const existing = holder.__solventDemoArena;
  if (existing === undefined) {
    const fresh: Holder = {
      arena: createArena({ seed: SEED, agents: AGENT_COUNT, now: now(), chainId: CHAIN_ID }),
      syncedAt: now(),
    };
    holder.__solventDemoArena = fresh;
    return fresh.arena;
  }
  const elapsed = now() - existing.syncedAt;
  if (elapsed > 0) {
    existing.syncedAt += elapsed;
    existing.arena.advance(elapsed);
  }
  return existing.arena;
}

const adapter: Fallback = {
  health: () => arena().health(),
  stats: () => arena().stats(),
  agents: (q: AgentQuery) => arena().agents(q),
  agent: (id: number) => arena().agent(id),
  sparkline: (id: number) => arena().sparkline(id),
  feed: (limit: number) => arena().feed(limit),
  ledger: (limit: number) => arena().ledger(limit),
  bounties: () => arena().bounties(),
};

registerFallback(adapter);

export { adapter as demoFallback };
