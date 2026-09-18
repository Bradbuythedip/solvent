/**
 * The one place this package turns operator input into USDC.
 *
 * SPEC 9.1 fixes a single grammar for every `_6` environment variable: bare
 * digits are raw 6-decimal units, anything else is a dollar string. Both this
 * package and @solvent/agent read the same `.env` - the CLI writes
 * SOLVENT_ALLOWANCE_CAP_6 and the agent later loads it - so a second grammar
 * behind one name means the cap the operator typed and the cap approved on chain
 * are different numbers. @solvent/agent's copy is parseUsdc6 in src/config.ts;
 * the two packages share only @solvent/core, so SPEC 9 is the contract that
 * keeps them equal.
 *
 * Failure here is an operator typo, never a bug, so it leaves as a CliError with
 * a remedy rather than as a BigInt SyntaxError with a stack trace.
 */

import { parseUsd } from '@solvent/core';
import type { Usdc6 } from '@solvent/core';
import { CliError } from './errors.js';

/**
 * SPEC 9.2: at or above this an allowance is unbounded, and unbounded is the one
 * approval shape this repo refuses. @solvent/agent's runtime rail uses the same
 * number (UNBOUNDED_ALLOWANCE_FLOOR_6 in src/wallet.ts); they have to agree, or
 * the rail lets through approvals doctor and status already called unbounded.
 */
export const UNBOUNDED_ALLOWANCE_FLOOR_6: Usdc6 = 1n << 128n;

/** SPEC 9 default for SOLVENT_ALLOWANCE_CAP_6, matching the agent's. */
export const DEFAULT_ALLOWANCE_CAP_6: Usdc6 = 10_000_000n; // $10.00

const RAW_UNITS = /^\d+$/;
const BOTH_FORMS = 'Use raw 6-decimal units (10000000) or a dollar string ($10.00).';

/** SPEC 9.1 grammar, for an environment variable. */
export function parseUsdc6Env(value: string, name: string): Usdc6 {
  const trimmed = value.trim();
  if (RAW_UNITS.test(trimmed)) return BigInt(trimmed);
  let parsed: Usdc6;
  try {
    parsed = parseUsd(trimmed);
  } catch {
    throw new CliError(`${name} is not an amount: ${value}`, BOTH_FORMS);
  }
  if (parsed < 0n) throw new CliError(`${name} must not be negative: ${value}`, BOTH_FORMS);
  return parsed;
}

/**
 * A flag documented as `<usd>` is dollars and nothing else (SPEC 9.1). Sharing
 * the environment's dual grammar here would silently reread "--allowance 10" as
 * ten micro-USDC, which approves a cap that dies at the first reap.
 */
export function parseUsdFlag(value: string, flag: string): Usdc6 {
  let parsed: Usdc6;
  try {
    parsed = parseUsd(value);
  } catch {
    throw new CliError(`--${flag} is not an amount: ${value}`, `Amounts are dollars: --${flag} 10, or --${flag} 0.25.`);
  }
  if (parsed < 0n) throw new CliError(`--${flag} must not be negative: ${value}`, `Amounts are dollars: --${flag} 10.`);
  return parsed;
}
