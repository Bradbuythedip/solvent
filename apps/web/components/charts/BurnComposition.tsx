'use client';

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { formatUsd } from '@solvent/core';
import { EmptyPlot, Legend, Tooltip } from '@/components/charts/parts';
import type { LegendItem } from '@/components/charts/parts';
import {
  clamp,
  monoWidth,
  percentLabel,
  tickLabel,
  toBig,
} from '@/components/charts/geometry';
import { useChartWidth } from '@/components/charts/useChartWidth';

export interface BurnPart {
  label: string;
  /** 6-decimal USDC burned in this category. Negative values are treated as zero. */
  value6: string | bigint;
}

export interface BurnCompositionProps {
  parts: readonly BurnPart[];
  width?: number;
  className?: string;
}

/**
 * Burn categories are not identities competing for attention, they are slices of
 * one number, so they wear the runway ramp — one hue, monotone lightness — rather
 * than a categorical palette. Colour in this product belongs to solvency state,
 * and a per-category hue set would spend it on something else. The legend and the
 * 2px surface gaps carry identity; the ramp only orders the slices.
 *
 * Slot order follows the caller's order, never the current ranking, so a slice
 * does not change colour when the numbers move.
 */
const SLOTS: ReadonlyArray<{ fill: string; ink: string }> = [
  { fill: 'var(--color-runway-5)', ink: 'var(--color-page)' },
  { fill: 'var(--color-runway-4)', ink: 'var(--color-page)' },
  { fill: 'var(--color-runway-3)', ink: 'var(--color-page)' },
  { fill: 'var(--color-runway-2)', ink: '#EDF6F9' },
  { fill: 'var(--color-border-strong)', ink: '#EDF6F9' },
];

const BAR = 24;
const GAP = 2;
const FONT = 10;

export function BurnComposition({ parts, width = 560, className = '' }: BurnCompositionProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const w = useChartWidth(hostRef, width);
  const [active, setActive] = useState<number | null>(null);
  const clipId = `burn-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  const series = parts.map((p, i) => {
    const raw = toBig(p.value6);
    const slot = SLOTS[Math.min(i, SLOTS.length - 1)] ?? SLOTS[SLOTS.length - 1];
    return {
      label: p.label,
      value6: raw < 0n ? 0n : raw,
      fill: slot?.fill ?? 'var(--color-border-strong)',
      ink: slot?.ink ?? '#EDF6F9',
    };
  });

  let total = 0n;
  for (const s of series) total += s.value6;

  if (series.length === 0 || total === 0n) {
    return (
      <div ref={hostRef} className={`w-full ${className}`}>
        <EmptyPlot height={72} message="Nothing burned yet" />
      </div>
    );
  }

  const totalNumber = Number(total);
  const h = BAR;

  // Widths are allocated across the full bar, then every segment but the last
  // gives up 2px to the surface. The gap is what separates the slices; nothing is
  // outlined.
  let cursorX = 0;
  const segments = series
    .map((s, i) => {
      const share = Number(s.value6) / totalNumber;
      const full = share * w;
      const x = cursorX;
      cursorX += full;
      const isLast = i === series.length - 1;
      return {
        ...s,
        index: i,
        share,
        x,
        width: Math.max(1, full - (isLast ? 0 : GAP)),
      };
    })
    .filter((s) => s.value6 > 0n);

  function onKeyDown(e: ReactKeyboardEvent<SVGSVGElement>): void {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      setActive((prev) => clamp((prev ?? 0) + step, 0, series.length - 1));
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  }

  const activePart = active === null ? null : (series[active] ?? null);
  const activeSegment = active === null ? null : (segments.find((s) => s.index === active) ?? null);

  const legend: LegendItem[] = series.map((s) => ({
    label: s.label,
    color: s.fill,
    value: tickLabel(s.value6),
    meta: percentLabel(Number(s.value6), totalNumber),
  }));

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
        aria-label={`Burn composition: ${series
          .map((s) => `${s.label} ${percentLabel(Number(s.value6), totalNumber)}`)
          .join(', ')}. Total ${formatUsd(total)}.`}
        className="block"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={w} height={h} rx={4} ry={4} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {segments.map((s) => {
            const text = percentLabel(s.share * 100, 100);
            const fits = s.width >= monoWidth(text, FONT) + 16;
            return (
              <g key={`${s.label}-${s.index}`}>
                <rect
                  x={s.x}
                  y={0}
                  width={s.width}
                  height={h}
                  fill={s.fill}
                  opacity={active === null || active === s.index ? 1 : 0.45}
                />
                {fits ? (
                  <text
                    x={s.x + s.width / 2}
                    y={h / 2 + 3.5}
                    textAnchor="middle"
                    fontSize={FONT}
                    fill={s.ink}
                    className="tnum"
                    pointerEvents="none"
                  >
                    {text}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {segments.map((s) => (
          <rect
            key={`hit-${s.index}`}
            x={s.x}
            y={0}
            width={Math.min(s.width + GAP, w - s.x)}
            height={h}
            fill="transparent"
            onPointerEnter={() => setActive(s.index)}
            onPointerMove={() => setActive(s.index)}
          />
        ))}
      </svg>

      {activePart === null ? null : (
        <Tooltip
          x={activeSegment === null ? w / 2 : activeSegment.x + activeSegment.width / 2}
          y={BAR}
          containerWidth={w}
          title={activePart.label}
          rows={[
            { label: 'Burned', value: formatUsd(activePart.value6), color: activePart.fill },
            { label: 'of total', value: percentLabel(Number(activePart.value6), totalNumber, 1) },
          ]}
        />
      )}

      <Legend items={legend} active={active} onActivate={setActive} className="mt-4" />
    </div>
  );
}

export function burnTable(parts: readonly BurnPart[]): { head: string[]; rows: string[][] } {
  let total = 0n;
  for (const p of parts) {
    const v = toBig(p.value6);
    if (v > 0n) total += v;
  }
  const rows = parts.map((p) => {
    const v = toBig(p.value6);
    return [p.label, formatUsd(v), percentLabel(Number(v > 0n ? v : 0n), Number(total), 1)];
  });
  rows.push(['Total', formatUsd(total), '100%']);
  return { head: ['Category', 'Burned', 'Share'], rows };
}
