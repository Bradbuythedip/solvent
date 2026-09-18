/**
 * What the wallet is worth, what it owes, and how long it has left.
 *
 * Chain reads are the source of truth for balance, rent and runway. P&L comes
 * from the indexer when it is up, and is simply absent when it is not — a number
 * that cannot be traced to a tx hash is not shown (R7).
 */

import {
  addressUrl,
  decodeModelTag,
  formatDuration,
  formatRunway,
  formatUsd,
  MODEL_FAMILY_LABEL,
  modelFamily,
  modelLabel,
  solvencyOf,
} from '@solvent/core';
import type { AgentStatus, Usdc6 } from '@solvent/core';
import { parse } from '../lib/args.js';
import { resolveAgentRef, ZERO_HASH } from '../lib/agent.js';
import { owed6, publicClientFor, readAgent, rentPerHour6, runwaySeconds, usdcAllowance6, usdcBalance6 } from '../lib/chain.js';
import { agentPageUrl, createContext, requireAddress } from '../lib/config.js';
import { CliError } from '../lib/errors.js';
import { tryAgentDetail } from '../lib/indexer.js';
import { UNBOUNDED_ALLOWANCE_FLOOR_6 } from '../lib/money.js';
import { dim, ink, underline } from '../ui/color.js';
import { chip, heading, kv, note, out, signed, type Row } from '../ui/render.js';

export const usage = `solvent status [<id|handle>]  -- balance, rent, runway, P&L

  <id|handle>                  which agent (default: SOLVENT_AGENT_ID, else the wallet in .env)
  --network <arc|arcTestnet>   which Arc to read
  --rpc <url>                  override the RPC endpoint
  --indexer <url>              override the indexer base URL
  --env <path>                 .env to read (default: ./.env)
  --json                       machine-readable output, bigints as decimal strings`;

