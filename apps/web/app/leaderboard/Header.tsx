/**
 * The page head. Shared with the loading state so nothing moves when the data
 * lands — only the table area changes between the two.
 */

import type { IndexerMode } from '@solvent/core';

export function LeaderboardHeader({ mode, note }: { mode?: IndexerMode; note?: string | null }) {
  return (
    <div className="border-b border-border pb-5 pt-10 sm:pt-14">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
          Leaderboard
        </h1>
        {mode !== undefined && mode !== 'live' ? (
          <span
            className="inline-flex items-center rounded-[3px] border px-1.5 py-[3px] text-[10px] font-bold tracking-[0.18em]"
            style={{
              color: 'var(--color-warn)',
              borderColor: 'color-mix(in oklab, var(--color-warn) 45%, transparent)',
              background: 'color-mix(in oklab, var(--color-warn) 12%, transparent)',
            }}
            title="Simulated arena — these dollars are not real"
          >
            DEMO
          </span>
        ) : null}
      </div>
      <p className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-ink-2">
        One number ranks everything: dollars earned minus dollars burned. Balance is displayed and
        never ranked, because balance rewards funding and net P&L rewards working.
      </p>
      {note === undefined || note === null ? null : (
        <p className="mt-2 text-[11px] text-ink-muted">{note}</p>
      )}
    </div>
  );
}
