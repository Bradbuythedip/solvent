/**
 * A mistyped --key must never reach an error message.
 *
 * resolveKey dispatches on shape alone, so anything that is not exactly 64 hex
 * characters falls through to the path branch - and that branch prints what it
 * was given. An operator who loses one character from a paste would otherwise
 * put 63 of a live wallet's 64 nibbles into stderr, the CI transcript and
 * anything shipping those logs, and one missing nibble is not a brute force.
 * These tests feed the malformed shapes and assert that nothing recognisable
 * survives into the message or its remedy.
 *
 * Node's type stripping does not remap a ".js" specifier onto a ".ts" file, so
 * the resolver hook below does it rather than weakening the package convention.
 *
 *   node --test --experimental-strip-types src/lib/keys.test.ts
 */

import assert from 'node:assert/strict';
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

const { normalisePrivateKey, resolveKey } = await import('./keys.ts');
const { CliError } = await import('./errors.ts');

/** Never funded, never used. Only its shape matters here. */
const KEY = `${'c0ffee'.repeat(10)}dead`;

const ENV_PATH = '/nonexistent/solvent/.env';

/** No 8-character window of the secret may survive into the text. */
function assertNoLeak(secret: string, text: string): void {
  assert.equal(secret.length >= 8, true);
  for (let i = 0; i + 8 <= secret.length; i += 1) {
    const window = secret.slice(i, i + 8);
    assert.equal(text.includes(window), false, `"${window}" leaked into: ${text}`);
  }
}

function refusal(spec: string | undefined, env: Record<string, string> = {}): string {
  try {
    resolveKey({ spec, env, envPath: ENV_PATH, allowGenerate: false });
  } catch (error) {
    assert.equal(error instanceof CliError, true, `expected a CliError, got ${String(error)}`);
    const cli = error as InstanceType<typeof CliError>;
    return `${cli.message} ${cli.remedy ?? ''}`;
  }
  return assert.fail('resolveKey accepted a malformed key');
}

describe('a malformed --key never reaches the error', () => {
  it('holds for a paste that lost its last character', () => {
    assert.equal(KEY.length, 64);
    const truncated = `0x${KEY.slice(0, -1)}`;
    assertNoLeak(KEY.slice(0, -1), refusal(truncated));
  });

  it('holds for a paste that gained a character', () => {
    // The worst case: this one carries all 64 nibbles, so there is nothing left
    // to brute force.
    assertNoLeak(KEY, refusal(`0x${KEY}f`));
  });

  it('holds for a key with a checksum suffix', () => {
    assertNoLeak(KEY, refusal(`0x${KEY}:9f2a`));
  });

  it('holds when the 0x prefix is missing too', () => {
    assertNoLeak(KEY.slice(0, -1), refusal(KEY.slice(0, -1)));
  });

  it('holds for a malformed PRIVATE_KEY in the environment', () => {
    assertNoLeak(KEY, refusal(undefined, { PRIVATE_KEY: `${KEY}zz` }));
  });

  it('holds for normalisePrivateKey called directly', () => {
    try {
      normalisePrivateKey(KEY.slice(0, -1), '--key');
      assert.fail('normalisePrivateKey accepted 63 hex characters');
    } catch (error) {
      const cli = error as InstanceType<typeof CliError>;
      assertNoLeak(KEY.slice(0, -1), `${cli.message} ${cli.remedy ?? ''}`);
    }
  });
});

describe('the path branch still behaves', () => {
  it('names a genuinely missing key file, because a path is not a secret', () => {
    const path = './keys/agent-7.key';
    assert.equal(refusal(path).includes(path), true);
  });

  it('accepts a well-formed key', () => {
    const key = resolveKey({ spec: `0x${KEY}`, env: {}, envPath: ENV_PATH, allowGenerate: false });
    assert.equal(key.origin, '--key (command line)');
    assert.equal(key.privateKey, `0x${KEY}`);
    assert.equal(key.generated, false);
  });
});
