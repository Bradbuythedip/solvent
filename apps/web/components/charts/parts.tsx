/**
 * The pieces every chart in this product is assembled from: the hover readout,
 * the legend, and the empty plot. Kept together so a sparkline and a histogram
 * cannot drift into two different tooltips.
 */

import type { ReactNode } from 'react';
import { clamp } from '@/components/charts/geometry';

export interface TooltipRow {
  label: string;
  value: string;
  /** Mark colour for the line key. Text in a tooltip never wears it. */
  color?: string;
}

/**
 * Values lead, labels follow — the legend's hierarchy inverted, because a reader
 * who is already pointing at a mark has the identity and wants the number.
 * Positioned in the host's pixel space; `pointer-events-none` so it can never
 * eat the hover it is describing.
 */
export function Tooltip({
  x,
  y,
  containerWidth,
  title,
  rows,
}: {
  x: number;
  y: number;
  containerWidth: number;
  title?: string;
  rows: readonly TooltipRow[];
}) {
  const below = y < 76;
  const left = clamp(x, 84, Math.max(84, containerWidth - 84));
  return (
    <div
      role="status"
      className={`pointer-events-none absolute z-20 w-max max-w-[220px] -translate-x-1/2 rounded border border-border bg-raised px-2.5 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.6)] ${
        below ? '' : '-translate-y-full'
      }`}
      style={{ left, top: below ? y + 16 : y - 12 }}
    >
      {title === undefined ? null : <div className="label mb-1.5">{title}</div>}
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={`${row.label}-${row.value}`} className="flex items-center gap-2 whitespace-nowrap">
            {row.color === undefined ? null : (
              <span
                aria-hidden="true"
                className="h-[2px] w-2.5 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
            )}
            <span className="tnum text-[12px] font-medium text-ink">{row.value}</span>
            <span className="text-[11px] text-ink-muted">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  value?: string;
  meta?: string;
}

/**
 * Two or more series always carry a legend — identity is never colour alone.
 * A single-series chart gets none: its title already names what is plotted.
 */
export function Legend({
  items,
  active = null,
  onActivate,
  className = '',
}: {
  items: readonly LegendItem[];
  active?: number | null;
  onActivate?: (index: number | null) => void;
  className?: string;
}) {
  return (
    <ul
      className={`grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4 ${className}`}
      onPointerLeave={onActivate === undefined ? undefined : () => onActivate(null)}
    >
      {items.map((item, i) => (
        <li
          key={item.label}
          className="flex items-center gap-2 text-[11px] transition-opacity duration-150"
          style={{ opacity: active === null || active === i ? 1 : 0.45 }}
          onPointerEnter={onActivate === undefined ? undefined : () => onActivate(i)}
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-[2px]"
            style={{ background: item.color }}
          />
          <span className="truncate text-ink-2">{item.label}</span>
          {item.value === undefined ? null : (
            <span className="tnum ml-auto shrink-0 text-ink">{item.value}</span>
          )}
          {item.meta === undefined ? null : (
            <span className="tnum shrink-0 text-ink-muted">{item.meta}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * This data starts empty — an arena with no agents yet — so every chart has to
 * render something honest at n = 0 rather than dividing by a zero domain.
 */
export function EmptyPlot({
  height = 120,
  message = 'No data yet',
  children,
}: {
  height?: number;
  message?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-1 border-b border-grid"
      style={{ height }}
    >
      <span className="label">{message}</span>
      {children}
    </div>
  );
}
