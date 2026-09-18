'use client';

/**
 * The tape: the last twelve things that happened, ledger entries and deaths in
 * one stream, newest first.
 *
 * Every row carries the transaction hash it came from (SPEC R7). In demo mode the
 * hash is minted from a seed and resolves to nothing, so it is rendered as plain
 * text rather than as a link to a 404 that would look like a receipt.
 *
 * Rows that arrive while you are watching animate in; an insolvency also flashes,
 * once. The animation classes are decided at merge time and never re-applied, and
 * rows only ever enter at the head, so a row that has flashed keeps its DOM node
 * and never flashes again. The flash is on the row and the slide is on its inner
 * box because a single element can only run one `animation`.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import type { IndexerMode, InsolvencyRecord, LedgerEntry } from '@solvent/core';
import { Money } from '@/components/ui/Money';
import { StateDot } from '@/components/ui/primitives';
import { agentPath, clockUtc, explorerTxUrl, formatDuration, shortHex } from '@/lib/format';
import { useStream } from '@/lib/stream';

const ROWS = 12;

/* One set of column widths, shared by the header and every row, so the tape reads
   as a column of numbers rather than a list of sentences. */
const COL_TIME = 'hidden w-[58px] shrink-0 sm:block';
const COL_LEAD = 'flex w-[36px] shrink-0 items-center';
const COL_TAG = 'hidden w-[78px] shrink-0 text-center sm:block';
const COL_AUX = 'hidden w-[94px] shrink-0 truncate xl:block';
const COL_AMOUNT = 'w-[78px] shrink-0 text-right';
const COL_TX = 'w-[78px] shrink-0 text-right';
const ROW_BOX = 'mono flex items-center gap-2 px-3 py-2 text-[11px] sm:gap-3 sm:px-4';

type Row =
  | { kind: 'entry'; key: string; at: number; live: boolean; entry: LedgerEntry }
  | { kind: 'death'; key: string; at: number; live: boolean; death: InsolvencyRecord };

const entryKey = (id: string): string => `e:${id}`;
const deathKey = (agentId: number): string => `d:${agentId}`;

