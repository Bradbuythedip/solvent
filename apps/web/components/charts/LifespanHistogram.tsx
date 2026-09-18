'use client';

import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatDuration } from '@solvent/core';
import type { SolvencyState } from '@solvent/core';
import { STATE_MARK } from '@/components/ui/primitives';
import { EmptyPlot, Tooltip } from '@/components/charts/parts';
import {
  clamp,
  countTicks,
  histogram,
  linear,
  median,
  monoWidth,
  percentLabel,
  vBarPath,
} from '@/components/charts/geometry';
import { useChartWidth } from '@/components/charts/useChartWidth';

export interface LifespanHistogramProps {
  /** Lifespans in seconds. */
  values: readonly number[];
  /** Single hue: the chart is one series, so the title names it and there is no legend. */
  state?: SolvencyState;
  bins?: number;
  width?: number;
  height?: number;
  className?: string;
}

const PAD_L = 30;
const PAD_R = 10;
const PAD_T = 18;
const PAD_B = 22;
const MAX_BAR = 24;
const GAP = 2;

export function LifespanHistogram({
  values,
  state = 'solvent',
  bins,
  width = 560,
  height = 180,
  className = '',
}: LifespanHistogramProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const w = useChartWidth(hostRef, width);
  const h = Math.max(120, height);
  const [active, setActive] = useState<number | null>(null);

  const binCount = bins ?? clamp(Math.ceil(Math.sqrt(values.length)), 4, 12);
  const data = histogram(values, binCount);
  const total = values.length;

  if (data.length === 0 || total === 0) {
    return (
      <div ref={hostRef} className={`w-full ${className}`}>
        <EmptyPlot height={h} message="No lifespans recorded yet" />
      </div>
    );
  }

  const mark = STATE_MARK[state];
  const plotW = Math.max(40, w - PAD_L - PAD_R);
  const plotH = Math.max(40, h - PAD_T - PAD_B);
  const baseY = PAD_T + plotH;

  let maxCount = 0;
  let modeIndex = 0;
  for (let i = 0; i < data.length; i++) {
    const bin = data[i];
    if (bin === undefined) continue;
    if (bin.count > maxCount) {
      maxCount = bin.count;
      modeIndex = i;
    }
  }
  if (maxCount === 0) maxCount = 1;

  const lastBin = data[data.length - 1];
  const domainMax = lastBin === undefined ? 1 : lastBin.x1;
  const x = linear(0, domainMax, PAD_L, PAD_L + plotW);
  const y = linear(0, maxCount, baseY, PAD_T);
  const ticks = countTicks(maxCount, 3);

  const band = plotW / data.length;
  const barW = Math.min(MAX_BAR, Math.max(2, band - GAP));

  const mid = median(values);
  const midX = x(clamp(mid, 0, domainMax));
  const showMedian = w >= 260 && mid > 0;

  function onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>): void {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      setActive((prev) => clamp((prev ?? 0) + step, 0, data.length - 1));
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  }

  const activeBin = active === null ? null : (data[active] ?? null);

  // The median rides the x-axis band next to its rule, and yields to the two axis
  // labels rather than overprinting them. A label that cannot fit is dropped: the
  // rule still reads, and the number is in the table.
  const medianLabel = `med ${formatDuration(mid)}`;
  const medianTextW = monoWidth(medianLabel, 10);
  const medianRight = midX > PAD_L + plotW / 2;
  const medianTextX = medianRight ? midX - 5 : midX + 5;
  const medianStart = medianRight ? medianTextX - medianTextW : medianTextX;
  const medianEnd = medianRight ? medianTextX : medianTextX + medianTextW;
  const axisLeftEnd = PAD_L + monoWidth('0', 10) + 8;
  const axisRightStart = PAD_L + plotW - monoWidth(formatDuration(domainMax), 10) - 8;
  const medianLabelFits = medianStart > axisLeftEnd && medianEnd < axisRightStart;

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
        aria-label={`Lifespan distribution across ${total} agents, median ${formatDuration(
          mid,
        )}, longest ${formatDuration(domainMax)}. Switch to the table view for every bin.`}
        className="block"
      >
        <g aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD_L}
                x2={PAD_L + plotW}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-grid)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={PAD_L - 6}
                y={y(t) + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--color-ink-muted)"
                className="tnum"
              >
                {t}
              </text>
            </g>
          ))}
        </g>

        {data.map((bin, i) => {
          const centre = PAD_L + (i + 0.5) * band;
          const barX = centre - barW / 2;
          const len = bin.count === 0 ? 0 : baseY - y(bin.count);
          const path = vBarPath(barX, baseY, len, barW, 4);
          return (
            <g key={`${bin.x0}-${i}`}>
              {path === '' ? null : (
                <path d={path} fill={mark} opacity={active === null || active === i ? 1 : 0.5} />
              )}
              <rect
                x={PAD_L + i * band}
                y={PAD_T}
                width={band}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setActive(i)}
                onPointerMove={() => setActive(i)}
              />
            </g>
          );
        })}

        {/* One selective label: the tallest bin. The rest is the axis and the table. */}
        <text
          x={PAD_L + (modeIndex + 0.5) * band}
          y={y(maxCount) - 6}
          textAnchor="middle"
          fontSize={10}
          fill="var(--color-ink-2)"
          className="tnum"
          pointerEvents="none"
        >
          {maxCount}
        </text>

        {showMedian ? (
          <g pointerEvents="none">
            <line
              x1={midX}
              x2={midX}
              y1={PAD_T}
              y2={baseY}
              stroke="var(--color-border-strong)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            {medianLabelFits ? (
              <text
                x={medianTextX}
                y={h - 6}
                textAnchor={medianRight ? 'end' : 'start'}
                fontSize={10}
                fill="var(--color-ink-2)"
                className="tnum"
              >
                {medianLabel}
              </text>
            ) : null}
          </g>
        ) : null}

        <line
          x1={PAD_L}
          x2={PAD_L + plotW}
          y1={baseY}
          y2={baseY}
          stroke="var(--color-border)"
          strokeWidth={1}
          shapeRendering="crispEdges"
          pointerEvents="none"
        />

        <g aria-hidden="true" fontSize={10} fill="var(--color-ink-muted)" className="tnum">
          <text x={PAD_L} y={h - 6}>
            0
          </text>
          <text x={PAD_L + plotW} y={h - 6} textAnchor="end">
            {formatDuration(domainMax)}
          </text>
        </g>
      </svg>

      {activeBin === null ? null : (
        <Tooltip
          x={PAD_L + ((active ?? 0) + 0.5) * band}
          y={activeBin.count === 0 ? baseY : y(activeBin.count)}
          containerWidth={w}
          title={`${formatDuration(activeBin.x0)} – ${formatDuration(activeBin.x1)}`}
          rows={[
            {
              label: activeBin.count === 1 ? 'agent' : 'agents',
              value: String(activeBin.count),
              color: mark,
            },
            { label: 'of all', value: percentLabel(activeBin.count, total, 1) },
          ]}
        />
      )}
    </div>
  );
}

export function lifespanTable(
  values: readonly number[],
  bins?: number,
): { head: string[]; rows: string[][] } {
  const binCount = bins ?? clamp(Math.ceil(Math.sqrt(values.length)), 4, 12);
  const data = histogram(values, binCount);
  return {
    head: ['Lifespan', 'Agents', 'Share'],
    rows: data.map((bin) => [
      `${formatDuration(bin.x0)} – ${formatDuration(bin.x1)}`,
      String(bin.count),
      percentLabel(bin.count, values.length, 1),
    ]),
  };
}
