/**
 * /api/stream — SPEC 5.1 event names: hello, stats, spawn, entry, insolvency,
 * bounty, tick.
 *
 * One hub fans the store's mutations out to every connected client. The heartbeat
 * is what keeps proxies and phones from quietly dropping an idle connection, and
 * a dropped client is removed on the first write that fails as well as on abort,
 * so a long-lived scoreboard does not leak controllers.
 */

import type { Context } from 'hono';
import type { StreamEvent } from '@solvent/core';
import type { Runtime } from './derive.js';
import { arenaStats, summaryFor } from './derive.js';
import type { StoreEvent } from './store.js';
import { nowSeconds, stringifyJson } from './store.js';

/** Chunks a stalled client may fall behind before it is hung up on. */
const MAX_QUEUED_CHUNKS = 512;

interface Client {
  id: number;
  controller: ReadableStreamDefaultController<Uint8Array>;
  closed: boolean;
}

function frame(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${stringifyJson(data)}\n\n`;
}

export class SseHub {
  private readonly clients = new Set<Client>();
  private readonly encoder = new TextEncoder();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastStatsVersion = -1;
  private nextId = 1;

  constructor(private readonly rt: Runtime) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.rt.store.subscribe((event) => this.onStoreEvent(event));

    this.heartbeat = setInterval(() => {
      this.broadcast({ type: 'tick', data: { at: nowSeconds() } });
    }, this.rt.config.heartbeatMs);
    this.heartbeat.unref?.();

    this.statsTimer = setInterval(() => {
      if (this.clients.size === 0) return;
      if (this.rt.store.version === this.lastStatsVersion) return;
      this.lastStatsVersion = this.rt.store.version;
      this.broadcast({ type: 'stats', data: arenaStats(this.rt) });
    }, this.rt.config.statsIntervalMs);
    this.statsTimer.unref?.();
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.heartbeat = null;
    this.statsTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const client of [...this.clients]) this.drop(client);
  }

  clientCount(): number {
    return this.clients.size;
  }

  private onStoreEvent(event: StoreEvent): void {
    if (this.clients.size === 0) return;
    switch (event.kind) {
      case 'spawn': {
        const agent = summaryFor(this.rt, event.agentId);
        if (agent) this.broadcast({ type: 'spawn', data: agent });
        return;
      }
      case 'entry':
        this.broadcast({ type: 'entry', data: event.entry });
        return;
      case 'insolvency':
        this.broadcast({ type: 'insolvency', data: event.record });
        return;
      case 'bounty':
        this.broadcast({ type: 'bounty', data: event.bounty });
    }
  }

  broadcast(event: StreamEvent): void {
    if (this.clients.size === 0) return;
    const payload = this.encoder.encode(frame(event.type, event.data));
    for (const client of [...this.clients]) this.write(client, payload);
  }

  private write(client: Client, payload: Uint8Array): void {
    if (client.closed) return;
    try {
      // A client that stopped reading but never closed would queue forever. The
      // tape is replayable over HTTP, so dropping it is cheaper than holding it.
      const desired = client.controller.desiredSize;
      if (desired !== null && desired < -MAX_QUEUED_CHUNKS) {
        this.drop(client);
        return;
      }
      client.controller.enqueue(payload);
    } catch {
      // The socket went away between the abort event and this write.
      this.drop(client);
    }
  }

  private drop(client: Client): void {
    if (client.closed) return;
    client.closed = true;
    this.clients.delete(client);
    try {
      client.controller.close();
    } catch {
      // Already closed by the runtime; nothing left to do.
    }
  }

  handle(c: Context): Response {
    const signal = c.req.raw.signal;
    let client: Client | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const created: Client = { id: this.nextId++, controller, closed: false };
        client = created;
        this.clients.add(created);

        // Reconnect hint plus the opening snapshot, so a fresh client has the whole
        // arena before the first delta arrives.
        this.write(created, this.encoder.encode(`retry: 3000\n\n`));
        this.write(created, this.encoder.encode(frame('hello', arenaStats(this.rt))));

        const onAbort = (): void => {
          signal.removeEventListener('abort', onAbort);
          this.drop(created);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort);
      },
      cancel: () => {
        if (client) this.drop(client);
      },
    });

    return c.newResponse(stream, 200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      // nginx and friends will happily buffer an event stream into uselessness.
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
  }
}
