'use client';

/**
 * Bounty board furniture.
 *
 * A bounty's state is NOT a solvency state, so it does not get a solvency colour.
 * Colour in this product means one thing — whether an agent can still pay its
 * rent — and a board of escrow states borrowing those hues would quietly make
 * "paid" look like "solvent". Every chip here is a shape plus a word in ink.
 */

import type { ReactNode } from 'react';
import type { BountyState } from '@solvent/core';
import { formatDuration } from '@/lib/format';
import { useCountdown } from '@/lib/hooks';

export const STATE_WORD: Record<BountyState, string> = {
  OPEN: 'Open',
  SUBMITTED: 'Submitted',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
};

/** What the state means for the escrow, in one clause. */
export const STATE_MEANING: Record<BountyState, string> = {
  OPEN: 'funded and waiting for an agent',
  SUBMITTED: 'a deliverable is in, the poster is reviewing',
  PAID: 'the escrow went to the agent',
  REFUNDED: 'the escrow went back to the poster',
};

function StateGlyph({ state }: { state: BountyState }) {
  const common = { width: 8, height: 8, viewBox: '0 0 8 8', 'aria-hidden': true as const };
  if (state === 'PAID') {
    return (
      <svg {...common} className="shrink-0">
        <path
          d="M1.2 4.2 L3.2 6.4 L6.8 1.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === 'REFUNDED') {
    return (
      <svg {...common} className="shrink-0">
        <path
          d="M7 6.4 A3 3 0 0 0 1.6 3.2 M1.6 3.2 L1.2 1 M1.6 3.2 L3.9 2.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (state === 'SUBMITTED') {
    return (
      <svg {...common} className="shrink-0">
        <rect x="0.9" y="0.9" width="6.2" height="6.2" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4 1.2 L4 6.8 L7.1 6.8 L7.1 1.2 Z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common} className="shrink-0">
      <path d="M4 0.8 L7.2 4 L4 7.2 L0.8 4 Z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function BountyStateChip({ state }: { state: BountyState }) {
  const muted = state === 'REFUNDED';
  return (
    <span
      title={STATE_MEANING[state]}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-raised px-2 py-0.5 text-[11px] font-medium ${
        muted ? 'text-ink-muted' : 'text-ink-2'
      }`}
    >
      <StateGlyph state={state} />
      {STATE_WORD[state]}
    </span>
  );
}

/**
 * Seconds left until `target`, ticking.
 *
 * `now` is the indexer's clock at render, so the first paint and the hydrated
 * one agree; the shared clock in lib/hooks takes over after mount and stops
 * entirely under prefers-reduced-motion.
 */
export function useRemaining(target: number, now: number): number {
  return useCountdown(target, Math.max(0, target - now));
}

export function Remaining({ seconds, className = '' }: { seconds: number; className?: string }) {
  return <span className={`tnum ${className}`}>{seconds <= 0 ? 'now' : formatDuration(seconds)}</span>;
}

/** A label/value line inside a card. Labels left, values right, one rhythm. */
export function Row({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1 ${className}`}>
      <span className="label shrink-0">{label}</span>
      <span className="mono min-w-0 truncate text-right text-[12px] text-ink-2">{children}</span>
    </div>
  );
}

export function ExternalLink({
  href,
  children,
  title,
  className = '',
}: {
  href: string;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title ?? href}
      className={`inline-flex items-baseline gap-1 text-ink-2 transition-colors duration-150 hover:text-pos ${className}`}
    >
      <span className="min-w-0 truncate">{children}</span>
      <span aria-hidden="true" className="shrink-0 text-[10px]">
        ↗
      </span>
    </a>
  );
}
