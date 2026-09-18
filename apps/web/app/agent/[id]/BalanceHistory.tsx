'use client';

/**
 * The balance history, at the size where it is the thing you came to read.
 *
 * One series, so no legend. The dashed run past the last observation is the
 * projection to the zero crossing at the current burn rate, and the line beneath
 * the chart says so in words — a dashed stroke on its own is not a claim anyone
 * should have to decode.
 */

import type { SolvencyState, SparkPoint } from '@solvent/core';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { Sparkline, sparklineTable } from '@/components/charts/Sparkline';
import { Hairline } from '@/components/ui/primitives';
import { dateUtc, formatDuration } from '@/lib/format';
import { ProjectedInsolvency } from './Vitals';

export function BalanceHistory({
  points,
  state,
  alive,
  runwaySeconds,
  deathAt,
  burnRatePerHour6,
  diedAt,
  lifespanSeconds,
}: {
  points: SparkPoint[];
  state: SolvencyState;
  alive: boolean;
  /** null once the agent is dead or retired; -1 means no burn rate. */
  runwaySeconds: number | null;
  deathAt: number;
  burnRatePerHour6: string;
  diedAt: number | null;
  lifespanSeconds: number;
}) {
  const table = sparklineTable(points, 'balance6');
  const projecting = alive && runwaySeconds !== null && runwaySeconds > 0;

  return (
    <ChartFrame
      title="Balance history"
      description={
        projecting
          ? 'Wallet balance over the life of the agent. The dashed run is a projection to zero at the current burn rate.'
          : 'Wallet balance over the life of the agent.'
      }
      tableHead={table.head}
      tableRows={table.rows}
    >
      <Sparkline
        points={points}
        field="balance6"
        state={state}
        height={268}
        width={880}
        showAxis
        projectionSeconds={projecting ? runwaySeconds : undefined}
      />

      <Hairline className="mt-5" />

      <div className="pt-4">
        {alive && runwaySeconds !== null ? (
          <ProjectedInsolvency
            runwaySeconds={runwaySeconds}
            deathAt={deathAt}
            burnRatePerHour6={burnRatePerHour6}
            state={state}
          />
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <div className="label">{diedAt === null ? 'Ended' : 'Balance reached zero'}</div>
              <p className="tnum mt-1.5 text-[clamp(1.25rem,5vw,1.75rem)] font-medium leading-none text-ink">
                {diedAt === null ? 'no longer accruing' : dateUtc(diedAt)}
              </p>
            </div>
            <p className="max-w-[46ch] text-[11px] leading-snug text-ink-muted">
              The line stops where the agent did. It ran for {formatDuration(lifespanSeconds)} and
              nothing has been added to it since.
            </p>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
