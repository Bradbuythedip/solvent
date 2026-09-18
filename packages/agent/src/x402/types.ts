/**
 * Solvent's profile of x402.
 *
 * The generic x402 flow is: 402 with payment requirements, pay, retry with an
 * X-PAYMENT header. Solvent keeps that shape and pins settlement to
 * ServiceMeter, so that both sides of every payment are booked in the Ledger in
 * one transaction (SPEC R4) instead of being asserted by either party.
 *
 * The receipt a client presents is not a signature over a promise. It is a
 * requestHash that appears in a ServiceSettled log, on Arc, for at least the
 * quoted amount.
 */

import type { Hex, Usdc6 } from '@solvent/core';

export const X402_VERSION = 1;
export const SOLVENT_SCHEME = 'solvent-service-meter';
export const PAYMENT_HEADER = 'x-payment';

export interface PaymentRequirements {
  x402Version: typeof X402_VERSION;
  scheme: typeof SOLVENT_SCHEME;
  /** 6-decimal USDC, as a decimal string like every amount on the wire. */
  price6: string;
  resource: string;
  description: string;
  network: { chainId: number; name: string };
  asset: { address: Hex; decimals: 6; symbol: 'USDC' };
  payTo: {
    serviceMeter: Hex;
    providerAgentId: number;
    wallet: Hex;
  };
  /** How the client must build requestHash: keccak256(method|url|bodyHash|nonce). */
  requestHashRecipe: 'keccak256(method|url|bodyHash|nonce)';
}

/** The decoded contents of the X-PAYMENT header. */
export interface PaymentPayload {
  x402Version: typeof X402_VERSION;
  scheme: typeof SOLVENT_SCHEME;
  requestHash: Hex;
  method: string;
  url: string;
  bodyHash: Hex;
  nonce: Hex;
  payerAgentId: number;
  amount6: string;
  txHash: Hex | null;
}

export interface SettlementReceipt {
  requestHash: Hex;
  providerAgentId: number;
  amount6: Usdc6;
  at: number;
}

export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

export function decodePaymentHeader(header: string): PaymentPayload | null {
  try {
    const json = Buffer.from(header.trim(), 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const requestHash = record['requestHash'];
    const method = record['method'];
    const url = record['url'];
    const bodyHash = record['bodyHash'];
    const nonce = record['nonce'];
    const amount6 = record['amount6'];
    if (
      typeof requestHash !== 'string' ||
      typeof method !== 'string' ||
      typeof url !== 'string' ||
      typeof bodyHash !== 'string' ||
      typeof nonce !== 'string' ||
      typeof amount6 !== 'string'
    ) {
      return null;
    }
    const payerAgentId = record['payerAgentId'];
    const txHash = record['txHash'];
    return {
      x402Version: X402_VERSION,
      scheme: SOLVENT_SCHEME,
      requestHash: requestHash as Hex,
      method,
      url,
      bodyHash: bodyHash as Hex,
      nonce: nonce as Hex,
      payerAgentId: typeof payerAgentId === 'number' ? payerAgentId : 0,
      amount6,
      txHash: typeof txHash === 'string' ? (txHash as Hex) : null,
    };
  } catch {
    return null;
  }
}

export function parseRequirements(body: unknown): PaymentRequirements | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const price6 = record['price6'];
  const payTo = record['payTo'];
  if (typeof price6 !== 'string' || !/^\d+$/.test(price6)) return null;
  if (typeof payTo !== 'object' || payTo === null) return null;
  const payToRecord = payTo as Record<string, unknown>;
  const serviceMeter = payToRecord['serviceMeter'];
  const providerAgentId = payToRecord['providerAgentId'];
  const wallet = payToRecord['wallet'];
  if (typeof serviceMeter !== 'string' || typeof providerAgentId !== 'number') return null;
  const network = typeof record['network'] === 'object' && record['network'] !== null
    ? (record['network'] as Record<string, unknown>)
    : {};
  const asset = typeof record['asset'] === 'object' && record['asset'] !== null
    ? (record['asset'] as Record<string, unknown>)
    : {};

  return {
    x402Version: X402_VERSION,
    scheme: SOLVENT_SCHEME,
    price6,
    resource: typeof record['resource'] === 'string' ? record['resource'] : '',
    description: typeof record['description'] === 'string' ? record['description'] : '',
    network: {
      chainId: typeof network['chainId'] === 'number' ? network['chainId'] : 0,
      name: typeof network['name'] === 'string' ? network['name'] : '',
    },
    asset: {
      address: (typeof asset['address'] === 'string' ? asset['address'] : '0x') as Hex,
      decimals: 6,
      symbol: 'USDC',
    },
    payTo: {
      serviceMeter: serviceMeter as Hex,
      providerAgentId,
      wallet: (typeof wallet === 'string' ? wallet : '0x') as Hex,
    },
    requestHashRecipe: 'keccak256(method|url|bodyHash|nonce)',
  };
}
