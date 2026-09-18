'use client';

/**
 * The status line's contents. Server-rendered values arrive as props and are
 * carried forward by the stream; with no indexer they simply stay put.
 */

import type { ReactNode } from 'react';
import type { IndexerMode } from '@solvent/core';
import { StateDot } from '@/components/ui/primitives';
import { useStream } from '@/lib/stream';
import { formatBlock, formatCount } from '@/lib/format';

export interface StatusSnapshot {
  mode: IndexerMode;
  chainId: number;
  chainName: string;
  /** Chain head as the indexer last saw it. */
  head: number;
  /** Last indexed block. */
  block: number;
  /** Blocks behind the head. */
  lag: number;
  alive: number;
  dead: number;
}

/** Past this many blocks behind, lag stops being a detail and becomes a warning. */
const STALE_BLOCKS = 30;

/** `className` carries the display utility, so nothing here can fight a `hidden`. */
function Cell({
  label,
  children,
  className = 'flex',
  labelClassName = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** Labels are the first thing to go at 360px; the values are the data. */
  labelClassName?: string;
}) {
  return (
    <div className={`min-w-0 shrink-0 items-center gap-1.5 ${className}`}>
      <span className={`label ${labelClassName}`}>{label}</span>
      <span className="tnum truncate text-[11px] text-ink-2">{children}</span>
    </div>
  );
}

function Rule({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`mx-3 h-3 w-px shrink-0 bg-border ${className}`} />;
}

export function StatusBarLive({ initial }: { initial: StatusSnapshot }) {
  const { stats, connected } = useStream();

  const live = initial.mode === 'live';
  const block = stats?.blockNumber ?? initial.block;
  const alive = stats?.agentsAlive ?? initial.alive;
  const dead = stats?.agentsDead ?? initial.dead;
  const stale = initial.lag > STALE_BLOCKS;

  return (
    <div className="mono flex h-8 items-center overflow-hidden text-[11px] leading-none">
      <div className="flex shrink-0 items-center gap-2">
        <span className="label hidden sm:inline">Mode</span>
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
            <span className={`inline-flex ${connected ? 'pulse' : ''}`}>
              <StateDot state="solvent" />
            </span>
            LIVE
          </span>
        ) : (
          <span
            className="inline-flex items-center rounded-[3px] border px-1.5 py-[3px] text-[10px] font-bold tracking-[0.18em]"
            style={{
              color: 'var(--color-warn)',
              borderColor: 'color-mix(in oklab, var(--color-warn) 45%, transparent)',
              background: 'color-mix(in oklab, var(--color-warn) 12%, transparent)',
            }}
          >
            DEMO
          </span>
        )}
        {live ? null : (
          <span className="hidden text-[11px] text-ink-muted sm:inline">simulated dollars</span>
        )}
      </div>

      <Rule />
      <Cell label="Chain" className="flex" labelClassName="hidden sm:inline">
        {initial.chainName}
        <span className="hidden text-ink-muted md:inline"> · {initial.chainId}</span>
      </Cell>

      <Rule className="hidden md:block" />
      <Cell label="Lag" className="hidden md:flex">
        {formatCount(initial.lag)}
        <span className="text-ink-muted"> blk</span>
        {stale ? <span style={{ color: 'var(--color-warn)' }}> STALE</span> : null}
      </Cell>

      <Rule className="hidden sm:block" />
      <Cell label="Indexed" className="hidden sm:flex">
        {formatBlock(block)}
      </Cell>

      <div className="ml-auto flex shrink-0 items-center gap-2 pl-3">
        <span className="label hidden sm:inline">Agents</span>
        <span className="inline-flex items-center gap-1.5 text-[11px]">
          <StateDot state="solvent" />
          <span className="tnum text-ink-2">{formatCount(alive)}</span>
          <span className="text-ink-muted">alive</span>
        </span>
        <span aria-hidden="true" className="h-3 w-px bg-border" />
        <span className="inline-flex items-center gap-1.5 text-[11px]">
          <StateDot state="dead" />
          <span className="tnum text-ink-2">{formatCount(dead)}</span>
          <span className="text-ink-muted">dead</span>
        </span>
      </div>
    </div>
  );
}
