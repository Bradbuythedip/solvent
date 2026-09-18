#!/usr/bin/env node
/**
 * CLI entry point. Wires the parts together, installs the safety rails, and
 * hands control to the loop.
 *
 *   PRIVATE_KEY=0x... pnpm --filter @solvent/agent start -- --brain heuristic
 *
 * The key is read from the environment and turned into a signer in memory. It is
 * never printed, never passed as an argument, and never written to disk.
 */

import { formatUsd } from '@solvent/core';
import { ConfigError, loadConfig, readPrivateKey } from './config.js';
import { createLogger } from './log.js';
import { AgentWallet, WalletError } from './wallet.js';
import { createBrain } from './brains/index.js';
import { ServiceDiscovery } from './discovery.js';
import { IndexerClient } from './indexer.js';
import { X402Client } from './x402/client.js';
import { startService } from './x402/server.js';
import { LoopError, PriceBook, runLoop } from './loop.js';

const USAGE = `solvent-agent - the metabolism loop for one agent in the Solvent arena

  PRIVATE_KEY=0x... solvent-agent [options]

Options
  --brain <name>        heuristic (default) | claude | openai | gemini
  --chain <name>        arc | arcTestnet            (env SOLVENT_CHAIN)
  --rpc <url>           Arc RPC endpoint
  --indexer <url>       Solvent indexer            (env SOLVENT_INDEXER_URL)
  --agent-id <n>        skip the registry lookup
  --interval <seconds>  seconds between ticks, default 60
  --max-spend <amount>  per-action cap, 6dp units or "$0.05"
  --price <amount>      what this agent charges per request
  --port <n>            port for this agent's own endpoint, default 8402
  --no-serve            do not serve a priced endpoint
  --once                run a single tick and exit
  --dry-run             decide and log, sign nothing
  --yes-i-know          start even with an unbounded allowance to Metabolism
  --log-level <level>   debug | info | warn | error
  --help

Contract addresses come from SOLVENT_REGISTRY_ADDRESS, SOLVENT_METABOLISM_ADDRESS,
SOLVENT_SERVICE_METER_ADDRESS and SOLVENT_BOUNTY_BOARD_ADDRESS (or the matching
--registry, --metabolism, --service-meter, --bounty-board flags).

This spends real money.`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const config = loadConfig(argv);
  const logger = createLogger(config.logLevel);
  if (process.env['SOLVENT_MODE'] === 'demo') {
    // The indexer has a demo mode. An agent does not: this loop signs real
    // transactions on whichever chain it is pointed at.
    logger.warn('SOLVENT_MODE=demo has no effect here: this agent acts on chain', {
      chain: config.network.name,
    });
  }

  const privateKey = readPrivateKey();

  const wallet = new AgentWallet(privateKey, config);
  const agentId = await wallet.agentId();
  const price = new PriceBook(config.price6);

  const brain = createBrain(config.brain, {
    onFallback: (reason) => logger.warn('brain fell back to the heuristic', { reason }),
  });

  const deps = {
    config,
    wallet,
    brain,
    discovery: new ServiceDiscovery(),
    indexer: new IndexerClient({ baseUrl: config.indexerUrl }),
    x402: new X402Client({
      wallet,
      payerAgentId: agentId,
      maxSpendPerAction6: config.maxSpendPerAction6,
    }),
    price,
    logger,
  };

  let service: { close(): Promise<void> } | null = null;
  if (config.serve) {
    if (config.contracts.serviceMeter === null) {
      logger.warn('serving without a ServiceMeter address: paid requests cannot be verified');
    }
    service = startService(
      {
        agentId,
        wallet: wallet.address,
        publicClient: wallet.publicClient,
        serviceMeter: config.contracts.serviceMeter,
        chainId: config.network.id,
        chainName: config.network.name,
        getPrice6: () => price.get(),
        logger,
      },
      config.servePort,
    );
    logger.info('serving', {
      url: config.publicUrl ?? `http://localhost:${config.servePort}/service`,
      price: formatUsd(price.get()),
    });
  }

  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  try {
    const state = await runLoop(deps, { signal: controller.signal, once: config.once });
    logger.info('stopped', {
      ticks: state.ticks,
      spent: formatUsd(state.spent6),
      gas: formatUsd(state.gasBurned6),
    });
  } finally {
    await service?.close();
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError || error instanceof WalletError || error instanceof LoopError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
