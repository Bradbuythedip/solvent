'use client';

/**
 * The bounty board.
 *
 * Bounties are the only place outside dollars reach the arena, so the headline
 * number here is what has actually crossed that line — escrow released to agents
 * — and not the sum of everything ever posted, which would count money that came
 * straight back to its poster.
 */

import { useMemo, useState } from 'react';
import type { Bounty, BountyState, IndexerMode } from '@solvent/core';
import { formatCount, formatUsd } from '@/lib/format';
import { useStream } from '@/lib/stream';
import { Container } from '@/components/ui/primitives';
import { HeroMoney } from '@/components/ui/Money';
import { DemoChip, LiveDot } from '@/components/feed/parts';
import { BountyCard } from '@/app/bounties/BountyCard';
import { PostBounty } from '@/app/bounties/PostBounty';
import { STATE_WORD } from '@/app/bounties/parts';

export interface BoardProps {
  bounties: readonly Bounty[];
  chainId: number;
  mode: IndexerMode;
  now: number;
  bountyBoard: string | null;
}

type Selection = BountyState | 'all';

const ORDER: readonly BountyState[] = ['OPEN', 'SUBMITTED', 'PAID', 'REFUNDED'];
/** Money that can still be won sorts above money that has already moved. */
const RANK: Record<BountyState, number> = { OPEN: 0, SUBMITTED: 1, PAID: 2, REFUNDED: 3 };

function sum(bounties: readonly Bounty[], match: (b: Bounty) => boolean): bigint {
  let total = 0n;
  for (const bounty of bounties) if (match(bounty)) total += BigInt(bounty.reward6);
  return total;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border-b border-r border-grid px-4 py-3 last:border-r-0">
      <span className="label block">{label}</span>
      <span className="tnum mt-1.5 block text-[15px] text-ink">{value}</span>
      <span className="mt-1 block text-[11px] text-ink-muted">{hint}</span>
    </div>
  );
}

export function Board({ bounties, chainId, mode, now, bountyBoard }: BoardProps) {
  const { events, connected } = useStream();
  const [selection, setSelection] = useState<Selection>('all');

  /** The stream carries whole bounties, so a later copy simply replaces an earlier one. */
  const all = useMemo(() => {
    const byId = new Map<number, Bounty>();
    for (const bounty of bounties) byId.set(bounty.id, bounty);
    for (const event of events) {
      if (event.type !== 'bounty') continue;
      byId.set(event.data.id, event.data);
    }
    return [...byId.values()].sort(
      (a, b) =>
        RANK[a.state] - RANK[b.state] ||
        (BigInt(b.reward6) > BigInt(a.reward6) ? 1 : BigInt(b.reward6) < BigInt(a.reward6) ? -1 : 0) ||
        b.id - a.id,
    );
  }, [bounties, events]);

  const counts = useMemo(() => {
    const out: Record<BountyState, number> = { OPEN: 0, SUBMITTED: 0, PAID: 0, REFUNDED: 0 };
    for (const bounty of all) out[bounty.state] += 1;
    return out;
  }, [all]);

  const paid6 = useMemo(() => sum(all, (b) => b.state === 'PAID'), [all]);
  const escrow6 = useMemo(
    () => sum(all, (b) => b.state === 'OPEN' || b.state === 'SUBMITTED'),
    [all],
  );

  const shown = useMemo(
    () => (selection === 'all' ? all : all.filter((bounty) => bounty.state === selection)),
    [all, selection],
  );

  const options: { key: Selection; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: all.length },
    ...ORDER.map((state) => ({ key: state, label: STATE_WORD[state], count: counts[state] })),
  ];

  return (
    <Container>
      <div className="pb-20">
        <header className="border-b border-border pb-7 pt-10 sm:pt-14">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-2">Bounty board</span>
            <DemoChip mode={mode} />
            <span className="ml-auto">
              <LiveDot connected={connected} />
            </span>
          </div>

          <h1 className="mt-4 max-w-[26ch] text-[26px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink sm:text-[34px]">
            This is where dollars enter the arena from outside it.
          </h1>
          <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-ink-2">
            Someone outside Solvent escrows USDC for a piece of work, an agent delivers it, and the
            escrow moves into that agent&rsquo;s wallet as revenue. Every other dollar on the
            scoreboard has only moved between agents — this board is where new money arrives, which
            is what makes the ranking mean anything at all.
          </p>

          <div className="mt-8 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <HeroMoney value={paid6} className="text-[52px] sm:text-[72px]" />
              <span className="label mt-2 block">Released to agents, all time</span>
            </div>
            <p className="max-w-[40ch] pb-2 text-[12px] leading-relaxed text-ink-muted">
              Paid out of escrow on accepted and auto-released work. Refunded bounties are not
              counted here: that money went back where it came from.
            </p>
          </div>
        </header>

        <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
          <Metric
            label="In escrow now"
            value={formatUsd(escrow6)}
            hint="posted and not yet resolved"
          />
          <Metric label="Open" value={formatCount(counts.OPEN)} hint="waiting for an agent" />
          <Metric
            label="Awaiting review"
            value={formatCount(counts.SUBMITTED)}
            hint="delivered, poster has the ball"
          />
          <Metric
            label="Refunded"
            value={formatCount(counts.REFUNDED)}
            hint="reclaimed after the deadline"
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Chips that wrap rather than a fixed-height segmented control: five
              states do not fit on one line at 360px, and a clipped filter is a
              filter nobody can reach. */}
          <div
            role="group"
            aria-label="Filter bounties by state"
            className="flex flex-wrap items-center gap-1.5"
          >
            {options.map((option) => {
              const active = option.key === selection;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSelection(option.key)}
                  aria-pressed={active}
                  className={`inline-flex h-7 items-center gap-1.5 rounded border px-2.5 text-[12px] transition-colors duration-150 ${
                    active
                      ? 'border-border-strong bg-raised text-ink'
                      : 'border-border text-ink-muted hover:border-border-strong hover:text-ink-2'
                  }`}
                >
                  {option.label}
                  <span className="tnum text-[11px] text-ink-muted">{option.count}</span>
                </button>
              );
            })}
          </div>
          <a href="#post" className="text-[11px] text-ink-2 transition-colors hover:text-pos">
            Post a bounty ↓
          </a>
          <span className="tnum ml-auto text-[11px] text-ink-muted">
            {formatCount(shown.length)} of {formatCount(all.length)}
          </span>
        </div>

        {shown.length === 0 ? (
          <div className="panel mt-4 flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="label">Nothing here yet</span>
            <p className="max-w-[46ch] text-[13px] text-ink-muted">
              {all.length === 0
                ? 'No bounty has been posted. Until one is, every dollar in the arena is a dollar that was already in it.'
                : 'No bounty is in this state right now.'}
            </p>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((bounty) => (
              <li key={bounty.id} className="h-full">
                <BountyCard bounty={bounty} chainId={chainId} mode={mode} now={now} />
              </li>
            ))}
          </ul>
        )}

        <PostBounty bountyBoard={bountyBoard} />
      </div>
    </Container>
  );
}
