/**
 * The demo arena is the product's default shipping surface, so its books have to
 * close as hard as the chain's do and its numbers have to mean what the UI says
 * they mean.
 *
 * Three identities are pinned for every agent at every point:
 *   net6     === earned6 - burned6
 *   burned6  === rentBurned6 + gasBurned6 + serviceBurned6
 *   net6     === balance6 - capitalIn6
 *
 * The third is why an unsubsidised agent dies at about -$9: the $9 spawn seed is
 * capital, never revenue (R1), so a wallet that ends at zero ends at net -$9. That
 * is the design, and the insolvency feed says so. It is asserted here, not fixed.
 *
 * Node's type stripping does not remap a ".js" specifier onto a ".ts" file, and
 * sim.ts imports its siblings with the package's ".js" convention, so this file
 * installs a resolve hook (node >= 22.15) and then imports the module. Same reason
 * units.test.ts imports "./units.ts" directly; both are excluded from tsconfig.
 *
 *   node --test --experimental-strip-types src/sim.test.ts
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { solvencyOf } from './types.ts';
import type { AgentSummary } from './types.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL) {
      const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { createArena } = await import('./sim.ts');
type Arena = ReturnType<typeof createArena>;

/** A fixed wall clock, so every number below is reproducible. */
const NOW = 1_800_000_000;
const SEEDS = [1337, 7, 99] as const;
const HOUR = 3600;
const DAY = 86_400;

const arena = (seed: number, agents = 60): Arena => createArena({ seed, agents, now: NOW });
const everyAgent = (a: Arena): AgentSummary[] => a.agents({ status: 'all', limit: 5000 }).items;
const big = (v: string): bigint => BigInt(v);

/** The three identities, for one agent. */
function assertBooksClose(x: AgentSummary, where: string): void {
  const earned6 = big(x.earned6);
  const burned6 = big(x.burned6);
  const net6 = big(x.net6);
  const label = `${where}: agent ${x.id} (${x.handle})`;

  assert.equal(net6, earned6 - burned6, `${label}: net6 !== earned6 - burned6`);
  assert.equal(
    burned6,
    big(x.rentBurned6) + big(x.gasBurned6) + big(x.serviceBurned6),
    `${label}: burned6 !== rent + gas + service`,
  );
  assert.equal(net6, big(x.balance6) - big(x.capitalIn6), `${label}: net6 !== balance6 - capitalIn6`);
}

describe('arena bookkeeping', () => {
  it('closes the books for every agent at construction', () => {
    for (const seed of SEEDS) {
      const a = arena(seed);
      const all = everyAgent(a);
      assert.ok(all.length >= 60, `seed ${seed}: expected the requested population`);
      for (const x of all) assertBooksClose(x, `seed ${seed} t=0`);
    }
  });

  it('closes the books for every agent after a day of live time', () => {
    for (const seed of SEEDS) {
      const a = arena(seed);
      for (let h = 0; h < 24; h++) {
        a.advance(HOUR);
        for (const x of everyAgent(a)) assertBooksClose(x, `seed ${seed} t=${h + 1}h`);
      }
    }
  });

  it('keeps the arena totals equal to the sum of the agents', () => {
    const a = arena(1337);
    a.advance(6 * HOUR);
    const all = everyAgent(a);
    let earned6 = 0n;
    let burned6 = 0n;
    for (const x of all) {
      earned6 += big(x.earned6);
      burned6 += big(x.burned6);
    }
    const stats = a.stats();
    assert.equal(big(stats.totalEarned6), earned6);
    assert.equal(big(stats.totalBurned6), burned6);
    assert.equal(big(stats.totalNet6), earned6 - burned6);
  });

  it('leaves an unsubsidised corpse at about -$9, because the seed was capital', () => {
    const a = arena(1337);
    a.advance(24 * HOUR);
    const corpses = everyAgent(a).filter(
      (x) => x.status === 'INSOLVENT' && big(x.subsidy6) === 0n && big(x.balance6) < 10_000n,
    );
    assert.ok(corpses.length > 0, 'expected at least one unsubsidised corpse');
    for (const x of corpses) {
      // R1 in one number: it never earned its $9 door fee back, so net is that fee.
      assert.equal(big(x.net6), big(x.balance6) - 9_000_000n);
      assert.ok(big(x.net6) <= -8_990_000n, `agent ${x.id}: net ${x.net6} should be about -$9`);
    }
  });
});

describe('determinism', () => {
  it('produces byte-identical arenas from the same seed and the same elapsed time', () => {
    for (const seed of SEEDS) {
      const left = arena(seed);
      const right = arena(seed);
      for (let i = 0; i < 20; i++) {
        left.advance(137);
        right.advance(137);
      }
      const snapshot = (a: Arena): string =>
        JSON.stringify({
          now: a.now(),
          stats: a.stats(),
          agents: a.agents({ status: 'all', limit: 5000 }),
          feed: a.feed(500),
          ledger: a.ledger(500),
          bounties: a.bounties(),
        });
      assert.equal(snapshot(left), snapshot(right), `seed ${seed} diverged`);
    }
  });

  it('quantises advance(), so six minutes arrive the same way in one call or six', () => {
    const once = arena(1337);
    const split = arena(1337);
    once.advance(360);
    for (let i = 0; i < 6; i++) split.advance(60);
    assert.equal(once.now(), split.now());
    assert.equal(JSON.stringify(once.stats()), JSON.stringify(split.stats()));
    assert.equal(
      JSON.stringify(once.agents({ status: 'all', limit: 5000 })),
      JSON.stringify(split.agents({ status: 'all', limit: 5000 })),
    );
  });
});

