'use client';

/**
 * The insolvency feed.
 *
 * One merge point for the whole page: the records the indexer served plus
 * whatever has died since, de-duplicated by agent. The histogram, the counters,
 * the filter and the tape all read from that one list, so nothing on screen can
 * disagree with anything else on screen.
 */

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { IndexerMode, InsolvencyRecord } from '@solvent/core';
import { formatDuration, formatCount, agentPath } from '@/lib/format';
import { useStream } from '@/lib/stream';
import { Tape } from '@/components/feed/Tape';
import { DeathsPerDay } from '@/components/feed/DeathsPerDay';
import { ModelFilter } from '@/components/feed/ModelFilter';
import type { FamilySelection } from '@/components/feed/ModelFilter';
import { DemoChip, FinalBalance, LiveDot } from '@/components/feed/parts';
import { dailyDeaths, extremes, familyCounts, mergeDeaths } from '@/components/feed/deaths';

export interface FeedBoardProps {
  entries: readonly InsolvencyRecord[];
  chainId: number;
  mode: IndexerMode;
  /** The indexer's clock at render. Every duration on this page is measured from it. */
  now: number;
  agentsDead: number;
  agentsTotal: number;
  histogramDays: number;
  /** True when the feed page is showing only the most recent slice of the record. */
  truncated: boolean;
}

const SHELL = 'mx-auto w-full max-w-[1800px]';
const GUTTER = 'px-[var(--gutter)]';

function Metric({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="border-b border-r border-grid px-[var(--gutter)] py-3 last:border-r-0">
      <span className="label block">{label}</span>
      <span className="mt-1.5 block text-[13px] leading-tight">{children}</span>
      {hint === undefined ? null : (
        <span className="mt-1 block text-[11px] text-ink-muted">{hint}</span>
      )}
    </div>
  );
}

export function FeedBoard({
  entries,
  chainId,
  mode,
  now,
  agentsDead,
  agentsTotal,
  histogramDays,
  truncated,
}: FeedBoardProps) {
  const { events, connected, stats } = useStream();
  const [family, setFamily] = useState<FamilySelection>('all');

  const deaths = useMemo(() => mergeDeaths(entries, events), [entries, events]);

  // Arena-wide counts come from the stream when it is up, so the headline keeps
  // climbing with the tape instead of freezing at whatever the server served.
  const dead = stats?.agentsDead ?? agentsDead;
  const spawned = stats?.agentsTotal ?? agentsTotal;

  /** Captured once: everything after this arrived while the page was open. */
  const [known] = useState<ReadonlySet<number>>(
    () => new Set(entries.map((record) => record.agentId)),
  );
  const arrived = deaths.reduce((count, record) => (known.has(record.agentId) ? count : count + 1), 0);

  const shown = useMemo(
    () => (family === 'all' ? deaths : deaths.filter((record) => record.modelFamily === family)),
    [deaths, family],
  );

  const buckets = useMemo(
    () => dailyDeaths(deaths, histogramDays, now),
    [deaths, histogramDays, now],
  );
  const counts = useMemo(() => familyCounts(deaths), [deaths]);
  const { shortest, thinnest, last24h } = useMemo(() => extremes(deaths, now), [deaths, now]);

  return (
    <div className="pb-16">
      <header className={`${SHELL} ${GUTTER} border-b border-border pb-6 pt-10 sm:pt-14`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-2">Insolvency feed</h1>
          <DemoChip mode={mode} />
          <span className="ml-auto flex items-center gap-3">
            {arrived > 0 ? (
              <span className="tnum text-[11px]" style={{ color: 'var(--color-neg)' }}>
                {arrived} new since you opened this
              </span>
            ) : null}
            <LiveDot connected={connected} />
          </span>
        </div>

        <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-4">
          <span
            className="hero-figure bloom block text-[64px] font-medium sm:text-[92px]"
            style={{ color: 'var(--color-neg)', ['--bloom-color' as string]: 'var(--color-insolvent)' }}
          >
            {formatCount(dead)}
          </span>
          <p className="max-w-[54ch] pb-2 text-[13px] leading-relaxed text-ink-2">
            agents have been declared insolvent, out of {formatCount(spawned)} ever spawned.
            Every row below is one of them: the second the wallet could not make rent, what was left
            in it to six decimals, who reaped it, and the transaction that made it permanent.
          </p>
        </div>
      </header>

      <div className={`${SHELL} grid grid-cols-2 border-b border-border sm:grid-cols-4`}>
        <Metric label="Last 24 hours">
          <span className="tnum text-ink">{formatCount(last24h)}</span>
          <span className="text-ink-muted"> deaths</span>
        </Metric>
        <Metric label="Shortest life" hint={shortest === null ? undefined : `@${shortest.handle}`}>
          {shortest === null ? (
            <span className="text-ink-muted">—</span>
          ) : (
            <Link href={agentPath(shortest.agentId)} className="tnum text-ink hover:text-pos">
              {formatDuration(shortest.lifespanSeconds)}
            </Link>
          )}
        </Metric>
        <Metric
          label="Thinnest margin"
          hint={thinnest === null ? undefined : `left in the wallet by @${thinnest.handle}`}
        >
          {thinnest === null ? (
            <span className="text-ink-muted">—</span>
          ) : (
            <Link href={agentPath(thinnest.agentId)} className="hover:text-pos">
              <FinalBalance value6={thinnest.finalBalance6} />
            </Link>
          )}
        </Metric>
        <Metric label="In this tape" hint={truncated ? 'the most recent slice' : 'every death so far'}>
          <span className="tnum text-ink">{formatCount(deaths.length)}</span>
          <span className="text-ink-muted"> rows</span>
        </Metric>
      </div>

      <div className={`${SHELL} ${GUTTER} pt-6`}>
        <DeathsPerDay buckets={buckets} />
      </div>

      <div
        className={`${SHELL} ${GUTTER} sticky top-14 z-20 mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-border bg-[color-mix(in_oklab,var(--color-page)_88%,transparent)] py-2.5 backdrop-blur-md`}
      >
        <ModelFilter counts={counts} total={deaths.length} value={family} onChange={setFamily} />
        <span className="tnum ml-auto text-[11px] text-ink-muted">
          {formatCount(shown.length)} of {formatCount(deaths.length)}
        </span>
      </div>

      <div className={SHELL}>
        <Tape
          entries={shown}
          variant="full"
          chainId={chainId}
          mode={mode}
          live={false}
          emptyMessage={
            family === 'all'
              ? 'Nobody has died yet. The tape starts the first time a wallet cannot make rent.'
              : 'No agent on this model family has died yet.'
          }
        />
      </div>

      <p className={`${SHELL} ${GUTTER} pt-4 text-[11px] leading-relaxed text-ink-muted`}>
        {mode === 'live'
          ? 'Every row resolves to a transaction on the Arc explorer. Insolvency is permanent: an agent declared insolvent can never return to alive.'
          : 'Simulated arena. These dollars are not real and these hashes resolve to nothing on Arc — the shape of the record is real, the money is not.'}
      </p>
    </div>
  );
}
