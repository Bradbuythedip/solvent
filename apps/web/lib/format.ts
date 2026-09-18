/**
 * Display helpers for the web app.
 *
 * Every number in this product is already formatted by @solvent/core — this file
 * re-exports that surface so a component has one import to reach for, and adds the
 * few helpers that only make sense in a browser: relative time, explorer links,
 * and UTC-fixed clocks (a locale-dependent clock would differ between the server
 * render and hydration).
 */

export {
  addressUrl,
  decodeModelTag,
  encodeModelTag,
  formatDuration,
  formatRunway,
  formatUsd,
  formatUsdCompact,
  fromWire,
  modelFamily,
  modelLabel,
  MODEL_FAMILY_LABEL,
  nativeToUsdc6,
  networkById,
  parseUsd,
  shortHex,
  solvencyOf,
  toWire,
  txUrl,
  usdc6ToNative,
  ENTRY_FEE_6,
  ENTRY_SEED_6,
  DEFAULT_RENT_PER_HOUR_6,
  NETWORKS,
  USDC_ADDRESS,
} from '@solvent/core';

export type {
  AgentStatus,
  Category,
  Flow,
  Hex,
  IndexerMode,
  ModelFamily,
  Native18,
  NetworkInfo,
  SolvencyState,
  Usdc6,
} from '@solvent/core';

import { addressUrl, txUrl } from '@solvent/core';
import type { IndexerMode } from '@solvent/core';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** Unix seconds. The whole product counts in seconds, not milliseconds. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function span(seconds: number): string {
  const s = Math.floor(seconds);
  if (s < 10) return 'just now';
  if (s < MINUTE) return `${s}s`;
  if (s < HOUR) return `${Math.floor(s / MINUTE)}m`;
  if (s < DAY) return `${Math.floor(s / HOUR)}h`;
  if (s < WEEK) return `${Math.floor(s / DAY)}d`;
  if (s < MONTH) return `${Math.floor(s / WEEK)}w`;
  if (s < YEAR) return `${Math.floor(s / MONTH)}mo`;
  return `${Math.floor(s / YEAR)}y`;
}

/**
 * "3m ago" / "in 4h" / "just now".
 *
 * `now` is a parameter so a component can drive it from the shared clock in
 * lib/hooks — calling Date.now() during hydration is how you get a mismatch.
 */
export function relativeTime(at: number, now: number = nowSeconds()): string {
  const delta = now - at;
  if (delta < 0) {
    const ahead = span(-delta);
    return ahead === 'just now' ? 'any moment' : `in ${ahead}`;
  }
  const ago = span(delta);
  return ago === 'just now' ? ago : `${ago} ago`;
}

/** Same scale, no suffix — for dense tape columns where the header says "AGE". */
export function relativeShort(at: number, now: number = nowSeconds()): string {
  const delta = Math.abs(now - at);
  return delta < 10 ? '0s' : span(delta);
}

/** Deterministic across server and client: no locale, no local timezone. */
export function clockUtc(at: number): string {
  const d = new Date(at * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function dateUtc(at: number): string {
  const d = new Date(at * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${clockUtc(at)} UTC`;
}

/** Grouped integer. Counts are data, so they wear the same separators as money. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Block heights read as identifiers, so they keep the hash sigil. */
export function formatBlock(n: number): string {
  return n > 0 ? `#${formatCount(n)}` : '#—';
}

export function formatPercent(part: number, whole: number, precision = 0): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return '—';
  return `${((part / whole) * 100).toFixed(precision)}%`;
}

/**
 * Explorer links.
 *
 * In demo mode the hashes are minted from a seed and correspond to nothing on
 * Arc, so these return null rather than sending someone to a 404 that looks like
 * a real receipt. Render the hash as plain text when the link is null.
 */
export function explorerTxUrl(chainId: number, hash: string, mode: IndexerMode = 'live'): string | null {
  return mode === 'live' ? txUrl(chainId, hash) : null;
}

export function explorerAddressUrl(
  chainId: number,
  address: string,
  mode: IndexerMode = 'live',
): string | null {
  return mode === 'live' ? addressUrl(chainId, address) : null;
}

/* Route builders — one place that knows the URL shapes in SPEC 6.5. */
export const agentPath = (id: number): string => `/agent/${id}`;
export const certificatePath = (id: number): string => `/agent/${id}/certificate`;
