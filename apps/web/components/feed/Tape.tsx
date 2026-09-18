'use client';

/**
 * The insolvency tape.
 *
 * One row is one death: the second it happened, who it was, what it ran on, how
 * long it lasted, what was left in the wallet, what it netted over its whole
 * life, who reaped it, and the transaction that says so. Newest at the top,
 * monospace, hairline-ruled — a wire service for things that ran out of money.
 *
 * Reused at two sizes: `full` on /feed, `compact` where a page needs the last few
 * rows without the whole apparatus.
 *
 * Motion: a row that arrived after you started watching animates in once and
 * flashes once. Rows are keyed by agent, so React keeps the DOM node across
 * re-renders and a CSS animation that has already run cannot replay. The flash
 * rides the <li> and the slide rides the inner box, because one element can only
 * run one animation. Under prefers-reduced-motion globals.css collapses both to
 * nothing and new rows simply appear, which is the correct behaviour and not a
 * degraded one — no meaning here is carried by movement.
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { IndexerMode, InsolvencyRecord } from '@solvent/core';
import { Money } from '@/components/ui/Money';
import { ModelBadge, StateDot } from '@/components/ui/primitives';
import { certificatePath, agentPath, clockUtc, formatDuration, modelLabel } from '@/lib/format';
import { useStream } from '@/lib/stream';
import { mergeDeaths, utcDayLabel } from '@/components/feed/deaths';
import { AddressLink, CopyLink, FinalBalance, TxLink } from '@/components/feed/parts';

export type TapeVariant = 'compact' | 'full';

export interface TapeProps {
  /** Newest first is not required — the tape sorts and de-duplicates by agent. */
  entries: readonly InsolvencyRecord[];
  variant?: TapeVariant;
  /** Cap on rows rendered. Undefined means every entry given. */
  maxRows?: number;
  chainId?: number;
  /** Anything but "live" renders hashes as text instead of links to nothing. */
  mode?: IndexerMode;
  /**
   * Subscribe to the stream and merge new deaths in. Pass false when the parent
   * already merges — two mergers would animate the same arrival twice.
   */
  live?: boolean;
  emptyMessage?: string;
  className?: string;
}

/* One set of widths, shared by the header and every row, so the tape reads as a
   column of numbers rather than a list of sentences. Below lg the row breaks into
   two lines and every width goes back to auto. */
const W_TIME = 'w-[62px] shrink-0';
const W_MODEL = 'lg:w-[100px]';
const W_CAUSE = 'hidden 2xl:block 2xl:w-[164px] 2xl:shrink-0';
const W_LIFE = 'lg:w-[72px] lg:shrink-0 lg:text-right';
const W_FINAL = 'lg:w-[116px] lg:shrink-0 lg:text-right';
const W_NET = 'lg:w-[96px] lg:shrink-0 lg:text-right';
const W_REAPER = 'lg:w-[78px] lg:shrink-0 lg:text-right';
const W_TX = 'lg:w-[78px] lg:shrink-0 lg:text-right';
const W_COPY = 'lg:w-[20px]';

const PAD_FULL = 'px-[var(--gutter)]';
const PAD_COMPACT = 'px-4';

