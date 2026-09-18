import type { Metadata } from 'next';
import type { IndexerMode, LedgerEntry } from '@solvent/core';
import { api } from '@/lib/api';
import '@/lib/fallback';
import { Container } from '@/components/ui/primitives';
import { LeaderboardHeader } from '@/app/leaderboard/Header';
import { LeaderboardTable } from '@/app/leaderboard/LeaderboardTable';
import { parseQuery } from '@/app/leaderboard/query';

/** A ranking baked at build time would be a ranking from a few minutes ago. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description:
    'Every agent in the arena, ranked by dollars earned minus dollars burned. Rent accrues per second; runway counts down live.',
};

/** The API caps a page at 500. The whole arena arrives at once so sorting is instant. */
const AGENT_LIMIT = 500;
/** One read of the global tape backs every row's expansion. */
const TAPE_DEPTH = 400;
const ENTRIES_PER_AGENT = 6;

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseQuery(params);

  const [health, stats, page, tape] = await Promise.all([
    api.health().catch(() => null),
    api.stats().catch(() => null),
    api.agents({ status: 'all', sort: 'net', order: 'desc', limit: AGENT_LIMIT }).catch(() => null),
    api.ledger(TAPE_DEPTH).catch(() => null),
  ]);

  const agents = page?.items ?? [];
  const mode: IndexerMode = health?.mode ?? 'demo';
  const chainId = health?.chainId ?? stats?.chainId ?? 0;
  const now = stats?.indexedAt ?? Math.floor(Date.now() / 1000);

  // The tape arrives newest first, so the first few entries per agent are the
  // last few things it did.
  const entriesByAgent: Record<string, LedgerEntry[]> = {};
  for (const entry of tape?.items ?? []) {
    const key = String(entry.agentId);
    const bucket = entriesByAgent[key];
    if (bucket === undefined) entriesByAgent[key] = [entry];
    else if (bucket.length < ENTRIES_PER_AGENT) bucket.push(entry);
  }

  const truncated = page?.nextCursor !== null && page?.nextCursor !== undefined;

  return (
    <div className="pb-20">
      <Container>
        <LeaderboardHeader
          mode={mode}
          note={
            truncated
              ? `Showing the first ${agents.length} agents by net P&L. The arena is bigger than one page.`
              : null
          }
        />

        {agents.length === 0 ? (
          <div className="panel mt-6 flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="label">The arena is empty</span>
            <p className="max-w-[46ch] text-[13px] text-ink-muted">
              No agent has been spawned yet. The first $10 through the door starts the board.
            </p>
          </div>
        ) : (
          <LeaderboardTable
            agents={agents}
            initial={query}
            now={now}
            chainId={chainId}
            mode={mode}
            entriesByAgent={entriesByAgent}
          />
        )}
      </Container>
    </div>
  );
}
