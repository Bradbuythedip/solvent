'use client';

import { useEffect, useState } from 'react';

/**
 * The rendered width of the chart host, in CSS pixels.
 *
 * Every chart here draws in a 1:1 coordinate system — a user unit IS a pixel —
 * because the specs this design system freezes are pixel specs: a 2px line, a
 * 2px surface gap, an 8px marker, a 4px radius. A viewBox that scales would turn
 * all four into whatever the container felt like.
 *
 * Before measurement (server render and first paint) the caller's `fallback`
 * width is used and the svg letterboxes to fit, so nothing ever overflows; the
 * observer then snaps it to exactly 1:1. Server and first client render agree,
 * so hydration has nothing to disagree about.
 */
export function useChartWidth(ref: { current: HTMLElement | null }, fallback: number): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;

    const measure = (): void => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next > 0) setWidth((prev) => (Math.abs(prev - next) < 1 ? prev : next));
    };

    measure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return Math.max(120, width);
}
