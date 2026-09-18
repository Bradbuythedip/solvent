'use client';

import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { formatDuration, formatUsd } from '@solvent/core';
import type { SolvencyState, SparkPoint } from '@solvent/core';
import { STATE_MARK, STATE_WORD } from '@/components/ui/primitives';
import { EmptyPlot, Tooltip } from '@/components/charts/parts';
import type { TooltipRow } from '@/components/charts/parts';
import {
  clamp,
  linear,
  monoWidth,
  px,
  tickLabel,
  toBig,
  toUsdc6,
  truncate,
  utcClock,
  utcStamp,
} from '@/components/charts/geometry';
import { useChartWidth } from '@/components/charts/useChartWidth';

export type SparkField = 'balance6' | 'net6';

export interface SparklineProps {
  points: readonly SparkPoint[];
  field: SparkField;
  /** Colour comes from solvency state and from nothing else. */
  state: SolvencyState;
  /**
   * Names the series in the accessible name. Given, the solvency word is not
   * announced at all: an arena-wide total has no solvency state, so `state` on
   * one of those is a colour slot and not a claim about the number.
   */
  label?: string;
  /**
   * The sentence that says where every value can be read. A table view lives in
   * the frame around a chart rather than in the chart, so only the caller knows
   * whether there is one — and a name that sends a reader to a table that is not
   * there is worse than one that never mentions it.
   */
  tableViewHint?: string;
  height?: number;
  width?: number;
  /**
   * Seconds of runway left. Given, the chart draws the dashed line from the last
   * observation to the moment the balance reaches zero — the whole product in
   * one mark.
   */
  projectionSeconds?: number;
  showAxis?: boolean;
  className?: string;
}

interface Pt {
  t: number;
  v: number;
  raw: bigint;
}

/** Enough room past the last observation to make a projection legible. */
const PROJECTION_WINDOW = 0.6;

