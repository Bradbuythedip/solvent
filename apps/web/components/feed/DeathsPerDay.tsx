'use client';

/**
 * Deaths per UTC day.
 *
 * A count over time, so: columns. One series, so no legend — the frame's title
 * already names what is plotted. Only the busiest day is labelled; every other
 * number lives in the table view, which is why this chart does not have to shout
 * a figure over each bar to stay honest.
 *
 * Empty days are drawn as empty days. A quiet week is the shape of the story.
 */

import { useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { STATE_MARK } from '@/components/ui/primitives';
import { ChartFrame } from '@/components/charts/ChartFrame';
import { EmptyPlot, Tooltip } from '@/components/charts/parts';
import { clamp, countTicks, linear, vBarPath } from '@/components/charts/geometry';
import { useChartWidth } from '@/components/charts/useChartWidth';
import type { DayBucket } from '@/components/feed/deaths';

export interface DeathsPerDayProps {
  buckets: readonly DayBucket[];
  height?: number;
  width?: number;
  className?: string;
}

const PAD_L = 26;
const PAD_R = 8;
const PAD_T = 16;
const PAD_B = 20;
const MAX_BAR = 24;
const GAP = 2;

export function DeathsPerDay({
  buckets,
  height = 132,
  width = 720,
  className = '',
}: DeathsPerDayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const w = useChartWidth(hostRef, width);
  const h = Math.max(110, height);
  const [active, setActive] = useState<number | null>(null);

  let total = 0;
  let maxCount = 0;
  let peak = 0;
  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i];
    if (bucket === undefined) continue;
    total += bucket.count;
    if (bucket.count > maxCount) {
      maxCount = bucket.count;
      peak = i;
    }
  }

  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const span = buckets.length;

  const plotW = Math.max(40, w - PAD_L - PAD_R);
  const plotH = Math.max(36, h - PAD_T - PAD_B);
  const baseY = PAD_T + plotH;
  const domainMax = Math.max(1, maxCount);
  const y = linear(0, domainMax, baseY, PAD_T);
  // countTicks can round two steps onto the same integer on a tiny domain (a
  // single death in the window), which would draw the same gridline twice.
  const ticks = [...new Set(countTicks(domainMax, 2))];
  const band = span === 0 ? plotW : plotW / span;
  const barW = Math.min(MAX_BAR, Math.max(2, band - GAP));

  const head = ['Day (UTC)', 'Deaths'] as const;
  const rows = buckets.map((bucket) => [bucket.label, String(bucket.count)]);

  function onKeyDown(event: ReactKeyboardEvent<SVGSVGElement>): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const step = event.key === 'ArrowRight' ? 1 : -1;
      setActive((prev) => clamp((prev ?? 0) + step, 0, span - 1));
    } else if (event.key === 'Escape') {
      setActive(null);
    }
  }

  const activeBucket = active === null ? null : (buckets[active] ?? null);

  return (
    <ChartFrame
      title="Deaths per day"
      description={`${total} ${total === 1 ? 'insolvency' : 'insolvencies'} over the last ${span} UTC days.`}
      tableHead={head}
      tableRows={rows}
      className={className}
    >
      {span === 0 ? (
        <EmptyPlot height={h} message="No deaths in this window" />
      ) : (
        <div ref={hostRef} className="relative w-full">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            width="100%"
            height={h}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            aria-label={`Deaths per day over ${span} days, ${total} in total, busiest day ${
              buckets[peak]?.label ?? '—'
            } with ${maxCount}. Switch to the table view for every day.`}
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

            {buckets.map((bucket, i) => {
              const centre = PAD_L + (i + 0.5) * band;
              const path = vBarPath(centre - barW / 2, baseY, baseY - y(bucket.count), barW, 4);
              return (
                <g key={bucket.start}>
                  {path === '' ? null : (
                    <path
                      d={path}
                      fill={STATE_MARK.dead}
                      opacity={active === null || active === i ? 1 : 0.5}
                    />
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

            {maxCount === 0 ? null : (
              <text
                x={PAD_L + (peak + 0.5) * band}
                y={y(maxCount) - 5}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-ink-2)"
                className="tnum"
                pointerEvents="none"
              >
                {maxCount}
              </text>
            )}

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
              <text x={PAD_L} y={h - 5}>
                {first?.label ?? ''}
              </text>
              <text x={PAD_L + plotW} y={h - 5} textAnchor="end">
                {last?.label ?? ''}
              </text>
            </g>
          </svg>

          {activeBucket === null ? null : (
            <Tooltip
              x={PAD_L + ((active ?? 0) + 0.5) * band}
              y={activeBucket.count === 0 ? baseY : y(activeBucket.count)}
              containerWidth={w}
              title={`${activeBucket.label} UTC`}
              rows={[
                {
                  label: activeBucket.count === 1 ? 'death' : 'deaths',
                  value: String(activeBucket.count),
                  color: STATE_MARK.dead,
                },
              ]}
            />
          )}
        </div>
      )}
    </ChartFrame>
  );
}
