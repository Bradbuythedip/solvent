'use client';

/**
 * One bounty.
 *
 * The reward is the loudest thing on the card because it is the number that
 * decides whether an agent bothers. Everything else is the fine print that makes
 * the number credible: who posted it, what the spec is, when the door closes,
 * and — once an agent has delivered — how long the poster has left to answer
 * before anyone can push the escrow across.
 */

import Link from 'next/link';
import type { Bounty, IndexerMode } from '@solvent/core';
import { agentPath, formatUsd, shortHex } from '@/lib/format';
import { AddressLink, TxLink } from '@/components/feed/parts';
import {
  BountyStateChip,
  ExternalLink,
  Remaining,
  Row,
  STATE_MEANING,
  useRemaining,
} from '@/app/bounties/parts';

export interface BountyCardProps {
  bounty: Bounty;
  chainId: number;
  mode: IndexerMode;
  /** The indexer's clock at render — the seed every countdown continues from. */
  now: number;
}

export function BountyCard({ bounty, chainId, mode, now }: BountyCardProps) {
  const toDeadline = useRemaining(bounty.deadline, now);
  const releaseAt = bounty.submittedAt === null ? 0 : bounty.submittedAt + bounty.reviewWindow;
  const toRelease = useRemaining(releaseAt, now);

  const open = bounty.state === 'OPEN';
  const submitted = bounty.state === 'SUBMITTED';
  const escrowed = open || submitted;
  /** A deadline still ahead of us is a countdown; one behind us is a date. */
  const closing = escrowed && toDeadline > 0;

  return (
    <article className="panel flex h-full flex-col p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="tnum shrink-0 text-[11px] text-ink-muted">#{bounty.id}</span>
          <BountyStateChip state={bounty.state} />
        </div>
        <div className="shrink-0 text-right">
          <span className="tnum block text-[19px] leading-none text-ink">
            {formatUsd(BigInt(bounty.reward6))}
          </span>
          <span className="label mt-1 block">{escrowed ? 'in escrow' : 'reward'}</span>
        </div>
      </div>

      <h3 className="mt-3 text-[14px] font-medium leading-snug text-ink">{bounty.title}</h3>
      <p className="mt-1 text-[11px] text-ink-muted">{STATE_MEANING[bounty.state]}</p>

      {/* Cards stretch to their row, so the metadata sits on the card's floor
          rather than leaving a ragged hole under a short one. */}
      <div className="flex-1" aria-hidden="true" />

      <div className="mt-3 border-t border-grid pt-2">
        <Row label="Poster">
          <AddressLink
            address={bounty.poster}
            chainId={chainId}
            mode={mode}
            title={`Posted by ${bounty.poster}`}
          />
        </Row>

        <Row label="Spec">
          <ExternalLink
            href={bounty.specURI}
            title={`${bounty.specURI} — hashed as ${bounty.specHash}`}
          >
            {shortSpec(bounty.specURI)}
          </ExternalLink>
        </Row>

        <Row label={closing ? 'Closes in' : 'Deadline'}>
          {closing ? (
            <Remaining seconds={toDeadline} className="text-ink" />
          ) : open ? (
            <span className="text-ink-muted">passed · reclaimable</span>
          ) : (
            <span className="tnum">{stampUtc(bounty.deadline)}</span>
          )}
        </Row>

        <Row label="Posted tx">
          <TxLink hash={bounty.txHash} chainId={chainId} mode={mode} />
        </Row>
      </div>

      {bounty.claimantAgentId === null ? null : (
        <div className="mt-3 rounded border border-border bg-raised px-3 py-2">
          <Row label={submitted ? 'Claimed by' : 'Delivered by'} className="py-0.5">
            <Link
              href={agentPath(bounty.claimantAgentId)}
              className="text-ink transition-colors duration-150 hover:text-pos"
            >
              {bounty.claimantHandle ?? `agent ${bounty.claimantAgentId}`}
            </Link>
          </Row>

          {bounty.deliverableURI === null ? null : (
            <Row label="Deliverable" className="py-0.5">
              <ExternalLink href={bounty.deliverableURI}>
                {shortSpec(bounty.deliverableURI)}
              </ExternalLink>
            </Row>
          )}

          {submitted ? (
            <>
              <Row label="Auto-release" className="py-0.5">
                {toRelease > 0 ? (
                  <Remaining seconds={toRelease} className="text-ink" />
                ) : (
                  <span className="text-ink">releasable now</span>
                )}
              </Row>
              <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">
                If the poster goes silent past the review window, anyone can release the escrow to
                the agent.
              </p>
            </>
          ) : null}
        </div>
      )}
    </article>
  );
}

/**
 * A spec link shows the file name, which is the part a reader recognises — unless
 * the file name carries no information ("9.md"), in which case the host does.
 */
function shortSpec(uri: string): string {
  try {
    const url = new URL(uri);
    const name = url.pathname.split('/').filter(Boolean).pop();
    if (name === undefined || name === '') return url.hostname;
    const stem = name.replace(/\.[a-z0-9]{1,5}$/i, '');
    return stem.length <= 3 || /^\d+$/.test(stem) ? url.hostname : name;
  } catch {
    return shortHex(uri, 12, 6);
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Minutes, not seconds: a deadline is not a stopwatch. UTC, never locale. */
function stampUtc(at: number): string {
  const d = new Date(at * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours(),
  )}:${pad2(d.getUTCMinutes())} UTC`;
}
