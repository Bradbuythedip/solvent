/**
 * USDC unit handling for Arc.
 *
 * Arc exposes ONE underlying USDC balance through TWO interfaces:
 *   - native  : 18 decimals — gas accounting, native sends, msg.value
 *   - ERC-20  :  6 decimals — transfer / transferFrom / approve / balanceOf
 *
 * 1 USDC = 1e18 native units = 1e6 ERC-20 units.
 *
 * Every accounting value in this repo is 6-decimal ERC-20 USDC (`Usdc6`).
 * Values in 18-decimal native units carry the `Native18` type and must be
 * converted explicitly. Adding the two together is always a bug.
 */

export type Usdc6 = bigint;
export type Native18 = bigint;

/** 1e18 native / 1e6 erc20 */
export const NATIVE_PER_USDC6 = 1_000_000_000_000n;
export const USDC_DECIMALS = 6;
export const NATIVE_DECIMALS = 18;

/** One dollar, in 6-decimal USDC. */
export const ONE_USD: Usdc6 = 1_000_000n;

export function usdc6ToNative(v: Usdc6): Native18 {
  return v * NATIVE_PER_USDC6;
}

/** Truncating. Gas receipts are native; use this before booking them as P&L. */
export function nativeToUsdc6(v: Native18): Usdc6 {
  return v / NATIVE_PER_USDC6;
}

/** Ceiling variant — use when under-charging would let value leak. */
export function nativeToUsdc6Ceil(v: Native18): Usdc6 {
  return (v + NATIVE_PER_USDC6 - 1n) / NATIVE_PER_USDC6;
}

/** Parse a human dollar string ("10", "0.0061", "$1,200.50") into Usdc6. */
export function parseUsd(input: string): Usdc6 {
  const cleaned = input.trim().replace(/[$,\s]/g, '');
  if (!/^-?\d*(\.\d*)?$/.test(cleaned) || cleaned === '' || cleaned === '.') {
    throw new Error(`parseUsd: not a number: ${input}`);
  }
  const negative = cleaned.startsWith('-');
  const [whole = '0', frac = ''] = cleaned.replace('-', '').split('.');
  const padded = (frac + '000000').slice(0, USDC_DECIMALS);
  const value = BigInt(whole || '0') * ONE_USD + BigInt(padded || '0');
  return negative ? -value : value;
}

const absBig = (v: bigint): bigint => (v < 0n ? -v : v);

export interface FormatUsdOptions {
  /** Fixed decimal places. Default: adaptive (see below). */
  precision?: number;
  /** Always render an explicit + or − glyph. Signed values must set this. */
  sign?: boolean;
  /** Omit the leading "$". */
  bare?: boolean;
}

/**
 * Adaptive precision, because this product spans $12,400.00 and $0.000061 and
 * both have to stay readable in the same column.
 *   >= $1      -> 2dp
 *   >= $0.01   -> 4dp
 *   otherwise  -> 6dp (full USDC resolution)
 */
function adaptivePrecision(v: Usdc6): number {
  const a = absBig(v);
  if (a >= ONE_USD) return 2;
  if (a >= 10_000n) return 4;
  return 6;
}

export function formatUsd(v: Usdc6, opts: FormatUsdOptions = {}): string {
  const precision = opts.precision ?? adaptivePrecision(v);
  const negative = v < 0n;
  const a = absBig(v);
  const whole = a / ONE_USD;
  const frac = (a % ONE_USD).toString().padStart(USDC_DECIMALS, '0');
  const shown = precision > 0 ? `.${frac.slice(0, precision)}` : '';
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const glyph = negative ? '−' : opts.sign ? '+' : '';
  return `${glyph}${opts.bare ? '' : '$'}${grouped}${shown}`;
}

/** $1.2K / $12.34 / $0.0061 — for stat tiles and axis ticks. */
export function formatUsdCompact(v: Usdc6): string {
  const negative = v < 0n;
  const a = absBig(v);
  const glyph = negative ? '−' : '';
  const dollars = Number(a) / 1e6;
  if (dollars >= 1_000_000) return `${glyph}$${(dollars / 1e6).toFixed(1)}M`;
  if (dollars >= 1_000) return `${glyph}$${(dollars / 1e3).toFixed(1)}K`;
  return formatUsd(v).replace('−', glyph);
}

/** "3d 04h" / "41m 12s" / "6s" */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2, '0')}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Runway: -1 encodes "no burn rate" over the wire; null means dead. */
export function formatRunway(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 0) return '∞';
  if (seconds === 0) return '00s';
  return formatDuration(seconds);
}

/** Shorten an address or tx hash for display: 0x3600…0000 */
export function shortHex(hex: string, lead = 6, tail = 4): string {
  if (hex.length <= lead + tail + 1) return hex;
  return `${hex.slice(0, lead)}…${hex.slice(-tail)}`;
}

/** bigint <-> wire. All monetary values cross the API as decimal strings. */
export const toWire = (v: bigint): string => v.toString();
export const fromWire = (v: string | number | bigint): bigint => BigInt(v);
