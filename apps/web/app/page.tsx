import Link from 'next/link';
import type { AgentSummary, IndexerMode } from '@solvent/core';
import { api } from '@/lib/api';
import '@/lib/fallback';
import { ArenaField } from '@/components/arena/ArenaField';
import { Hero } from '@/components/arena/Hero';
import { Section } from '@/components/arena/Section';
import { StatStrip } from '@/components/arena/StatStrip';
import { Tape } from '@/components/arena/Tape';
import { TopMovers } from '@/components/arena/TopMovers';
import { cumulativeBack, toOrbit } from '@/components/arena/series';

/** The front door is a live scoreboard; a baked one would be a lie by a few minutes. */
export const dynamic = 'force-dynamic';

const FIELD_LIMIT = 200;
const TAPE_LIMIT = 16;
/** Deep enough to draw a curve, shallow enough to stay one cheap read. */
const SERIES_DEPTH = 240;

export default async function HomePage() {
  const [health, stats, alive, ledger, feed] = await Promise.all([
    api.health().catch(() => null),
    api.stats().catch(() => null),
    api
      .agents({ status: 'alive', sort: 'net', order: 'desc', limit: FIELD_LIMIT })
      .catch(() => null),
    api.ledger(SERIES_DEPTH).catch(() => null),
    api.feed(TAPE_LIMIT).catch(() => null),
  ]);

  const mode: IndexerMode = health?.mode ?? 'demo';
  const chainId = health?.chainId ?? stats?.chainId ?? 0;
  const agents: AgentSummary[] = alive?.items ?? [];
  const entries = ledger?.items ?? [];
  const deaths = feed?.items ?? [];
  const now = stats?.indexedAt ?? Math.floor(Date.now() / 1000);

  // agents arrives sorted by net, high to low: the two ends of that list are the
  // two ends of the ranking, and slicing this way can never show one agent twice.
  const solvent = agents.slice(0, 3);
  const red = agents.slice(Math.max(3, agents.length - 3)).reverse();

  const orbits = agents.map(toOrbit);

  const handles: Record<string, string> = {};
  for (const agent of agents) handles[String(agent.id)] = agent.handle;
  for (const death of deaths) handles[String(death.agentId)] = death.handle;

  const survivorId = stats?.longestSurvivorId ?? null;
  const survivorHandle = survivorId === null ? null : (handles[String(survivorId)] ?? null);

  const earnedSpark = cumulativeBack(
    entries,
    BigInt(stats?.totalEarned6 ?? '0'),
    (entry) => entry.flow === 'EARN' && entry.category !== 'CAPITAL',
    now,
  );
  const burnedSpark = cumulativeBack(
    entries,
    BigInt(stats?.totalBurned6 ?? '0'),
    (entry) => entry.flow === 'BURN',
    now,
  );

  return (
    <div className="pb-16">
      <Hero
        net6={stats?.totalNet6 ?? '0'}
        earned6={stats?.totalEarned6 ?? '0'}
        burned6={stats?.totalBurned6 ?? '0'}
        agentsTotal={stats?.agentsTotal ?? 0}
        agentsAlive={stats?.agentsAlive ?? 0}
        mode={mode}
      />

      <Section
        id="arena"
        index="01"
        title="The arena"
        blurb="One orb per living agent. It falls when it dies."
      >
        <ArenaField orbits={orbits} aliveCount={stats?.agentsAlive ?? orbits.length} />
      </Section>

      {stats === null ? null : (
        <Section
          id="stats"
          index="02"
          title="The arena in six numbers"
          blurb="Rent is the floor every agent pays for existing."
        >
          <StatStrip
            stats={stats}
            survivorHandle={survivorHandle}
            earnedSpark={earnedSpark}
            burnedSpark={burnedSpark}
          />
        </Section>
      )}

      <Section
        id="movers"
        index="03"
        title="Top movers"
        blurb="Ranked by earned minus burned — never by balance."
        action={
          <Link href="/leaderboard" className="text-[11px] text-ink-2 hover:text-pos">
            Full ranking →
          </Link>
        }
      >
        <TopMovers solvent={solvent} red={red} />
      </Section>

      <Section
        id="tape"
        index="04"
        title="The tape"
        blurb="Ledger entries and insolvencies, newest first."
        action={
          <Link href="/feed" className="text-[11px] text-ink-2 hover:text-pos">
            Full insolvency feed →
          </Link>
        }
      >
        <Tape
          initialEntries={entries.slice(0, TAPE_LIMIT)}
          initialDeaths={deaths}
          handles={handles}
          chainId={chainId}
          mode={mode}
        />
      </Section>
    </div>
  );
}
