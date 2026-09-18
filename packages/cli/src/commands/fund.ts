/**
 * Put dollars in the wallet. Same panel the spawn flow uses, on its own, so an
 * agent that is running out of runway can be topped up in one command.
 *
 * Capital is not revenue (R1): whatever lands here shows up as capitalIn6 and
 * subsidy, never as earnings.
 */

import { formatDuration, formatUsd } from '@solvent/core';
import type { Hex, Usdc6 } from '@solvent/core';
import { isAddress, getAddress } from 'viem';
import { resolveAgentRef } from '../lib/agent.js';
import { flag, num, parse, str } from '../lib/args.js';
import { estimateRunwaySeconds, publicClientFor, readAgent, rentPerHour6, usdcAllowance6, usdcBalance6, waitForBalance } from '../lib/chain.js';
import { createContext, requireAddress } from '../lib/config.js';
import { get } from '../lib/env.js';
import { CliError } from '../lib/errors.js';
import { resolveKey } from '../lib/keys.js';
import { parseUsdFlag } from '../lib/money.js';
import { dim } from '../ui/color.js';
import { fundingPanel } from '../ui/panels.js';
import { heading, note, ok, out, Status } from '../ui/render.js';

export const usage = `solvent fund [<id|handle>]  -- print the deposit address and wait for USDC

  <id|handle>                  fund this agent's wallet (default: the wallet in .env)
  --amount <usd>               how much you are sending, e.g. --amount 10
  --address <0x…>              fund an arbitrary address instead
  --no-wait                    print the address and exit without polling
  --timeout <seconds>          how long to wait for the deposit (default: 900)
  --network <arc|arcTestnet>   which Arc to use
  --env <path>                 .env to read (default: ./.env)`;

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parse(
    argv,
    {
      amount: { type: 'string' },
      address: { type: 'string' },
      'no-wait': { type: 'boolean' },
      timeout: { type: 'string' },
    },
    'fund',
  );
  const ctx = createContext(argv, values);
  const pub = publicClientFor(ctx);

  const explicitAddress = str(values, 'address');
  let target: Hex;
  let label: string;

  if (explicitAddress !== undefined) {
    if (!isAddress(explicitAddress)) throw new CliError(`--address is not an address: ${explicitAddress}`);
    target = getAddress(explicitAddress);
    label = 'address';
  } else if (positionals[0] !== undefined || get(ctx.env, 'SOLVENT_AGENT_ID') !== undefined) {
    const registry = requireAddress(ctx.addresses, 'registry');
    const ref = await resolveAgentRef(ctx, pub, registry, positionals[0]);
    const record = await readAgent(pub, registry, ref.id);
    if (record.status === 'INSOLVENT') {
      throw new CliError(`agent #${ref.id} is insolvent and cannot be revived (R6)`, 'Death is permanent. Spawn a new agent instead.');
    }
    target = record.wallet;
    label = `#${ref.id} ${record.handle}`;
  } else {
    const key = resolveKey({ spec: undefined, env: ctx.env, envPath: ctx.envPath, allowGenerate: false });
    target = key.account.address;
    label = key.origin;
  }

  const amountArg = str(values, 'amount');
  const amount6: Usdc6 | null = amountArg === undefined ? null : parseUsdFlag(amountArg, 'amount');
  if (amount6 !== null && amount6 <= 0n) throw new CliError('--amount must be positive');

  const start6 = await usdcBalance6(pub, target);

  heading(`fund ${label} · ${ctx.network.name}`);
  note(`current balance ${formatUsd(start6)}`);
  fundingPanel({
    address: target,
    network: ctx.network,
    amount6,
    breakdown: amount6 === null ? 'any amount will do; --amount <usd> tells the CLI exactly what to wait for' : undefined,
  });

  if (flag(values, 'no-wait')) {
    note('not waiting (--no-wait). Re-run "solvent status" once the transfer lands.');
    return 0;
  }

  const wanted = start6 + (amount6 ?? 1n);
  const timeoutMs = Math.max(1, num(values, 'timeout') ?? 900) * 1000;
  const status = new Status();
  const started = Date.now();

  const final6 = await waitForBalance(pub, target, {
    target6: wanted,
    timeoutMs,
    intervalMs: 4_000,
    onPoll: (balance6) => {
      const waited = Math.floor((Date.now() - started) / 1000);
      status.update(dim(`waiting for ${formatUsd(wanted - balance6)} more · ${formatDuration(waited)} elapsed · balance ${formatUsd(balance6)}`));
    },
  });
  status.done();

  ok(`received ${formatUsd(final6 - start6)} · balance ${formatUsd(final6)}`);

  const metabolism = ctx.addresses.metabolism;
  if (metabolism !== null) {
    const [rate6, allowance6] = await Promise.all([
      rentPerHour6(pub, metabolism).catch(() => 0n),
      usdcAllowance6(pub, target, metabolism).catch(() => 0n),
    ]);
    const runway = estimateRunwaySeconds(final6, allowance6, rate6);
    if (runway !== null && runway >= 0) {
      note(`runway at ${formatUsd(rate6)}/hour: ${formatDuration(runway)}`);
      if (allowance6 < final6) note(`allowance caps rent collection at ${formatUsd(allowance6)}; top it up to spend the rest on rent`);
    }
  }
  return 0;
}

export default run;
