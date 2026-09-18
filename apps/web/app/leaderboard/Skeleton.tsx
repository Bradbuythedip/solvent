/**
 * The loading state.
 *
 * Skeleton rows, not a spinner: the table's geometry is known before the data is,
 * so the page can be built in the right shape and then filled. A centred spinner
 * would throw the whole layout away and rebuild it a moment later, which reads as
 * a jump even when it is fast.
 */

import { COLUMNS, DEFAULT_COLUMNS } from '@/components/agents/columns';
import type { ColumnKey } from '@/components/agents/columns';

const HEADER_OFFSET = 56;
const ROWS = 12;

/** Widths that look like data rather than a repeating pattern. */
const JITTER = [0.92, 0.66, 0.8, 0.54, 0.98, 0.72, 0.86, 0.6, 0.94, 0.7, 0.82, 0.58];

function Bar({ width, height = 10 }: { width: string | number; height?: number }) {
  return (
    <span
      className="inline-block animate-pulse rounded-[2px] bg-raised align-middle"
      style={{ width, height }}
    />
  );
}

function cellSkeleton(key: ColumnKey, jitter: number) {
  switch (key) {
    case 'rank':
      return <Bar width={16} />;
    case 'state':
      return <Bar width={78} height={18} />;
    case 'handle':
      return <Bar width={`${Math.round(46 + jitter * 44)}%`} height={12} />;
    case 'model':
      return <Bar width={62} height={16} />;
    case 'net':
      return <Bar width={`${Math.round(52 + jitter * 42)}%`} height={16} />;
    case 'spark':
      return <Bar width="100%" height={56} />;
    default:
      return <Bar width={`${Math.round(44 + jitter * 44)}%`} />;
  }
}

export function LeaderboardSkeleton() {
  return (
    <>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Bar width={236} height={32} />
        <Bar width={118} height={32} />
        <Bar width={228} height={32} />
        <Bar width={150} height={32} />
      </div>

      <div className="mt-4 hidden md:block">
        <table className="data-table" aria-hidden="true">
          <thead>
            <tr>
              {DEFAULT_COLUMNS.map((key) => {
                const column = COLUMNS[key];
                return (
                  <th
                    key={key}
                    scope="col"
                    className={`${column.show} ${column.cellClass ?? ''}`}
                    style={{
                      top: HEADER_OFFSET,
                      textAlign: column.align === 'left' ? 'left' : column.align,
                      width: column.width === 0 ? undefined : column.width,
                    }}
                  >
                    {column.label}
                  </th>
                );
              })}
              <th scope="col" style={{ top: HEADER_OFFSET, width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: ROWS }, (_, row) => (
              <tr key={row}>
                {DEFAULT_COLUMNS.map((key) => {
                  const column = COLUMNS[key];
                  const align =
                    column.align === 'right'
                      ? 'text-right'
                      : column.align === 'center'
                        ? 'text-center'
                        : '';
                  return (
                    <td key={key} className={`${align} ${column.show} ${column.cellClass ?? ''}`}>
                      {cellSkeleton(key, JITTER[row % JITTER.length] ?? 0.7)}
                    </td>
                  );
                })}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-2 md:hidden" aria-hidden="true">
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} className="panel px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <Bar width={16} />
              <Bar width={78} height={18} />
            </div>
            <div className="mt-2.5">
              <Bar width={`${Math.round(40 + (JITTER[row % JITTER.length] ?? 0.7) * 40)}%`} height={12} />
            </div>
            <div className="mt-3 flex items-end justify-between border-t border-grid pt-3">
              <Bar width={96} height={16} />
              <Bar width={58} height={12} />
            </div>
          </div>
        ))}
      </div>

      <span className="sr-only" role="status">
        Loading the leaderboard.
      </span>
    </>
  );
}
