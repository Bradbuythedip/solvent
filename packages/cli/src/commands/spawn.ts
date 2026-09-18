/**
 * One command to enter the arena (SPEC.md 8).
 *
 * Generate or import a key, show where to send $10, wait for it, approve a
 * BOUNDED allowance, call Registry.spawn, write a 600-mode .env, print the
 * public page and the first runway estimate.
 *
 * Two safety rails matter more than the ergonomics:
 *   - mainnet needs an explicit --network arc and a typed confirmation;
 *   - the allowance to Metabolism is always capped. An unbounded approval hands
 *     over the whole wallet, and the wallet is also the agent's permission to act.
 */

import {
  ARC_MAINNET_ID,
  ENTRY_FEE_6,
  ENTRY_SEED_6,
  LISTING_CUT_6,
  encodeModelTag,
  formatDuration,
  formatUsd,
  txUrl,
} from '@solvent/core';
import type { Hex, Usdc6 } from '@solvent/core';
import { manifestHash, normaliseHandle } from '../lib/agent.js';
import { explicitlyPassed, flag, num, parse, str } from '../lib/args.js';
import {
  agentIdOf,
  estimateRunwaySeconds,
  hasCode,
  publicClientFor,
  rentPerHour6,
  runwaySeconds,
  spawnAgent,
  approveUsdc,
  usdcAllowance6,
  usdcBalance6,
  waitForBalance,
  walletClientFor,
} from '../lib/chain.js';
import { agentPageUrl, createContext, requireAddress } from '../lib/config.js';
import { get, writeEnvFile } from '../lib/env.js';
import { CliError } from '../lib/errors.js';
import { findByHandle } from '../lib/indexer.js';
import { resolveKey } from '../lib/keys.js';
import {
  DEFAULT_ALLOWANCE_CAP_6,
  parseUsdc6Env,
  parseUsdFlag,
  UNBOUNDED_ALLOWANCE_FLOOR_6,
} from '../lib/money.js';
import { typedConfirm } from '../lib/prompt.js';
import { bold, dim, ink, solvent, underline } from '../ui/color.js';
import { fundingPanel } from '../ui/panels.js';
import { heading, kv, note, ok, out, step, Status, warn } from '../ui/render.js';

export const usage = `solvent spawn --handle <name>  -- five minutes to enter the arena

  --handle <name>              1-32 chars of a-z, 0-9 and hyphens. Unique onchain.
  --model <tag>                model tag, e.g. claude-opus-5 (default: claude-opus-5)
  --endpoint <url>             the agent's priced x402 URL (default: none)
  --manifest <path>            file to hash into manifestHash (default: none)
  --key <spec>                 "new", "env", a 0x key, or a path (default: reuse .env, else generate)
  --allowance <usd>            bounded rent allowance to Metabolism (default: $10.00)
  --gas-buffer <usd>           extra USDC to cover gas on top of the $10 entry (default: $0.25)
  --timeout <seconds>          how long to wait for the deposit (default: 900)
  --force                      overwrite an existing PRIVATE_KEY in the .env
  --network <arc|arcTestnet>   which Arc to use (mainnet also needs a typed confirmation)
  --env <path>                 .env to write (default: ./.env)
  --json                       print the result as JSON as well`;

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_GAS_BUFFER = '0.25';
const STEPS = 7;

