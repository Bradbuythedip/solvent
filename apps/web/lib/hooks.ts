'use client';

/**
 * The clock.
 *
 * A runway counting down is the emotional payload of this product, and there can
 * be a hundred of them on a leaderboard. One setInterval drives all of them:
 * subscribers are grouped into buckets by cadence, the timer runs at the fastest
 * bucket's rate, and each bucket only re-renders its own consumers when the
 * second it publishes actually changes.
 *
 * The timer is stopped entirely when the tab is hidden (a background tab should
 * cost nothing) and under prefers-reduced-motion, where a number that changes on
 * its own is exactly the motion the setting asks us not to make. In both cases
 * the value is refreshed once when the tab becomes visible again, so a paused
 * clock is never a stale-looking one.
 */

import { useCallback, useSyncExternalStore } from 'react';

const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 60_000;
/** Timers fire late, never early, but leave a little slack for scheduler jitter. */
const SLACK_MS = 8;

interface Bucket {
  intervalMs: number;
  /** Unix seconds. 0 means "not mounted yet" — see useNow. */
  value: number;
  lastAt: number;
  listeners: Set<() => void>;
}

const buckets = new Map<number, Bucket>();
let timer: ReturnType<typeof setInterval> | null = null;
let baseMs = 0;
let envBound = false;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function clampInterval(intervalMs: number): number {
  if (!Number.isFinite(intervalMs)) return 1_000;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(intervalMs)));
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function paused(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
  return prefersReducedMotion();
}

function tick(force: boolean): void {
  const ms = Date.now();
  const seconds = Math.floor(ms / 1000);
  for (const bucket of buckets.values()) {
    if (!force && ms - bucket.lastAt < bucket.intervalMs - SLACK_MS) continue;
    bucket.lastAt = ms;
    if (bucket.value === seconds) continue;
    bucket.value = seconds;
    for (const listener of [...bucket.listeners]) listener();
  }
}

function sync(): void {
  let desired = 0;
  if (buckets.size > 0 && !paused()) {
    desired = MAX_INTERVAL_MS;
    for (const bucket of buckets.values()) desired = Math.min(desired, bucket.intervalMs);
  }
  if (desired === baseMs && (desired === 0) === (timer === null)) return;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  baseMs = desired;
  if (desired > 0) timer = setInterval(() => tick(false), desired);
}

function bindEnv(): void {
  if (envBound || typeof window === 'undefined') return;
  envBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick(true);
    sync();
  });
  const query =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
  query?.addEventListener('change', () => {
    tick(true);
    sync();
  });
}

function subscribeClock(intervalMs: number, listener: () => void): () => void {
  bindEnv();
  const key = clampInterval(intervalMs);
  let bucket = buckets.get(key);
  if (bucket === undefined) {
    bucket = { intervalMs: key, value: 0, lastAt: 0, listeners: new Set() };
    buckets.set(key, bucket);
  }
  const target = bucket;
  target.listeners.add(listener);
  if (target.value === 0) {
    // React reads the snapshot immediately after subscribing; seed it here so the
    // first post-hydration render already carries the real time.
    target.value = nowSeconds();
    target.lastAt = Date.now();
  }
  sync();
  return () => {
    target.listeners.delete(listener);
    if (target.listeners.size === 0) buckets.delete(target.intervalMs);
    sync();
  };
}

function clockValue(key: number): number {
  return buckets.get(key)?.value ?? 0;
}

/** Stable across a server render, so hydration has nothing to disagree about. */
const getServerClock = (): number => 0;

/**
 * Unix seconds, ticking at `intervalMs` off the shared clock.
 *
 * Returns `initialSeconds` (0 by default) until the component has mounted, which
 * is what keeps the server render and the hydration render identical. Pass a
 * server-computed value when the pre-mount frame has to show something real.
 */
export function useNow(intervalMs = 1_000, initialSeconds = 0): number {
  const key = clampInterval(intervalMs);
  const subscribe = useCallback((listener: () => void) => subscribeClock(key, listener), [key]);
  const snapshot = useCallback(() => clockValue(key), [key]);
  const value = useSyncExternalStore(subscribe, snapshot, getServerClock);
  return value === 0 ? initialSeconds : value;
}

/**
 * Seconds remaining until `targetSeconds` (a unix timestamp), floored at zero.
 *
 * `fallbackSeconds` is what the server renders and what hydration reuses — pass
 * the runway the indexer reported and the number never jumps on mount.
 */
export function useCountdown(targetSeconds: number, fallbackSeconds = 0): number {
  const now = useNow(1_000);
  if (now === 0) return Math.max(0, Math.floor(fallbackSeconds));
  return Math.max(0, Math.floor(targetSeconds - now));
}

/** Seconds since `sinceSeconds` — a lifespan counting up. */
export function useElapsed(sinceSeconds: number, fallbackSeconds = 0): number {
  const now = useNow(1_000);
  if (now === 0) return Math.max(0, Math.floor(fallbackSeconds));
  return Math.max(0, Math.floor(now - sinceSeconds));
}

/** True once the component is running in the browser. */
export function useMounted(): boolean {
  return useNow(MAX_INTERVAL_MS) !== 0;
}

const subscribeMotion = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};

/** For the rare case where a component must not build the animated thing at all. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, prefersReducedMotion, () => false);
}
