/**
 * Service discovery against Circle's keyless x402 Discovery API.
 *
 * No API key, no account, no SDK. If the catalogue is unreachable the agent
 * keeps the last good list and carries on: discovery is an opportunity, never a
 * dependency. An agent that cannot reach Circle is not thereby insolvent.
 */

import type { Hex, Usdc6 } from '@solvent/core';
import { USDC_ADDRESS, X402_DISCOVERY_URL } from '@solvent/core';

export interface DiscoveredService {
  /** The priced URL to GET. */
  url: string;
  name: string;
  description: string;
  /** null when the price is not quoted in a 6-decimal stablecoin we understand. */
  price6: Usdc6 | null;
  network: string | null;
  payTo: Hex | null;
  lastSeen: number;
}

export interface DiscoveryResult {
  services: DiscoveredService[];
  ok: boolean;
  /** Why the list is stale or empty, in one line, for the log. */
  note: string | null;
}

export interface DiscoveryOptions {
  url?: string;
  timeoutMs?: number;
  limit?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function address(value: unknown): Hex | null {
  const s = str(value);
  return s !== null && /^0x[0-9a-fA-F]{40}$/.test(s) ? (s as Hex) : null;
}

function itemsOf(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of ['items', 'resources', 'data', 'results']) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function rescale(amount: bigint, decimals: number): Usdc6 | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (decimals === 6) return amount;
  if (decimals > 6) return amount / 10n ** BigInt(decimals - 6);
  return amount * 10n ** BigInt(6 - decimals);
}

/**
 * Returns null whenever the price cannot be established beyond doubt. The loop
 * never buys a service whose price6 is null - an unknown price is an unbounded
 * price, and this agent has a wallet it can actually lose.
 */
export function priceOfAccept(accept: unknown): Usdc6 | null {
  if (!isRecord(accept)) return null;
  const raw = str(accept['maxAmountRequired']) ?? str(accept['amountRequired']) ?? str(accept['amount']);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const atomic = BigInt(raw);

  const asset = address(accept['asset']);
  const extra = isRecord(accept['extra']) ? accept['extra'] : null;
  const declared = extra ? extra['decimals'] : accept['decimals'];

  if (typeof declared === 'number') return rescale(atomic, declared);
  if (typeof declared === 'string' && /^\d+$/.test(declared)) return rescale(atomic, Number(declared));
  if (asset !== null && asset.toLowerCase() === USDC_ADDRESS.toLowerCase()) return atomic;
  return null;
}

function parseItem(raw: unknown, now: number): DiscoveredService | null {
  if (!isRecord(raw)) return null;
  const url = str(raw['resource']) ?? str(raw['url']) ?? str(raw['endpoint']);
  if (url === null || !/^https?:\/\//i.test(url)) return null;

  const accepts = Array.isArray(raw['accepts']) ? raw['accepts'] : [];
  const first = accepts.length > 0 ? accepts[0] : null;
  const firstRecord = isRecord(first) ? first : null;
  const metadata = isRecord(raw['metadata']) ? raw['metadata'] : null;

  return {
    url,
    name: str(raw['name']) ?? (metadata ? (str(metadata['name']) ?? url) : url),
    description:
      (firstRecord ? str(firstRecord['description']) : null) ??
      str(raw['description']) ??
      (metadata ? (str(metadata['description']) ?? '') : ''),
    price6: priceOfAccept(first),
    network: firstRecord ? str(firstRecord['network']) : null,
    payTo: firstRecord ? address(firstRecord['payTo']) : null,
    lastSeen: now,
  };
}

export class ServiceDiscovery {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly limit: number;
  private readonly fetchImpl: typeof fetch;
  private lastGood: DiscoveredService[] = [];

  constructor(options: DiscoveryOptions = {}) {
    this.url = options.url ?? X402_DISCOVERY_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.limit = options.limit ?? DEFAULT_LIMIT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The last list that parsed, whether or not the most recent call worked. */
  get cached(): DiscoveredService[] {
    return this.lastGood;
  }

  async refresh(now: number = Math.floor(Date.now() / 1000)): Promise<DiscoveryResult> {
    try {
      const response = await this.fetchImpl(this.url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        return { services: this.lastGood, ok: false, note: `discovery HTTP ${response.status}` };
      }
      const payload: unknown = await response.json();
      const services: DiscoveredService[] = [];
      for (const raw of itemsOf(payload)) {
        const parsed = parseItem(raw, now);
        if (parsed !== null) services.push(parsed);
        if (services.length >= this.limit) break;
      }
      this.lastGood = services;
      return { services, ok: true, note: services.length === 0 ? 'discovery returned no usable entries' : null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { services: this.lastGood, ok: false, note: `discovery unreachable: ${reason}` };
    }
  }
}
