/**
 * The hard rail of SPEC 7: the runtime refuses to start on an unbounded
 * allowance to Metabolism, and never widens the allowance itself.
 *
 * The floor that decides "unbounded" was 2^128 in the CLI and 2^255 here, so
 * every approval in between - type(uint160).max, the shape a wallet UI or a
 * Permit2 script grants - was called unbounded by "solvent doctor" and
 * "solvent status" and then waved through by the rail that exists to stop it.
 * SPEC 9.2 fixes the number at 2^128 for the whole repo.
 *
 * Two directories deep because the package's test glob expands one level only,
 * and would not find a file sitting beside wallet.ts.
 *
 *   node --test --experimental-strip-types src/rails/allowance.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Hex } from '@solvent/core';
import { NETWORKS } from '@solvent/core';
import type { AgentConfig } from '../config.ts';
import { AgentWallet, UNBOUNDED_ALLOWANCE_FLOOR_6, WalletError } from '../wallet.ts';

/** Never funded. Only its shape matters here. */
const PRIVATE_KEY = `0x${'c0ffee'.repeat(10)}dead` as Hex;

const METABOLISM = '0x00000000000000000000000000000000000000aa' as Hex;
const REGISTRY = '0x00000000000000000000000000000000000000bb' as Hex;
const USDC = '0x3600000000000000000000000000000000000000' as Hex;

/** Permit2's infinite approval, and the raw approve any wallet UI will send. */
const UINT160_MAX = (1n << 160n) - 1n;

const AGENT_ID = 7;

function walletWithAllowance(allowance6: bigint): AgentWallet {
  const config = {
    network: NETWORKS.arcTestnet,
    // Never dialled: every read below is stubbed.
    rpcUrl: 'http://127.0.0.1:1',
    contracts: { registry: REGISTRY, metabolism: METABOLISM, serviceMeter: null, bountyBoard: null, ledger: null, usdc: USDC },
    agentId: AGENT_ID,
    maxSpendPerAction6: 50_000n,
    dryRun: true,
  } as unknown as AgentConfig;

  const wallet = new AgentWallet(PRIVATE_KEY, config);
  const answers: Record<string, unknown> = {
    balanceOf: 5_000_000n,
    allowance: allowance6,
    owed6: 0n,
    rentPerHour6: 10_000n,
    isAlive: true,
  };
  const client = wallet.publicClient as unknown as {
    readContract: (args: { functionName: string }) => Promise<unknown>;
  };
  client.readContract = async ({ functionName }) => {
    // Metabolism's own runway answer is optional; snapshot keeps its local one.
    if (functionName === 'runwaySeconds') throw new Error('not stubbed');
    if (!(functionName in answers)) throw new Error(`unexpected read: ${functionName}`);
    return answers[functionName];
  };
  return wallet;
}

describe('the unbounded-allowance rail', () => {
  it('uses the floor SPEC 9.2 fixes, not one 2^127 times higher', () => {
    assert.equal(UNBOUNDED_ALLOWANCE_FLOOR_6, 1n << 128n);
  });

  it('flags type(uint160).max, which preflight turns into a refusal to start', async () => {
    const snapshot = await walletWithAllowance(UINT160_MAX).snapshot(AGENT_ID);
    assert.equal(snapshot.allowance6, UINT160_MAX);
    assert.equal(snapshot.unboundedAllowance, true);
  });

  it('flags type(uint256).max', async () => {
    const snapshot = await walletWithAllowance((1n << 256n) - 1n).snapshot(AGENT_ID);
    assert.equal(snapshot.unboundedAllowance, true);
  });

  it('leaves a bounded cap alone', async () => {
    const snapshot = await walletWithAllowance(10_000_000n).snapshot(AGENT_ID);
    assert.equal(snapshot.unboundedAllowance, false);
  });

  it('refuses to sign an effectively unbounded approve, even under a cap that allows it', async () => {
    const wallet = walletWithAllowance(10_000_000n);
    const intent = wallet.originate('approve', 0n, 'widen the rent allowance');
    await assert.rejects(
      () => wallet.approveMetabolism(intent, UINT160_MAX, UINT160_MAX),
      WalletError,
      'a running agent must not be able to widen its own exposure to infinity',
    );
  });

  it('still signs a bounded approve', async () => {
    const wallet = walletWithAllowance(10_000_000n);
    const intent = wallet.originate('approve', 0n, 'widen the rent allowance');
    const tx = await wallet.approveMetabolism(intent, 20_000_000n, 25_000_000n);
    assert.equal(tx.dryRun, true);
  });
});
