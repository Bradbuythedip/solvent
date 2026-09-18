'use client';

import { useId, useState } from 'react';
import type { ReactNode } from 'react';

export interface ChartFrameProps {
  title: string;
  description?: string;
  /** Column headers for the table view. The first column is the category. */
  tableHead: readonly string[];
  /** One array per row, aligned to tableHead. */
  tableRows: readonly (readonly ReactNode[])[];
  children: ReactNode;
  className?: string;
}

/**
 * The frame every chart in this product ships inside: a title, an optional
 * description, and a toggle that swaps the svg for the same data as a real
 * table.
 *
 * The table is not a courtesy. A chart encodes with position and colour, and
 * both of those fail for someone — so the table is the backstop that makes every
 * value reachable without them, and it is why no chart here needs to label every
 * point to stay honest.
 */
export function ChartFrame({
  title,
  description,
  tableHead,
  tableRows,
  children,
  className = '',
}: ChartFrameProps) {
  const [table, setTable] = useState(false);
  const bodyId = useId();

  return (
    <figure className={`panel ${className}`}>
      <figcaption className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 className="label">{title}</h3>
          {description === undefined ? null : (
            <p className="mt-1.5 max-w-[60ch] text-xs leading-snug text-ink-muted">{description}</p>
          )}
        </div>
        <div
          role="group"
          aria-label={`${title} view`}
          className="flex shrink-0 overflow-hidden rounded border border-border"
        >
          <ViewButton active={!table} onClick={() => setTable(false)} controls={bodyId}>
            Chart
          </ViewButton>
          <span className="w-px bg-border" aria-hidden="true" />
          <ViewButton active={table} onClick={() => setTable(true)} controls={bodyId}>
            Table
          </ViewButton>
        </div>
      </figcaption>

      <div id={bodyId} className="px-4 py-4">
        {table ? <TableView head={tableHead} rows={tableRows} /> : children}
      </div>
    </figure>
  );
}

function ViewButton({
  active,
  onClick,
  controls,
  children,
}: {
  active: boolean;
  onClick: () => void;
  controls: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-controls={controls}
      className={`px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] transition-colors duration-150 ${
        active ? 'bg-raised text-ink' : 'text-ink-muted hover:text-ink-2'
      }`}
    >
      {children}
    </button>
  );
}

function TableView({
  head,
  rows,
}: {
  head: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-xs text-ink-muted">No data yet.</p>;
  }
  return (
    <div className="-mx-4 max-h-[340px] overflow-auto">
      <table className="data-table">
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th
                key={`${cell}-${i}`}
                scope="col"
                style={i === 0 ? undefined : { textAlign: 'right' }}
                className={i === 0 ? 'pl-4' : i === head.length - 1 ? 'pr-4' : undefined}
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={`${c === 0 ? 'pl-4 text-ink-2' : 'tnum text-right text-ink'} ${
                    c === row.length - 1 ? 'pr-4' : ''
                  }`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
