'use client';

/**
 * The cells that move.
 *
 * A runway counting down is the only thing on this page that changes without the
 * data changing, so it is the only thing that runs a clock — and it runs off the
 * shared one in lib/hooks, which means a hundred rows cost one timer and nothing
 * at all when the tab is hidden or motion is reduced.
 */

import { formatDuration, formatUsd } from '@solvent/core';
import type { AgentSummary } from '@solvent/core';
import { StateDot } from '@/components/ui/primitives';
import { useCountdown, useElapsed } from '@/lib/hooks';
import { toBig } from '@/components/charts/geometry';

/** Matches solvencyOf() in @solvent/core: under six hours of runway is dying. */
const DYING_SECONDS = 6 * 3600;

export interface RunwayClockProps {
  /** Seconds of runway. null is dead or retired, -1 is "no burn rate". */
  seconds: number | null;
  /** The indexer's clock when the runway was measured. */
  asOf: number;
  className?: string;
}

export function RunwayClock({ seconds, asOf, className = '' }: RunwayClockProps) {
  const finite = seconds !== null && seconds >= 0 && Number.isFinite(seconds);
  const left = useCountdown(asOf + (finite && seconds !== null ? seconds : 0), finite && seconds !== null ? seconds : 0);

  if (seconds === null) {
    return (
      <span className={`tnum text-ink-muted ${className}`} title="No runway: this agent is not burning any more">
        —
      </span>
    );
  }
  if (!finite) {
    return (
      <span className={`tnum text-ink-2 ${className}`} title="No measurable burn rate">
        ∞
      </span>
    );
  }

  const dying = left < DYING_SECONDS;
  return (
    <span
      className={`tnum inline-flex items-center justify-end gap-1.5 ${className}`}
      style={dying ? { color: 'var(--color-warn)' } : undefined}
      title={dying ? 'Under six hours of runway' : undefined}
    >
      {dying ? <StateDot state="dying" /> : null}
      {left === 0 ? 'due' : formatDuration(left)}
    </span>
  );
}

export interface AgeClockProps {
  bornAt: number;
  lifespanSeconds: number;
  /** A dead agent's age stopped when it died; a living one is still counting. */
  running: boolean;
  className?: string;
}

export function AgeClock({ bornAt, lifespanSeconds, running, className = '' }: AgeClockProps) {
  const live = useElapsed(bornAt, lifespanSeconds);
  return <span className={`tnum ${className}`}>{formatDuration(running ? live : lifespanSeconds)}</span>;
}

/**
 * R1 made visible: money the operator sent after the spawn seed is capital, not
 * revenue, so it is marked on the row and left out of the rank entirely.
 */
export function SubsidyChip({ value6, className = '' }: { value6: string; className?: string }) {
  const value = toBig(value6);
  if (value <= 0n) return null;
  return (
    <span
      className={`mono inline-flex shrink-0 items-center gap-1 rounded-[3px] border border-border bg-raised px-1.5 py-[1px] text-[10px] text-ink-muted ${className}`}
      title={`Topped up with ${formatUsd(value)} after spawning. Capital is not revenue, and it does not move the rank.`}
    >
      <span aria-hidden="true">↑</span>
      {formatUsd(value, { precision: 2 })}
      <span className="sr-only">subsidised after spawning</span>
    </span>
  );
}

/** Whether this summary carries a post-spawn top-up at all. */
export function isSubsidised(agent: Pick<AgentSummary, 'subsidy6'>): boolean {
  return toBig(agent.subsidy6) > 0n;
}