export function Sparkline({
  points,
  field,
  state,
  label,
  tableViewHint,
  height = 120,
  width = 560,
  projectionSeconds,
  showAxis = false,
  className = '',
}: SparklineProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const w = useChartWidth(hostRef, width);
  const h = Math.max(56, height);
  const [cursor, setCursor] = useState<number | null>(null);
  const washId = `spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const data = useMemo<Pt[]>(() => {
    const out: Pt[] = [];
    for (const p of points) {
      if (!Number.isFinite(p.t)) continue;
      const raw = toBig(p[field]);
      out.push({ t: p.t, v: Number(raw) / 1e6, raw });
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }, [points, field]);

  const mark = STATE_MARK[state];
  const first = data[0];
  const last = data[data.length - 1];

  if (first === undefined || last === undefined) {
    return (
      <div ref={hostRef} className={`w-full ${className}`}>
        <EmptyPlot height={h} message="No balance history yet" />
      </div>
    );
  }

  const flat = data.length === 1;

  // The value domain is computed before the padding: on this arena a balance can
  // be $0.003220, and the axis gutter has to be wide enough for whatever the top
  // tick actually says rather than for a number we assumed.
  let vMin = 0;
  let vMax = 0;
  for (const p of data) {
    if (p.v < vMin) vMin = p.v;
    if (p.v > vMax) vMax = p.v;
  }
  if (vMax === vMin) vMax = vMin + 1;
  const headroom = (vMax - vMin) * 0.14;
  const yTop = vMax + headroom;
  const yBottom = vMin < 0 ? vMin - headroom : 0;
  const topTick = tickLabel(toUsdc6(yTop));

  const padL = showAxis ? clamp(monoWidth(topTick, 10) + 14, 34, Math.max(34, w * 0.32)) : 10;
  const padR = 14;
  const padT = 12;
  const padB = showAxis ? 20 : 10;
  const plotW = Math.max(32, w - padL - padR);
  const plotH = Math.max(28, h - padT - padB);

  const tMin = flat ? last.t - 60 : first.t;
  const tMaxData = Math.max(last.t, tMin + 1);
  const span = Math.max(1, tMaxData - tMin);

  const runway =
    projectionSeconds !== undefined && Number.isFinite(projectionSeconds) && projectionSeconds > 0 && last.v > 0
      ? projectionSeconds
      : null;
  const crossT = runway === null ? null : last.t + runway;
  const projectionLimit = tMaxData + span * PROJECTION_WINDOW;
  const crossOnChart = crossT !== null && crossT <= projectionLimit;
  // A crossing that fits gets a short tail past it, so the marker sits inside the
  // plot rather than balanced on its right edge.
  const domainMax =
    crossT === null ? tMaxData : crossOnChart ? crossT + span * 0.05 : projectionLimit;

  const x = linear(tMin, domainMax, padL, padL + plotW);
  const y = linear(yBottom, yTop, padT + plotH, padT);
  const zeroY = clamp(y(0), padT, padT + plotH);

  const linePts: ReadonlyArray<{ t: number; v: number }> = flat
    ? [
        { t: tMin, v: last.v },
        { t: last.t, v: last.v },
      ]
    : data;
  const line = linePts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(2)} ${y(p.v).toFixed(2)}`)
    .join(' ');
  const area = `${line} L${x(last.t).toFixed(2)} ${zeroY.toFixed(2)} L${padL.toFixed(2)} ${zeroY.toFixed(2)} Z`;

  // The projection is a straight run from the last observation to zero at the
  // reported burn rate. Off-window, it is drawn to the edge and labelled rather
  // than compressing the history that actually happened.
  let projection: string | null = null;
  let crossX = 0;
  let crossY = 0;
  if (runway !== null && crossT !== null) {
    const endT = Math.min(crossT, domainMax);
    const endV = last.v * (1 - (endT - last.t) / runway);
    crossX = px(x(endT));
    crossY = px(crossOnChart ? zeroY : y(endV));
    projection = `M${x(last.t).toFixed(2)} ${y(last.v).toFixed(2)} L${crossX.toFixed(2)} ${crossY.toFixed(2)}`;
  }

  const endX = x(last.t);
  const endY = y(last.v);
  // A row sparkline is a summary beside numbers that are already on the row, so
  // it does not take a tab stop — fifty of them in a leaderboard would bury the
  // links. A chart big enough to be the thing you came to read does.
  const focusable = width >= 240;
  const active = cursor === null ? null : (data[cursor] ?? null);

  function nearest(userX: number): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < data.length; i++) {
      const p = data[i];
      if (p === undefined) continue;
      const d = Math.abs(x(p.t) - userX);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    return best;
  }

  function onPointerMove(e: ReactPointerEvent<SVGRectElement>): void {
    const svg = svgRef.current;
    if (svg === null) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    setCursor(nearest(((e.clientX - rect.left) / rect.width) * w));
  }

  function onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>): void {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      setCursor((prev) => clamp((prev ?? data.length - 1) + step, 0, data.length - 1));
    } else if (e.key === 'Escape') {
      setCursor(null);
    }
  }

  const valueName = field === 'net6' ? 'net P&L' : 'balance';
  const rows: TooltipRow[] = [];
  if (active !== null) {
    rows.push({
      label: field === 'net6' ? 'Net' : 'Balance',
      value: formatUsd(active.raw, { sign: field === 'net6' }),
      color: mark,
    });
    if (runway !== null && cursor === data.length - 1) {
      rows.push({ label: 'Runway', value: formatDuration(runway) });
    }
  }

  const projectionNote = runway === null ? null : `zero in ${formatDuration(runway)}`;

  // Every clause here has to be true at this call site: the solvency word only
  // where the series has a solvency state, the table sentence only where a
  // caller has actually put a table view around the chart.
  const lead =
    label === undefined
      ? `${STATE_WORD[state]}. ${data.length} ${valueName} observations`
      : `${label}. ${data.length} samples`;
  const accessibleName = `${lead}, latest ${formatUsd(last.raw, {
    sign: field === 'net6',
  })}${projectionNote === null ? '' : `, ${projectionNote}`}.${
    tableViewHint === undefined ? '' : ` ${tableViewHint}`
  }`;

  return (
    <div ref={hostRef} className={`relative w-full ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        tabIndex={focusable ? 0 : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => setCursor(null)}
        aria-label={accessibleName}
        className="block"
      >
        <defs>
          <linearGradient id={washId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={mark} stopOpacity="0.14" />
            <stop offset="100%" stopColor={mark} stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* Zero is the death line: everything above it is time left. */}
        <line
          x1={padL}
          x2={padL + plotW}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--color-grid)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />

        <path d={area} fill={`url(#${washId})`} />
        <path
          d={line}
          fill="none"
          stroke={mark}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {projection === null ? null : (
          <g>
            <path
              d={projection}
              fill="none"
              stroke={mark}
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="5 5"
              opacity={0.75}
            />
            {crossOnChart ? (
              <g>
                <circle cx={crossX} cy={crossY} r={6} fill="var(--color-panel)" />
                <path
                  d={`M${crossX - 4} ${crossY - 4} L${crossX + 4} ${crossY + 4} M${crossX + 4} ${crossY - 4} L${crossX - 4} ${crossY + 4}`}
                  stroke="var(--color-insolvent)"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </g>
            ) : (
              <path
                d={`M${(crossX - 6).toFixed(2)} ${(crossY - 5).toFixed(2)} L${crossX.toFixed(2)} ${crossY.toFixed(2)} L${(crossX - 6).toFixed(2)} ${(crossY + 5).toFixed(2)}`}
                fill="none"
                stroke={mark}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.75}
              />
            )}
          </g>
        )}

        {/* End marker: >=8px, with a 2px surface ring so it survives the line
            and the crosshair crossing underneath it. */}
        <circle cx={endX} cy={endY} r={4.5} fill={mark} stroke="var(--color-panel)" strokeWidth={2} />

        {active === null ? null : (
          <g>
            <line
              x1={x(active.t)}
              x2={x(active.t)}
              y1={padT}
              y2={padT + plotH}
              stroke="var(--color-border)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <circle
              cx={x(active.t)}
              cy={y(active.v)}
              r={4}
              fill={mark}
              stroke="var(--color-panel)"
              strokeWidth={2}
            />
          </g>
        )}

        {showAxis ? (
          <g aria-hidden="true" fill="var(--color-ink-muted)" fontSize={10} className="tnum">
            <text x={padL - 8} y={padT + 4} textAnchor="end">
              {truncate(topTick, Math.max(3, Math.floor((padL - 10) / 6)))}
            </text>
            <text x={padL - 8} y={zeroY + 3} textAnchor="end">
              $0
            </text>
            <text x={padL} y={h - 6}>
              {utcClock(tMin)}
            </text>
            <text x={padL + plotW} y={h - 6} textAnchor="end">
              {utcClock(Math.round(domainMax))}
            </text>
          </g>
        ) : null}

        {projectionNote === null || crossOnChart ? null : (
          <text
            x={padL + plotW}
            y={Math.max(padT + 10, zeroY - 8)}
            textAnchor="end"
            fontSize={10}
            fill="var(--color-ink-muted)"
            className="tnum"
          >
            {monoWidth(projectionNote, 10) < plotW * 0.7 ? projectionNote : formatDuration(runway ?? 0)}
          </text>
        )}

        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setCursor(null)}
          style={{ touchAction: 'pan-y' }}
        />
      </svg>

      {active === null ? null : (
        <Tooltip
          x={x(active.t)}
          y={y(active.v)}
          containerWidth={w}
          title={utcStamp(active.t)}
          rows={rows}
        />
      )}
    </div>
  );
}

/** The table-view twin. Newest first — the tape reads down. */
export function sparklineTable(
  points: readonly SparkPoint[],
  field: SparkField = 'balance6',
): { head: string[]; rows: string[][] } {
  const head = ['Time (UTC)', field === 'net6' ? 'Net' : 'Balance'];
  const rows = [...points]
    .sort((a, b) => b.t - a.t)
    .map((p) => [utcStamp(p.t), formatUsd(toBig(p[field]), { sign: field === 'net6' })]);
  return { head, rows };
}
