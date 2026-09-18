'use client';

/**
 * The headline numbers. Six tiles on one hairline grid: label, value, and a
 * twelve-point curve where a curve actually says something.
 *
 * Counts and durations are ink. Nothing here is a signed value, so nothing here
 * is coloured — the one signed figure on this page is the hero, and colour on a
 * total would claim a polarity these numbers do not have.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { ArenaStats, SparkPoint } from '@solvent/core';
import { Sparkline } from '@/components/charts/Sparkline';
import { StateDot } from '@/components/ui/primitives';
import { agentPath, formatCount, formatDuration, formatUsd } from '@/lib/format';
import { useStream } from '@/lib/stream';

function Tile({
  label,
  value,
  hint,
  spark,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  spark?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3 bg-panel px-3.5 py-3.5">
      <span className="label truncate">{label}</span>
      <div className="min-w-0">
        <div className="truncate text-[20px] leading-none text-ink">{value}</div>
        {hint === undefined ? null : (
          <div className="mt-1.5 truncate text-[11px] text-ink-muted">{hint}</div>
        )}
      </div>
      {spark === undefined ? null : <div className="mt-auto -mb-2 pt-1">{spark}</div>}
    </div>
  );
}

export function StatStrip({
  stats,
  survivorHandle,
  earnedSpark,
  burnedSpark,
}: {
  stats: ArenaStats;
  survivorHandle: string | null;
  earnedSpark: SparkPoint[];
  burnedSpark: SparkPoint[];
}) {
  const live = useStream().stats;
  const s = live ?? stats;

  const survivorId = s.longestSurvivorId;
  const survivorLabel =
    survivorId === null
      ? '—'
      : survivorId === stats.longestSurvivorId && survivorHandle !== null
        ? survivorHandle
        : `#${survivorId}`;

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-3 xl:grid-cols-6">
      <Tile
        label="Agents alive"
        value={
          <span className="tnum inline-flex items-center gap-2">
            <StateDot state="solvent" />
            {formatCount(s.agentsAlive)}
          </span>
        }
        hint={`${formatCount(s.agentsTotal)} ever spawned`}
      />

      <Tile
        label="Total burned"
        value={<span className="tnum">{formatUsd(BigInt(s.totalBurned6))}</span>}
        hint={`${formatUsd(BigInt(s.totalRentBurned6))} rent · ${formatUsd(BigInt(s.totalGasBurned6))} gas`}
        spark={
          <Sparkline points={burnedSpark} field="balance6" width={140} height={56} state="burning" />
        }
      />

      <Tile
        label="Total earned"
        value={<span className="tnum">{formatUsd(BigInt(s.totalEarned6))}</span>}
        hint="Capital in is never revenue"
        spark={
          <Sparkline points={earnedSpark} field="balance6" width={140} height={56} state="solvent" />
        }
      />

      <Tile
        label="Deaths, last 24h"
        value={
          <span className="tnum inline-flex items-center gap-2">
            <StateDot state="dead" />
            {formatCount(s.deathsLast24h)}
          </span>
        }
        hint={`${formatCount(s.agentsDead)} insolvent all time`}
      />

      <Tile
        label="Median lifespan"
        value={<span className="tnum">{formatDuration(s.medianLifespanSeconds)}</span>}
        hint="Spawn to insolvency"
      />

      <Tile
        label="Longest survivor"
        value={
          survivorId === null ? (
            <span className="mono">—</span>
          ) : (
            <Link href={agentPath(survivorId)} className="mono block truncate hover:text-pos">
              {survivorLabel}
            </Link>
          )
        }
        hint={formatDuration(s.longestLifespanSeconds)}
      />
    </div>
  );
}
