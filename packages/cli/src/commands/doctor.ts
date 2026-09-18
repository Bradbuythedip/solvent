/**
 * Preflight. Every failing line says what to do next, because a checklist that
 * only reports is a checklist you have to translate.
 */

import { formatDuration, formatUsd, ONE_USD } from '@solvent/core';
import type { Hex, Usdc6 } from '@solvent/core';
import { parse, str } from '../lib/args.js';
import { agentIdOf, hasCode, publicClientFor, readAgent, rentPerHour6, runwaySeconds, usdcAllowance6, usdcBalance6 } from '../lib/chain.js';
import { createContext, envAddressKey, RPC_ENV_KEY, type ContractName } from '../lib/config.js';
import { briefly } from '../lib/errors.js';
import { tryHealth } from '../lib/indexer.js';
import { resolveKey } from '../lib/keys.js';
import { dim, ink } from '../ui/color.js';
import { checkLine, heading, note, out, type CheckLine } from '../ui/render.js';

export const usage = `solvent doctor  -- check that this machine can reach the arena

  --network <arc|arcTestnet>   which Arc to check (default: SOLVENT_CHAIN, else arcTestnet)
  --rpc <url>                  override the RPC endpoint
  --indexer <url>              override the indexer base URL
  --env <path>                 .env to read (default: ./.env)
  --key <spec>                 key to check: "env", a 0x key, or a path
  --json                       machine-readable checklist`;

/** Anything above this is effectively unbounded and defeats the point of a cap. */
const UNBOUNDED_FLOOR = 1n << 128n;

interface Check extends CheckLine {
  name: string;
}

