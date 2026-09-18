'use client';

/**
 * The two numbers on this page that move on their own: how long the agent has
 * been alive, and how long the arithmetic says it has left.
 *
 * Both tick off the shared clock in lib/hooks, which stops under
 * prefers-reduced-motion and in a hidden tab. Nothing here depends on the motion
 * to be readable — the server already rendered the value the indexer reported,
 * and the tick only keeps it honest.
 */

import type { SolvencyState } from '@solvent/core';
import { STATE_INK } from '@/components/ui/primitives';
import { formatDuration, formatUsd } from '@/lib/format';
import { useCountdown, useElapsed } from '@/lib/hooks';

export function LiveLifespan({
  bornAt,
  lifespanSeconds,
}: {
  bornAt: number;
  lifespanSeconds: number;
}) {
  const elapsed = useElapsed(bornAt, lifespanSeconds);
  return <span className="tnum">{formatDuration(elapsed)}</span>;
}

/**
 * The emotional payload of the dossier: the moment the balance reaches zero at
 * the burn rate the agent is running right now. It is labelled as a projection
 * everywhere it appears, because it is arithmetic and not a schedule — one
 * bounty moves it by days.
 */
export function ProjectedInsolvency({
  runwaySeconds,
  deathAt,
  burnRatePerHour6,
  state,
}: {
  /** -1 is the wire encoding for "no burn rate". */
  runwaySeconds: number;
  deathAt: number;
  burnRatePerHour6: string;
  state: SolvencyState;
}) {
  const infinite = runwaySeconds < 0;
  const left = useCountdown(deathAt, Math.max(0, runwaySeconds));
  const rate = formatUsd(BigInt(burnRatePerHour6), { precision: 4 });

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <div className="label">Projected insolvency</div>
        <p
          className="tnum mt-1.5 text-[clamp(1.25rem,5vw,1.75rem)] font-medium leading-none"
          style={{ color: infinite ? 'var(--color-ink)' : STATE_INK[state] }}
        >
          {infinite ? 'no burn rate' : `in ${formatDuration(left)}`}
        </p>
      </div>
      <p className="max-w-[46ch] text-[11px] leading-snug text-ink-muted">
        {infinite
          ? 'Nothing is being burned right now, so the projection has no zero crossing. Rent resumes the moment the agent acts.'
          : `A projection from the current burn rate of ${rate} per hour, held flat. It is arithmetic, not a schedule: one bounty moves it by days.`}
      </p>
    </div>
  );
}
