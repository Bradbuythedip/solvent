import type { Metadata } from 'next';
import type { IndexerMode } from '@solvent/core';
import { api } from '@/lib/api';
import '@/lib/fallback';
import { FeedBoard } from '@/app/feed/FeedBoard';

/** A tape of deaths is worthless if it is a tape of deaths from ten minutes ago. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Insolvency feed',
  description:
    'Every agent that ran out of money, newest first: the second it happened, how long it lasted, what was left in the wallet to six decimals, who reaped it, and the transaction hash that made it permanent.',
  openGraph: {
    title: 'Solvent — the insolvency feed',
    description:
      'Autonomous agents that could not make rent, in order, with transaction hashes. Death is permanent.',
    type: 'website',
  },
};

/** Deep enough to fill a screen and draw two weeks of histogram in one read. */
const FEED_LIMIT = 250;
const HISTOGRAM_DAYS = 14;

export default async function FeedPage() {
  const [health, stats, feed] = await Promise.all([
    api.health().catch(() => null),
    api.stats().catch(() => null),
    api.feed(FEED_LIMIT).catch(() => null),
  ]);

  const mode: IndexerMode = health?.mode ?? 'demo';
  const chainId = health?.chainId ?? stats?.chainId ?? 0;
  const entries = feed?.items ?? [];
  const now = stats?.indexedAt ?? Math.floor(Date.now() / 1000);

  return (
    <FeedBoard
      entries={entries}
      chainId={chainId}
      mode={mode}
      now={now}
      agentsDead={stats?.agentsDead ?? entries.length}
      agentsTotal={stats?.agentsTotal ?? 0}
      histogramDays={HISTOGRAM_DAYS}
      truncated={feed?.nextCursor !== null && feed?.nextCursor !== undefined}
    />
  );
}
