/**
 * The agent's own priced endpoint.
 *
 *   no receipt        -> 402 Payment Required + requirements
 *   receipt presented -> recompute requestHash, find the matching ServiceSettled
 *                        log on Arc, check the amount, then serve
 *
 * The server never trusts the requestHash it is handed. It rebuilds it from the
 * method, URL, body hash and nonce in the header, so a receipt bought for one
 * request cannot be presented for another. A receipt is spendable exactly once
 * per process lifetime.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { serve } from '@hono/node-server';
import type { ServerType } from '@hono/node-server';
import type { Hex, Usdc6 } from '@solvent/core';
import { USDC_ADDRESS, serviceMeterAbi } from '@solvent/core';
import type { ArcPublicClient } from '../wallet.js';
import type { Logger } from '../log.js';
import { silentLogger } from '../log.js';
import { bodyHashOf, canonicalUrl, requestHashOf } from './hash.js';
import type { PaymentRequirements } from './types.js';
import { PAYMENT_HEADER, SOLVENT_SCHEME, X402_VERSION, decodePaymentHeader } from './types.js';

export interface ServiceRequest {
  path: string;
  query: Record<string, string>;
  /** The `input` query parameter, JSON-parsed when it parses. */
  input: unknown;
  requestHash: Hex | null;
  payerAgentId: number;
}

export type ServiceHandler = (request: ServiceRequest) => unknown | Promise<unknown>;

export interface ServiceOptions {
  agentId: number;
  wallet: Hex;
  publicClient: ArcPublicClient;
  serviceMeter: Hex | null;
  chainId: number;
  chainName: string;
  /** Read on every request so `set-price` takes effect without a restart. */
  getPrice6: () => Usdc6;
  /** Replace this with whatever your agent sells. */
  handler?: ServiceHandler;
  description?: string;
  /** How far back to look for the settlement log. */
  lookbackBlocks?: bigint;
  logger?: Logger;
}

const DEFAULT_LOOKBACK_BLOCKS = 50_000n;

function defaultHandler(request: ServiceRequest): unknown {
  return {
    service: 'solvent-agent-template',
    note: 'Replace the handler with the thing your agent actually sells.',
    echo: request.input,
    servedAt: Math.floor(Date.now() / 1000),
  };
}

function requirementsFor(options: ServiceOptions, resource: string, price6: Usdc6): PaymentRequirements {
  return {
    x402Version: X402_VERSION,
    scheme: SOLVENT_SCHEME,
    price6: price6.toString(),
    resource,
    description: options.description ?? 'Solvent agent endpoint',
    network: { chainId: options.chainId, name: options.chainName },
    asset: { address: USDC_ADDRESS, decimals: 6, symbol: 'USDC' },
    payTo: {
      serviceMeter: options.serviceMeter ?? ('0x' as Hex),
      providerAgentId: options.agentId,
      wallet: options.wallet,
    },
    requestHashRecipe: 'keccak256(method|url|bodyHash|nonce)',
  };
}

/**
 * Was this exact requestHash settled to us, for at least this much? The
 * ServiceSettled log is the authority; `receiptOf` is a fallback for RPCs that
 * will not serve a wide log range.
 */
export async function verifySettlement(
  options: ServiceOptions,
  requestHash: Hex,
  minAmount6: Usdc6,
): Promise<{ ok: boolean; reason: string | null; amount6: Usdc6 }> {
  const serviceMeter = options.serviceMeter;
  if (serviceMeter === null) return { ok: false, reason: 'no ServiceMeter address configured', amount6: 0n };

  const provider = BigInt(options.agentId);

  try {
    const head = await options.publicClient.getBlockNumber();
    const lookback = options.lookbackBlocks ?? DEFAULT_LOOKBACK_BLOCKS;
    const fromBlock = head > lookback ? head - lookback : 0n;
    const logs = await options.publicClient.getContractEvents({
      address: serviceMeter,
      abi: serviceMeterAbi,
      eventName: 'ServiceSettled',
      args: { requestHash },
      fromBlock,
      toBlock: 'latest',
    });
    for (const log of logs) {
      const settledProvider = log.args.providerAgentId;
      const settledAmount = log.args.amount6;
      if (settledProvider === undefined || settledAmount === undefined) continue;
      if (settledProvider !== provider) continue;
      if (settledAmount < minAmount6) continue;
      return { ok: true, reason: null, amount6: settledAmount };
    }
  } catch {
    // fall through to the direct read
  }

  try {
    const receipt = await options.publicClient.readContract({
      address: serviceMeter,
      abi: serviceMeterAbi,
      functionName: 'receiptOf',
      args: [requestHash],
    });
    const [providerAgentId, amount6] = receipt;
    if (providerAgentId === provider && amount6 >= minAmount6) {
      return { ok: true, reason: null, amount6 };
    }
    return { ok: false, reason: 'no settlement to this agent for that requestHash', amount6: 0n };
  } catch (error) {
    return {
      ok: false,
      reason: `could not verify settlement: ${error instanceof Error ? error.message : String(error)}`,
      amount6: 0n,
    };
  }
}