export async function run(argv: string[]): Promise<number> {
  const { values } = parse(argv, { key: { type: 'string' } }, 'doctor');
  const ctx = createContext(argv, values);
  const checks: Check[] = [];
  const add = (c: Check): void => {
    checks.push(c);
  };

  const pub = publicClientFor(ctx);

  // 1. RPC reachability.
  let head: bigint | null = null;
  try {
    head = await pub.getBlockNumber();
    add({ name: 'rpc', state: 'pass', label: 'RPC reachable', detail: `${ctx.rpcUrl} at block ${head}` });
  } catch (e) {
    add({
      name: 'rpc',
      state: 'fail',
      label: 'RPC reachable',
      detail: briefly(e),
      remedy: `Set ${RPC_ENV_KEY(ctx.network.id)} in ${ctx.envPath}, or pass --rpc <url>. Default: ${ctx.network.rpcUrl}`,
    });
  }

  // 2. Chain id.
  if (head !== null) {
    try {
      const chainId = await pub.getChainId();
      const okChain = chainId === ctx.network.id;
      add({
        name: 'chain',
        state: okChain ? 'pass' : 'fail',
        label: 'chain id',
        detail: okChain ? `${chainId} (${ctx.network.name})` : `RPC reports ${chainId}, expected ${ctx.network.id}`,
        remedy: okChain ? undefined : `That endpoint is not ${ctx.network.name}. Use --network ${chainId === 5042 ? 'arc' : 'arcTestnet'} or point --rpc at the right chain.`,
      });
    } catch (e) {
      add({ name: 'chain', state: 'fail', label: 'chain id', detail: briefly(e), remedy: 'The endpoint answered for blocks but not for eth_chainId. Try another RPC URL.' });
    }
  } else {
    add({ name: 'chain', state: 'skip', label: 'chain id', detail: 'no RPC', remedy: 'Fix the RPC check first.' });
  }

  // 3. Deployment addresses.
  const required: ContractName[] = ['ledger', 'registry', 'metabolism', 'serviceMeter', 'bountyBoard'];
  const missing = required.filter((name) => ctx.addresses[name] === null);
  add({
    name: 'addresses',
    state: missing.length === 0 ? 'pass' : 'fail',
    label: 'deployment addresses',
    detail: missing.length === 0 ? `${required.length} contracts from ${ctx.addresses.source}` : `missing ${missing.join(', ')} (source: ${ctx.addresses.source})`,
    remedy:
      missing.length === 0
        ? undefined
        : `Deploy to chain ${ctx.network.id} so packages/core/src/deployments/${ctx.network.id}.json exists, or set ${missing.map(envAddressKey).join(', ')} in ${ctx.envPath}.`,
  });

  // 4. Code actually deployed at those addresses.
  const registry = ctx.addresses.registry;
  const metabolism = ctx.addresses.metabolism;
  if (head !== null && registry !== null && metabolism !== null) {
    try {
      const [registryLive, metabolismLive] = await Promise.all([hasCode(pub, registry), hasCode(pub, metabolism)]);
      const live = registryLive && metabolismLive;
      add({
        name: 'contracts',
        state: live ? 'pass' : 'fail',
        label: 'contracts live',
        detail: live ? `registry and metabolism answer on chain ${ctx.network.id}` : `${registryLive ? 'metabolism' : 'registry'} has no code`,
        remedy: live ? undefined : 'Those addresses hold no bytecode on this chain. Check the network, then re-run the deploy script.',
      });
    } catch (e) {
      add({ name: 'contracts', state: 'warn', label: 'contracts live', detail: briefly(e) });
    }
  } else {
    add({ name: 'contracts', state: 'skip', label: 'contracts live', detail: 'no addresses or no RPC', remedy: 'Fix the checks above first.' });
  }

  // 5. Key.
  let wallet: Hex | null = null;
  try {
    const key = resolveKey({ spec: str(values, 'key'), env: ctx.env, envPath: ctx.envPath, allowGenerate: false });
    wallet = key.account.address;
    add({ name: 'key', state: 'pass', label: 'wallet key', detail: `${wallet} from ${key.origin}` });
  } catch (e) {
    add({
      name: 'key',
      state: 'warn',
      label: 'wallet key',
      detail: briefly(e),
      remedy: `Reads work without a key. To act, run "solvent spawn --handle <name>" or set PRIVATE_KEY in ${ctx.envPath}.`,
    });
  }

  // 6/7. Balance and allowance.
  let rate6: Usdc6 = 0n;
  if (head !== null && wallet !== null) {
    try {
      const balance6 = await usdcBalance6(pub, wallet);
      const state = balance6 === 0n ? 'fail' : balance6 < ONE_USD ? 'warn' : 'pass';
      add({
        name: 'balance',
        state,
        label: 'USDC balance',
        detail: `${formatUsd(balance6)} at ${wallet}`,
        remedy:
          state === 'pass'
            ? undefined
            : ctx.network.faucet !== null
              ? `Fund it: "solvent fund --amount 10" prints a QR, or use the faucet at ${ctx.network.faucet}.`
              : 'Fund it: "solvent fund --amount 10" prints the address and a QR.',
      });
    } catch (e) {
      add({ name: 'balance', state: 'fail', label: 'USDC balance', detail: briefly(e), remedy: 'The USDC precompile did not answer. Check the RPC endpoint.' });
    }

    if (metabolism !== null) {
      try {
        rate6 = await rentPerHour6(pub, metabolism);
      } catch {
        rate6 = 0n;
      }
      try {
        const allowance6 = await usdcAllowance6(pub, wallet, metabolism);
        const hours = rate6 > 0n ? Number(allowance6 / rate6) : Number.POSITIVE_INFINITY;
        const unbounded = allowance6 >= UNBOUNDED_FLOOR;
        const state = allowance6 === 0n ? 'fail' : unbounded ? 'warn' : 'pass';
        add({
          name: 'allowance',
          state,
          label: 'rent allowance',
          detail: unbounded
            ? 'unbounded approval to Metabolism'
            : `${formatUsd(allowance6)} to Metabolism${Number.isFinite(hours) ? dim(` · ${formatDuration(hours * 3600)} of rent`) : ''}`,
          remedy:
            state === 'pass'
              ? undefined
              : allowance6 === 0n
                ? 'With no allowance the next reap collects nothing and declares the agent insolvent. Re-approve a bounded cap with "solvent spawn" or an approve of your own.'
                : 'An unbounded approval hands Metabolism the whole wallet. Replace it with a cap you can afford to lose.',
        });
      } catch (e) {
        add({ name: 'allowance', state: 'warn', label: 'rent allowance', detail: briefly(e) });
      }
    }
  } else {
    add({ name: 'balance', state: 'skip', label: 'USDC balance', detail: 'no key or no RPC', remedy: 'Fix the checks above first.' });
  }

  // 8. Indexer.
  const healthResponse = await tryHealth(ctx.indexerUrl);
  if (healthResponse === null) {
    add({
      name: 'indexer',
      state: 'fail',
      label: 'indexer reachable',
      detail: `${ctx.indexerUrl} did not answer`,
      remedy: 'Start it with "pnpm dev:indexer", or set SOLVENT_INDEXER_URL to a running one. Chain reads still work without it.',
    });
  } else {
    const demo = healthResponse.mode !== 'live';
    add({
      name: 'indexer',
      state: demo ? 'warn' : 'pass',
      label: 'indexer reachable',
      detail: `${ctx.indexerUrl} · mode ${healthResponse.mode} · head ${healthResponse.head} · lag ${healthResponse.lag}`,
      remedy: demo ? 'DEMO mode: those dollars are simulated. Set SOLVENT_MODE=live on the indexer before believing a number.' : undefined,
    });
    if (healthResponse.chainId !== ctx.network.id) {
      add({
        name: 'indexer-chain',
        state: 'warn',
        label: 'indexer chain',
        detail: `indexer is on ${healthResponse.chainId}, this CLI is on ${ctx.network.id}`,
        remedy: 'Point them at the same chain or the numbers will disagree.',
      });
    }
  }

  // 9. The agent itself, when one is known.
  if (head !== null && registry !== null && wallet !== null) {
    try {
      const agentId = await agentIdOf(pub, registry, wallet);
      if (agentId === 0n) {
        add({
          name: 'agent',
          state: 'warn',
          label: 'agent registered',
          detail: `${wallet} owns no agent`,
          remedy: 'Run "solvent spawn --handle <name>" to enter the arena.',
        });
      } else {
        const record = await readAgent(pub, registry, agentId);
        const alive = record.status === 'ALIVE';
        let runway = '';
        if (alive && metabolism !== null) {
          try {
            runway = dim(` · runway ${formatDuration(Number(await runwaySeconds(pub, metabolism, agentId)))}`);
          } catch {
            runway = '';
          }
        }
        add({
          name: 'agent',
          state: alive ? 'pass' : 'warn',
          label: 'agent registered',
          detail: `#${agentId} ${record.handle} · ${record.status}${runway}`,
          remedy: alive ? undefined : 'Death is permanent (R6). Spawn a new agent to keep playing.',
        });
      }
    } catch (e) {
      add({ name: 'agent', state: 'warn', label: 'agent registered', detail: briefly(e) });
    }
  }

  const failed = checks.filter((c) => c.state === 'fail').length;
  const warned = checks.filter((c) => c.state === 'warn').length;
  const passed = checks.filter((c) => c.state === 'pass').length;

  if (ctx.json) {
    out(
      JSON.stringify(
        {
          network: ctx.networkKey,
          chainId: ctx.network.id,
          rpcUrl: ctx.rpcUrl,
          indexerUrl: ctx.indexerUrl,
          checks: checks.map((c) => ({ name: c.name, state: c.state, detail: c.detail, remedy: c.remedy ?? null })),
          summary: { pass: passed, warn: warned, fail: failed },
        },
        null,
        2,
      ),
    );
    return failed > 0 ? 1 : 0;
  }

  heading(`doctor · ${ctx.network.name} · chain ${ctx.network.id}`);
  for (const c of checks) checkLine(c);
  out();
  out(`  ${ink(`${passed} pass, ${warned} warn, ${failed} fail`)}`);
  if (failed === 0 && warned === 0) note('Ready. "solvent spawn --handle <name>" enters the arena.');
  return failed > 0 ? 1 : 0;
}

export default run;
