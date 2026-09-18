/**
 * Server-side derivations for the front door.
 *
 * Plain functions, no React: page.tsx runs them during the server render and the
 * results cross to the client as ordinary JSON. Nothing here fetches.
 */

import type { AgentSummary, LedgerEntry, SolvencyState, SparkPoint } from '@solvent/core';
import { solvencyOf } from '@/lib/format';

/**
 * What the arena canvas needs per agent, and nothing more. An AgentSummary
 * carries up to 64 sparkline points; multiplied by every living agent that is a
 * megabyte of payload for a dot on a canvas.
 */
export interface Orbit {
  id: number;
  handle: string;
  modelTag: string;
  state: SolvencyState;
  balance6: string;
  net6: string;
}

export function toOrbit(a: AgentSummary): Orbit {
  return {
    id: a.id,
    handle: a.handle,
    modelTag: a.modelTag,
    state: solvencyOf(a),
    balance6: a.balance6,
    net6: a.net6,
  };
}

const MIN_WINDOW_SECONDS = 15 * 60;
const MAX_WINDOW_SECONDS = 24 * 3600;

/**
 * A cumulative curve that ends exactly on the number the tile shows.
 *
 * The indexer reports arena totals but not their history, so the curve is walked
 * backwards from the live total: each earlier point is the total minus everything
 * booked after it. The right edge is therefore exact, and the left edge is only as
 * old as the tape we were handed.
 */
export function cumulativeBack(
  entries: readonly LedgerEntry[],
  total6: bigint,
  keep: (entry: LedgerEntry) => boolean,
  now: number,
  points = 12,
): SparkPoint[] {
  const count = Math.max(2, Math.floor(points));

  let oldest = now;
  for (const entry of entries) if (entry.at < oldest) oldest = entry.at;
  const span = Math.min(MAX_WINDOW_SECONDS, Math.max(MIN_WINDOW_SECONDS, now - oldest));
  const step = span / (count - 1);

  const relevant = entries.filter(keep).slice().sort((a, b) => b.at - a.at);

  const out: SparkPoint[] = [];
  let running = total6;
  let cursor = 0;

  for (let i = count - 1; i >= 0; i--) {
    const t = Math.round(now - step * (count - 1 - i));
    while (cursor < relevant.length) {
      const entry = relevant[cursor];
      if (entry === undefined || entry.at <= t) break;
      running -= BigInt(entry.amount6);
      cursor += 1;
    }
    if (running < 0n) running = 0n;
    const value = running.toString();
    out.push({ t, balance6: value, net6: value });
  }

  return out.reverse();
}
