/**
 * The default brain has to be predictable, because an entrant reads it to learn
 * what the arena rewards. Same context in, same action out, every time.
 *
 * Node's type stripping does not remap a ".js" specifier onto a ".ts" file, so
 * these tests import "./heuristic.ts" directly. Test files are excluded from
 * tsconfig, so the package's ".js" import convention is untouched.
 *
 *   node --test --experimental-strip-types src/brains/heuristic.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Bounty } from '@solvent/core';
import { HeuristicBrain } from './heuristic.ts';
import type { AgentContext } from './types.ts';
import type { DiscoveredService } from '../discovery.ts';

const RENT_PER_HOUR_6 = 10_000n; // $0.01/hour, the Metabolism default

function bounty(id: number, reward6: string, deadline: number): Bounty {
  return {
    id,
    poster: '0x1111111111111111111111111111111111111111',
    reward6,
    deadline,
    reviewWindow: 86_400,
    specURI: `ipfs://spec-${id}`,
    specHash: '0x00',
    title: `bounty ${id}`,
    state: 'OPEN',
    claimantAgentId: null,
    claimantHandle: null,
    deliverableURI: null,
    submittedAt: null,
    txHash: '0xfeed',
  };
}

function service(url: string, price6: bigint | null): DiscoveredService {
  return { url, name: url, description: '', price6, network: 'arc', payTo: null, lastSeen: 1_000 };
}

function context(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    agentId: 7,
    wallet: '0x2222222222222222222222222222222222222222',
    now: 1_000_000,
    balance6: 9_000_000n,
    owedRent6: 0n,
    allowance6: 10_000_000n,
    rentPerHour6: RENT_PER_HOUR_6,
    runwaySeconds: 90 * 3600,
    earned6: 0n,
    burned6: 0n,
    price6: RENT_PER_HOUR_6,
    maxSpendPerAction6: 50_000n,
    bounties: [],
    services: [],
    committed: [],
    recent: [],
    ...overrides,
  };
}

describe('HeuristicBrain', () => {
  it('prices itself before doing anything else when it has no price', async () => {
    const brain = new HeuristicBrain();
    const action = await brain.decide(context({ price6: 0n, bounties: [bounty(1, '5000000', 2_000_000)] }));
    assert.equal(action.kind, 'set-price');
    if (action.kind === 'set-price') assert.equal(action.price6, RENT_PER_HOUR_6);
  });

  it('finishes committed work before starting new work', async () => {
    const brain = new HeuristicBrain();
    const action = await brain.decide(
      context({
        bounties: [bounty(1, '1000000', 2_000_000), bounty(2, '9000000', 2_000_000)],
        committed: [1],
      }),
    );
    assert.equal(action.kind, 'deliver-bounty');
    if (action.kind === 'deliver-bounty') assert.equal(action.bountyId, 1);
  });

  it('bids on the largest reward, and ignores a bounty about to close', async () => {
    const brain = new HeuristicBrain();
    const action = await brain.decide(
      context({
        now: 1_000_000,
        bounties: [
          bounty(1, '1000000', 2_000_000),
          bounty(2, '9000000', 1_000_100), // closes in 100s: too soon to bid
          bounty(3, '4000000', 2_000_000),
        ],
      }),
    );
    assert.equal(action.kind, 'bid-bounty');
    if (action.kind === 'bid-bounty') assert.equal(action.bountyId, 3);
  });

  it('buys the cheapest affordable service and never one with an unknown price', async () => {
    const brain = new HeuristicBrain();
    const action = await brain.decide(
      context({
        services: [service('https://b.example/x', null), service('https://a.example/x', 20_000n), service('https://c.example/x', 5_000n)],
      }),
    );
    assert.equal(action.kind, 'buy-service');
    if (action.kind === 'buy-service') {
      assert.equal(action.url, 'https://c.example/x');
      assert.equal(action.maxPrice6, 5_000n);
    }
  });

  it('stops buying when the runway is short', async () => {
    const brain = new HeuristicBrain();
    const action = await brain.decide(
      context({ runwaySeconds: 3600, services: [service('https://a.example/x', 1_000n)] }),
    );
    assert.equal(action.kind, 'idle');
  });

  it('keeps a 24h rent reserve out of discretionary spending', async () => {
    const brain = new HeuristicBrain();
    // Balance covers the reserve ($0.24) and nothing more, so nothing is buyable.
    const ctx = context({ balance6: 240_000n + 1_000n, services: [service('https://a.example/x', 5_000n)] });
    assert.equal((await brain.decide(ctx)).kind, 'idle');
  });

  it('never retires unless the operator opted in', async () => {
    const dying = context({ runwaySeconds: 0, balance6: 0n, owedRent6: 50_000n });
    assert.equal((await new HeuristicBrain().decide(dying)).kind, 'idle');
    assert.equal((await new HeuristicBrain({ allowRetire: true }).decide(dying)).kind, 'retire');
  });

  it('is deterministic', async () => {
    const brain = new HeuristicBrain();
    const ctx = context({ bounties: [bounty(4, '2000000', 2_000_000)] });
    const first = await brain.decide(ctx);
    const second = await brain.decide(ctx);
    assert.deepEqual(first, second);
  });
});
