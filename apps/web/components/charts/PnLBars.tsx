'use client';

import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatUsd } from '@solvent/core';
import { EmptyPlot, Tooltip } from '@/components/charts/parts';
import type { TooltipRow } from '@/components/charts/parts';
import {
  clamp,
  hBarPath,
  linear,
  monoWidth,
  px,
  signedLabel,
  toBig,
  truncate,
} from '@/components/charts/geometry';
import { useChartWidth } from '@/components/charts/useChartWidth';

export interface PnLRow {
  label: string;
  /** 6-decimal USDC, signed. Decimal string over the wire, bigint in process. */
  value6: string | bigint;
  /** Optional population behind the bar, e.g. how many agents are in this family. */
  n?: number;
}

export interface PnLBarsProps {
  rows: readonly PnLRow[];
  width?: number;
  className?: string;
}

const BAR = 18;
const ROW = 30;
const PAD_T = 8;
const PAD_B = 10;
const FONT = 11;
const LABEL_FONT = 11;

/**
 * Magnitude and polarity, so: horizontal bars from a zero baseline, coloured by
 * SIGN.
 *
 * Sign is polarity, not identity — there are exactly two possible values and one
 * of them is the point of the whole product — so this chart needs no categorical
 * palette and no legend. Every value ships its + or minus glyph, so the colour is
 * reinforcement rather than the message.
 */
