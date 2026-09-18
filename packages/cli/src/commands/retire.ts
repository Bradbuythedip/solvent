/**
 * Withdraw an agent from the arena while it is still solvent.
 *
 * Retiring is one-way — the Registry only allows it from ALIVE, and nothing
 * moves the agent back. So it asks for the handle to be typed, not for a y/n.
 */

import { formatDuration, formatUsd, txUrl } from '@solvent/core';
import { resolveAgentRef } from '../lib/agent.js';
import { parse, str } from '../lib/args.js';
import { publicClientFor, readAgent, retireAgent, usdcBalance6, walletClientFor } from '../lib/chain.js';
import { agentPageUrl, createContext, requireAddress } from '../lib/config.js';
import { CliError } from '../lib/errors.js';
import { resolveKey } from '../lib/keys.js';
import { dim, underline } from '../ui/color.js';
import { typedConfirm } from '../lib/prompt.js';
import { heading, kv, note, ok, out } from '../ui/render.js';

export const usage = `solvent retire [<id|handle>]  -- leave the arena while still solvent

  <id|handle>                  which agent (default: SOLVENT_AGENT_ID, else the wallet in .env)
  --key <spec>                 operator key: "env", a 0x key, or a path (default: PRIVATE_KEY)
  --yes                        skip the typed confirmation (scripts only)
  --network <arc|arcTestnet>   which Arc to use
  --env <path>                 .env to read (default: ./.env)`;

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, { key: { type: 'string' } }, 'retire');
  const ctx = createContext(argv, values);
  const pub = publicClientFor(ctx);
  const registry = requireAddress(ctx.addresses, 'registry');

  const ref = await resolveAgentRef(ctx, pub, registry, positionals[0]);
  const record = await readAgent(pub, registry, ref.id);
  if (record.status !== 'ALIVE') {
    throw new CliError(
      `agent #${ref.id} is ${record.status}, not ALIVE`,
      record.status === 'INSOLVENT' ? 'Death is permanent (R6); there is nothing to retire.' : 'Only an ALIVE agent can be retired.',
    );
  }

  const balance6 = await usdcBalance6(pub, record.wallet);
  const age = Math.floor(Date.now() / 1000) - record.bornAt;

  heading(`retire #${ref.id} ${record.handle} · ${ctx.network.name}`);
  kv([
    { label: 'wallet', value: record.wallet },
    { label: 'balance', value: formatUsd(balance6) },
    { label: 'age', value: formatDuration(age) },
    { label: 'operator', value: record.operator },
  ]);
  out();
  note('Retiring stops rent and closes the run. The agent can never be ALIVE again.');

  if (!ctx.yes) await typedConfirm(`Retire #${ref.id} ${record.handle} on ${ctx.network.name}?`, record.handle);

  const key = resolveKey({ spec: str(values, 'key'), env: ctx.env, envPath: ctx.envPath, allowGenerate: false });
  if (key.account.address.toLowerCase() !== record.operator.toLowerCase()) {
    throw new CliError(
      `${key.account.address} is not the operator of #${ref.id}`,
      `Only ${record.operator} can retire this agent. Point --key at that wallet.`,
    );
  }

  const wallet = walletClientFor(ctx, key.account);
  const result = await retireAgent(pub, wallet, registry, ref.id);

  out();
  ok(`retired #${ref.id} ${record.handle} · final balance ${formatUsd(result.finalBalance6 ?? balance6)} · gas ${formatUsd(result.gas6)}`);
  out(`  ${dim('tx')}   ${underline(txUrl(ctx.network.id, result.hash))}`);
  out(`  ${dim('page')} ${underline(agentPageUrl(ctx, ref.id))}`);
  return 0;
}

export default run;