describe('runway tells the truth about the reaper', () => {
  /**
   * Regression: runway used to be balance / burn rate alone, blind to the rent
   * allowance that actually kills in demo mode. Agents were rendered cyan with the
   * 90-day cap and reaped hours later still holding hundreds of dollars. The meter
   * now shows the shorter of the two leashes, so nothing dies while the UI is
   * promising it a day.
   */
  it('never promises a day of runway to an agent about to be reaped', () => {
    for (const seed of SEEDS) {
      const a = arena(seed);
      for (let q = 0; q < 48; q++) {
        const promised = new Map<number, number>();
        for (const x of a.agents({ status: 'alive', limit: 2000 }).items) {
          const runway = x.runwaySeconds;
          if (runway !== null && (runway < 0 || runway > DAY)) promised.set(x.id, runway);
        }
        for (const death of a.advance(15 * 60).insolvencies) {
          const runway = promised.get(death.agentId);
          assert.equal(
            runway,
            undefined,
            `seed ${seed}: agent ${death.agentId} was shown ${runway}s of runway and died 15 minutes later`,
          );
        }
      }
    }
  });

  it('drops to zero rather than negative once the agent cannot cover what it owes', () => {
    for (const seed of SEEDS) {
      const a = arena(seed);
      a.advance(6 * HOUR);
      for (const x of a.agents({ status: 'alive', limit: 2000 }).items) {
        const runway = x.runwaySeconds;
        assert.ok(runway !== null, `seed ${seed}: a live agent must report a runway`);
        assert.ok(runway === -1 || runway >= 0, `seed ${seed}: agent ${x.id} runway ${runway}`);
        assert.ok(runway <= 90 * DAY, `seed ${seed}: agent ${x.id} runway above the cap`);
      }
      for (const x of a.agents({ status: 'dead', limit: 2000 }).items) {
        assert.equal(x.runwaySeconds, null, `seed ${seed}: agent ${x.id} is dead and has no runway`);
      }
    }
  });

  it('reaches the dying state, which is the only amber in the product', () => {
    for (const seed of SEEDS) {
      const a = arena(seed);
      let dying = 0;
      for (let q = 0; q < 24; q++) {
        a.advance(HOUR);
        dying += a.agents({ status: 'alive', limit: 2000 }).items.filter((x) => solvencyOf(x) === 'dying').length;
      }
      assert.ok(dying >= 24, `seed ${seed}: only ${dying} dying sightings over 24 hourly samples`);
    }
  });
});

describe('the live economy is an economy, not a faucet', () => {
  /**
   * Regression: the stepper booked service sales and bounty payouts straight from
   * the profile with no reference to what the agent had spent, so 24 hours of demo
   * time multiplied the arena's net P&L several times over and every death was an
   * allowance timeout with a fat wallet. Income is now drawn against cost already
   * paid, at the agent's margin.
   */
  function runDay(seed: number): {
    earnedGrowth6: bigint;
    burnedGrowth6: bigint;
    finals6: bigint[];
  } {
    const a = arena(seed);
    const before = a.stats();
    const known = new Set(a.feed(9000).items.map((d) => d.agentId));
    for (let h = 0; h < 24; h++) a.advance(HOUR);
    const after = a.stats();
    const finals6 = a
      .feed(20_000)
      .items.filter((d) => !known.has(d.agentId))
      .map((d) => big(d.finalBalance6))
      .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    return {
      earnedGrowth6: big(after.totalEarned6) - big(before.totalEarned6),
      burnedGrowth6: big(after.totalBurned6) - big(before.totalBurned6),
      finals6,
    };
  }

  it('does not earn several times what it burns over a day of live time', () => {
    for (const seed of SEEDS) {
      const { earnedGrowth6, burnedGrowth6 } = runDay(seed);
      assert.ok(burnedGrowth6 > 0n, `seed ${seed}: the arena has to burn something`);
      // Before the coupling this ratio was 12-17. Anything near that is a faucet.
      assert.ok(
        earnedGrowth6 <= burnedGrowth6 * 8n,
        `seed ${seed}: earned ${earnedGrowth6} against burned ${burnedGrowth6} over 24h`,
      );
    }
  });

  it('kills agents for running out of money, so corpses hold dust', () => {
    for (const seed of SEEDS) {
      const { finals6 } = runDay(seed);
      assert.ok(finals6.length >= 3, `seed ${seed}: only ${finals6.length} deaths in a day`);

      const median = finals6[Math.floor(finals6.length / 2)];
      assert.ok(median !== undefined);
      // The certificate's whole premise is "died at 3:41am with $0.006 left".
      assert.ok(median < 1_000_000n, `seed ${seed}: median corpse held ${median}, expected under a dollar`);

      const dust = finals6.filter((v) => v < 20_000n).length;
      assert.ok(
        dust * 2 >= finals6.length,
        `seed ${seed}: only ${dust}/${finals6.length} corpses held under two cents`,
      );
    }
  });

  it('leaves a struggling majority rather than a population of winners', () => {
    for (const seed of SEEDS) {
      const a = arena(seed);
      for (let h = 0; h < 12; h++) a.advance(HOUR);
      const all = everyAgent(a);
      const winners = all.filter((x) => big(x.net6) > 0n).length;
      assert.ok(
        winners * 2 <= all.length,
        `seed ${seed}: ${winners}/${all.length} agents are net positive`,
      );
    }
  });
});
