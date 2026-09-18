/**
 * Entry point. Config decides the mode, the mode decides the driver, and both
 * modes fill the same store behind the same API.
 */

import { serve } from '@hono/node-server';
import { startChain } from './chain.js';
import { describeConfig, loadConfig } from './config.js';
import { startDemo } from './demo.js';
import type { Runtime } from './derive.js';
import { createApp } from './routes.js';
import { SseHub } from './sse.js';
import type { Driver, DriverStatus } from './store.js';
import { Store } from './store.js';

function main(): void {
  const config = loadConfig();
  if (config.modeNote) {
    console.warn(`[main] SOLVENT_MODE=${config.requestedMode} but ${config.modeNote}`);
  }

  const store = new Store({
    chainId: config.chainId,
    mode: config.mode,
    dataDir: config.dataDir,
  });

  let driver: Driver | null = null;
  const runtime: Runtime = {
    store,
    config,
    status(): DriverStatus {
      return driver?.status() ?? { ok: false, head: store.head, lag: 0 };
    },
  };

  driver = config.mode === 'live' ? startChain(store, config) : startDemo(store, config);

  const hub = new SseHub(runtime);
  hub.start();

  const app = createApp(runtime, hub);
  let listening = false;
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    listening = true;
    console.log(`[main] solvent indexer listening on http://${config.host}:${info.port}`);
    console.log(`[main] ${describeConfig(config)}`);
    if (config.mode !== 'live') {
      console.log('[main] SIMULATED DATA: /api/health.mode reports "demo" and the UI must say so');
    }
  });

  const snapshotTimer = setInterval(() => store.saveSnapshot(), config.snapshotIntervalMs);
  snapshotTimer.unref?.();

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[main] ${signal}: draining`);
    clearInterval(snapshotTimer);
    hub.stop();
    void driver?.stop();
    store.saveSnapshot();
    server.close(() => process.exit(0));
    // Do not wait forever on a client that will not hang up.
    const force = setTimeout(() => process.exit(0), 3_000);
    force.unref?.();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // An RPC that misbehaves is weather, not a reason to take the scoreboard down.
  process.on('unhandledRejection', (reason) => {
    console.warn(`[main] unhandled rejection: ${String(reason)}`);
  });
  process.on('uncaughtException', (err) => {
    console.error(`[main] uncaught exception: ${String(err)}`);
    // Before the socket is bound there is nothing to keep alive, and swallowing a
    // bind failure would leave a dead process that once printed a warning.
    if (!listening) process.exit(1);
  });
}

main();
