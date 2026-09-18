/**
 * Pure geometry and number shaping for the hand-built charts.
 *
 * No React and no DOM, so a server component can import it as freely as a client
 * one. Everything here is deterministic: the same inputs render identically on
 * the server and after hydration.
 */

import { formatUsd, formatUsdCompact } from '@solvent/core';
import type { Usdc6 } from '@solvent/core';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Wire values are decimal strings and arrive from an indexer we do not control. */
export function toBig(v: string | bigint): bigint {
  if (typeof v === 'bigint') return v;
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
}

/** 6-decimal USDC as a float in dollars — for scales only, never for display. */
export const toDollars = (v: string | bigint): number => Number(toBig(v)) / 1e6;

/** Dollars back to 6-decimal USDC, for handing an axis value to formatUsd. */
export const toUsdc6 = (dollars: number): Usdc6 => BigInt(Math.round(dollars * 1e6));

/**
 * A chart value label. The sign glyph is always present, so colour is never the
 * only channel carrying polarity. Compact above $1,000 because a bar tip is not
 * the place for eight digits.
 */
export function signedLabel(v: Usdc6): string {
  const abs = v < 0n ? -v : v;
  if (abs >= 1_000_000_000n) return `${v > 0n ? '+' : ''}${formatUsdCompact(v)}`;
  // Below $1000 the core's adaptive precision is exactly right: 2dp for dollars,
  // 6dp for the sub-cent amounts this arena actually runs on. Rounding a burn of
  // $0.000061 to $0.0000 would print zero for a number that is not zero.
  return formatUsd(v, { sign: true });
}

/** Two decimals of pixel: enough for sub-pixel geometry, no float noise in the DOM. */
export const px = (v: number): number => Math.round(v * 100) / 100;

/** Unsigned, compact — axis ticks and legend values. */
export const tickLabel = (v: Usdc6): string => formatUsdCompact(v);

export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (!Number.isFinite(span) || span === 0) return () => r0;
  const k = (r1 - r0) / span;
  return (v: number) => r0 + (v - d0) * k;
}

const n2 = (v: number): string => (Number.isFinite(v) ? v.toFixed(2) : '0');

/**
 * Horizontal bar: square at the baseline, `radius` rounded at the data end.
 * `len` may be negative — a bar that grew left from a zero baseline.
 */
export function hBarPath(baseX: number, y: number, len: number, height: number, radius = 4): string {
  const dir = len < 0 ? -1 : 1;
  const length = Math.abs(len);
  if (length < 1) return `M${n2(baseX)} ${n2(y)} h${dir} v${n2(height)} h${-dir} Z`;
  const r = Math.min(radius, length, height / 2);
  const end = baseX + dir * length;
  const sweep = dir > 0 ? 1 : 0;
  return [
    `M${n2(baseX)} ${n2(y)}`,
    `H${n2(end - dir * r)}`,
    `A${n2(r)} ${n2(r)} 0 0 ${sweep} ${n2(end)} ${n2(y + r)}`,
    `V${n2(y + height - r)}`,
    `A${n2(r)} ${n2(r)} 0 0 ${sweep} ${n2(end - dir * r)} ${n2(y + height)}`,
    `H${n2(baseX)}`,
    'Z',
  ].join(' ');
}

/** Vertical column: square on the baseline, `radius` rounded on the cap. */
export function vBarPath(x: number, baseY: number, len: number, width: number, radius = 4): string {
  if (len <= 0) return '';
  const top = baseY - len;
  const r = Math.min(radius, len, width / 2);
  return [
    `M${n2(x)} ${n2(baseY)}`,
    `V${n2(top + r)}`,
    `A${n2(r)} ${n2(r)} 0 0 1 ${n2(x + r)} ${n2(top)}`,
    `H${n2(x + width - r)}`,
    `A${n2(r)} ${n2(r)} 0 0 1 ${n2(x + width)} ${n2(top + r)}`,
    `V${n2(baseY)}`,
    'Z',
  ].join(' ');
}

/** Round counts to 1/2/5 steps so the y axis reads as counting, not as data. */
export function countTicks(max: number, target = 3): number[] {
  if (!(max > 0)) return [0];
  const raw = max / Math.max(1, target);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? magnitude * 10;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(Math.round(v));
  return out;
}

export interface Bin {
  x0: number;
  x1: number;
  count: number;
}

export function histogram(values: readonly number[], binCount: number): Bin[] {
  const clean: number[] = [];
  for (const v of values) if (Number.isFinite(v) && v >= 0) clean.push(v);
  if (clean.length === 0) return [];
  let max = 0;
  for (const v of clean) if (v > max) max = v;
  if (max <= 0) max = 1;
  const n = clamp(Math.floor(binCount), 1, 24);
  const width = max / n;
  const bins: Bin[] = [];
  for (let i = 0; i < n; i++) bins.push({ x0: i * width, x1: (i + 1) * width, count: 0 });
  for (const v of clean) {
    const bin = bins[Math.min(n - 1, Math.floor(v / width))];
    if (bin !== undefined) bin.count += 1;
  }
  return bins;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * JetBrains Mono advances at 0.6em, so text width is arithmetic rather than a
 * measurement. Good enough to decide whether a label fits inside a bar, which is
 * the only question we ask of it.
 */
export const monoWidth = (text: string, fontSize: number): number => text.length * fontSize * 0.6;

export function truncate(text: string, maxChars: number): string {
  if (maxChars < 2) return '';
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** UTC, never locale: a server render and its hydration must agree exactly. */
export function utcClock(t: number): string {
  const d = new Date(t * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

export function utcStamp(t: number): string {
  const d = new Date(t * 1000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
}

export function percentLabel(part: number, whole: number, precision = 0): string {
  if (!(whole > 0)) return '—';
  return `${((part / whole) * 100).toFixed(precision)}%`;
}
