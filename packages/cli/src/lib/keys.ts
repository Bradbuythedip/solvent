/**
 * Key handling.
 *
 * The private key is written to exactly one place — the .env the operator asked
 * for, mode 600 — and is never printed, logged, or put in an error message.
 */

import { existsSync, readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem';
import type { Hex } from '@solvent/core';
import { get, parseEnv, type EnvMap } from './env.js';
import { CliError } from './errors.js';

export interface ResolvedKey {
  account: PrivateKeyAccount;
  privateKey: Hex;
  /** Where the key came from, safe to print. */
  origin: string;
  generated: boolean;
}

const HEX32 = /^[0-9a-fA-F]{64}$/;

export function normalisePrivateKey(raw: string, origin: string): Hex {
  const trimmed = raw.trim();
  const body = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed;
  if (!HEX32.test(body)) {
    // Deliberately does not echo the value.
    throw new CliError(`the key from ${origin} is not 32 bytes of hex`, 'A private key is 64 hex characters, with or without the 0x prefix.');
  }
  return `0x${body.toLowerCase()}`;
}

function accountFrom(privateKey: Hex, origin: string, generated: boolean): ResolvedKey {
  return { account: privateKeyToAccount(privateKey), privateKey, origin, generated };
}

function fromFile(path: string): ResolvedKey {
  if (!existsSync(path)) throw new CliError(`no key file at ${path}`);
  const text = readFileSync(path, 'utf8');
  const fromEnvFile = get(parseEnv(text), 'PRIVATE_KEY');
  const raw = fromEnvFile ?? text;
  return accountFrom(normalisePrivateKey(raw, path), path, false);
}

export interface ResolveKeyOptions {
  /** --key value: "new", "env", a 0x hex key, or a path. */
  spec: string | undefined;
  env: EnvMap;
  envPath: string;
  /** spawn may mint a key; every other command must find one. */
  allowGenerate: boolean;
}

export function resolveKey(opts: ResolveKeyOptions): ResolvedKey {
  const { spec, env, envPath, allowGenerate } = opts;
  const fromEnv = get(env, 'PRIVATE_KEY');

  if (spec === undefined) {
    if (fromEnv !== undefined) return accountFrom(normalisePrivateKey(fromEnv, 'PRIVATE_KEY'), `PRIVATE_KEY (${envPath})`, false);
    if (allowGenerate) return accountFrom(generatePrivateKey(), 'generated', true);
    throw new CliError('no private key found', `Set PRIVATE_KEY in ${envPath}, or pass --key <path|0x…>, or run "solvent spawn" to mint one.`);
  }

  const value = spec.trim();
  if (value === 'new' || value === 'generate') {
    if (!allowGenerate) throw new CliError('this command cannot generate a key', 'Pass --key <path|0x…> or set PRIVATE_KEY.');
    return accountFrom(generatePrivateKey(), 'generated', true);
  }
  if (value === 'env') {
    if (fromEnv === undefined) throw new CliError('--key env was given but PRIVATE_KEY is not set', `Add PRIVATE_KEY to ${envPath}.`);
    return accountFrom(normalisePrivateKey(fromEnv, 'PRIVATE_KEY'), `PRIVATE_KEY (${envPath})`, false);
  }
  if (HEX32.test(value.replace(/^0[xX]/, ''))) {
    return accountFrom(normalisePrivateKey(value, '--key'), '--key (command line)', false);
  }
  return fromFile(value);
}