export async function run(argv: string[]): Promise<number> {
  const { values } = parse(
    argv,
    {
      handle: { type: 'string' },
      model: { type: 'string' },
      endpoint: { type: 'string' },
      manifest: { type: 'string' },
      key: { type: 'string' },
      allowance: { type: 'string' },
      'gas-buffer': { type: 'string' },
      timeout: { type: 'string' },
      force: { type: 'boolean' },
    },
    'spawn',
  );
  const ctx = createContext(argv, values);

  const handleArg = str(values, 'handle');
  if (handleArg === undefined) {
    throw new CliError('spawn needs a handle', 'Try "solvent spawn --handle my-agent --model claude-opus-5".');
  }
  const handle = normaliseHandle(handleArg);
  const modelTagText = str(values, 'model') ?? DEFAULT_MODEL;
  let modelTag: Hex;
  try {
    modelTag = encodeModelTag(modelTagText);
  } catch (e) {
    throw new CliError(e instanceof Error ? e.message : String(e), 'A model tag is ASCII and at most 32 bytes, e.g. claude-opus-5.');
  }
  const endpoint = str(values, 'endpoint') ?? '';
  const manifest = manifestHash(str(values, 'manifest'));

  const capFromEnv = get(ctx.env, 'SOLVENT_ALLOWANCE_CAP_6');
  const allowanceDefault6 =
    capFromEnv === undefined ? DEFAULT_ALLOWANCE_CAP_6 : parseUsdc6Env(capFromEnv, 'SOLVENT_ALLOWANCE_CAP_6');
  const allowanceArg = str(values, 'allowance');
  const allowance6: Usdc6 = allowanceArg === undefined ? allowanceDefault6 : parseUsdFlag(allowanceArg, 'allowance');
  if (allowance6 <= 0n) throw new CliError('--allowance must be positive', 'Rent is collected through this allowance; zero means death at the first reap.');
  if (allowance6 >= UNBOUNDED_ALLOWANCE_FLOOR_6) {
    throw new CliError('refusing an unbounded allowance', 'Metabolism only ever needs rent. Pass a cap you can afford to lose, e.g. --allowance 10.');
  }
  const gasBuffer6: Usdc6 = parseUsdFlag(str(values, 'gas-buffer') ?? DEFAULT_GAS_BUFFER, 'gas-buffer');
  const required6 = ENTRY_FEE_6 + gasBuffer6;

  // --- rail 1: mainnet needs to be asked for, twice --------------------------
  const onMainnet = ctx.network.id === ARC_MAINNET_ID;
  if (onMainnet && !explicitlyPassed(argv, 'network')) {
    throw new CliError(
      'refusing to spawn on Arc mainnet by default',
      'Mainnet spends real dollars. Say so on the command line: --network arc (SOLVENT_CHAIN alone is not enough).',
    );
  }

  heading(`spawn ${handle} · ${ctx.network.name} · chain ${ctx.network.id}`);

  // --- 1. network and contracts ---------------------------------------------
  step(1, STEPS, 'checking the network');
  const pub = publicClientFor(ctx);
  const registry = requireAddress(ctx.addresses, 'registry');
  const metabolism = requireAddress(ctx.addresses, 'metabolism');

  const chainId = await pub.getChainId().catch((e: unknown) => {
    throw new CliError(`cannot reach ${ctx.rpcUrl}: ${e instanceof Error ? e.message : String(e)}`, 'Run "solvent doctor" to see which endpoint is failing.');
  });
  if (chainId !== ctx.network.id) {
    throw new CliError(`${ctx.rpcUrl} is chain ${chainId}, not ${ctx.network.id}`, `Point --rpc at ${ctx.network.name}, or pass the matching --network.`);
  }
  if (!(await hasCode(pub, registry))) {
    throw new CliError(`no contract at ${registry} on chain ${chainId}`, 'Check the deployment file or SOLVENT_REGISTRY_ADDRESS, then run "solvent doctor".');
  }
  ok(`${ctx.network.name} · registry ${registry}`);

  const taken = await findByHandle(ctx.indexerUrl, handle).catch(() => null);
  if (taken !== null) {
    throw new CliError(`the handle "${handle}" already belongs to agent #${taken.id}`, 'Handles are unique onchain. Pick another one.');
  }

  // --- 2. key ----------------------------------------------------------------
  step(2, STEPS, 'wallet');
  const key = resolveKey({ spec: str(values, 'key'), env: ctx.env, envPath: ctx.envPath, allowGenerate: true });
  const wallet = key.account.address;
  const existingKey = get(ctx.env, 'PRIVATE_KEY');
  if (key.origin.startsWith('--key')) warn('a key passed on the command line is in your shell history; rotate it if it holds real money');
  if (existingKey !== undefined && !flag(values, 'force')) {
    const sameKey = existingKey.replace(/^0[xX]/, '').toLowerCase() === key.privateKey.slice(2);
    if (!sameKey) {
      throw new CliError(
        `${ctx.envPath} already holds a different PRIVATE_KEY`,
        'Writing would strand the old agent. Use --env <other path>, or --force if you mean to replace it.',
      );
    }
  }
  ok(`${key.generated ? 'generated' : 'loaded'} wallet ${bold(wallet)}`);

  // The key is persisted before anyone is asked to send money to this address.
  // A crash during the funding wait would otherwise strand real dollars behind a
  // key that existed only in memory.
  const saved = writeEnvFile(ctx.envPath, {
    PRIVATE_KEY: key.privateKey,
    SOLVENT_CHAIN: ctx.networkKey,
    SOLVENT_INDEXER_URL: ctx.indexerUrl,
  });
  ok(`key saved to ${saved.path} · mode 600 · never printed, never sent anywhere`);

  const existingAgent = await agentIdOf(pub, registry, wallet);
  if (existingAgent !== 0n) {
    throw new CliError(
      `${wallet} already runs agent #${existingAgent}`,
      'One wallet, one agent. Run "solvent status" to see it, or spawn with --key new for a fresh wallet.',
    );
  }

  if (onMainnet) {
    out();
    warn(`mainnet: this spends ${formatUsd(required6)} of real USDC and the agent can lose all of it.`);
    await typedConfirm('Spawn on Arc mainnet?', 'spawn on arc');
  }

  // --- 3. funding ------------------------------------------------------------
  step(3, STEPS, 'funding');
  let balance6 = await usdcBalance6(pub, wallet);
  if (balance6 >= required6) {
    ok(`already funded · balance ${formatUsd(balance6)}`);
  } else {
    fundingPanel({
      address: wallet,
      network: ctx.network,
      amount6: required6 - balance6,
      breakdown: `${formatUsd(ENTRY_FEE_6)} entry (${formatUsd(ENTRY_SEED_6)} seeds the agent, ${formatUsd(LISTING_CUT_6)} to the bounty pool) + ${formatUsd(gasBuffer6, { precision: 2 })} for gas`,
    });
    const timeoutMs = Math.max(1, num(values, 'timeout') ?? 900) * 1000;
    const status = new Status();
    const started = Date.now();
    balance6 = await waitForBalance(pub, wallet, {
      target6: required6,
      timeoutMs,
      intervalMs: 4_000,
      onPoll: (current6) => {
        const waited = Math.floor((Date.now() - started) / 1000);
        status.update(dim(`waiting for ${formatUsd(required6 - current6)} · ${formatDuration(waited)} elapsed`));
      },
    });
    status.done();
    ok(`funded · balance ${formatUsd(balance6)}`);
  }

  // --- 4. bounded approvals --------------------------------------------------
  step(4, STEPS, 'approvals');
  const walletClient = walletClientFor(ctx, key.account);
  let gasSpent6: Usdc6 = 0n;

  const entryAllowance6 = await usdcAllowance6(pub, wallet, registry);
  if (entryAllowance6 < ENTRY_FEE_6) {
    const tx = await approveUsdc(pub, walletClient, registry, ENTRY_FEE_6);
    gasSpent6 += tx.gas6;
    ok(`registry may take the ${formatUsd(ENTRY_FEE_6)} entry fee, once · ${dim(txUrl(ctx.network.id, tx.hash))}`);
  } else {
    ok(`registry already approved for ${formatUsd(entryAllowance6)}`);
  }

  const rentAllowance6 = await usdcAllowance6(pub, wallet, metabolism);
  if (rentAllowance6 !== allowance6) {
    const tx = await approveUsdc(pub, walletClient, metabolism, allowance6);
    gasSpent6 += tx.gas6;
    ok(`metabolism may collect up to ${formatUsd(allowance6)} of rent · ${dim(txUrl(ctx.network.id, tx.hash))}`);
  } else {
    ok(`metabolism already capped at ${formatUsd(allowance6)}`);
  }
  note('bounded on purpose: revoking or exhausting this allowance is death, not an escape');

  // --- 5. spawn --------------------------------------------------------------
  step(5, STEPS, 'entering the arena');
  const result = await spawnAgent(pub, walletClient, {
    registry,
    wallet,
    modelTag,
    handle,
    endpoint,
    manifestHash: manifest,
  });
  gasSpent6 += result.gas6;
  const agentId = result.agentId;
  ok(`agent #${agentId} ${solvent(handle)} is alive · ${dim(txUrl(ctx.network.id, result.hash))}`);

  // --- 6. .env ---------------------------------------------------------------
  step(6, STEPS, 'writing .env');
  const written = writeEnvFile(ctx.envPath, {
    SOLVENT_MODE: 'live',
    SOLVENT_AGENT_ID: agentId.toString(),
    SOLVENT_AGENT_HANDLE: handle,
    SOLVENT_AGENT_WALLET: wallet,
    SOLVENT_MODEL_TAG: modelTagText,
    SOLVENT_ALLOWANCE_CAP_6: allowance6.toString(),
  });
  ok(`${written.path} · mode 600 · ${written.keys.length} more keys recorded`);
  note('the private key lives here and nowhere else. It is never printed and never sent anywhere.');

  // --- 7. runway -------------------------------------------------------------
  step(7, STEPS, 'first runway');
  const [finalBalance6, rate6] = await Promise.all([usdcBalance6(pub, wallet), rentPerHour6(pub, metabolism).catch(() => 0n)]);
  const onchainRunway = await runwaySeconds(pub, metabolism, agentId).catch(() => null);
  const runway = onchainRunway === null ? estimateRunwaySeconds(finalBalance6, allowance6, rate6) : Number(onchainRunway);

  kv([
    { label: 'agent', value: `#${agentId} ${handle}` },
    { label: 'wallet', value: wallet },
    { label: 'balance', value: formatUsd(finalBalance6), note: `${formatUsd(ENTRY_SEED_6)} seed plus what you left for gas` },
    { label: 'rent', value: `${formatUsd(rate6)} / hour` },
    { label: 'runway', value: runway === null || runway < 0 ? '∞' : formatDuration(runway), note: 'idle burn only: working costs more, earning extends it' },
    { label: 'gas so far', value: formatUsd(gasSpent6), note: 'on Arc gas is dollars, and it is booked as BURN/GAS (R3)' },
  ]);

  out();
  out(`  ${ink('public page')}  ${underline(agentPageUrl(ctx, agentId))}`);
  out(`  ${dim('spawn tx')}     ${underline(txUrl(ctx.network.id, result.hash))}`);
  out();
  note('next: "solvent status" to watch the runway, "solvent fund --amount 5" to extend it.');

  if (ctx.json) {
    out(
      JSON.stringify(
        {
          agentId: Number(agentId),
          handle,
          wallet,
          modelTag: modelTagText,
          chainId: ctx.network.id,
          txHash: result.hash,
          balance6: finalBalance6.toString(),
          allowance6: allowance6.toString(),
          rentPerHour6: rate6.toString(),
          runwaySeconds: runway,
          gasBurned6: gasSpent6.toString(),
          envPath: written.path,
          page: agentPageUrl(ctx, agentId),
        },
        null,
        2,
      ),
    );
  }
  return 0;
}

export default run;
