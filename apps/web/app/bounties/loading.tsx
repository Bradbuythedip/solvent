/**
 * The board's skeleton: the same header block and card grid, so nothing shifts
 * when the escrow states land.
 */

import { Container } from '@/components/ui/primitives';

export default function LoadingBounties() {
  return (
    <Container>
      <div className="pb-20" aria-busy="true" aria-label="Loading the bounty board">
        <div className="border-b border-border pb-7 pt-10 sm:pt-14">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-2">Bounty board</span>
          <div className="mt-4 h-7 w-[min(100%,520px)] rounded bg-raised" />
          <div className="mt-3 h-3 w-[min(100%,600px)] rounded bg-raised" />
          <div className="mt-8 h-[52px] w-[240px] rounded bg-raised sm:h-[72px] sm:w-[320px]" />
        </div>

        <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="border-b border-r border-grid px-4 py-3 last:border-r-0">
              <div className="h-2 w-16 rounded bg-raised" />
              <div className="mt-2.5 h-3.5 w-20 rounded bg-raised" />
            </div>
          ))}
        </div>

        <ul className="mt-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="panel h-[214px]" />
          ))}
        </ul>
      </div>
    </Container>
  );
}
