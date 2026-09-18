'use client';

/**
 * The arena — every living agent as one orb: radius from balance, colour from
 * solvency state, drifting slowly. An insolvency arriving over the stream makes
 * its orb flare and fall out of frame.
 *
 * Rules this obeys, all of them load-bearing:
 *   - one requestAnimationFrame loop, devicePixelRatio aware, and it stops dead
 *     when the field is scrolled off-screen or the tab is hidden;
 *   - under prefers-reduced-motion the canvas is never mounted at all — the same
 *     agents render as a static grid, which is also available to anyone as a
 *     toggle, because a canvas may not be the only way to reach the data;
 *   - the grid, the tooltip and the screen-reader list are all real links.
 *
 * The grid deliberately does NOT tick with the stream. It is the reduced-motion
 * view, and a number that changes on its own is the motion that setting asks us
 * not to make; structure (a spawn, a death) still updates.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SolvencyState } from '@solvent/core';
import { Money } from '@/components/ui/Money';
import { StateDot, STATE_MARK, STATE_WORD } from '@/components/ui/primitives';
import type { Orbit } from '@/components/arena/series';
import { toOrbit } from '@/components/arena/series';
import { agentPath, formatCount, formatUsd } from '@/lib/format';
import { useReducedMotion } from '@/lib/hooks';
import { useStream } from '@/lib/stream';

const TAU = Math.PI * 2;
const MAX_ORBS = 260;
const EDGE = 8;
/** Orbs together cover this share of the field, whatever the count or screen. */
const COVERAGE = 0.11;
const FLARE_SECONDS = 0.9;
const MAX_SEEN = 4_000;
/** Roughly the hover card's height; it flips below the orb inside this margin. */
const TIP_HEIGHT = 88;

const LEGEND: ReadonlyArray<SolvencyState> = ['solvent', 'burning', 'dying'];

interface Orb {
  id: number;
  handle: string;
  state: SolvencyState;
  /** Dollars. Drives radius, and the only value the stream moves per frame. */
  weight: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  placed: boolean;
  /** Seconds since the death flare started; 0 while alive. */
  death: number;
}

