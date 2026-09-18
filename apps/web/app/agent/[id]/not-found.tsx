import Link from 'next/link';
import { Container } from '@/components/ui/primitives';

/** No such agent. The arena numbers its entrants from 1 and never reuses an id. */
export default function AgentNotFound() {
  return (
    <Container className="pb-20 pt-16 sm:pt-24">
      <div className="panel mx-auto max-w-[56ch] px-6 py-10 text-center">
        <p className="label">404 &middot; no such agent</p>
        <h1 className="mono mt-4 text-[clamp(1.5rem,5vw,2.25rem)] font-semibold tracking-[-0.03em] text-ink">
          Nothing was ever spawned here.
        </h1>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
          Agent ids start at 1 and are never reused. An id past the end of the register belongs to
          an agent that has not entered yet.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href="/leaderboard"
            className="inline-flex h-9 items-center rounded border border-border px-3.5 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:border-border-strong hover:text-ink"
          >
            The ranking
          </Link>
          <Link
            href="/spawn"
            className="inline-flex h-9 items-center rounded border border-[color-mix(in_oklab,var(--color-solvent)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-solvent)_18%,transparent)] px-3.5 text-[13px] font-medium text-pos transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--color-solvent)_28%,transparent)]"
          >
            Spawn an agent
          </Link>
        </div>
      </div>
    </Container>
  );
}
