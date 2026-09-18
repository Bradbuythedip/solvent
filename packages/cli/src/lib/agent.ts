/**
 * Agent identity helpers: handles, manifests, and turning whatever the operator
 * typed into an agent id.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Hex } from '@solvent/core';
import { agentIdOf, type Pub } from './chain.js';
import type { Ctx } from './config.js';
import { get } from './env.js';
import { CliError } from './errors.js';
import { findByHandle } from './indexer.js';
import { resolveKey } from './keys.js';

export const ZERO_HASH: Hex = `0x${'0'.repeat(64)}`;

/** Lower-case, [a-z0-9-], <= 32 characters, as the Registry validates it. */
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function normaliseHandle(raw: string): string {
  const handle = raw.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    throw new CliError(
      `"${raw}" is not a usable handle`,
      'Handles are 1-32 characters of a-z, 0-9 and hyphens, and cannot start or end with a hyphen.',
    );
  }
  return handle;
}

/** sha256 of the agent's code+prompt manifest, or the zero hash when there is none. */
export function manifestHash(path: string | undefined): Hex {
  if (path === undefined) return ZERO_HASH;
  const target = resolve(path);
  if (!existsSync(target)) throw new CliError(`no manifest at ${target}`, 'Point --manifest at the file that defines the agent, or drop the flag.');
  const digest = createHash('sha256').update(readFileSync(target)).digest('hex');
  return `0x${digest}`;
}

export interface AgentRef {
  id: bigint;
  /** Where the id came from, safe to print. */
  source: string;
}

function asId(raw: string): bigint | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = BigInt(raw);
  return id > 0n ? id : null;
}

/**
 * Resolution order: an explicit argument (id, or handle via the indexer), then
 * SOLVENT_AGENT_ID, then the agent owned by the wallet in .env.
 */
export async function resolveAgentRef(ctx: Ctx, pub: Pub, registry: Hex, arg: string | undefined): Promise<AgentRef> {
  if (arg !== undefined) {
    const id = asId(arg);
    if (id !== null) return { id, source: 'argument' };

    const summary = await findByHandle(ctx.indexerUrl, arg).catch(() => null);
    if (summary === null) {
      throw new CliError(
        `no agent with handle "${arg}"`,
        'Handle lookup goes through the indexer. Start it, or pass the numeric agent id instead.',
      );
    }
    return { id: BigInt(summary.id), source: `handle "${summary.handle}"` };
  }

  const fromEnv = get(ctx.env, 'SOLVENT_AGENT_ID');
  if (fromEnv !== undefined) {
    const id = asId(fromEnv);
    if (id === null) throw new CliError(`SOLVENT_AGENT_ID is not an agent id: ${fromEnv}`);
    return { id, source: `SOLVENT_AGENT_ID (${ctx.envPath})` };
  }

  const key = resolveKey({ spec: undefined, env: ctx.env, envPath: ctx.envPath, allowGenerate: false });
  const id = await agentIdOf(pub, registry, key.account.address);
  if (id === 0n) {
    throw new CliError(
      `no agent registered for ${key.account.address}`,
      'Run "solvent spawn --handle <name>" to enter the arena, or name an agent: "solvent status <id|handle>".',
    );
  }
  return { id, source: `wallet ${key.account.address}` };
}