function TxCell({ hash, chainId, mode }: { hash: string; chainId: number; mode: IndexerMode }) {
  const href = explorerTxUrl(chainId, hash, mode);
  const text = shortHex(hash, 6, 4);
  if (href === null) {
    return (
      <span
        className={`${COL_TX} text-ink-muted`}
        title="Simulated — this hash resolves to nothing on Arc"
      >
        {text}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={hash}
      className={`${COL_TX} text-ink-muted transition-colors duration-150 hover:text-ink`}
    >
      {text}
    </a>
  );
}

function Handle({ id, children }: { id: number; children: string }) {
  return (
    <Link
      href={agentPath(id)}
      className="mono min-w-0 flex-1 truncate text-[12px] text-ink transition-colors duration-150 hover:text-pos"
    >
      {children}
    </Link>
  );
}

export function Tape({
  initialEntries,
  initialDeaths,
  handles,
  chainId,
  mode,
}: {
  initialEntries: LedgerEntry[];
  initialDeaths: InsolvencyRecord[];
  handles: Record<string, string>;
  chainId: number;
  mode: IndexerMode;
}) {
  const { events } = useStream();

  const rows = useMemo<Row[]>(() => {
    const byKey = new Map<string, Row>();

    for (const entry of initialEntries) {
      const key = entryKey(entry.id);
      byKey.set(key, { kind: 'entry', key, at: entry.at, live: false, entry });
    }
    for (const death of initialDeaths) {
      const key = deathKey(death.agentId);
      byKey.set(key, { kind: 'death', key, at: death.at, live: false, death });
    }

    // Anything the server already sent keeps its non-live row: a replay is not
    // an arrival, and must not animate.
    for (const event of events) {
      if (event.type === 'entry') {
        const key = entryKey(event.data.id);
        if (byKey.has(key)) continue;
        byKey.set(key, { kind: 'entry', key, at: event.data.at, live: true, entry: event.data });
      } else if (event.type === 'insolvency') {
        const key = deathKey(event.data.agentId);
        if (byKey.has(key)) continue;
        byKey.set(key, { kind: 'death', key, at: event.data.at, live: true, death: event.data });
      }
    }

    return [...byKey.values()]
      .sort((a, b) => b.at - a.at || (a.key < b.key ? 1 : -1))
      .slice(0, ROWS);
  }, [events, initialEntries, initialDeaths]);

  /**
   * Deaths are rarer than ledger entries by two orders of magnitude, so a strict
   * newest-first window is usually all settlements. The tape keeps its ordering
   * honest and the last insolvency is pinned below it, labelled as out of
   * sequence rather than smuggled into it.
   */
  const latestDeath = useMemo<InsolvencyRecord | null>(() => {
    let best: InsolvencyRecord | null = null;
    for (const death of initialDeaths) if (best === null || death.at > best.at) best = death;
    for (const event of events) {
      if (event.type !== 'insolvency') continue;
      if (best === null || event.data.at > best.at) best = event.data;
    }
    return best;
  }, [events, initialDeaths]);

  const pinned = rows.some((row) => row.kind === 'death') ? null : latestDeath;

  return (
    <div className="panel overflow-hidden">
      <div className={`${ROW_BOX} border-b border-border text-[10px] tracking-[0.12em] text-ink-muted`}>
        <span className={COL_TIME}>UTC</span>
        <span className={COL_LEAD}>FLOW</span>
        <span className="min-w-0 flex-1 truncate">AGENT</span>
        <span className={COL_TAG}>TYPE</span>
        <span className={COL_AUX}>PARTY</span>
        <span className={COL_AMOUNT}>AMOUNT</span>
        <span className={COL_TX}>TX</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-[12px] text-ink-muted">Nothing has settled yet.</p>
      ) : (
        <ul>
          {rows.map((row) =>
            row.kind === 'death' ? (
              <li
                key={row.key}
                className={`border-b border-grid last:border-b-0 ${row.live ? 'death-flash' : ''}`}
              >
                <div className={`${ROW_BOX} ${row.live ? 'tape-in' : ''}`}>
                  <span className={`${COL_TIME} text-ink-muted`}>{clockUtc(row.at)}</span>
                  <span className={COL_LEAD}>
                    <StateDot state="dead" />
                  </span>
                  <Handle id={row.death.agentId}>{row.death.handle}</Handle>
                  <span
                    className={`${COL_TAG} text-[10px] tracking-[0.1em]`}
                    style={{ color: 'var(--color-neg)' }}
                    title={row.death.causeOfDeath}
                  >
                    INSOLVENT
                  </span>
                  <span className={`${COL_AUX} text-ink-muted`}>
                    {formatDuration(row.death.lifespanSeconds)} lived
                  </span>
                  <Money value={row.death.net6} signed size="xs" className={COL_AMOUNT} />
                  <TxCell hash={row.death.txHash} chainId={chainId} mode={mode} />
                </div>
              </li>
            ) : (
              <li key={row.key} className="border-b border-grid last:border-b-0">
                <div className={`${ROW_BOX} ${row.live ? 'tape-in' : ''}`}>
                  <span className={`${COL_TIME} text-ink-muted`}>{clockUtc(row.at)}</span>
                  <span className={`${COL_LEAD} text-[10px] tracking-[0.1em] text-ink-muted`}>
                    {row.entry.flow}
                  </span>
                  <Handle id={row.entry.agentId}>
                    {handles[String(row.entry.agentId)] ?? `agent ${row.entry.agentId}`}
                  </Handle>
                  <span className={COL_TAG}>
                    <span
                      className="inline-block w-full truncate rounded border border-border px-1 py-[1px] text-[10px] text-ink-2"
                      title={
                        row.entry.category === 'CAPITAL'
                          ? 'Capital in is recorded, never counted as revenue (R1)'
                          : (row.entry.memo ?? undefined)
                      }
                    >
                      {row.entry.category}
                    </span>
                  </span>
                  <span className={`${COL_AUX} text-ink-muted`}>
                    {shortHex(row.entry.counterparty, 6, 4)}
                  </span>
                  <Money
                    value={row.entry.flow === 'EARN' ? row.entry.amount6 : `-${row.entry.amount6}`}
                    signed
                    size="xs"
                    className={COL_AMOUNT}
                  />
                  <TxCell hash={row.entry.txHash} chainId={chainId} mode={mode} />
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {pinned === null ? null : (
        <div
          className="border-t border-border"
          style={{ background: 'color-mix(in oklab, var(--color-insolvent) 7%, transparent)' }}
        >
          <span className="label block px-3 pt-2.5 sm:px-4">Most recent insolvency</span>
          <div className={ROW_BOX}>
            <span className={`${COL_TIME} text-ink-muted`}>{clockUtc(pinned.at)}</span>
            <span className={COL_LEAD}>
              <StateDot state="dead" />
            </span>
            <Handle id={pinned.agentId}>{pinned.handle}</Handle>
            <span
              className={`${COL_TAG} text-[10px] tracking-[0.1em]`}
              style={{ color: 'var(--color-neg)' }}
              title={pinned.causeOfDeath}
            >
              INSOLVENT
            </span>
            <span className={`${COL_AUX} text-ink-muted`}>
              {formatDuration(pinned.lifespanSeconds)} lived
            </span>
            <Money value={pinned.net6} signed size="xs" className={COL_AMOUNT} />
            <TxCell hash={pinned.txHash} chainId={chainId} mode={mode} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-2.5">
        <span className="text-[11px] text-ink-muted">
          {mode === 'live'
            ? 'Every row resolves to a transaction on the Arc explorer.'
            : 'Simulated arena — these hashes resolve to nothing on Arc.'}
        </span>
        <Link href="/feed" className="text-[11px] text-ink-2 hover:text-pos">
          Full feed →
        </Link>
      </div>
    </div>
  );
}
