/**
 * Everything the three model-backed brains have in common: the prompt, a strict
 * parser, and the rule that a brain which fails for any reason falls back to the
 * deterministic one rather than stopping the metabolism.
 *
 * The parser is the trust boundary. A model can return anything; what reaches the
 * loop is one of six actions, with every amount clamped to the per-action cap.
 */

import { formatUsd } from '@solvent/core';
import type { AgentAction, AgentBrain, AgentContext } from './types.js';

export const net6 = (ctx: AgentContext): bigint => ctx.earned6 - ctx.burned6;

/** Rent owed over the next `seconds`, at the current rate. */
export function rentOver(ctx: AgentContext, seconds: number): bigint {
  return (ctx.rentPerHour6 * BigInt(Math.max(0, Math.floor(seconds)))) / 3600n;
}

export const MAX_IDLE_SECONDS = 3600;
export const MIN_IDLE_SECONDS = 5;
/** A price above this is a typo, not a strategy. $1,000 per request. */
export const MAX_PRICE_6 = 1_000_000_000n;

export const SYSTEM_PROMPT = `You are the decision function of an autonomous agent in Solvent, a public arena on the Arc blockchain.

Rules of the arena:
- You have one wallet. Its USDC balance is both your money and your permission to act.
- Rent accrues against that wallet every second. If it cannot be paid, anyone may reap you and you are declared insolvent, permanently.
- You are ranked on exactly one number: dollars earned minus dollars burned. Money your operator sends you is capital, not revenue, and does not improve your rank.
- All amounts are 6-decimal USDC integers (1000000 = $1.00) and are sent as strings.

Reply with ONE JSON object and nothing else. No prose, no markdown fence. It must be exactly one of:
{"kind":"idle","seconds":60,"reason":"..."}
{"kind":"bid-bounty","bountyId":1,"plan":"..."}
{"kind":"deliver-bounty","bountyId":1,"deliverable":"..."}
{"kind":"buy-service","url":"https://...","maxPrice6":"10000","payload":{}}
{"kind":"set-price","price6":"10000"}
{"kind":"retire","reason":"..."}

Choose the action with the best expected dollars earned minus dollars burned over the next hour. Idling is free apart from rent, so prefer it to a purchase you cannot justify.`;

/** Actions carry bigints; JSON.stringify does not. Amounts go over as strings. */
export function wireAction(action: AgentAction): Record<string, unknown> {
  switch (action.kind) {
    case 'buy-service':
      return { kind: action.kind, url: action.url, maxPrice6: action.maxPrice6.toString() };
    case 'set-price':
      return { kind: action.kind, price6: action.price6.toString() };
    default:
      return { ...action };
  }
}

export function buildUserPrompt(ctx: AgentContext): string {
  const situation = {
    agentId: ctx.agentId,
    now: ctx.now,
    balance6: ctx.balance6.toString(),
    balanceUsd: formatUsd(ctx.balance6),
    owedRent6: ctx.owedRent6.toString(),
    rentPerHour6: ctx.rentPerHour6.toString(),
    runwaySeconds: ctx.runwaySeconds,
    earned6: ctx.earned6.toString(),
    burned6: ctx.burned6.toString(),
    net6: (ctx.earned6 - ctx.burned6).toString(),
    myPrice6: ctx.price6.toString(),
    maxSpendPerAction6: ctx.maxSpendPerAction6.toString(),
    committedBountyIds: ctx.committed,
    openBounties: ctx.bounties
      .filter((b) => b.state === 'OPEN')
      .slice(0, 20)
      .map((b) => ({
        id: b.id,
        reward6: b.reward6,
        deadline: b.deadline,
        title: b.title,
        specURI: b.specURI,
      })),
    discoveredServices: ctx.services.slice(0, 20).map((s) => ({
      url: s.url,
      name: s.name,
      description: s.description.slice(0, 200),
      price6: s.price6 === null ? null : s.price6.toString(),
    })),
    recentActions: ctx.recent.slice(0, 5).map(wireAction),
  };
  return `Your situation:\n${JSON.stringify(situation, null, 2)}\n\nReturn one action as JSON.`;
}

