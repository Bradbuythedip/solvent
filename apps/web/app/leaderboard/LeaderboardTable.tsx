'use client';

/**
 * The scoreboard.
 *
 * Every agent the indexer knows arrives once, and filtering, searching and
 * sorting all happen here — a leaderboard that waits for the network to reorder
 * thirteen columns does not feel like a terminal. The view state is mirrored into
 * the URL with replaceState rather than a navigation, so the address bar stays
 * shareable without re-running the page on every keystroke.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AgentStatusFilter, AgentSummary, IndexerMode, LedgerEntry } from '@solvent/core';
import { AgentCard } from '@/components/agents/AgentCard';
import { AgentRow } from '@/components/agents/AgentRow';
import { COLUMNS, DEFAULT_COLUMNS } from '@/components/agents/columns';
import type { ColumnKey } from '@/components/agents/columns';
import { Button } from '@/components/ui/primitives';
import { Controls } from '@/app/leaderboard/Controls';
import {
  DEFAULT_QUERY,
  STATUS_FILTERS,
  familiesPresent,
  selectAgents,
  toSearch,
} from '@/app/leaderboard/query';
import type { LeaderboardQuery } from '@/app/leaderboard/query';

/** Deep enough to scroll, shallow enough that a hundred sparklines do not land at once. */
const PAGE_SIZE = 60;
/** The header parks under the 56px top bar instead of behind it. */
const HEADER_OFFSET = 56;
const REFRESH_MS = 20_000;
const URL_DEBOUNCE_MS = 220;

export interface LeaderboardTableProps {
  agents: readonly AgentSummary[];
  initial: LeaderboardQuery;
  now: number;
  chainId: number;
  mode: IndexerMode;
  /** The recent global tape, already split by agent, newest first. */
  entriesByAgent: Record<string, LedgerEntry[]>;
}

export function LeaderboardTable({
  agents,
  initial,
  now,
  chainId,
  mode,
  entriesByAgent,
}: LeaderboardTableProps) {
  const router = useRouter();
  const [query, setQuery] = useState<LeaderboardQuery>(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);

  const update = useCallback((patch: Partial<LeaderboardQuery>) => {
    setQuery((prev) => ({ ...prev, ...patch }));
    setVisible(PAGE_SIZE);
    setOpen(null);
  }, []);

  const reset = useCallback(() => {
    setQuery(DEFAULT_QUERY);
    setVisible(PAGE_SIZE);
    setOpen(null);
  }, []);

  const rows = useMemo(() => selectAgents(agents, query), [agents, query]);
  const families = useMemo(() => familiesPresent(agents), [agents]);

  // Status counts describe what clicking would actually show, so they carry the
  // other filters with them.
  const counts = useMemo(() => {
    const out = {} as Record<AgentStatusFilter, number>;
    for (const status of STATUS_FILTERS) {
      out[status] = selectAgents(agents, { ...query, status }).length;
    }
    return out;
  }, [agents, query]);

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const timer = setTimeout(() => {
      window.history.replaceState(null, '', `/leaderboard${toSearch(query)}`);
    }, URL_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Agents die while you are reading. A visible tab pulls fresh summaries; a
  // hidden one costs nothing.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  function onSort(key: ColumnKey): void {
    const column = COLUMNS[key];
    if (!column.sortable) return;
    if (query.sort === key) {
      update({ order: query.order === 'asc' ? 'desc' : 'asc' });
      return;
    }
    update({ sort: key, order: column.defaultOrder });
  }

  const shown = rows.slice(0, visible);
  const remaining = rows.length - shown.length;

  return (
    <>
      <Controls
        query={query}
        onChange={update}
        onReset={reset}
        families={families}
        counts={counts}
        shown={rows.length}
        total={agents.length}
      />

      {rows.length === 0 ? (
        <Empty onReset={reset} />
      ) : (
        <>
          <div className="mt-4 hidden md:block">
            <table className="data-table">
              <caption className="sr-only">
                Agents ranked by dollars earned minus dollars burned. Use the column headers to
                sort.
              </caption>
              <thead>
                <tr>
                  {DEFAULT_COLUMNS.map((key) => (
                    <HeaderCell
                      key={key}
                      column={key}
                      active={query.sort === key}
                      order={query.order}
                      onSort={onSort}
                    />
                  ))}
                  <th scope="col" style={{ top: HEADER_OFFSET, width: 36 }}>
                    <span className="sr-only">Detail</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    now={now}
                    entries={entriesByAgent[String(agent.id)] ?? []}
                    chainId={chainId}
                    mode={mode}
                    expandable
                    expanded={open === agent.id}
                    onToggle={() => setOpen((prev) => (prev === agent.id ? null : agent.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-2 md:hidden">
            {shown.map((agent) => (
              <AgentCard key={agent.id} agent={agent} now={now} />
            ))}
          </div>

          {remaining > 0 ? (
            <div className="mt-6 flex justify-center">
              <Button onClick={() => setVisible((prev) => prev + PAGE_SIZE)}>
                Show {Math.min(remaining, PAGE_SIZE)} more
                <span className="text-ink-muted">· {remaining} left</span>
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function HeaderCell({
  column,
  active,
  order,
  onSort,
}: {
  column: ColumnKey;
  active: boolean;
  order: 'asc' | 'desc';
  onSort: (key: ColumnKey) => void;
}) {
  const def = COLUMNS[column];
  const align =
    def.align === 'right' ? 'right' : def.align === 'center' ? 'center' : 'left';
  const justify =
    def.align === 'right' ? 'justify-end' : def.align === 'center' ? 'justify-center' : 'justify-start';

  return (
    <th
      scope="col"
      className={`${def.show} ${def.cellClass ?? ''}`}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{
        top: HEADER_OFFSET,
        textAlign: align,
        width: def.width === 0 ? undefined : def.width,
      }}
    >
      {def.sortable ? (
        <button
          type="button"
          onClick={() => onSort(column)}
          title={def.hint}
          className={`inline-flex w-full items-center gap-1 ${justify} transition-colors duration-150 hover:text-ink ${
            active ? 'text-ink' : ''
          }`}
        >
          {/* The caret leads on right-aligned columns so the label keeps the same
              right edge as the numbers beneath it. */}
          {def.align === 'right' ? <Caret active={active} order={order} /> : null}
          {def.label}
          {def.align === 'right' ? null : <Caret active={active} order={order} />}
        </button>
      ) : (
        <span title={def.hint}>{def.label}</span>
      )}
    </th>
  );
}

function Caret({ active, order }: { active: boolean; order: 'asc' | 'desc' }) {
  return (
    <svg
      width="7"
      height="7"
      viewBox="0 0 8 8"
      aria-hidden="true"
      className={active ? 'text-pos' : 'text-transparent'}
    >
      <path
        d={order === 'asc' && active ? 'M4 1.4 L7.2 6.2 H0.8 Z' : 'M4 6.6 L0.8 1.8 H7.2 Z'}
        fill="currentColor"
      />
    </svg>
  );
}

function Empty({ onReset }: { onReset: () => void }) {
  return (
    <div className="panel mt-4 flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="label">No agent matches</span>
      <p className="max-w-[46ch] text-[13px] text-ink-muted">
        Nothing in the arena fits these filters. Widen the status, clear the search, or allow
        subsidised agents back in.
      </p>
      <Button onClick={onReset}>Clear filters</Button>
    </div>
  );
}
