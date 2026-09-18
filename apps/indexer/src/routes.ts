/**
 * The Hono app — SPEC 5 exactly: the nine routes, JSON, CORS *, no-store.
 *
 * Every response body goes through one serialiser, because a raw bigint in
 * JSON.stringify throws and every monetary field in this product is a bigint.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AgentSort, AgentStatusFilter } from '@solvent/core';
import type { Runtime } from './derive.js';
import {
  agentDetail,
  arenaStats,
  feedPage,
  healthFor,
  ledgerPage,
  queryAgents,
  sparklineFor,
} from './derive.js';
import { stringifyJson } from './store.js';
import type { SseHub } from './sse.js';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Last-Event-ID',
  'Access-Control-Max-Age': '600',
};

const SORTS: readonly AgentSort[] = [
  'net',
  'earned',
  'burned',
  'balance',
  'runway',
  'lifespan',
  'born',
];
const STATUSES: readonly AgentStatusFilter[] = ['alive', 'dead', 'retired', 'all'];

function json(c: Context, data: unknown, status: 200 | 400 | 404 | 500 = 200): Response {
  return c.newResponse(stringifyJson(data), status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function parseInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseSort(raw: string | undefined): AgentSort {
  const found = SORTS.find((sort) => sort === raw);
  return found ?? 'net';
}

function parseStatus(raw: string | undefined): AgentStatusFilter {
  const found = STATUSES.find((status) => status === raw);
  return found ?? 'alive';
}

function parseOrder(raw: string | undefined): 'asc' | 'desc' {
  return raw === 'asc' ? 'asc' : 'desc';
}

/** "24h" / "7d" / "45m" / "3600" / "all". Undefined means the whole life. */
function parseWindow(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '' || raw === 'all') return undefined;
  const match = /^(\d+)([smhdw]?)$/.exec(raw.trim().toLowerCase());
  if (!match) return undefined;
  const value = Number.parseInt(match[1] ?? '0', 10);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  switch (match[2]) {
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86_400;
    case 'w':
      return value * 604_800;
    default:
      return value;
  }
}

export function createApp(rt: Runtime, hub: SseHub): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return c.newResponse(null, 204, CORS_HEADERS);
    await next();
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      if (!c.res.headers.has(key)) c.res.headers.set(key, value);
    }
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
  });

  app.get('/', (c) =>
    json(c, {
      name: '@solvent/indexer',
      mode: rt.config.mode,
      chainId: rt.config.chainId,
      routes: [
        '/api/health',
        '/api/stats',
        '/api/agents',
        '/api/agents/:id',
        '/api/agents/:id/sparkline',
        '/api/feed',
        '/api/ledger',
        '/api/bounties',
        '/api/stream',
      ],
    }),
  );

  app.get('/api/health', (c) => json(c, healthFor(rt)));

  app.get('/api/stats', (c) => json(c, arenaStats(rt)));

  app.get('/api/agents', (c) =>
    json(
      c,
      queryAgents(rt, {
        status: parseStatus(c.req.query('status')),
        sort: parseSort(c.req.query('sort')),
        order: parseOrder(c.req.query('order')),
        limit: parseInteger(c.req.query('limit'), 50),
        cursor: c.req.query('cursor'),
        q: c.req.query('q'),
      }),
    ),
  );

  app.get('/api/agents/:id', (c) => {
    const id = parseInteger(c.req.param('id'), 0);
    const detail = agentDetail(rt, id);
    if (!detail) return json(c, { error: 'agent not found', id }, 404);
    return json(c, detail);
  });

  app.get('/api/agents/:id/sparkline', (c) => {
    const id = parseInteger(c.req.param('id'), 0);
    const points = sparklineFor(rt, id, parseWindow(c.req.query('window')));
    if (points === null) return json(c, { error: 'agent not found', id }, 404);
    return json(c, { points });
  });

  app.get('/api/feed', (c) =>
    json(c, feedPage(rt, parseInteger(c.req.query('limit'), 50), c.req.query('cursor'))),
  );

  app.get('/api/ledger', (c) =>
    json(c, ledgerPage(rt, parseInteger(c.req.query('limit'), 100), c.req.query('cursor'))),
  );

  app.get('/api/bounties', (c) => json(c, { items: rt.store.bounties(c.req.query('state')) }));

  app.get('/api/stream', (c) => hub.handle(c));

  app.notFound((c) => json(c, { error: 'not found', path: c.req.path }, 404));

  app.onError((err, c) => {
    console.error(`[api] ${c.req.method} ${c.req.path} failed: ${String(err)}`);
    return json(c, { error: 'internal error' }, 500);
  });

  return app;
}
