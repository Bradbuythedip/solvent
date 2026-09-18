import { formatUsd, formatUsdCompact, type Usdc6 } from '@solvent/core';

/**
 * A signed dollar value.
 *
 * Colour discipline: the sign glyph (+ / −) is ALWAYS rendered, so colour is a
 * reinforcement and never the only channel. The `--color-pos` / `--color-neg`
 * steps used here are the text-contrast variants (12.5:1 and 8.0:1 on the page
 * surface), not the chart mark colours.
 */
export function Money({
  value,
  signed = false,
  compact = false,
  precision,
  className = '',
  colorize = true,
  size = 'md',
}: {
  value: Usdc6 | string;
  signed?: boolean;
  compact?: boolean;
  precision?: number;
  className?: string;
  colorize?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
}) {
  const v = typeof value === 'string' ? BigInt(value) : value;
  const text = compact
    ? formatUsdCompact(v)
    : formatUsd(v, precision === undefined ? { sign: signed } : { sign: signed, precision });

  const tone = !colorize
    ? 'var(--color-ink)'
    : v > 0n
      ? 'var(--color-pos)'
      : v < 0n
        ? 'var(--color-neg)'
        : 'var(--color-ink-2)';

  const sizes: Record<string, string> = {
    xs: 'text-[11px]',
    sm: 'text-[12px]',
    md: 'text-[13px]',
    lg: 'text-[18px]',
    xl: 'text-[28px]',
  };

  return (
    <span className={`tnum ${sizes[size]} ${className}`} style={{ color: tone }}>
      {text}
    </span>
  );
}

/** An unsigned amount in ink — for burn lines, fees, and anything unpolarised. */
export function Amount({
  value,
  className = '',
  compact = false,
  precision,
}: {
  value: Usdc6 | string;
  className?: string;
  compact?: boolean;
  precision?: number;
}) {
  const v = typeof value === 'string' ? BigInt(value) : value;
  return (
    <span className={`tnum text-ink-2 ${className}`}>
      {compact ? formatUsdCompact(v) : formatUsd(v, precision === undefined ? {} : { precision })}
    </span>
  );
}

/**
 * The hero figure. Exactly one per view. Proportional figures at display size —
 * tabular-nums gives every digit the width of a zero, which reads loose at 48px+.
 */
export function HeroMoney({
  value,
  signed = true,
  className = '',
}: {
  value: Usdc6 | string;
  signed?: boolean;
  className?: string;
}) {
  const v = typeof value === 'string' ? BigInt(value) : value;
  const tone = v > 0n ? 'var(--color-pos)' : v < 0n ? 'var(--color-neg)' : 'var(--color-ink)';
  const bloom = v >= 0n ? 'var(--color-solvent)' : 'var(--color-insolvent)';
  return (
    <span
      className={`hero-figure bloom block font-medium ${className}`}
      style={{ color: tone, ['--bloom-color' as string]: bloom }}
    >
      {formatUsd(v, { sign: signed })}
    </span>
  );
}