function parseInput(raw: string | undefined): unknown {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function createServiceApp(options: ServiceOptions): Hono {
  const app = new Hono();
  const handler = options.handler ?? defaultHandler;
  const logger = options.logger ?? silentLogger;
  // Per-process. A fork that restarts often should persist this.
  const spent = new Set<string>();

  app.get('/health', (c: Context) =>
    c.json({
      ok: true,
      agentId: options.agentId,
      wallet: options.wallet,
      price6: options.getPrice6().toString(),
      chainId: options.chainId,
    }),
  );

  app.get('/price', (c: Context) =>
    c.json(requirementsFor(options, canonicalUrl(c.req.url), options.getPrice6())),
  );

  app.get('/service', async (c: Context) => {
    const price6 = options.getPrice6();
    const url = canonicalUrl(c.req.url);
    const query = c.req.query();
    const input = parseInput(query['input']);

    if (price6 === 0n) {
      return c.json(await handler({ path: '/service', query, input, requestHash: null, payerAgentId: 0 }));
    }

    const header = c.req.header(PAYMENT_HEADER);
    if (header === undefined) {
      return c.json(requirementsFor(options, url, price6), 402);
    }

    const payment = decodePaymentHeader(header);
    if (payment === null) {
      return c.json({ ...requirementsFor(options, url, price6), error: 'unreadable X-PAYMENT header' }, 402);
    }

    // The receipt is bound to one request. Rebuild the hash rather than trust it.
    let presentedUrl: URL;
    try {
      presentedUrl = new URL(payment.url);
    } catch {
      return c.json({ ...requirementsFor(options, url, price6), error: 'X-PAYMENT url is not a URL' }, 402);
    }
    const here = new URL(url);
    if (
      payment.method.toUpperCase() !== 'GET' ||
      presentedUrl.pathname !== here.pathname ||
      presentedUrl.search !== here.search
    ) {
      return c.json({ ...requirementsFor(options, url, price6), error: 'receipt is for a different request' }, 402);
    }
    if (payment.bodyHash !== bodyHashOf('')) {
      return c.json({ ...requirementsFor(options, url, price6), error: 'body hash mismatch' }, 402);
    }
    const recomputed = requestHashOf({
      method: payment.method,
      url: payment.url,
      bodyHash: payment.bodyHash,
      nonce: payment.nonce,
    });
    if (recomputed !== payment.requestHash) {
      return c.json({ ...requirementsFor(options, url, price6), error: 'requestHash does not match its inputs' }, 402);
    }
    // Claim the receipt here, synchronously, before the first await. Testing
    // membership and adding after the settlement lookup would leave the whole
    // RPC round trip open: every concurrent request carrying the same receipt
    // would see an empty set and every one of them would be served for one
    // payment. The claim is released below only if verification says no.
    if (spent.has(recomputed)) {
      return c.json({ ...requirementsFor(options, url, price6), error: 'receipt already used' }, 402);
    }
    spent.add(recomputed);

    const settled = await verifySettlement(options, recomputed, price6);
    if (!settled.ok) {
      spent.delete(recomputed);
      logger.warn('rejected an x402 request', { requestHash: recomputed, reason: settled.reason });
      return c.json(
        { ...requirementsFor(options, url, price6), error: settled.reason ?? 'settlement not found' },
        402,
      );
    }

    logger.info('served a paid request', {
      requestHash: recomputed,
      amount6: settled.amount6,
      payer: payment.payerAgentId,
    });

    return c.json(
      await handler({
        path: '/service',
        query,
        input,
        requestHash: recomputed,
        payerAgentId: payment.payerAgentId,
      }),
    );
  });

  app.get('/', (c: Context) =>
    c.json({
      agentId: options.agentId,
      wallet: options.wallet,
      priced: '/service',
      price6: options.getPrice6().toString(),
      requirements: '/price',
    }),
  );

  return app;
}

export interface RunningService {
  app: Hono;
  port: number;
  close(): Promise<void>;
}

export function startService(options: ServiceOptions, port: number): RunningService {
  const app = createServiceApp(options);
  const server: ServerType = serve({ fetch: app.fetch, port });
  return {
    app,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
