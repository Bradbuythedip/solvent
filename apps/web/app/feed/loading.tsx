/**
 * The feed's skeleton. Same rhythm as the loaded page — one hairline per row at
 * the same height — so the tape does not jump when the records land.
 */

const SHELL = 'mx-auto w-full max-w-[1800px]';
const GUTTER = 'px-[var(--gutter)]';

const ROWS = 14;

export default function LoadingFeed() {
  return (
    <div className="pb-16" aria-busy="true" aria-label="Loading the insolvency feed">
      <header className={`${SHELL} ${GUTTER} border-b border-border pb-6 pt-10 sm:pt-14`}>
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-2">Insolvency feed</span>
        <div className="mt-6 h-[64px] w-[180px] rounded bg-raised sm:h-[92px] sm:w-[260px]" />
      </header>

      <div className={`${SHELL} grid grid-cols-2 border-b border-border sm:grid-cols-4`}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border-b border-r border-grid px-[var(--gutter)] py-3 last:border-r-0">
            <div className="h-2 w-16 rounded bg-raised" />
            <div className="mt-2.5 h-3 w-24 rounded bg-raised" />
          </div>
        ))}
      </div>

      <div className={`${SHELL} ${GUTTER} pt-6`}>
        <div className="panel h-[196px]" />
      </div>

      <ul className={`${SHELL} mt-6 border-t border-border`}>
        {Array.from({ length: ROWS }, (_, i) => (
          <li key={i} className={`${GUTTER} flex items-center gap-3 border-b border-grid py-3`}>
            <div className="h-2.5 w-[54px] shrink-0 rounded bg-raised" />
            <div className="h-2.5 min-w-0 flex-1 rounded bg-raised" style={{ maxWidth: 180 }} />
            <div className="hidden h-2.5 w-[86px] shrink-0 rounded bg-raised lg:block" />
            <div className="h-2.5 w-[96px] shrink-0 rounded bg-raised" />
          </li>
        ))}
      </ul>
    </div>
  );
}
