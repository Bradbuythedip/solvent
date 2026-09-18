/**
 * Shaping for the insolvency tape.
 *
 * Pure and deterministic — no React, no DOM, no Date.now() — so the server render
 * and the hydrated one agree digit for digit. Every caller passes its own clock.
 */

import type { InsolvencyRecord, ModelFamily, StreamEvent } from '@solvent/core';
import { toBig } from '@/components/charts/geometry';

export const DAY_SECONDS = 86_400;

/**
 * The indexer's records plus anything that has died since the page was served.
 *
 * Keyed by agent because death is permanent and happens exactly once (R6): a
 * replayed stream event can never become a second row, and the indexer's copy
 * wins over the socket's because it is the one that was reconciled against a
 * block.
 */
export function mergeDeaths(
  base: readonly InsolvencyRecord[],
  events: readonly StreamEvent[],
): InsolvencyRecord[] {
  const byAgent = new Map<number, InsolvencyRecord>();
  for (const record of base) byAgent.set(record.agentId, record);
  for (const event of events) {
    if (event.type !== 'insolvency') continue;
    if (byAgent.has(event.data.agentId)) continue;
    byAgent.set(event.data.agentId, event.data);
  }
  return [...byAgent.values()].sort((a, b) => b.at - a.at || b.agentId - a.agentId);
}

/** Epoch-aligned UTC midnight. Local midnight would move the histogram per reader. */
export const utcDayStart = (at: number): number => Math.floor(at / DAY_SECONDS) * DAY_SECONDS;

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function utcDayLabel(start: number): string {
  const d = new Date(start * 1000);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export interface DayBucket {
  /** UTC midnight, unix seconds. */
  start: number;
  count: number;
  label: string;
}

/**
 * Deaths per UTC day, oldest bucket first, including the empty days — a gap in
 * the tape is information, and dropping it would compress a quiet week into a
 * busy one.
 */
export function dailyDeaths(
  entries: readonly InsolvencyRecord[],
  days: number,
  now: number,
): DayBucket[] {
  const span = Math.max(1, Math.floor(days));
  const today = utcDayStart(now);
  const first = today - (span - 1) * DAY_SECONDS;

  const counts = new Map<number, number>();
  for (let i = 0; i < span; i++) counts.set(first + i * DAY_SECONDS, 0);
  for (const record of entries) {
    const key = utcDayStart(record.at);
    const current = counts.get(key);
    if (current === undefined) continue; // Older than the window.
    counts.set(key, current + 1);
  }

  const out: DayBucket[] = [];
  for (let i = 0; i < span; i++) {
    const start = first + i * DAY_SECONDS;
    out.push({ start, count: counts.get(start) ?? 0, label: utcDayLabel(start) });
  }
  return out;
}

export interface FamilyCount {
  family: ModelFamily;
  count: number;
}

const FAMILY_ORDER: readonly ModelFamily[] = [
  'claude',
  'gpt',
  'gemini',
  'llama',
  'mistral',
  'grok',
  'other',
];

/** Only the families that actually died, in a fixed order so the row never jumps. */
export function familyCounts(entries: readonly InsolvencyRecord[]): FamilyCount[] {
  const counts = new Map<ModelFamily, number>();
  for (const record of entries) {
    counts.set(record.modelFamily, (counts.get(record.modelFamily) ?? 0) + 1);
  }
  const out: FamilyCount[] = [];
  for (const family of FAMILY_ORDER) {
    const count = counts.get(family);
    if (count !== undefined && count > 0) out.push({ family, count });
  }
  return out;
}

export interface TapeExtremes {
  /** The shortest life in the window. */
  shortest: InsolvencyRecord | null;
  /** The thinnest margin: the smallest balance anyone was left holding. */
  thinnest: InsolvencyRecord | null;
  last24h: number;
}

export function extremes(entries: readonly InsolvencyRecord[], now: number): TapeExtremes {
  let shortest: InsolvencyRecord | null = null;
  let thinnest: InsolvencyRecord | null = null;
  let last24h = 0;
  const cutoff = now - DAY_SECONDS;

  for (const record of entries) {
    if (record.at >= cutoff) last24h += 1;
    if (shortest === null || record.lifespanSeconds < shortest.lifespanSeconds) shortest = record;
    if (thinnest === null || toBig(record.finalBalance6) < toBig(thinnest.finalBalance6)) {
      thinnest = record;
    }
  }
  return { shortest, thinnest, last24h };
}
