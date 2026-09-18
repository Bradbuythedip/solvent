'use client';

/**
 * useStream() — the live tape, over SSE from the indexer (SPEC 5.1).
 *
 * One EventSource is shared by every consumer on the page through an external
 * store, so the status bar, the chain indicator and the tape cost one connection
 * between them rather than one each.
 *
 * When there is no indexer this must be invisible. The browser logs its own
 * connection failure once per attempt and we cannot suppress that, so we own the
 * backoff instead of letting EventSource retry forever: a handful of attempts,
 * then we stop and the page stays exactly as the server rendered it. Nothing
 * throws, nothing is logged by us, and `connected` stays false.
 */

import { useSyncExternalStore } from 'react';
import type { ArenaStats, StreamEvent } from '@solvent/core';
import { INDEXER_URL } from '@/lib/api';

/** Deep enough for a full-screen tape, shallow enough to stay cheap. */
const MAX_EVENTS = 200;
/** Bursts of ledger entries arrive together; coalesce them into one render. */
const FLUSH_MS = 120;
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;
const MAX_ATTEMPTS = 5;
/** React remounts subscribers in StrictMode; do not thrash the socket for that. */
const TEARDOWN_GRACE_MS = 250;

const NAMES = ['hello', 'stats', 'spawn', 'entry', 'insolvency', 'bounty', 'tick'] as const;
type EventName = (typeof NAMES)[number];

export interface StreamState {
  /** Newest first. `tick` and `stats` are not retained — they are noise in a tape. */
  events: StreamEvent[];
  connected: boolean;
  stats: ArenaStats | null;
}

const EMPTY: StreamState = Object.freeze({ events: [], connected: false, stats: null });

let snapshot: StreamState = EMPTY;
const listeners = new Set<() => void>();

let source: EventSource | null = null;
let attempts = 0;
let pending: StreamEvent[] = [];
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;
let envBound = false;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function setConnected(value: boolean): void {
  if (snapshot.connected === value) return;
  snapshot = { events: snapshot.events, connected: value, stats: snapshot.stats };
  notify();
}

function setStats(stats: ArenaStats): void {
  snapshot = { events: snapshot.events, connected: snapshot.connected, stats };
  notify();
}

function flush(): void {
  flushTimer = null;
  if (pending.length === 0) return;
  const incoming = pending.reverse();
  pending = [];
  const events = incoming.concat(snapshot.events).slice(0, MAX_EVENTS);
  snapshot = { events, connected: snapshot.connected, stats: snapshot.stats };
  notify();
}

function scheduleFlush(): void {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flush, FLUSH_MS);
}

function ingest(name: EventName, raw: string): void {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return; // A truncated frame is not worth a console entry.
  }
  if (data === null || typeof data !== 'object') return;
  if (name === 'tick') return;
  if (name === 'hello' || name === 'stats') {
    setStats(data as ArenaStats);
    return;
  }
  // The wire is untyped by nature; the event name is the discriminant the
  // indexer promises in SPEC 5.1.
  pending.push({ type: name, data } as unknown as StreamEvent);
  if (pending.length > MAX_EVENTS) pending = pending.slice(-MAX_EVENTS);
  scheduleFlush();
}

function close(es: EventSource): void {
  if (source === es) source = null;
  try {
    es.close();
  } catch {
    // Already torn down by the browser.
  }
  setConnected(false);
}

function scheduleRetry(): void {
  if (retryTimer !== null || listeners.size === 0) return;
  attempts += 1;
  if (attempts > MAX_ATTEMPTS) return; // Give up quietly: the static render stands.
  const backoff = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** (attempts - 1));
  retryTimer = setTimeout(
    () => {
      retryTimer = null;
      if (listeners.size > 0) open();
    },
    backoff + Math.random() * backoff * 0.25,
  );
}

function open(): void {
  if (source !== null) return;
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

  let es: EventSource;
  try {
    es = new EventSource(`${INDEXER_URL}/api/stream`);
  } catch {
    return; // A bad URL will not become a good one on the next try.
  }
  source = es;

  es.onopen = () => {
    attempts = 0;
    setConnected(true);
  };
  es.onerror = () => {
    close(es);
    scheduleRetry();
  };
  for (const name of NAMES) {
    es.addEventListener(name, (event: Event) => {
      const message = event as MessageEvent<unknown>;
      if (typeof message.data === 'string') ingest(name, message.data);
    });
  }
}

function bindEnv(): void {
  if (envBound || typeof document === 'undefined') return;
  envBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (listeners.size === 0 || source !== null || retryTimer !== null) return;
    // Coming back to the tab is a fresh chance, even after we gave up.
    attempts = 0;
    open();
  });
}

function start(): void {
  if (teardownTimer !== null) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
  bindEnv();
  if (source === null && retryTimer === null) {
    attempts = 0;
    open();
  }
}

function stop(): void {
  if (teardownTimer !== null) return;
  teardownTimer = setTimeout(() => {
    teardownTimer = null;
    if (listeners.size > 0) return;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    pending = [];
    if (source !== null) close(source);
  }, TEARDOWN_GRACE_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

const getSnapshot = (): StreamState => snapshot;
const getServerSnapshot = (): StreamState => EMPTY;

/**
 * The live arena. Server-rendered content is the source of truth until the first
 * event lands, so a page that never connects simply never changes.
 */
export function useStream(): StreamState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