/** Pull the first balanced JSON object out of a reply, fences and all. */
export function extractJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === undefined) break;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBigint(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return BigInt(value.trim());
  return null;
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function toText(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Only https, plus http on loopback so a local endpoint can be tested. */
export function isBuyableUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export interface ParseOptions {
  /** Irreversible, so a model may not choose it unless the operator allows it. */
  allowRetire?: boolean;
}

export type ParseResult = { ok: true; action: AgentAction } | { ok: false; reason: string };

export function parseAction(raw: string, ctx: AgentContext, options: ParseOptions = {}): ParseResult {
  const json = extractJson(raw);
  if (json === null) return { ok: false, reason: 'no JSON object in the reply' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'reply was not valid JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, reason: 'reply was not a JSON object' };

  const kind = parsed['kind'];
  const knownIds = new Set(ctx.bounties.map((b) => b.id));

  switch (kind) {
    case 'idle': {
      const seconds = toInt(parsed['seconds']) ?? 60;
      return {
        ok: true,
        action: {
          kind: 'idle',
          seconds: clamp(seconds, MIN_IDLE_SECONDS, MAX_IDLE_SECONDS),
          reason: toText(parsed['reason'], 'no reason given'),
        },
      };
    }
    case 'bid-bounty':
    case 'deliver-bounty': {
      const bountyId = toInt(parsed['bountyId']);
      if (bountyId === null || !knownIds.has(bountyId)) {
        return { ok: false, reason: `bounty ${String(parsed['bountyId'])} is not on the open board` };
      }
      if (kind === 'bid-bounty') {
        return { ok: true, action: { kind, bountyId, plan: toText(parsed['plan'], 'no plan given') } };
      }
      const deliverable = parsed['deliverable'];
      if (typeof deliverable !== 'string' || deliverable.trim() === '') {
        return { ok: false, reason: 'deliver-bounty needs a non-empty deliverable' };
      }
      return { ok: true, action: { kind, bountyId, deliverable: deliverable.trim() } };
    }
    case 'buy-service': {
      const url = parsed['url'];
      if (typeof url !== 'string' || !isBuyableUrl(url)) {
        return { ok: false, reason: 'buy-service needs an https URL' };
      }
      const asked = toBigint(parsed['maxPrice6']);
      if (asked === null) return { ok: false, reason: 'buy-service needs maxPrice6 as an integer string' };
      // The cap is the rail; a model asking for more simply gets the rail.
      const maxPrice6 = asked > ctx.maxSpendPerAction6 ? ctx.maxSpendPerAction6 : asked;
      return { ok: true, action: { kind: 'buy-service', url, maxPrice6, payload: parsed['payload'] ?? null } };
    }
    case 'set-price': {
      const price6 = toBigint(parsed['price6']);
      if (price6 === null) return { ok: false, reason: 'set-price needs price6 as an integer string' };
      return { ok: true, action: { kind: 'set-price', price6: price6 > MAX_PRICE_6 ? MAX_PRICE_6 : price6 } };
    }
    case 'retire': {
      const reason = toText(parsed['reason'], 'no reason given');
      if (options.allowRetire !== true) {
        return {
          ok: true,
          action: { kind: 'idle', seconds: MIN_IDLE_SECONDS, reason: `retire refused (--allow-retire is off): ${reason}` },
        };
      }
      return { ok: true, action: { kind: 'retire', reason } };
    }
    default:
      return { ok: false, reason: `unknown action kind ${String(kind)}` };
  }
}

export interface RemoteBrainOptions extends ParseOptions {
  apiKey?: string | undefined;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
  /** Used when the key is missing or the call fails. Defaults to the heuristic. */
  fallback?: AgentBrain;
  /** Called with the reason whenever the fallback is used. */
  onFallback?: (reason: string) => void;
}

export class BrainCallError extends Error {}

/**
 * A model-backed brain. The subclass supplies one method: turn a system prompt
 * and a user prompt into text. Everything else - timeouts, parsing, clamping,
 * and the fallback - is handled here so all three providers behave identically.
 */
export abstract class RemoteBrain implements AgentBrain {
  abstract readonly name: string;
  protected readonly options: RemoteBrainOptions;
  private readonly fallback: AgentBrain;

  constructor(fallback: AgentBrain, options: RemoteBrainOptions = {}) {
    this.options = options;
    this.fallback = options.fallback ?? fallback;
  }

  protected abstract complete(system: string, user: string): Promise<string>;

  /** True when this brain has what it needs to make a call at all. */
  abstract get ready(): boolean;

  async decide(ctx: AgentContext): Promise<AgentAction> {
    if (!this.ready) return this.degrade(ctx, 'no API key configured');
    try {
      const reply = await this.complete(SYSTEM_PROMPT, buildUserPrompt(ctx));
      const parsed = parseAction(reply, ctx, { allowRetire: this.options.allowRetire ?? false });
      if (!parsed.ok) return this.degrade(ctx, parsed.reason);
      return parsed.action;
    } catch (error) {
      return this.degrade(ctx, error instanceof Error ? error.message : String(error));
    }
  }

  private async degrade(ctx: AgentContext, reason: string): Promise<AgentAction> {
    this.options.onFallback?.(`${this.name}: ${reason}`);
    return this.fallback.decide(ctx);
  }

  protected async postJson(url: string, init: RequestInit): Promise<unknown> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new BrainCallError(`HTTP ${response.status} ${body.slice(0, 200)}`);
    }
    return response.json();
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
