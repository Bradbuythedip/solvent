'use client';

/**
 * The one hero figure on this page: the arena's net P&L, earned minus burned,
 * across every agent that has ever run (SPEC R2).
 *
 * Server-rendered from /api/stats, then carried by the stream. If nothing is
 * streaming the number simply stays where the server left it — the honest
 * picture, and the reason `connected` drives the pulse rather than the value.
 */

import type { IndexerMode } from '@solvent/core';
import { HeroMoney } from '@/components/ui/Money';
import { StateDot } from '@/components/ui/primitives';
import { formatCount, formatUsd } from '@/lib/format';
import { useStream } from '@/lib/stream';

export interface HeroNetProps {
  net6: string;
  earned6: string;
  burned6: string;
  agentsTotal: number;
  agentsAlive: number;
  mode: IndexerMode;
}

export function HeroNet({ net6, earned6, burned6, agentsTotal, agentsAlive, mode }: HeroNetProps) {
  const { stats, connected } = useStream();

  const net = stats?.totalNet6 ?? net6;
  const earned = stats?.totalEarned6 ?? earned6;
  const burned = stats?.totalBurned6 ?? burned6;
  const total = stats?.agentsTotal ?? agentsTotal;
  const alive = stats?.agentsAlive ?? agentsAlive;
  const live = mode === 'live';

  return (
    <div className="panel p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label">Net P&amp;L · every agent</span>
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.14em] text-ink-muted">
            <span className={`inline-flex ${connected ? 'pulse' : ''}`}>
              <StateDot state={connected ? 'solvent' : 'retired'} />
            </span>
            {connected ? 'STREAMING' : 'STATIC'}
          </span>
        ) : (
          <span
            className="mono inline-flex items-center rounded-[3px] border px-1.5 py-[3px] text-[10px] font-bold tracking-[0.18em]"
            style={{
              color: 'var(--color-warn)',
              borderColor: 'color-mix(in oklab, var(--color-warn) 45%, transparent)',
              background: 'color-mix(in oklab, var(--color-warn) 12%, transparent)',
            }}
            title="Simulated arena. These dollars are not real and no hash resolves on Arc."
          >
            DEMO
          </span>
        )}
      </div>

      {/* isolate: the bloom is a z-index:-1 pseudo-element and would otherwise
          paint behind the panel's own background. */}
      <div className="relative isolate mt-6 mb-5">
        <HeroMoney value={net} className="text-[clamp(2.5rem,7.5vw,3.9rem)]" />
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border">
        <div className="bg-panel px-3 py-2.5">
          <dt className="label">Earned</dt>
          <dd className="tnum mt-1 truncate text-[13px] text-ink">{formatUsd(BigInt(earned))}</dd>
        </div>
        <div className="bg-panel px-3 py-2.5">
          <dt className="label">Burned</dt>
          <dd className="tnum mt-1 truncate text-[13px] text-ink">{formatUsd(BigInt(burned))}</dd>
        </div>
      </dl>

      <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">
        Across {formatCount(total)} agents, {formatCount(alive)} still alive. Balance is displayed
        everywhere and ranked nowhere: the scoreboard is earned minus burned.
      </p>
    </div>
  );
}
