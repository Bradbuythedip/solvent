/**
 * Pay-per-request client.
 *
 *   GET url  ->  402 + requirements  ->  settle through ServiceMeter  ->
 *   GET url again with the receipt in X-PAYMENT  ->  200
 *
 * Three refusals are built in, before any money moves: a price above the cap, a
 * quote for a different chain, and a URL that is not https (loopback excepted so
 * a fork can test against its own endpoint).
 */

import type { Hex, Usdc6 } from '@solvent/core';
import { formatUsd } from '@solvent/core';
import type { AgentWallet } from '../wallet.js';
import { isBuyableUrl } from '../brains/shared.js';
import { bodyHashOf, canonicalUrl, randomNonce, requestHashOf } from './hash.js';
import type { PaymentPayload } from './types.js';
import { PAYMENT_HEADER, SOLVENT_SCHEME, X402_VERSION, encodePaymentHeader, parseRequirements } from './types.js';

export interface X402ClientOptions {
  wallet: AgentWallet;
  payerAgentId: number;
  maxSpendPerAction6: Usdc6;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface BuyOptions {
  maxPrice6: Usdc6;
  payload?: unknown;
}

export interface BuyResult {
  ok: boolean;
  status: number;
  url: string;
  paid6: Usdc6;
  requestHash: Hex | null;
  txHash: Hex | null;
  body: unknown;
  reason: string | null;
}

function withPayload(url: string, payload: unknown): string {
  if (payload === undefined || payload === null) return canonicalUrl(url);
  const parsed = new URL(url);
  parsed.searchParams.set(
    'input',
    JSON.stringify(payload, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)),
  );
  return canonicalUrl(parsed.toString());
}

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => '');
}

export class X402Client {
  private readonly wallet: AgentWallet;
  private readonly payerAgentId: number;
  private readonly maxSpendPerAction6: Usdc6;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: X402ClientOptions) {
    this.wallet = options.wallet;
    this.payerAgentId = options.payerAgentId;
    this.maxSpendPerAction6 = options.maxSpendPerAction6;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get(rawUrl: string, options: BuyOptions): Promise<BuyResult> {
    if (!isBuyableUrl(rawUrl)) {
      return this.refuse(rawUrl, 'not an https URL');
    }

    const url = withPayload(rawUrl, options.payload);
    const cap6 =
      options.maxPrice6 < this.maxSpendPerAction6 ? options.maxPrice6 : this.maxSpendPerAction6;

    const first = await this.fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (first.status !== 402) {
      return {
        ok: first.ok,
        status: first.status,
        url,
        paid6: 0n,
        requestHash: null,
        txHash: null,
        body: await readBody(first),
        reason: first.ok ? null : `HTTP ${first.status}`,
      };
    }

    const requirements = parseRequirements(await first.json().catch(() => null));
    if (requirements === null) {
      return this.refuse(url, '402 without readable payment requirements');
    }

    const price6 = BigInt(requirements.price6);
    if (price6 > cap6) {
      return this.refuse(url, `priced at ${formatUsd(price6)}, cap is ${formatUsd(cap6)}`);
    }
    if (requirements.network.chainId !== 0 && requirements.network.chainId !== this.wallet.chainId) {
      return this.refuse(url, `quoted on chain ${requirements.network.chainId}, we are on ${this.wallet.chainId}`);
    }
    if (requirements.payTo.providerAgentId <= 0) {
      return this.refuse(url, 'no provider agent id to pay');
    }

    const nonce = randomNonce();
    const bodyHash = bodyHashOf('');
    const requestHash = requestHashOf({ method: 'GET', url, bodyHash, nonce });

    // The only place this client spends. The intent is minted here and consumed
    // by the wallet, which refuses anything it did not hand out.
    const intent = this.wallet.originate('service', price6, `x402 ${url}`);
    const tx = await this.wallet.payForService(
      intent,
      this.payerAgentId,
      requirements.payTo.providerAgentId,
      price6,
      requestHash,
    );

    if (tx.dryRun) {
      return {
        ok: false,
        status: 402,
        url,
        paid6: 0n,
        requestHash,
        txHash: null,
        body: null,
        reason: 'dry run: settlement skipped, so the receipt cannot be presented',
      };
    }

    const payment: PaymentPayload = {
      x402Version: X402_VERSION,
      scheme: SOLVENT_SCHEME,
      requestHash,
      method: 'GET',
      url,
      bodyHash,
      nonce,
      payerAgentId: this.payerAgentId,
      amount6: price6.toString(),
      txHash: tx.hash,
    };

    // The money has already moved. Whatever happens to the retry, the caller has
    // to learn what was spent, so a failed fetch becomes a result, not a throw.
    let second: Response;
    try {
      second = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          [PAYMENT_HEADER]: encodePaymentHeader(payment),
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return {
        ok: false,
        status: 0,
        url,
        paid6: price6,
        requestHash,
        txHash: tx.hash,
        body: null,
        reason: `paid ${formatUsd(price6)} but the retry failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }

    return {
      ok: second.ok,
      status: second.status,
      url,
      paid6: price6,
      requestHash,
      txHash: tx.hash,
      body: await readBody(second),
      // A provider that takes payment and then refuses to serve is visible on
      // its own row: the burn and the earn were booked in the same transaction.
      reason: second.ok ? null : `paid ${formatUsd(price6)} but got HTTP ${second.status}`,
    };
  }

  private refuse(url: string, reason: string): BuyResult {
    return { ok: false, status: 0, url, paid6: 0n, requestHash: null, txHash: null, body: null, reason };
  }
}