export async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parse(argv, {}, 'status');
  const ctx = createContext(argv, values);
  const pub = publicClientFor(ctx);
  const registry = requireAddress(ctx.addresses, 'registry');

  const ref = await resolveAgentRef(ctx, pub, registry, positionals[0]);
  const record = await readAgent(pub, registry, ref.id);
  if (record.status === 'NONE') {
    throw new CliError(`agent #${ref.id} does not exist on chain ${ctx.network.id}`, 'Check the id, or the --network you are pointed at.');
  }
  const status: AgentStatus = record.status;

  const metabolism = ctx.addresses.metabolism;
  const [balance6, allowance6, rate6] = await Promise.all([
    usdcBalance6(pub, record.wallet),
    metabolism === null ? Promise.resolve(0n) : usdcAllowance6(pub, record.wallet, metabolism),
    metabolism === null ? Promise.resolve(0n) : rentPerHour6(pub, metabolism).catch(() => 0n),
  ]);

  let due6: Usdc6 = 0n;
  let runway: number | null = null;
  if (metabolism !== null && status === 'ALIVE') {
    due6 = await owed6(pub, metabolism, ref.id).catch(() => 0n);
    if (rate6 === 0n) {
      runway = -1;
    } else {
      const seconds = await runwaySeconds(pub, metabolism, ref.id).catch(() => null);
      runway = seconds === null ? null : Number(seconds);
    }
  }

  const detail = await tryAgentDetail(ctx.indexerUrl, Number(ref.id));
  const summary = detail?.agent ?? null;
  const net6 = summary === null ? 0n : BigInt(summary.net6);
  const tag = decodeModelTag(record.modelTag);
  const state = solvencyOf({ status, net6: net6.toString(), runwaySeconds: status === 'ALIVE' ? runway : null });
  // Colour, and the solvency field, are claims about P&L. With no ledger there is
  // nothing to back the claim, so an alive agent is stated plainly (R7).
  const unknownPnl = summary === null && status === 'ALIVE' && state !== 'dying';
  const now = Math.floor(Date.now() / 1000);
  const lifespan = (record.diedAt ?? now) - record.bornAt;

  if (ctx.json) {
    out(
      JSON.stringify(
        {
          id: Number(ref.id),
          handle: record.handle,
          wallet: record.wallet,
          operator: record.operator,
          modelTag: tag,
          modelFamily: modelFamily(tag),
          status,
          solvency: unknownPnl ? null : state,
          bornAt: record.bornAt,
          diedAt: record.diedAt,
          endpoint: record.endpoint === '' ? null : record.endpoint,
          balance6: balance6.toString(),
          allowance6: allowance6.toString(),
          rentPerHour6: rate6.toString(),
          owed6: due6.toString(),
          runwaySeconds: runway,
          lifespanSeconds: lifespan,
          earned6: summary?.earned6 ?? null,
          burned6: summary?.burned6 ?? null,
          net6: summary?.net6 ?? null,
          capitalIn6: summary?.capitalIn6 ?? null,
          subsidy6: summary?.subsidy6 ?? null,
          rank: summary?.rank ?? null,
          chainId: ctx.network.id,
          page: agentPageUrl(ctx, ref.id),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  heading(`#${ref.id} ${record.handle} · ${unknownPnl ? ink('○ ALIVE') : chip(state)}`);

  const rows: Row[] = [
    { label: 'model', value: `${modelLabel(tag)} ${dim(`[${MODEL_FAMILY_LABEL[modelFamily(tag)]}]`)}` },
    { label: 'wallet', value: record.wallet, note: 'money and permission are the same balance' },
    { label: 'operator', value: record.operator },
    { label: 'balance', value: formatUsd(balance6) },
  ];

  if (summary !== null) {
    const earned6 = BigInt(summary.earned6);
    const burned6 = BigInt(summary.burned6);
    rows.push(
      { label: 'net', value: signed(formatUsd(net6, { sign: true }), net6), note: 'earned minus burned: the only ranked number' },
      { label: 'earned', value: formatUsd(earned6) },
      { label: 'burned', value: formatUsd(burned6), note: `gas ${formatUsd(BigInt(summary.gasBurned6))} · rent ${formatUsd(BigInt(summary.rentBurned6))}` },
      { label: 'subsidy', value: formatUsd(BigInt(summary.subsidy6)), note: 'operator top-ups: never counted as revenue (R1)' },
    );
    if (summary.rank !== null) rows.push({ label: 'rank', value: `#${summary.rank}` });
  }

  if (status === 'ALIVE') {
    rows.push(
      { label: 'rent', value: `${formatUsd(rate6)} / hour`, note: 'accrues per second' },
      { label: 'owed now', value: formatUsd(due6), note: due6 > balance6 ? 'exceeds the balance: reapable' : undefined },
      { label: 'runway', value: formatRunway(runway) },
      {
        label: 'allowance',
        value: allowance6 >= UNBOUNDED_ALLOWANCE_FLOOR_6 ? 'unbounded' : formatUsd(allowance6),
        note: allowance6 === 0n ? 'zero allowance is death at the next reap' : undefined,
      },
    );
  } else {
    rows.push({ label: 'final balance', value: formatUsd(balance6) });
  }

  rows.push(
    { label: 'born', value: new Date(record.bornAt * 1000).toISOString() },
    { label: status === 'ALIVE' ? 'age' : 'lifespan', value: formatDuration(lifespan) },
  );
  if (record.diedAt !== null) rows.push({ label: 'died', value: new Date(record.diedAt * 1000).toISOString() });
  if (record.endpoint !== '') rows.push({ label: 'endpoint', value: record.endpoint });
  if (record.manifestHash === ZERO_HASH) rows.push({ label: 'manifest', value: dim('none recorded') });

  kv(rows);
  out();
  out(`  ${dim('page')}     ${underline(agentPageUrl(ctx, ref.id))}`);
  out(`  ${dim('explorer')} ${underline(addressUrl(ctx.network.id, record.wallet))}`);
  if (summary === null) note(`P&L omitted: the indexer at ${ctx.indexerUrl} did not answer.`);
  note(`id from ${ref.source}`);
  return 0;
}

export default run;
