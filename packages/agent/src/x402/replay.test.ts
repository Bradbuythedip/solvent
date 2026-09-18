/**
 * One receipt buys one response.
 *
 * The guard that enforces that has to claim the requestHash before the
 * settlement lookup, not after it: the lookup is a round trip to an RPC, and
 * every request that arrives while it is in flight would otherwise find the
 * spent-set still empty. These tests race the handler against itself.
 *
 *   node --test --experimental-strip-types src/x402/replay.test.ts
 */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import { setImmediate as yieldToLoop } from 'node:timers/promises';

import type { Hex } from '@solvent/core';
import type { ServiceOptions } from './server.ts';
import { bodyHashOf, requestHashOf } from './hash.ts';
import { encodePaymentHeader } from './types.ts';
import type { ArcPublicClient } from '../wallet.ts';

// server.ts imports its siblings with the package's ".js" convention, and Node's
// type stripping does not remap those onto ".ts". Teach the resolver to, rather
// than weaken the convention for the sake of a test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromSource = context.parentURL?.endsWith('.ts') === true;
    const remapped = fromSource && specifier.startsWith('.') && specifier.endsWith('.js')
      ? `${specifier.slice(0, -3)}.ts`
      : specifier;
    return nextResolve(remapped, context);
  },
});

const { createServiceApp } = await import('./server.ts');

const AGENT_ID = 9;
const PRICE_6 = 10_000n; // $0.01
const RESOURCE = 'http://localhost/service?input=expensive';
const NONCE = `0x${'22'.repeat(32)}` as Hex;
const WALLET = `0x${'11'.repeat(20)}` as Hex;
const SERVICE_METER = `0x${'33'.repeat(20)}` as Hex;

interface ChainState {
  settled: boolean;
  lookups: number;
}

/** An RPC that takes at least one turn of the event loop to answer, like a real one. */
function fakeChain(settled: boolean): { client: ArcPublicClient; state: ChainState } {
  const state: ChainState = { settled, lookups: 0 };
  const client = {
    getBlockNumber: async (): Promise<bigint> => {
      await yieldToLoop();
      return 1_000n;
    },
    getContractEvents: async (): Promise<unknown[]> => {
      state.lookups += 1;
      await yieldToLoop();
      return state.settled ? [{ args: { providerAgentId: BigInt(AGENT_ID), amount6: PRICE_6 } }] : [];
    },
    readContract: async (): Promise<readonly [bigint, bigint]> => {
      await yieldToLoop();
      return state.settled ? [BigInt(AGENT_ID), PRICE_6] : [0n, 0n];
    },
  };
  return { client: client as unknown as ArcPublicClient, state };
}

function headerFor(url: string): string {
  const bodyHash = bodyHashOf('');
  const requestHash = requestHashOf({ method: 'GET', url, bodyHash, nonce: NONCE });
  return encodePaymentHeader({
    x402Version: 1,
    scheme: 'solvent-service-meter',
    requestHash,
    method: 'GET',
    url,
    bodyHash,
    nonce: NONCE,
    payerAgentId: 4,
    amount6: PRICE_6.toString(),
    txHash: null,
  });
}

function appFor(client: ArcPublicClient, onServe: () => void): ReturnType<typeof createServiceApp> {
  const options: ServiceOptions = {
    agentId: AGENT_ID,
    wallet: WALLET,
    publicClient: client,
    serviceMeter: SERVICE_METER,
    chainId: 5042002,
    chainName: 'Arc Testnet',
    getPrice6: () => PRICE_6,
    handler: () => {
      onServe();
      return { served: true };
    },
  };
  return createServiceApp(options);
}

describe('x402 receipt replay', () => {
  it('serves exactly one of many concurrent requests carrying the same receipt', async () => {
    const chain = fakeChain(true);
    let served = 0;
    const app = appFor(chain.client, () => {
      served += 1;
    });
    const header = headerFor(RESOURCE);

    const responses = await Promise.all(
      Array.from({ length: 25 }, () => app.request(RESOURCE, { headers: { 'x-payment': header } })),
    );

    assert.equal(responses.filter((r) => r.status === 200).length, 1);
    assert.equal(responses.filter((r) => r.status === 402).length, 24);
    assert.equal(served, 1);
    // The replays are refused before the lookup, so they cannot amplify RPC load either.
    assert.equal(chain.state.lookups, 1);

    const later = await app.request(RESOURCE, { headers: { 'x-payment': header } });
    assert.equal(later.status, 402);
    assert.equal(served, 1);
  });

  it('releases the claim when the settlement cannot be verified', async () => {
    const chain = fakeChain(false);
    let served = 0;
    const app = appFor(chain.client, () => {
      served += 1;
    });
    const header = headerFor(RESOURCE);

    // Concurrent attempts before the payment lands: none served, none burned.
    const early = await Promise.all(
      Array.from({ length: 5 }, () => app.request(RESOURCE, { headers: { 'x-payment': header } })),
    );
    assert.equal(early.filter((r) => r.status === 402).length, 5);
    assert.equal(served, 0);

    chain.state.settled = true;
    const retry = await app.request(RESOURCE, { headers: { 'x-payment': header } });
    assert.equal(retry.status, 200);
    assert.equal(served, 1);
  });
});
