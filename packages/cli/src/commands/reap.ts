/**
 * Collect rent from an agent, and declare it insolvent if it cannot pay.
 *
 * Permissionless by design: anyone may call it, and the caller is paid for the
 * work. A revoked allowance is not an escape — payable falls to zero, zero is
 * less than due, and the agent dies (SPEC.md 3.3).
 */

import { formatUsd, txUrl } from '@solvent/core';
import type { Usdc6 } from '@solvent/core';
import { flag, parse, str } from '../lib/args.js';
import { owed6, publicClientFor, readAgent, reapAgents, usdcAllowance6, usdcBalance6, walletClientFor } from '../lib/chain.js';
import { createContext, requireAddress } from '../lib/config.js';
import { CliError } from '../lib/errors.js';
import { resolveKey } from '../lib/keys.js';
import { dim, insolvent, solvent, underline } from '../ui/color.js';
import { heading, kv, note, ok, out, warn, type Row } from '../ui/render.js';

export const usage = `solvent reap <id> [<id>…]  -- settle rent, and reap what cannot pay

  --dry-run                    read only: show what a reap would do right now
  --key <spec>                 reaper key: "env", a 0x key, or a path (default: PRIVATE_KEY)
  --network <arc|arcTestnet>   which Arc to use
  --env <path>                 .env to read (default: ./.env)
  --json                       machine-readable output`;

interface Prediction {
  id: bigint;
  handle: string;
  status: string;
  due6: Usdc6;
  balance6: Usdc6;
  allowance6: Usdc6;
  payable6: Usdc6;
  dies: boolean;
}

const min = (a: Usdc6, b: Usdc6): Usdc6 => (a < b ? a : b);

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, { 'dry-run': { type: 'boolean' }, key: { type: 'string' } }, 'reap');
  const ctx = createContext(argv, values);

  const ids = positionals.map((raw) => {
    if (!/^\d+$/.test(raw) || BigInt(raw) === 0n) {
      throw new CliError(`"${raw}" is not an agent id`, 'reap takes numeric ids: "solvent reap 7 12". Agent ids start at 1.');
    }
    return BigInt(raw);
  });
  if (ids.length === 0) throw new CliError('reap needs at least one agent id', 'Try "solvent reap 7", or "solvent reap 7 12 --dry-run".');

  const pub = publicClientFor(ctx);
  const registry = requireAddress(ctx.addresses, 'registry');
  const metabolism = requireAddress(ctx.addresses, 'metabolism');

  const predictions: Prediction[] = [];
  for (const id of ids) {
    const record = await readAgent(pub, registry, id);
    if (record.status === 'NONE') throw new CliError(`agent #${id} does not exist on chain ${ctx.network.id}`);
    const [due6, balance6, allowance6] = await Promise.all([
      owed6(pub, metabolism, id),
      usdcBalance6(pub, record.wallet),
      usdcAllowance6(pub, record.wallet, metabolism),
    ]);
    const payable6 = min(due6, min(balance6, allowance6));
    predictions.push({
      id,
      handle: record.handle,
      status: record.status,
      due6,
      balance6,
      allowance6,
      payable6,
      dies: record.status === 'ALIVE' && payable6 < due6,
    });
  }

  if (ctx.json && flag(values, 'dry-run')) {
    out(
      JSON.stringify(
        predictions.map((p) => ({
          id: Number(p.id),
          handle: p.handle,
          status: p.status,
          due6: p.due6.toString(),
          balance6: p.balance6.toString(),
          allowance6: p.allowance6.toString(),
          payable6: p.payable6.toString(),
          dies: p.dies,
        })),
        null,
        2,
      ),
    );
    return 0;
  }

  heading(`reap · ${ctx.network.name}`);
  for (const p of predictions) {
    const rows: Row[] = [
      { label: 'status', value: p.status },
      { label: 'owed', value: formatUsd(p.due6) },
      { label: 'balance', value: formatUsd(p.balance6) },
      { label: 'allowance', value: formatUsd(p.allowance6) },
      { label: 'collectable', value: formatUsd(p.payable6) },
      {
        label: 'outcome',
        value: p.dies ? insolvent('✖ INSOLVENT') : solvent('✔ pays rent'),
        note: p.dies ? (p.allowance6 < p.due6 && p.balance6 >= p.due6 ? 'allowance too small: a revoked allowance is death, not an escape' : 'cannot make rent') : undefined,
      },
    ];
    out();
    out(`  ${dim('agent')} #${p.id} ${p.handle}`);
    kv(rows);
  }

  if (flag(values, 'dry-run')) {
    out();
    note('dry run: nothing was sent.');
    return 0;
  }

  const key = resolveKey({ spec: str(values, 'key'), env: ctx.env, envPath: ctx.envPath, allowGenerate: false });
  if (key.origin.startsWith('--key')) warn('a key passed on the command line is in your shell history; rotate it if it holds real money');
  const wallet = walletClientFor(ctx, key.account);

  out();
  note(`reaping as ${key.account.address}`);
  const result = await reapAgents(pub, wallet, metabolism, ids);

  out();
  for (const r of result.reaped) {
    const line = `#${r.agentId} · due ${formatUsd(r.due6)} · collected ${formatUsd(r.collected6)} · final balance ${formatUsd(r.balance6)}`;
    if (r.died) out(`  ${insolvent('✖ INSOLVENT')} ${line}`);
    else out(`  ${solvent('✔ settled')}   ${line}`);
  }
  if (result.reaped.length === 0) note('nothing was owed: no rent had accrued since the last settlement.');

  ok(`${result.deaths} ${result.deaths === 1 ? 'death' : 'deaths'} · gas ${formatUsd(result.gas6)}`);
  out(`  ${dim('tx')} ${underline(txUrl(ctx.network.id, result.hash))}`);

  if (ctx.json) {
    out(
      JSON.stringify(
        {
          txHash: result.hash,
          chainId: ctx.network.id,
          gasBurned6: result.gas6.toString(),
          deaths: result.deaths,
          reaped: result.reaped.map((r) => ({
            id: Number(r.agentId),
            died: r.died,
            due6: r.due6.toString(),
            collected6: r.collected6.toString(),
            balance6: r.balance6.toString(),
          })),
        },
        null,
        2,
      ),
    );
  }
  return 0;
}

export default run;