export function PnLBars({ rows, width = 560, className = '' }: PnLBarsProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const w = useChartWidth(hostRef, width);
  const [active, setActive] = useState<number | null>(null);

  const series = rows.map((r) => ({ label: r.label, v6: toBig(r.value6), n: r.n }));

  if (series.length === 0) {
    return (
      <div ref={hostRef} className={`w-full ${className}`}>
        <EmptyPlot height={120} message="No P&L recorded yet" />
      </div>
    );
  }

  const h = PAD_T + series.length * ROW + PAD_B;

  const labelChars = series.reduce((m, s) => Math.max(m, s.label.length), 0);
  const labelW = clamp(labelChars * LABEL_FONT * 0.6 + 10, 52, Math.min(150, w * 0.34));
  const maxLabelChars = Math.max(2, Math.floor((labelW - 10) / (LABEL_FONT * 0.6)));

  const plotX = labelW + 10;
  const plotW = Math.max(40, w - plotX - 8);

  const values = series.map((s) => Number(s.v6) / 1e6);
  let dMax = 0;
  let dMin = 0;
  for (const v of values) {
    if (v > dMax) dMax = v;
    if (v < dMin) dMin = v;
  }
  if (dMax === 0 && dMin === 0) dMax = 1;

  // Room for a value label that will not fit inside its bar. Reserved up front so
  // the tip label of a short bar has somewhere to go that is not off the edge.
  const texts = series.map((s) => signedLabel(s.v6));
  const widest = texts.reduce((m, t) => Math.max(m, monoWidth(t, FONT)), 0);
  const reserve = clamp(widest + 10, 0, plotW * 0.4);
  const rangeLeft = plotX + (dMin < 0 ? reserve : 0);
  const rangeRight = plotX + plotW - (dMax > 0 ? reserve : 0);

  const x = linear(dMin, dMax, rangeLeft, rangeRight);
  const zeroX = clamp(x(0), plotX, plotX + plotW);

  function onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((prev) => clamp((prev ?? 0) + step, 0, series.length - 1));
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  }

  const activeRow = active === null ? null : (series[active] ?? null);
  const tooltipRows: TooltipRow[] = [];
  if (activeRow !== null) {
    tooltipRows.push({
      label: 'Net',
      value: formatUsd(activeRow.v6, { sign: true }),
      color: activeRow.v6 < 0n ? 'var(--color-insolvent)' : 'var(--color-solvent)',
    });
    if (activeRow.n !== undefined) {
      tooltipRows.push({ label: activeRow.n === 1 ? 'agent' : 'agents', value: String(activeRow.n) });
    }
  }
  const activeY = active === null ? 0 : PAD_T + active * ROW + (ROW - BAR) / 2;
  const activeX = activeRow === null ? 0 : x(Number(activeRow.v6) / 1e6);

  return (
    <div ref={hostRef} className={`relative w-full ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        aria-label={`Net dollars earned minus burned, ${series.length} series. Switch to the table view for every value.`}
        className="block"
      >
        {series.map((s, i) => {
          const value = Number(s.v6) / 1e6;
          const barY = PAD_T + i * ROW + (ROW - BAR) / 2;
          const end = x(value);
          const length = end - zeroX;
          const negative = s.v6 < 0n;
          const mark = negative ? 'var(--color-insolvent)' : 'var(--color-solvent)';
          const text = texts[i] ?? '';
          const textW = monoWidth(text, FONT);
          const inside = Math.abs(length) >= textW + 16;
          const dir = negative ? -1 : 1;
          const labelX = px(inside ? end - dir * 8 : end + dir * 6);
          // Outside the bar end the label needs the room to exist. If the plot
          // cannot give it, the label is dropped rather than clipped — the value
          // is still on the mark's tooltip and in the table view.
          const outsideStart = dir > 0 ? labelX : labelX - textW;
          const showLabel = inside || (outsideStart >= plotX && outsideStart + textW <= plotX + plotW);
          const anchor = inside
            ? negative
              ? 'start'
              : 'end'
            : negative
              ? 'end'
              : 'start';
          // Inside a solid mark, text picks the tone that clears contrast on it:
          // near-black on the cyan step, white on the red one.
          const labelFill = inside
            ? negative
              ? '#FFFFFF'
              : 'var(--color-page)'
            : 'var(--color-ink)';

          return (
            <g key={`${s.label}-${i}`}>
              {active === i ? (
                <rect
                  x={0}
                  y={PAD_T + i * ROW}
                  width={w}
                  height={ROW}
                  rx={4}
                  fill="var(--color-raised)"
                />
              ) : null}

              <text
                x={labelW}
                y={barY + BAR / 2 + 4}
                textAnchor="end"
                fontSize={LABEL_FONT}
                fill={active === i ? 'var(--color-ink)' : 'var(--color-ink-2)'}
              >
                {truncate(s.label, maxLabelChars)}
              </text>

              <path d={hBarPath(zeroX, barY, length, BAR, 4)} fill={mark} />

              {showLabel ? (
                <text
                  x={labelX}
                  y={barY + BAR / 2 + 4}
                  textAnchor={anchor}
                  fontSize={FONT}
                  fill={labelFill}
                  className="tnum"
                >
                  {text}
                </text>
              ) : null}

              <rect
                x={0}
                y={PAD_T + i * ROW}
                width={w}
                height={ROW}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerMove={() => setActive(i)}
              />
            </g>
          );
        })}

        {/* The anchor every bar is measured from. */}
        <line
          x1={px(zeroX)}
          x2={px(zeroX)}
          y1={PAD_T - 2}
          y2={h - PAD_B + 2}
          stroke="var(--color-border)"
          strokeWidth={1}
          shapeRendering="crispEdges"
          pointerEvents="none"
        />
      </svg>

      {activeRow === null ? null : (
        <Tooltip
          x={activeX}
          y={activeY}
          containerWidth={w}
          title={activeRow.label}
          rows={tooltipRows}
        />
      )}
    </div>
  );
}

export function pnlTable(rows: readonly PnLRow[]): { head: string[]; rows: string[][] } {
  const withCount = rows.some((r) => r.n !== undefined);
  const head = withCount ? ['Series', 'Net', 'Agents'] : ['Series', 'Net'];
  return {
    head,
    rows: rows.map((r) => {
      const cells = [r.label, formatUsd(toBig(r.value6), { sign: true })];
      if (withCount) cells.push(r.n === undefined ? '—' : String(r.n));
      return cells;
    }),
  };
}
