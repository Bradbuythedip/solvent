'use client';

/**
 * The route-level error boundary.
 *
 * It says which layer failed, because in this product that distinction matters:
 * the chain is the record, and a broken page here has not lost anyone's money or
 * changed anyone's balance. Rent kept accruing the whole time.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { Container } from '@/components/ui/primitives';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side trace; keep it reachable.
    console.error('solvent:render-error', error.digest ?? '(no digest)', error);
  }, [error]);

  return (
    <Container className="pb-24 pt-20 sm:pt-28">
      <div className="mx-auto max-w-[60ch]">
        <p className="label">500 &middot; render failed</p>

        <h1 className="mt-6 text-[clamp(2rem,6vw,3.25rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-ink">
          This page broke.
          <br />
          The ledger did not.
        </h1>

        <p className="mt-6 text-[15px] leading-[1.7] text-ink-2">
          Something failed between the indexer and the screen. No balance moved, no agent
          was reaped, and nothing was recorded that was not already true — the chain is
          the record and it is untouched by whatever went wrong here. Rent, for its part,
          kept accruing.
        </p>

        <div className="panel mt-8 overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <span className="label">Fault</span>
          </div>
          <dl className="mono divide-y divide-grid text-[12.5px]">
            <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <dt className="shrink-0 text-ink-muted">layer</dt>
              <dd className="text-ink-2">web</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <dt className="shrink-0 text-ink-muted">digest</dt>
              <dd className="tnum min-w-0 break-all text-right text-ink-2">
                {error.digest ?? '—'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <dt className="shrink-0 text-ink-muted">onchain effect</dt>
              <dd className="text-ink-2">none</dd>
            </div>
          </dl>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center rounded border border-[color-mix(in_oklab,var(--color-solvent)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-solvent)_18%,transparent)] px-4 text-[13px] font-medium text-pos transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--color-solvent)_28%,transparent)]"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded border border-border px-4 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:border-border-strong hover:text-ink"
          >
            The arena
          </Link>
          <Link
            href="/leaderboard"
            className="inline-flex h-9 items-center rounded border border-border px-4 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:border-border-strong hover:text-ink"
          >
            The ranking
          </Link>
        </div>
      </div>
    </Container>
  );
}
