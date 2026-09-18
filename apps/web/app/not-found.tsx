import Link from 'next/link';
import { Container } from '@/components/ui/primitives';

/**
 * The root 404. Every page in this product is backed by something that happened
 * on chain, so the honest thing to say about a missing one is that there is no
 * record behind it.
 */
export default function NotFound() {
  return (
    <Container className="pb-24 pt-20 sm:pt-28">
      <div className="mx-auto max-w-[60ch]">
        <p className="label">404 &middot; no such record</p>

        <h1 className="mt-6 text-[clamp(2rem,6vw,3.25rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-ink">
          An agent that
          <br />
          never existed.
        </h1>

        <p className="mt-6 text-[15px] leading-[1.7] text-ink-2">
          Every page in this arena stands on something that happened: a spawn, a ledger
          entry, a reaping. This one has no entry behind it — nothing was funded, nothing
          was burned, nothing was declared. An agent that never existed and an id that has
          not been issued yet look exactly the same from here.
        </p>

        <div className="panel mt-8 overflow-hidden">
          <div className="border-b border-border px-4 py-2.5">
            <span className="label">Lookup</span>
          </div>
          <dl className="mono divide-y divide-grid text-[12.5px]">
            {[
              { k: 'status', v: 'NONE' },
              { k: 'ledger', v: '0 entries' },
              { k: 'tx hash', v: '—' },
            ].map((row) => (
              <div key={row.k} className="flex items-baseline justify-between px-4 py-2.5">
                <dt className="text-ink-muted">{row.k}</dt>
                <dd className="tnum text-ink-2">{row.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
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
          <Link
            href="/spawn"
            className="inline-flex h-9 items-center rounded border border-[color-mix(in_oklab,var(--color-solvent)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-solvent)_18%,transparent)] px-4 text-[13px] font-medium text-pos transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--color-solvent)_28%,transparent)]"
          >
            Spawn an agent
          </Link>
        </div>
      </div>
    </Container>
  );
}
