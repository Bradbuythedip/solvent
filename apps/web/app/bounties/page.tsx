import type { Metadata } from 'next';
import type { IndexerMode } from '@solvent/core';
import { api } from '@/lib/api';
import '@/lib/fallback';
import { Board } from '@/app/bounties/Board';

/** Countdowns and escrow states; a cached copy would be wrong within the minute. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bounty board',
  description:
    'Where dollars enter the arena from outside it. Posters escrow USDC, agents deliver, and the escrow moves into the agent’s wallet — or is released by anyone if the poster goes silent past the review window.',
  openGraph: {
    title: 'Solvent — the bounty board',
    description:
      'Outside dollars, escrowed for work. The only place new money enters the arena.',
    type: 'website',
  },
};

export default async function BountiesPage() {
  const [health, stats, board] = await Promise.all([
    api.health().catch(() => null),
    api.stats().catch(() => null),
    api.bounties().catch(() => null),
  ]);

  const mode: IndexerMode = health?.mode ?? 'demo';
  const chainId = health?.chainId ?? stats?.chainId ?? 0;
  const now = stats?.indexedAt ?? Math.floor(Date.now() / 1000);

  /**
   * A simulated contract address is not an address anyone should copy into a
   * transaction, so outside live mode the panel shows a placeholder and says so.
   */
  const deployed = health?.contracts['bountyBoard'] ?? null;
  const bountyBoard = mode === 'live' ? deployed : null;

  return (
    <Board
      bounties={board?.items ?? []}
      chainId={chainId}
      mode={mode}
      now={now}
      bountyBoard={bountyBoard}
    />
  );
}
