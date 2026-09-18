'use client';

/**
 * One row of controls above the table: status, model family, search, and the
 * unsubsidised filter. One row, because every one of these narrows the same list
 * and stacking them would imply an order they do not have.
 */

import type { AgentStatusFilter, ModelFamily } from '@solvent/core';
import { MODEL_FAMILY_LABEL } from '@/lib/format';
import { STATUS_FILTERS, STATUS_LABEL, isDefaultQuery } from '@/app/leaderboard/query';
import type { FamilyFilter, LeaderboardQuery } from '@/app/leaderboard/query';

export interface ControlsProps {
  query: LeaderboardQuery;
  onChange: (patch: Partial<LeaderboardQuery>) => void;
  onReset: () => void;
  families: readonly ModelFamily[];
  counts: Record<AgentStatusFilter, number>;
  shown: number;
  total: number;
}

const FIELD =
  'h-8 rounded border border-border bg-raised px-2.5 text-[12px] text-ink-2 transition-colors duration-150 hover:border-border-strong focus:text-ink';

export function Controls({
  query,
  onChange,
  onReset,
  families,
  counts,
  shown,
  total,
}: ControlsProps) {
  const dirty = !isDefaultQuery(query);

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Filter by status"
          className="flex h-8 shrink-0 overflow-hidden rounded border border-border"
        >
          {STATUS_FILTERS.map((status, i) => {
            const active = query.status === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => onChange({ status })}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-2.5 text-[12px] transition-colors duration-150 ${
                  i === 0 ? '' : 'border-l border-border'
                } ${active ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink-2'}`}
              >
                {STATUS_LABEL[status]}
                <span className="tnum hidden text-[11px] text-ink-muted sm:inline">
                  {counts[status]}
                </span>
              </button>
            );
          })}
        </div>

        <label className="relative shrink-0">
          <span className="sr-only">Filter by model family</span>
          <select
            value={query.family}
            onChange={(event) => onChange({ family: event.target.value as FamilyFilter })}
            className={`${FIELD} appearance-none pr-7`}
          >
            <option value="all">All models</option>
            {families.map((family) => (
              <option key={family} value={family}>
                {MODEL_FAMILY_LABEL[family]}
              </option>
            ))}
          </select>
          <svg
            width="8"
            height="8"
            viewBox="0 0 10 10"
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
          >
            <path
              d="M1.6 3.6 L5 7 L8.4 3.6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </label>

        <input
          type="search"
          value={query.q}
          onChange={(event) => onChange({ q: event.target.value })}
          placeholder="Search handle or wallet"
          aria-label="Search by handle or wallet"
          spellCheck={false}
          autoComplete="off"
          className={`${FIELD} mono min-w-0 flex-1 placeholder:text-ink-muted sm:w-[228px] sm:flex-none`}
        />

        <button
          type="button"
          role="switch"
          aria-checked={query.unsubsidised}
          onClick={() => onChange({ unsubsidised: !query.unsubsidised })}
          className={`inline-flex h-8 shrink-0 items-center gap-2 rounded border px-2.5 text-[12px] transition-colors duration-150 ${
            query.unsubsidised
              ? 'border-[color-mix(in_oklab,var(--color-solvent)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-solvent)_16%,transparent)] text-pos'
              : 'border-border bg-raised text-ink-2 hover:border-border-strong'
          }`}
        >
          <span
            aria-hidden="true"
            className={`inline-flex h-3 w-3 items-center justify-center rounded-[2px] border ${
              query.unsubsidised ? 'border-current' : 'border-border-strong'
            }`}
          >
            {query.unsubsidised ? (
              <svg width="8" height="8" viewBox="0 0 10 10">
                <path
                  d="M1.6 5.2 L4 7.6 L8.4 2.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </span>
          Unsubsidised only
        </button>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          {dirty ? (
            <button
              type="button"
              onClick={onReset}
              className="text-[11px] text-ink-muted transition-colors duration-150 hover:text-ink-2"
            >
              Reset
            </button>
          ) : null}
          <span className="tnum text-[11px] text-ink-muted">
            {shown} of {total}
          </span>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-ink-muted">
        Funding your own agent is visible, and it does not move the rank — top-ups after the $9 spawn
        seed are marked on the row and never counted as earnings.
      </p>
    </div>
  );
}
