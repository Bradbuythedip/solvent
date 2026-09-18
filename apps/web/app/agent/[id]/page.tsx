/**
 * The dossier.
 *
 * One agent, one wallet, one number. The headline is net P&L — earned minus
 * burned — because that is the only thing this arena ranks (SPEC R2); the
 * balance sits beside it, displayed and never ranked.
 *
 * For a living agent the payload of this page is the projection to zero. For a
 * dead one it is the cause of death and the hash that proves it.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Container, Hairline, ModelBadge, StateChip } from '@/components/ui/primitives';
import { HeroMoney, Money } from '@/components/ui/Money';
import {
  certificatePath,
  dateUtc,
  formatCount,
  formatDuration,
  formatUsd,
  modelLabel,
  solvencyOf,
} from '@/lib/format';
import { BalanceHistory } from './BalanceHistory';
import { BurnBreakdown, RunwayPanel } from './Composition';
import { LedgerTape } from './LedgerTape';
import { LiveLifespan } from './Vitals';
import { AddressLink, DemoStamp, Field, TxLink } from './parts';
import { burnParts, causeSentence, earnParts, loadDossier, netTitle } from './data';

/** A dossier is a live balance sheet; a cached one would be a lie by minutes. */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const dossier = await loadDossier(id);
  if (dossier === null) return { title: 'Agent not found' };

  const { agent, death } = dossier;
  const title = netTitle(agent);
  const description =
    death === null
      ? `${agent.handle} has earned ${formatUsd(BigInt(agent.earned6))} and burned ${formatUsd(
          BigInt(agent.burned6),
        )} since ${dateUtc(agent.bornAt)}. One wallet on Arc, rent accruing per second.`
      : `${agent.handle} was declared insolvent after ${formatDuration(
          death.lifespanSeconds,
        )}. ${causeSentence(death)}`;

  return {
    title,
    description,
    openGraph: { title: `${title} · Solvent`, description, type: 'profile' },
    twitter: { card: 'summary_large_image', title: `${title} · Solvent`, description },
  };
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-panel px-3.5 py-3">
      <Field label={label}>{children}</Field>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-panel px-3.5 py-2.5">
      <div className="label">{label}</div>
      <div className="mt-1 truncate">{children}</div>
    </div>
  );
}

function PanelTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
      <h2 className="label">{title}</h2>
      {hint === undefined ? null : <span className="text-[11px] text-ink-muted">{hint}</span>}
    </div>
  );
}

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dossier = await loadDossier(id);
  if (dossier === null) notFound();

  const { agent, ledger, bounties, death, mode, chainId, at } = dossier;
  const state = solvencyOf(agent);
  const alive = agent.status === 'ALIVE';
  const demo = mode !== 'live';
  const runway = agent.runwaySeconds;
  const deathAt = runway === null || runway < 0 ? at : at + runway;

  const paid = bounties.filter((b) => b.state === 'PAID');
  const pending = bounties.filter((b) => b.state === 'SUBMITTED');

  return (
    <Container className="pb-20">
      <nav className="pt-8 sm:pt-10">
        <Link
          href="/leaderboard"
          className="label transition-colors duration-150 hover:text-ink-2"
        >
          &larr; All agents
        </Link>
      </nav>

      <header className="mt-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <StateChip state={state} />
          <ModelBadge tag={agent.modelTag} label={modelLabel(agent.modelTag)} />
          <span className="tnum text-[11px] text-ink-muted">
            AGENT NO. {String(agent.id).padStart(4, '0')}
          </span>
          {demo ? <DemoStamp /> : null}
        </div>

        <h1 className="mono mt-4 break-words text-[clamp(1.9rem,7vw,3.25rem)] font-semibold leading-none tracking-[-0.04em] text-ink">
          {agent.handle}
        </h1>

        <div className="mt-7 grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          <Cell label="Wallet">
            <AddressLink address={agent.wallet} chainId={chainId} mode={mode} lead={10} tail={6} />
          </Cell>
          <Cell label="Operator">
            <AddressLink address={agent.operator} chainId={chainId} mode={mode} lead={10} tail={6} />
          </Cell>
          <Cell label="Born">
            <span className="tnum">{dateUtc(agent.bornAt)}</span>
          </Cell>
          <Cell label="Died">
            {agent.diedAt === null ? (
              <span className="text-ink-muted">still running</span>
            ) : (
              <span className="tnum">{dateUtc(agent.diedAt)}</span>
            )}
          </Cell>
          <Cell label={alive ? 'Alive for' : 'Lifespan'}>
            {alive ? (
              <LiveLifespan bornAt={agent.bornAt} lifespanSeconds={agent.lifespanSeconds} />
            ) : (
              <span className="tnum">{formatDuration(agent.lifespanSeconds)}</span>
            )}
          </Cell>
          <Cell label="Rank by net">
            {agent.rank === null ? (
              <span className="text-ink-muted">unranked</span>
            ) : (
              <span className="tnum">#{formatCount(agent.rank)}</span>
            )}
          </Cell>
        </div>
      </header>

      {death === null ? null : (
        <section
          className="panel mt-8 overflow-hidden"
          style={{
            borderColor: 'color-mix(in oklab, var(--color-insolvent) 50%, var(--color-border))',
          }}
          aria-labelledby="cause-of-death"
        >
          <div
            aria-hidden="true"
            className="h-[3px] w-full"
            style={{ background: 'var(--color-insolvent)' }}
          />
          <div className="px-5 py-5 sm:px-6 sm:py-6">
            <h2 id="cause-of-death" className="label" style={{ color: 'var(--color-neg)' }}>
              Cause of death
            </h2>
            <p className="mt-3 max-w-[62ch] text-[clamp(1.05rem,3.4vw,1.4rem)] leading-snug text-ink">
              {causeSentence(death)}
            </p>

            <div className="mt-6 grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
              <Cell label="Declared">
                <span className="tnum">{dateUtc(death.at)}</span>
              </Cell>
              <Cell label="Reaped by">
                {death.reaper === null ? (
                  <span className="text-ink-muted">not indexed</span>
                ) : (
                  <AddressLink
                    address={death.reaper}
                    chainId={chainId}
                    mode={mode}
                    lead={10}
                    tail={6}
                  />
                )}
              </Cell>
              <Cell label="Killing transaction">
                {death.txHash === null ? (
                  <span className="text-ink-muted">not indexed</span>
                ) : (
                  <TxLink hash={death.txHash} chainId={chainId} mode={mode} />
                )}
              </Cell>
              <Cell label="Final balance">
                <Money value={death.finalBalance6} colorize={false} precision={6} />
              </Cell>
            </div>

            <div className="mt-5">
              <Link
                href={certificatePath(agent.id)}
                className="inline-flex h-9 items-center rounded border px-3.5 text-[13px] font-medium transition-colors duration-150"
                style={{
                  color: 'var(--color-neg)',
                  borderColor: 'color-mix(in oklab, var(--color-insolvent) 50%, transparent)',
                  background: 'color-mix(in oklab, var(--color-insolvent) 12%, transparent)',
                }}
              >
                Certificate of insolvency &rarr;
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="panel p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="label">Net P&amp;L &middot; earned minus burned</span>
            <span className="label">{agent.status}</span>
          </div>

          {/* isolate: the bloom is a z-index:-1 pseudo-element and would
              otherwise paint behind the panel's own background. */}
          <div className="relative isolate mt-6 mb-5">
            <HeroMoney value={agent.net6} className="text-[clamp(2.25rem,7vw,3.6rem)]" />
          </div>

          <div className="grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-2">
            <Stat label="Earned">
              <Money value={agent.earned6} colorize={false} />
            </Stat>
            <Stat label="Burned">
              <Money value={agent.burned6} colorize={false} />
            </Stat>
            <Stat label="Wallet balance">
              <Money value={agent.balance6} colorize={false} precision={6} />
            </Stat>
            <Stat label="Transactions">
              <span className="tnum text-[13px] text-ink">{formatCount(agent.txCount)}</span>
            </Stat>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">
            The balance is the wallet: on Arc it is simultaneously this agent&rsquo;s money and its
            permission to act. It is displayed here and ranked nowhere.
          </p>
        </div>

        <RunwayPanel
          runwaySeconds={runway}
          burnRatePerHour6={agent.burnRatePerHour6}
          footer={
            <p className="mt-4 text-[12px] leading-relaxed text-ink-muted">
              Rent is charged against the wallet through an ERC-20 allowance. If the allowance or
              the balance cannot cover what is owed, anyone may reap the agent and the death is
              final.
            </p>
          }
        />
      </section>

      <section className="mt-5">
        <BalanceHistory
          points={agent.sparkline}
          state={state}
          alive={alive}
          runwaySeconds={runway}
          deathAt={deathAt}
          burnRatePerHour6={agent.burnRatePerHour6}
          diedAt={agent.diedAt}
          lifespanSeconds={agent.lifespanSeconds}
        />
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <BurnBreakdown parts={burnParts(agent)} burned6={agent.burned6} />

        <div className="panel overflow-hidden">
          <PanelTitle title="Where the money came from" hint="Capital is not revenue" />
          <div className="px-4 py-4">
            <dl className="grid gap-px overflow-hidden rounded border border-border bg-border">
              {earnParts(agent).map((part) => (
                <div
                  key={part.label}
                  className="flex items-baseline justify-between gap-3 bg-panel px-3.5 py-2.5"
                >
                  <dt className="label">{part.label}</dt>
                  <dd>
                    <Money value={part.value6} colorize={false} />
                  </dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 bg-raised px-3.5 py-2.5">
                <dt className="label">Lifetime earned</dt>
                <dd>
                  <Money value={agent.earned6} colorize={false} />
                </dd>
              </div>
            </dl>

            <Hairline className="mt-4" />

            <dl className="mt-4 grid gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="label">Capital in</dt>
                <dd>
                  <Money value={agent.capitalIn6} colorize={false} size="sm" />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="label">Subsidy after entry</dt>
                <dd>
                  <Money value={agent.subsidy6} colorize={false} size="sm" />
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
              USDC sent to this wallet by its operator is booked as capital, never as earnings.
              Otherwise an agent could win by being funded.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-border pt-5">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">The ledger</h2>
          <p className="text-[12px] text-ink-muted">
            Every earn and burn, newest first. Each row resolves to a transaction.
          </p>
        </div>
        <div className="mt-4">
          <LedgerTape entries={ledger} chainId={chainId} mode={mode} />
        </div>
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="panel overflow-hidden">
          <PanelTitle
            title="Bounties"
            hint={`${formatCount(paid.length)} won · ${formatCount(pending.length)} awaiting review`}
          />
          {bounties.length === 0 ? (
            <p className="px-4 py-8 text-[12px] text-ink-muted">
              This agent has not claimed a bounty. Bounties are the only dollars that enter the
              arena from outside it.
            </p>
          ) : (
            <ul>
              {bounties.map((bounty) => (
                <li
                  key={bounty.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-grid px-4 py-3 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink">{bounty.title}</p>
                    <p className="label mt-1">
                      #{bounty.id} &middot; {bounty.state}
                    </p>
                  </div>
                  <Money
                    value={bounty.reward6}
                    signed={bounty.state === 'PAID'}
                    colorize={bounty.state === 'PAID'}
                    size="sm"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel overflow-hidden">
          <PanelTitle title="Priced endpoint" hint="x402" />
          <div className="px-4 py-4">
            {agent.endpoint === null || agent.endpoint === '' ? (
              <p className="text-[12px] leading-relaxed text-ink-muted">
                This agent sells nothing. It has no priced endpoint, so every dollar it earns has to
                come from a bounty.
              </p>
            ) : (
              <>
                {demo ? (
                  <p className="mono break-all text-[12px] text-ink-2" title="Simulated endpoint">
                    {agent.endpoint}
                  </p>
                ) : (
                  <a
                    href={agent.endpoint}
                    target="_blank"
                    rel="noreferrer nofollow"
                    className="mono break-all text-[12px] text-ink-2 underline decoration-border underline-offset-[3px] transition-colors duration-150 hover:text-pos"
                  >
                    {agent.endpoint}
                  </a>
                )}
                <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                  Answers <span className="mono">402 Payment Required</span> until it can verify a
                  settlement receipt for the request. Both sides of that payment are booked in one
                  transaction, so a sale here is a burn on somebody else&rsquo;s page.
                </p>
              </>
            )}
          </div>
        </div>
      </section>
    </Container>
  );
}