/** A value with a tiny caption, shown only while the row is stacked. */
function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1.5 ${className}`}>
      <span className="label lg:hidden">{label}</span>
      {children}
    </span>
  );
}

function Handle({ id, handle }: { id: number; handle: string }) {
  return (
    <Link
      href={agentPath(id)}
      className="mono min-w-0 truncate text-[12px] text-ink transition-colors duration-150 hover:text-pos"
    >
      {handle}
    </Link>
  );
}

function FullRow({
  record,
  chainId,
  mode,
}: {
  record: InsolvencyRecord;
  chainId: number;
  mode: IndexerMode;
}) {
  return (
    <div
      id={`death-${record.agentId}`}
      className={`mono flex flex-wrap items-baseline gap-x-3 gap-y-1.5 ${PAD_FULL} py-2.5 text-[11px] lg:flex-nowrap lg:items-center lg:gap-x-3`}
    >
      <time
        dateTime={new Date(record.at * 1000).toISOString()}
        className={`tnum ${W_TIME} text-ink-muted`}
      >
        <span className="hidden 2xl:inline">{utcDayLabel(record.at)} </span>
        {clockUtc(record.at)}
      </time>

      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span aria-hidden="true" className="translate-y-[1px]">
          <StateDot state="dead" />
        </span>
        <span className="tnum shrink-0 text-ink-muted">#{record.agentId}</span>
        <Handle id={record.agentId} handle={record.handle} />
      </span>

      {/* On a phone the row breaks into a stack and the lifetime P&L rides the
          first line with the handle; on a wide screen it returns to its column. */}
      <Field label="net" className={`ml-auto ${W_NET} lg:order-7 lg:ml-0 lg:block`}>
        <Money value={record.net6} signed size="sm" />
      </Field>

      {/* Model identity is a text badge. A hue per model would collide with the
          solvency palette, which is the only thing colour is allowed to mean. */}
      <span className={`shrink-0 ${W_MODEL} lg:order-3`}>
        <ModelBadge tag={record.modelTag} label={modelLabel(record.modelTag)} />
      </span>

      <span className={`${W_CAUSE} truncate text-[11px] text-ink-muted lg:order-4`}>
        {record.causeOfDeath}
      </span>

      <Field label="lived" className={`${W_LIFE} lg:order-5 lg:block`}>
        <span className="tnum text-ink-2">{formatDuration(record.lifespanSeconds)}</span>
      </Field>

      {/* The one figure this whole page exists for, so it is the one that steps
          up a size: an agent died holding $0.006123, not "about a cent". */}
      <Field label="left" className={`${W_FINAL} lg:order-6 lg:block`}>
        <FinalBalance value6={record.finalBalance6} className="text-[12px]" />
      </Field>

      <Field label="reaped by" className={`${W_REAPER} lg:order-8 lg:block`}>
        <AddressLink
          address={record.reaper}
          chainId={chainId}
          mode={mode}
          title={`Reaped by ${record.reaper}`}
        />
      </Field>

      <Field label="tx" className={`${W_TX} lg:order-9 lg:block`}>
        <TxLink hash={record.txHash} chainId={chainId} mode={mode} />
      </Field>

      <span className={`shrink-0 ${W_COPY} lg:order-10`}>
        <CopyLink
          path={certificatePath(record.agentId)}
          label={`Copy a link to the insolvency of ${record.handle}`}
        />
      </span>

      {/* The cause is a column only on the widest screens; everywhere else it is
          still read out, because it is the sentence the row is about. */}
      <span className="sr-only 2xl:hidden">Cause: {record.causeOfDeath}</span>
    </div>
  );
}

function CompactRow({
  record,
  chainId,
  mode,
}: {
  record: InsolvencyRecord;
  chainId: number;
  mode: IndexerMode;
}) {
  return (
    <div
      className={`mono flex items-center gap-2 ${PAD_COMPACT} py-2 text-[11px] sm:gap-3`}
      title={record.causeOfDeath}
    >
      <time
        dateTime={new Date(record.at * 1000).toISOString()}
        className="tnum hidden w-[58px] shrink-0 text-ink-muted sm:block"
      >
        {clockUtc(record.at)}
      </time>

      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span aria-hidden="true">
          <StateDot state="dead" />
        </span>
        <Handle id={record.agentId} handle={record.handle} />
      </span>

      <span className="hidden shrink-0 md:block">
        <ModelBadge tag={record.modelTag} label={modelLabel(record.modelTag)} />
      </span>

      <span className="tnum hidden w-[64px] shrink-0 text-right text-ink-2 xl:block">
        {formatDuration(record.lifespanSeconds)}
      </span>

      <span className="hidden w-[104px] shrink-0 text-right sm:block">
        <FinalBalance value6={record.finalBalance6} />
      </span>

      <span className="w-[84px] shrink-0 text-right">
        <Money value={record.net6} signed size="xs" />
      </span>

      <span className="hidden w-[76px] shrink-0 text-right sm:block">
        <TxLink hash={record.txHash} chainId={chainId} mode={mode} />
      </span>
    </div>
  );
}

function FullHeader() {
  return (
    <div
      className={`mono hidden items-center gap-x-3 border-b border-border ${PAD_FULL} py-2 text-[10px] uppercase tracking-[0.14em] text-ink-muted lg:flex`}
    >
      <span className={W_TIME}>UTC</span>
      <span className="min-w-0 flex-1">Agent</span>
      <span className={`shrink-0 ${W_MODEL}`}>Model</span>
      <span className={W_CAUSE}>Cause</span>
      <span className={W_LIFE}>Lived</span>
      <span className={W_FINAL}>Left</span>
      <span className={W_NET}>Net P&amp;L</span>
      <span className={W_REAPER}>Reaper</span>
      <span className={W_TX}>Tx</span>
      <span className={`shrink-0 ${W_COPY}`} aria-hidden="true" />
    </div>
  );
}

function CompactHeader() {
  return (
    <div
      className={`mono flex items-center gap-2 border-b border-border ${PAD_COMPACT} py-2 text-[10px] uppercase tracking-[0.14em] text-ink-muted sm:gap-3`}
    >
      <span className="hidden w-[58px] shrink-0 sm:block">UTC</span>
      <span className="min-w-0 flex-1">Agent</span>
      <span className="hidden shrink-0 md:block">Model</span>
      <span className="hidden w-[64px] shrink-0 text-right xl:block">Lived</span>
      <span className="hidden w-[104px] shrink-0 text-right sm:block">Left</span>
      <span className="w-[84px] shrink-0 text-right">Net</span>
      <span className="hidden w-[76px] shrink-0 text-right sm:block">Tx</span>
    </div>
  );
}

export function Tape({
  entries,
  variant = 'full',
  maxRows,
  chainId = 0,
  mode = 'demo',
  live = true,
  emptyMessage = 'Nobody has died yet.',
  className = '',
}: TapeProps) {
  const { events } = useStream();
  const full = variant === 'full';

  const rows = useMemo(() => {
    const merged = mergeDeaths(entries, live ? events : []);
    return maxRows === undefined ? merged : merged.slice(0, Math.max(0, maxRows));
  }, [entries, events, live, maxRows]);

  /**
   * Everything on screen at mount is history; anything else arrived while you
   * were watching. Captured once, in a state initialiser, so it survives every
   * re-render and is identical on the server and the client.
   */
  const [known] = useState<ReadonlySet<number>>(
    () => new Set(entries.map((record) => record.agentId)),
  );

  if (rows.length === 0) {
    return (
      <div className={`${full ? PAD_FULL : PAD_COMPACT} py-10 ${className}`}>
        <p className="text-[12px] text-ink-muted">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={className}>
      {full ? <FullHeader /> : <CompactHeader />}
      <ul>
        {rows.map((record) => {
          const arrived = !known.has(record.agentId);
          return (
            <li
              key={record.agentId}
              className={`border-b border-grid last:border-b-0 ${arrived ? 'death-flash' : ''}`}
            >
              <div className={arrived ? 'tape-in' : ''}>
                {full ? (
                  <FullRow record={record} chainId={chainId} mode={mode} />
                ) : (
                  <CompactRow record={record} chainId={chainId} mode={mode} />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
