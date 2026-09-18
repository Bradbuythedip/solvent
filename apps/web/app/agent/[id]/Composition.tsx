'use client';

/**
 * Where the money went, and how much time is left.
 *
 * Burn is a part-to-whole with four parts, so it is one stacked bar separated by
 * 2px surface gaps. Runway is one value with a severity, so it is a meter. Both
 * ship the table view, which is what lets the bar label only the slices wide
 * enough to hold a number.
 */

import type { ReactNode } from 'react';
import { BurnComposition, burnTable } from '@/components/charts/BurnComposition';
import { RunwayMeter, runwayTable } from '@/components/charts/RunwayMeter';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { Money } from '@/components/ui/Money';
import { formatDuration } from '@/lib/format';

export interface CompositionSlice {
  label: string;
  value6: string;
}

const DAY = 86_400;

/**
 * The meter's scale, chosen so "of 30d" means something. A fixed 24h track would
 * peg every healthy agent at full and a self-scaling one would make two agents
 * incomparable, so this steps between three fixed scales.
 */
function runwayScale(seconds: number): number {
  if (seconds < 0) return DAY;
  if (seconds <= DAY) return DAY;
  if (seconds <= 7 * DAY) return 7 * DAY;
  return 30 * DAY;
}

export function BurnBreakdown({ parts, burned6 }: { parts: CompositionSlice[]; burned6: string }) {
  const table = burnTable(parts);
  return (
    <ChartFrame
      title="Burn composition"
      description="Every dollar this agent spent, by what it was spent on. Rent is the floor it pays for existing; gas is dollars too, because on Arc the gas token is USDC."
      tableHead={table.head}
      tableRows={table.rows}
    >
      <BurnComposition parts={parts} width={560} />
      <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-grid pt-3">
        <span className="label">Lifetime burned</span>
        <Money value={burned6} colorize={false} size="sm" />
      </div>
    </ChartFrame>
  );
}

export function RunwayPanel({
  runwaySeconds,
  burnRatePerHour6,
  footer,
}: {
  /** null once dead or retired; -1 encodes "no burn rate". */
  runwaySeconds: number | null;
  burnRatePerHour6: string;
  footer?: ReactNode;
}) {
  const dead = runwaySeconds === null;
  const seconds = runwaySeconds ?? 0;
  const max = runwayScale(seconds);
  // A dead wallet has no runway at all, which is not the same number as zero
  // seconds of it — the table has to say so rather than print 00s.
  const table = dead
    ? {
        head: ['Measure', 'Value'],
        rows: [
          ['Runway left', '\u2014'],
          ['Scale', '\u2014'],
          ['State', 'No longer accruing'],
        ],
      }
    : runwayTable(seconds, max);

  return (
    <ChartFrame
      title="Runway"
      description={
        dead
          ? 'Balance divided by burn rate. This wallet has neither.'
          : `Balance divided by burn rate, on a ${formatDuration(max)} scale.`
      }
      tableHead={table.head}
      tableRows={table.rows}
    >
      {dead ? (
        <p className="py-6 text-center text-[12px] text-ink-muted">
          No runway. The wallet stopped accruing when the agent did.
        </p>
      ) : (
        <RunwayMeter seconds={seconds} maxSeconds={max} />
      )}
      <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-grid pt-3">
        <span className="label">{dead ? 'Burn rate at death' : 'Burn rate'}</span>
        <span className="tnum text-[13px] text-ink-2">
          <Money value={burnRatePerHour6} colorize={false} size="sm" precision={4} />
          <span className="text-ink-muted"> / hour</span>
        </span>
      </div>
      {footer}
    </ChartFrame>
  );
}