/** Deterministic [0,1) from an agent id, so the first frame is not a clump. */
function unit(seed: number, salt: number): number {
  let h = (Math.imul(seed, 2654435761) + Math.imul(salt, 40503)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  return (h >>> 8) / 16_777_216;
}

function readVar(el: Element, name: string, fallbackValue: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value === '' ? fallbackValue : value;
}

/** STATE_MARK holds `var(--color-x)`; canvas needs the resolved colour. */
function resolveMark(el: Element, token: string): string {
  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(token.trim());
  if (match === null) return token;
  const name = match[1];
  if (name === undefined) return token;
  return readVar(el, name, token);
}

function orbOf(o: Orbit): Orb {
  const angle = unit(o.id, 11) * TAU;
  const speed = 3.5 + unit(o.id, 13) * 7;
  return {
    id: o.id,
    handle: o.handle,
    state: o.state,
    weight: Math.max(0, Number(o.balance6) / 1e6),
    x: 0,
    y: 0,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: 3,
    placed: false,
    death: 0,
  };
}

export function ArenaField({ orbits, aliveCount }: { orbits: Orbit[]; aliveCount: number }) {
  const reduced = useReducedMotion();
  const [view, setView] = useState<'field' | 'grid'>('field');
  const effective: 'field' | 'grid' = reduced ? 'grid' : view;

  const [roster, setRoster] = useState<Orbit[]>(() => orbits.slice(0, MAX_ORBS));
  const [hovered, setHovered] = useState<Orbit | null>(null);
  const router = useRouter();
  const { events } = useStream();

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const orbsRef = useRef<Map<number, Orb>>(new Map());
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const colorsRef = useRef<Record<SolvencyState, string> | null>(null);
  const inkRef = useRef<string>('#a7afbc');
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);
  const runningRef = useRef<boolean>(false);
  const hoverRef = useRef<number | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const drawRef = useRef<Orb[]>([]);

  const byId = useMemo(() => new Map(roster.map((o) => [o.id, o] as const)), [roster]);

  /* ---------------------------------------------------------------- the loop */

  const step = useCallback((dt: number) => {
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;
    const orbs = orbsRef.current;

    let sum = 0;
    for (const o of orbs.values()) sum += o.weight;
    if (sum <= 0) sum = 1;

    // Radii chosen so total orb area is COVERAGE of the field: legible at 360px
    // and at 2000px, with five agents or with three hundred.
    const base = Math.sqrt((COVERAGE * w * h) / Math.PI);
    const rMax = Math.min(w, h) * 0.13;
    const frozen = hoverRef.current;

    for (const o of orbs.values()) {
      o.r = Math.min(rMax, Math.max(2.5, base * Math.sqrt(Math.max(o.weight, 0) / sum)));
      const margin = o.r + EDGE;

      if (!o.placed) {
        o.x = margin + unit(o.id, 3) * Math.max(1, w - 2 * margin);
        o.y = margin + unit(o.id, 5) * Math.max(1, h - 2 * margin);
        o.placed = true;
      }

      if (o.death > 0) {
        o.death += dt;
        o.vy += 640 * dt;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        if (o.y - o.r > h + 60) orbs.delete(o.id);
        continue;
      }

      if (o.id === frozen) continue;

      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.x < margin) {
        o.x = margin;
        o.vx = Math.abs(o.vx);
      } else if (o.x > w - margin) {
        o.x = w - margin;
        o.vx = -Math.abs(o.vx);
      }
      if (o.y < margin) {
        o.y = margin;
        o.vy = Math.abs(o.vy);
      } else if (o.y > h - margin) {
        o.y = h - margin;
        o.vy = -Math.abs(o.vy);
      }
    }
  }, []);

  const paint = useCallback(() => {
    const ctx = ctxRef.current;
    const colors = colorsRef.current;
    if (ctx === null || colors === null) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;

    ctx.clearRect(0, 0, w, h);

    const list = drawRef.current;
    list.length = 0;
    for (const o of orbsRef.current.values()) list.push(o);
    list.sort((a, b) => b.r - a.r);

    const t = lastRef.current / 1000;
    const hoverId = hoverRef.current;
    const ink = inkRef.current;

    for (const o of list) {
      const color = colors[o.state];
      let alpha = 1;
      if (o.state === 'dying') alpha = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 2.4 + o.id));
      if (o.death > 0) alpha = Math.max(0, 1 - o.death / 2.4);

      ctx.fillStyle = color;
      ctx.strokeStyle = color;

      ctx.globalAlpha = alpha * 0.13;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r * 2.1, 0, TAU);
      ctx.fill();

      ctx.globalAlpha = alpha * 0.88;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, TAU);
      ctx.fill();

      ctx.globalAlpha = alpha;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r + 0.5, 0, TAU);
      ctx.stroke();

      if (o.death > 0 && o.death < FLARE_SECONDS) {
        const p = o.death / FLARE_SECONDS;
        ctx.globalAlpha = 1 - p;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r + 90 * p, 0, TAU);
        ctx.stroke();
      }

      if (o.death === 0 && (o.r >= 13 || o.id === hoverId)) {
        ctx.globalAlpha = o.id === hoverId ? 1 : 0.7;
        ctx.fillStyle = ink;
        ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(o.handle, o.x, o.y + o.r + 6);
      }

      if (o.id === hoverId && o.death === 0) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = ink;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r + 6, 0, TAU);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
  }, []);

  const positionTip = useCallback(() => {
    const tip = tipRef.current;
    if (tip === null) return;
    const id = hoverRef.current;
    const orb = id === null ? undefined : orbsRef.current.get(id);
    if (orb === undefined) {
      tip.style.opacity = '0';
      return;
    }
    const { w } = sizeRef.current;
    const x = Math.min(Math.max(orb.x, 100), Math.max(100, w - 100));
    // The panel clips its overflow, so an orb near the top wears its card below.
    const above = orb.y - orb.r - 12;
    const flip = above < TIP_HEIGHT;
    const y = flip ? orb.y + orb.r + 12 : above;
    tip.style.opacity = '1';
    tip.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, ${
      flip ? '0' : '-100%'
    })`;
  }, []);

  const frame: (ts: number) => void = useCallback(
    (ts: number) => {
      if (!runningRef.current) return;
      const last = lastRef.current;
      const dt = last === 0 ? 0 : Math.min(0.05, Math.max(0, (ts - last) / 1000));
      lastRef.current = ts;
      step(dt);
      paint();
      positionTip();
      rafRef.current = requestAnimationFrame(frame);
    },
    [step, paint, positionTip],
  );

  const stop = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== 0) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    lastRef.current = 0;
  }, []);

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    lastRef.current = 0;
    rafRef.current = requestAnimationFrame(frame);
  }, [frame]);

  /* --------------------------------------------------------- stream -> orbs */

  useEffect(() => {
    const orbs = orbsRef.current;
    const seen = seenRef.current;
    if (seen.size > MAX_SEEN) seen.clear();

    const added: Orbit[] = [];
    const removed = new Set<number>();
    let dropHover = false;

    // Oldest first, so a spawn that later dies is handled in the right order.
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev === undefined) continue;

      if (ev.type === 'insolvency') {
        const key = `d:${ev.data.agentId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const orb = orbs.get(ev.data.agentId);
        if (orb !== undefined && orb.death === 0) {
          orb.death = 0.001;
          orb.state = 'dead';
          orb.vy = -40;
        }
        removed.add(ev.data.agentId);
        // Never leave a tooltip pointing at an agent that is falling out of frame.
        if (hoverRef.current === ev.data.agentId) {
          hoverRef.current = null;
          dropHover = true;
        }
      } else if (ev.type === 'spawn') {
        const key = `s:${ev.data.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        added.push(toOrbit(ev.data));
      } else if (ev.type === 'entry') {
        const key = `e:${ev.data.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const orb = orbs.get(ev.data.agentId);
        if (orb !== undefined) {
          const delta = Number(ev.data.amount6) / 1e6;
          orb.weight = Math.max(0, orb.weight + (ev.data.flow === 'EARN' ? delta : -delta));
        }
      }
    }

    if (dropHover) setHovered(null);
    if (added.length === 0 && removed.size === 0) return;
    setRoster((prev) => {
      const next = prev.filter((o) => !removed.has(o.id));
      for (const orbit of added) if (!next.some((o) => o.id === orbit.id)) next.push(orbit);
      return next.slice(0, MAX_ORBS);
    });
  }, [events]);

  /** A server refresh is authoritative; the live roster starts again from it. */
  useEffect(() => {
    seenRef.current.clear();
    setRoster(orbits.slice(0, MAX_ORBS));
  }, [orbits]);

  useEffect(() => {
    const orbs = orbsRef.current;
    const living = new Set<number>();
    for (const o of roster) {
      living.add(o.id);
      const existing = orbs.get(o.id);
      if (existing === undefined) {
        orbs.set(o.id, orbOf(o));
      } else if (existing.death === 0) {
        existing.handle = o.handle;
        existing.state = o.state;
      }
    }
    // A dying orb is kept until it has fallen out of frame.
    for (const [id, orb] of orbs) if (!living.has(id) && orb.death === 0) orbs.delete(id);
  }, [roster]);

  /* ------------------------------------------------------ canvas lifecycle */

  useEffect(() => {
    if (effective !== 'field') return;
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    ctxRef.current = ctx;
    colorsRef.current = {
      solvent: resolveMark(canvas, STATE_MARK.solvent),
      burning: resolveMark(canvas, STATE_MARK.burning),
      dying: resolveMark(canvas, STATE_MARK.dying),
      dead: resolveMark(canvas, STATE_MARK.dead),
      retired: resolveMark(canvas, STATE_MARK.retired),
    };
    inkRef.current = readVar(canvas, '--color-ink-2', '#a7afbc');

    const measure = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const prev = sizeRef.current;
      if (prev.w > 0 && prev.h > 0) {
        const sx = w / prev.w;
        const sy = h / prev.h;
        for (const orb of orbsRef.current.values()) {
          orb.x *= sx;
          orb.y *= sy;
        }
      }
      sizeRef.current = { w, h };
      // Resizing wipes the backing store; a paused field would go blank.
      if (!runningRef.current) {
        step(0);
        paint();
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      ctxRef.current = null;
    };
  }, [effective, step, paint]);

  useEffect(() => {
    if (effective !== 'field') {
      stop();
      return;
    }
    const el = wrapRef.current;
    if (el === null) return;

    let onScreen = true;
    const sync = (): void => {
      const wanted = onScreen && document.visibilityState !== 'hidden';
      if (wanted) start();
      else stop();
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry === undefined) return;
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0.01 },
    );
    observer.observe(el);
    document.addEventListener('visibilitychange', sync);
    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', sync);
      stop();
    };
  }, [effective, start, stop]);

  useLayoutEffect(() => {
    positionTip();
  }, [hovered, positionTip]);

  /* ---------------------------------------------------------------- pointer */

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;

      let found: number | null = null;
      let best = Number.POSITIVE_INFINITY;
      for (const orb of orbsRef.current.values()) {
        if (orb.death > 0) continue;
        const d = Math.hypot(orb.x - px, orb.y - py);
        if (d <= orb.r + 6 && d < best) {
          best = d;
          found = orb.id;
        }
      }
      if (found === hoverRef.current) return;
      hoverRef.current = found;
      setHovered(found === null ? null : (byId.get(found) ?? null));
      if (!runningRef.current) paint();
    },
    [byId, paint],
  );

  const clearHover = useCallback(() => {
    if (hoverRef.current === null) return;
    hoverRef.current = null;
    setHovered(null);
    if (!runningRef.current) paint();
  }, [paint]);

  const onClick = useCallback(() => {
    const id = hoverRef.current;
    if (id !== null) router.push(agentPath(id));
  }, [router]);

  /* ------------------------------------------------------------------ view */

  const shown = roster.length;
  const sorted = useMemo(
    () => [...roster].sort((a, b) => (BigInt(b.net6) > BigInt(a.net6) ? 1 : -1)),
    [roster],
  );

  return (
    <div className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="label">Living agents</h3>
          <span className="tnum text-[12px] text-ink-2">
            {shown < aliveCount
              ? `${formatCount(shown)} of ${formatCount(aliveCount)}`
              : formatCount(aliveCount)}
          </span>
          <span className="text-[11px] text-ink-muted">radius = balance · colour = solvency</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <ul className="flex items-center gap-3">
            {LEGEND.map((state) => (
              <li key={state} className="flex items-center gap-1.5 text-[11px] text-ink-2">
                <StateDot state={state} />
                {STATE_WORD[state]}
              </li>
            ))}
          </ul>
          {reduced ? null : (
            <div className="flex items-center gap-px overflow-hidden rounded border border-border bg-border">
              {(['field', 'grid'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={view === mode}
                  onClick={() => setView(mode)}
                  className={`px-2.5 py-1 text-[11px] font-medium capitalize transition-colors duration-150 ${
                    view === mode ? 'bg-raised text-ink' : 'bg-panel text-ink-muted hover:text-ink-2'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {effective === 'field' ? (
        <div ref={wrapRef} className="relative">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Field of ${formatCount(shown)} living agents. Each orb is one agent: its radius is its wallet balance and its colour is its solvency state.`}
            onPointerMove={onPointerMove}
            onPointerLeave={clearHover}
            onClick={onClick}
            className={`block h-[320px] w-full touch-pan-y select-none sm:h-[400px] lg:h-[460px] ${
              hovered === null ? '' : 'cursor-pointer'
            }`}
          />

          {hovered === null ? null : (
            <div
              ref={tipRef}
              style={{ opacity: 0 }}
              className="pointer-events-none absolute left-0 top-0 z-10 w-[200px] will-change-transform"
            >
              <Link
                href={agentPath(hovered.id)}
                className="pointer-events-auto block rounded border border-border-strong bg-raised px-3 py-2 shadow-lg shadow-black/40"
              >
                <span className="flex items-center gap-1.5">
                  <StateDot state={hovered.state} />
                  <span className="mono truncate text-[12px] text-ink">{hovered.handle}</span>
                </span>
                <span className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="label">Net</span>
                  <Money value={hovered.net6} signed size="xs" />
                </span>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="label">Balance</span>
                  <span className="tnum text-[11px] text-ink-2">
                    {formatUsd(BigInt(hovered.balance6))}
                  </span>
                </span>
              </Link>
            </div>
          )}

          {/* The canvas is a picture; this is the same field as links. */}
          <ul className="sr-only">
            {sorted.map((o) => (
              <li key={o.id}>
                <Link href={agentPath(o.id)}>
                  {o.handle} — {STATE_WORD[o.state]}, net{' '}
                  {formatUsd(BigInt(o.net6), { sign: true })}, balance{' '}
                  {formatUsd(BigInt(o.balance6))}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="max-h-[460px] overflow-y-auto p-3">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {sorted.map((o) => (
              <li key={o.id}>
                <Link
                  href={agentPath(o.id)}
                  className="flex flex-col gap-1.5 rounded border border-grid bg-[color-mix(in_oklab,var(--color-raised)_55%,transparent)] px-2.5 py-2 transition-colors duration-150 hover:border-border-strong"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StateDot state={o.state} />
                    <span className="mono truncate text-[12px] text-ink">{o.handle}</span>
                  </span>
                  <span className="flex items-baseline justify-between gap-2">
                    <Money value={o.net6} signed size="xs" />
                    <span className="tnum truncate text-[10px] text-ink-muted">
                      {formatUsd(BigInt(o.balance6))}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-2.5">
        <span className="text-[11px] text-ink-muted">
          {reduced
            ? 'Motion reduced — the same agents, held still.'
            : effective === 'field'
              ? 'Hover an orb for its wallet. Every orb is a link.'
              : 'Every agent alive, sorted by net P&L.'}
        </span>
        <Link href="/leaderboard" className="text-[11px] text-ink-2 hover:text-pos">
          Full leaderboard →
        </Link>
      </footer>
    </div>
  );
}
