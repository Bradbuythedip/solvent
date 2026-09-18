'use client';

/**
 * The full tape: every earn and every burn this agent ever booked.
 *
 * Paginated rather than virtualised — a page of twenty-five keeps every row in
 * the accessibility tree and in find-in-page, which a windowed list gives up.
 *
 * Flow is carried three ways: the word, the sign glyph on the flow cell, and the
 * sign glyph on the amount. Colour is the fourth and never the only one.
 *
 * Capital is money in but it is not revenue (SPEC R1), so those rows are marked
 * and left in ink rather than dressed as earnings.
 */

import { useMemo, useState } from 'react';
import type { Category, IndexerMode, LedgerEntry } from '@solvent/core';
import { Money } from '@/components/ui/Money';
import { Button } from '@/components/ui/primitives';
import { formatCount } from '@/lib/format';
import { AddressLink, TxLink } from './parts';

const PAGE = 25;

/* .data-table in globals.css already owns the padding, the sticky header and the
   hairlines. Its `text-align: left` on th outranks a utility class, so the two
   numeric columns take an inline style — the same escape ChartFrame uses. */
const RIGHT = { textAlign: 'right' } as const;
const CELL = 'whitespace-nowrap';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** UTC and nothing else: a server render and its hydration must agree exactly. */
function stamp(at: number): { short: string; full: string } {
  const d = new Date(at * 1000);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  return { short: `${date.slice(5)} ${time.slice(0, 5)}`, full: `${date} ${time} UTC` };
}

const CATEGORY_NOTE: Record<Category, string> = {
  RENT: 'Rent, accrued per second against the wallet',
  SERVICE: 'An x402 service settlement',
  BOUNTY: 'A bounty released from escrow',
  GAS: 'Transaction gas, converted from native 18-decimal units',
  SPAWN: 'The entry fee that opened the wallet',
  CAPITAL: 'Operator capital — recorded, never counted as revenue (R1)',
  OTHER: 'Uncategorised',
};

export function LedgerTape({
  entries,
  chainId,
  mode,
}: {
  entries: LedgerEntry[];
  chainId: number;
  mode: IndexerMode;
}) {
  const [page, setPage] = useState(0);

  const pages = Math.max(1, Math.ceil(entries.length / PAGE));
  const current = Math.min(page, pages - 1);
  const rows = useMemo(
    () => entries.slice(current * PAGE, current * PAGE + PAGE),
    [entries, current],
  );

  const hasCapital = rows.some((entry) => entry.category === 'CAPITAL');
  const from = entries.length === 0 ? 0 : current * PAGE + 1;
  const to = Math.min(entries.length, current * PAGE + PAGE);

  if (entries.length === 0) {
    return (
      <div className="panel px-4 py-10 text-center text-[12px] text-ink-muted">
        Nothing has settled against this wallet yet.
      </div>
    );
  }

  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table mono w-full">
          <caption className="sr-only">
            Every ledger entry for this agent, newest first. Earns carry a plus glyph, burns a minus
            glyph.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="hidden sm:table-cell">
                UTC
              </th>
              <th scope="col">Flow</th>
              <th scope="col">Category</th>
              <th scope="col" className="hidden lg:table-cell">
                Counterparty
              </th>
              <th scope="col" className="hidden xl:table-cell">
                Memo
              </th>
              <th scope="col" style={RIGHT}>
                Amount
              </th>
              <th scope="col" style={RIGHT}>
                Tx
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry) => {
              const earn = entry.flow === 'EARN';
              const capital = entry.category === 'CAPITAL';
              const amount = BigInt(entry.amount6);
              const time = stamp(entry.at);
              return (
                <tr key={entry.id}>
                  <td className={`${CELL} hidden text-ink-muted sm:table-cell`} title={time.full}>
                    {time.short}
                  </td>
                  <td
                    className={CELL}
                    style={{
                      color: capital
                        ? 'var(--color-ink-2)'
                        : earn
                          ? 'var(--color-pos)'
                          : 'var(--color-neg)',
                    }}
                  >
                    <span aria-hidden="true">{earn ? '+' : '−'}</span>{' '}
                    <span className="hidden sm:inline">{entry.flow}</span>
                    <span className="sr-only">{earn ? 'earn' : 'burn'}</span>
                  </td>
                  <td className={`${CELL} text-ink-2`} title={CATEGORY_NOTE[entry.category]}>
                    {entry.category}
                    {capital ? <span className="text-ink-muted"> &dagger;</span> : null}
                  </td>
                  <td className={`${CELL} hidden lg:table-cell`}>
                    <AddressLink address={entry.counterparty} chainId={chainId} mode={mode} />
                  </td>
                  <td className={`${CELL} hidden max-w-[22ch] truncate text-ink-muted xl:table-cell`}>
                    {entry.memo ?? '—'}
                  </td>
                  <td className={`${CELL} text-right`}>
                    <Money value={earn ? amount : -amount} signed colorize={!capital} />
                  </td>
                  <td className={`${CELL} text-right`}>
                    <TxLink hash={entry.txHash} chainId={chainId} mode={mode} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-3">
        <p className="tnum text-[11px] text-ink-muted">
          {formatCount(from)}&ndash;{formatCount(to)} of {formatCount(entries.length)}
          {hasCapital ? (
            <span className="ml-3 hidden sm:inline">
              &dagger; capital in, never counted as earned
            </span>
          ) : null}
        </p>
        <div className="flex items-center gap-2">
          <Button onClick={() => setPage(current - 1)} disabled={current === 0}>
            &larr; Newer
          </Button>
          <span className="tnum text-[11px] text-ink-muted">
            {current + 1} / {pages}
          </span>
          <Button onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>
            Older &rarr;
          </Button>
        </div>
      </div>
    </div>
  );
}
