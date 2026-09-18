/**
 * SPEC 9.1: one grammar for a _6 environment variable, and a message rather than
 * a stack trace when the value does not match it.
 *
 * "solvent spawn" writes SOLVENT_ALLOWANCE_CAP_6 and the agent runtime reads it
 * back, so the two packages have to agree on what the operator typed - this one
 * sets how much USDC Metabolism may take. spawn used to hand the raw value
 * straight to BigInt(), which dies on "$25.00" with a SyntaxError before the
 * first numbered step, before any output, and without naming the variable.
 *
 * Node's type stripping does not remap a ".js" specifier onto a ".ts" file, so
 * the resolver hook below does it rather than weakening the package convention.
 *
 *   node --test --experimental-strip-types src/lib/money.test.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { describe, it } from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromSource = context.parentURL?.endsWith('.ts') === true;
    const remapped = fromSource && specifier.startsWith('.') && specifier.endsWith('.js')
      ? `${specifier.slice(0, -3)}.ts`
      : specifier;
    return nextResolve(remapped, context);
  },
});

const { DEFAULT_ALLOWANCE_CAP_6, parseUsdc6Env, parseUsdFlag, UNBOUNDED_ALLOWANCE_FLOOR_6 } =
  await import('./money.ts');
const { CliError } = await import('./errors.ts');

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    assert.equal(error instanceof CliError, true, `expected a CliError, got ${String(error)}`);
    const cli = error as InstanceType<typeof CliError>;
    assert.notEqual(cli.remedy, undefined, 'an operator-fixable error needs a remedy');
    return `${cli.message} ${cli.remedy ?? ''}`;
  }
  return assert.fail('the value was accepted');
}

describe('SOLVENT_ALLOWANCE_CAP_6 has one grammar (SPEC 9.1)', () => {
  it('reads bare digits as raw 6-decimal units', () => {
    assert.equal(parseUsdc6Env('10000000', 'SOLVENT_ALLOWANCE_CAP_6'), 10_000_000n);
    assert.equal(parseUsdc6Env(' 50000 ', 'SOLVENT_ALLOWANCE_CAP_6'), 50_000n);
    assert.equal(DEFAULT_ALLOWANCE_CAP_6, 10_000_000n);
  });

  it('reads anything else as dollars, the way the agent does', () => {
    assert.equal(parseUsdc6Env('$25.00', 'SOLVENT_ALLOWANCE_CAP_6'), 25_000_000n);
    assert.equal(parseUsdc6Env('25.00', 'SOLVENT_ALLOWANCE_CAP_6'), 25_000_000n);
    assert.equal(parseUsdc6Env('$1,200.50', 'SOLVENT_ALLOWANCE_CAP_6'), 1_200_500_000n);
  });

  it('names the variable and both forms instead of throwing a SyntaxError', () => {
    for (const bad of ['10_000_000', 'ten dollars', '$', '']) {
      const text = refusal(() => parseUsdc6Env(bad, 'SOLVENT_ALLOWANCE_CAP_6'));
      assert.equal(text.includes('SOLVENT_ALLOWANCE_CAP_6'), true, text);
      assert.equal(text.includes('10000000'), true, text);
      assert.equal(text.includes('$10.00'), true, text);
    }
  });

  it('refuses a negative cap', () => {
    assert.equal(refusal(() => parseUsdc6Env('-5', 'SOLVENT_ALLOWANCE_CAP_6')).includes('negative'), true);
  });
});

describe('a <usd> flag stays dollars (SPEC 9.1)', () => {
  it('reads --allowance 10 as ten dollars, not ten micro-USDC', () => {
    // The environment's dual grammar must not leak onto the flags: "10" here has
    // meant $10 since the first release, and 10n would be a cap that dies at the
    // first reap.
    assert.equal(parseUsdFlag('10', 'allowance'), 10_000_000n);
    assert.equal(parseUsdFlag('0.25', 'gas-buffer'), 250_000n);
  });

  it('refuses nonsense with a remedy rather than a stack trace', () => {
    assert.equal(refusal(() => parseUsdFlag('abc', 'allowance')).includes('--allowance'), true);
    assert.equal(refusal(() => parseUsdFlag('-1', 'amount')).includes('negative'), true);
  });
});

describe('"unbounded" is one number (SPEC 9.2)', () => {
  it('is 2^128', () => {
    assert.equal(UNBOUNDED_ALLOWANCE_FLOOR_6, 1n << 128n);
  });

  it('catches the Permit2 shape', () => {
    // type(uint160).max is the approval a wallet UI or a Permit2-shaped script
    // grants. It has to trip every gate, not just the CLI's.
    assert.equal((1n << 160n) - 1n >= UNBOUNDED_ALLOWANCE_FLOOR_6, true);
    assert.equal((1n << 256n) - 1n >= UNBOUNDED_ALLOWANCE_FLOOR_6, true);
    assert.equal(10_000_000n >= UNBOUNDED_ALLOWANCE_FLOOR_6, false);
  });

  it('is the same number the agent runtime rails on', () => {
    // The two packages share only @solvent/core, so nothing can import one
    // constant into both. SPEC 9.2 is the contract; this reads the other copy to
    // catch the drift it is meant to prevent. Skipped where the agent source is
    // not on disk, e.g. the CLI installed on its own from npm.
    let source: string;
    try {
      source = readFileSync(new URL('../../../agent/src/wallet.ts', import.meta.url), 'utf8');
    } catch {
      return;
    }
    const declared = /UNBOUNDED_ALLOWANCE_FLOOR_6\s*:\s*Usdc6\s*=\s*1n\s*<<\s*(\d+)n/.exec(source);
    assert.notEqual(declared, null, 'could not find the agent floor to compare against');
    assert.equal(1n << BigInt(declared?.[1] ?? '0'), UNBOUNDED_ALLOWANCE_FLOOR_6);
  });
});
