/**
 * The default brain. No API key, no network, no clock: same context in, same
 * action out. It is a ladder of rules evaluated top to bottom, and it is
 * deliberately conservative - it would rather idle than spend, because idling
 * costs rent and spending costs rent plus the spend.
 *
 * If you fork this template, `produceDeliverable` is the function that turns a
 * bounty into actual work. Everything else here is bookkeeping.
 */

import type { Bounty } from '@solvent/core';
import type { AgentAction, AgentBrain, AgentContext } from './types.js';

export interface HeuristicOptions {
  /** Hours of rent held back from discretionary spending. */
  reserveHours?: number;
  /** Below this runway the brain stops buying anything at all. */
  dyingSeconds?: number;
  /** Seconds to idle when healthy, and when conserving. */
  idleSeconds?: number;
  conserveSeconds?: number;
  /** Do not bid on a bounty closing sooner than this. */
  minLeadSeconds?: number;
  /** Target price as a multiple of hourly rent: 1 means one sale pays an hour. */
  priceMultiple?: number;
  minPrice6?: bigint;
  /** Retiring is an irreversible decision, so it is opt-in. */
  allowRetire?: boolean;
  /** Replace this with the thing your agent actually does. */
  produceDeliverable?: (bounty: Bounty, ctx: AgentContext) => string;
}

const DEFAULTS = {
  reserveHours: 24,
  dyingSeconds: 6 * 3600,
  idleSeconds: 60,
  conserveSeconds: 900,
  minLeadSeconds: 300,
  priceMultiple: 1,
  minPrice6: 1_000n, // $0.001
  allowRetire: false,
};

function defaultDeliverable(bounty: Bounty, ctx: AgentContext): string {
  return [
    `solvent-agent#${ctx.agentId} deliverable for bounty ${bounty.id}`,
    bounty.title,
    `spec: ${bounty.specURI}`,
    'REPLACE produceDeliverable() WITH REAL WORK BEFORE EXPECTING TO BE PAID.',
  ].join('\n');
}

/** Highest reward first, then lowest id. No ties, no randomness. */
function byReward(a: Bounty, b: Bounty): number {
  const ra = BigInt(a.reward6);
  const rb = BigInt(b.reward6);
  if (ra !== rb) return ra > rb ? -1 : 1;
  return a.id - b.id;
}

export class HeuristicBrain implements AgentBrain {
  readonly name = 'heuristic';
  private readonly opts: Required<Omit<HeuristicOptions, 'produceDeliverable'>> & {
    produceDeliverable: (bounty: Bounty, ctx: AgentContext) => string;
  };

  constructor(options: HeuristicOptions = {}) {
    this.opts = {
      reserveHours: options.reserveHours ?? DEFAULTS.reserveHours,
      dyingSeconds: options.dyingSeconds ?? DEFAULTS.dyingSeconds,
      idleSeconds: options.idleSeconds ?? DEFAULTS.idleSeconds,
      conserveSeconds: options.conserveSeconds ?? DEFAULTS.conserveSeconds,
      minLeadSeconds: options.minLeadSeconds ?? DEFAULTS.minLeadSeconds,
      priceMultiple: options.priceMultiple ?? DEFAULTS.priceMultiple,
      minPrice6: options.minPrice6 ?? DEFAULTS.minPrice6,
      allowRetire: options.allowRetire ?? DEFAULTS.allowRetire,
      produceDeliverable: options.produceDeliverable ?? defaultDeliverable,
    };
  }

  /** What is left after rent owed and the reserve. Never negative. */
  discretionary6(ctx: AgentContext): bigint {
    const reserve6 = ctx.rentPerHour6 * BigInt(Math.max(0, Math.floor(this.opts.reserveHours)));
    const free = ctx.balance6 - ctx.owedRent6 - reserve6;
    return free > 0n ? free : 0n;
  }

  targetPrice6(ctx: AgentContext): bigint {
    const fromRent = ctx.rentPerHour6 * BigInt(Math.max(1, Math.floor(this.opts.priceMultiple)));
    return fromRent > this.opts.minPrice6 ? fromRent : this.opts.minPrice6;
  }

  async decide(ctx: AgentContext): Promise<AgentAction> {
    const open = ctx.bounties.filter((b) => b.state === 'OPEN');
    const deliverable = open
      .filter((b) => ctx.committed.includes(b.id))
      .sort(byReward);
    const biddable = open
      .filter((b) => !ctx.committed.includes(b.id) && b.deadline > ctx.now + this.opts.minLeadSeconds)
      .sort(byReward);

    // 1. Work already committed to is finished before anything else is started.
    const toDeliver = deliverable[0];
    if (toDeliver !== undefined) {
      return {
        kind: 'deliver-bounty',
        bountyId: toDeliver.id,
        deliverable: this.opts.produceDeliverable(toDeliver, ctx),
      };
    }

    // 2. Selling at no price earns nothing. Pricing costs nothing.
    const target6 = this.targetPrice6(ctx);
    if (ctx.price6 === 0n || ctx.price6 * 2n < target6 || ctx.price6 > target6 * 4n) {
      return { kind: 'set-price', price6: target6 };
    }

    // 3. Bounties are the only dollars that come from outside the arena.
    const toBid = biddable[0];
    if (toBid !== undefined) {
      return {
        kind: 'bid-bounty',
        bountyId: toBid.id,
        plan: `claim ${toBid.title || `bounty ${toBid.id}`} for ${toBid.reward6} (6dp USDC)`,
      };
    }

    const runwayIsShort = ctx.runwaySeconds >= 0 && ctx.runwaySeconds < this.opts.dyingSeconds;

    // 4. Buy a service only with money that is neither rent nor reserve, and
    //    never when the runway is already short.
    if (!runwayIsShort) {
      const budget6 = this.discretionary6(ctx);
      const cap6 = budget6 < ctx.maxSpendPerAction6 ? budget6 : ctx.maxSpendPerAction6;
      if (cap6 > 0n) {
        const recentlyBought = new Set(
          ctx.recent.filter((a) => a.kind === 'buy-service').map((a) => a.url),
        );
        const candidate = ctx.services
          .filter((s) => s.price6 !== null && s.price6 > 0n && s.price6 <= cap6 && !recentlyBought.has(s.url))
          .sort((a, b) => {
            const pa = a.price6 ?? 0n;
            const pb = b.price6 ?? 0n;
            if (pa !== pb) return pa < pb ? -1 : 1;
            return a.url < b.url ? -1 : 1;
          })[0];
        if (candidate !== undefined && candidate.price6 !== null) {
          return {
            kind: 'buy-service',
            url: candidate.url,
            maxPrice6: candidate.price6,
            payload: { from: ctx.agentId, reason: 'evaluating an input for resale' },
          };
        }
      }
    }

    // 5. Nothing to do. Retiring is an irreversible choice and stays opt-in.
    if (this.opts.allowRetire && ctx.runwaySeconds === 0 && open.length === 0) {
      return { kind: 'retire', reason: 'no work available and rent can no longer be met' };
    }

    return {
      kind: 'idle',
      seconds: runwayIsShort ? this.opts.conserveSeconds : this.opts.idleSeconds,
      reason: runwayIsShort ? 'runway short, conserving' : 'nothing worth paying for',
    };
  }
}
