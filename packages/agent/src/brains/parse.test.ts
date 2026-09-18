/**
 * The parser is the trust boundary between a language model and a wallet.
 * These tests pin the clamps, not the prompt.
 *
 *   node --test --experimental-strip-types src/brains/parse.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Bounty } from '@solvent/core';
import { buildUserPrompt, extractJson, isBuyableUrl, parseAction } from './shared.ts';
import type { AgentContext } from './types.ts';

const OPEN_BOUNTY: Bounty = {
  id: 3,
  poster: '0x1111111111111111111111111111111111111111',
  reward6: '2000000',
  deadline: 2_000_000,
  reviewWindow: 86_400,
  specURI: 'ipfs://spec',
  specHash: '0x00',
  title: 'a bounty',
  state: 'OPEN',
  claimantAgentId: null,
  claimantHandle: null,
  deliverableURI: null,
  submittedAt: null,
  txHash: '0xfeed',
};

const ctx: AgentContext = {
  agentId: 1,
  wallet: '0x2222222222222222222222222222222222222222',
  now: 1_000_000,
  balance6: 9_000_000n,
  owedRent6: 0n,
  allowance6: 10_000_000n,
  rentPerHour6: 10_000n,
  runwaySeconds: 3600,
  earned6: 0n,
  burned6: 0n,
  price6: 10_000n,
  maxSpendPerAction6: 50_000n,
  bounties: [OPEN_BOUNTY],
  services: [],
  committed: [],
  recent: [],
};

describe('extractJson', () => {
  it('finds the object inside a fenced, chatty reply', () => {
    const raw = 'Sure!\n```json\n{"kind":"idle","seconds":30,"reason":"x"}\n```\nHope that helps.';
    assert.equal(extractJson(raw), '{"kind":"idle","seconds":30,"reason":"x"}');
  });

  it('survives braces inside strings', () => {
    assert.equal(extractJson('{"reason":"} not the end"}'), '{"reason":"} not the end"}');
  });

  it('returns null when there is no object', () => {
    assert.equal(extractJson('no json here'), null);
  });
});

describe('parseAction', () => {
  it('clamps a purchase to the per-action cap', () => {
    const result = parseAction('{"kind":"buy-service","url":"https://x.example/a","maxPrice6":"999999999"}', ctx);
    assert.equal(result.ok, true);
    if (result.ok && result.action.kind === 'buy-service') {
      assert.equal(result.action.maxPrice6, ctx.maxSpendPerAction6);
    }
  });

  it('clamps idle seconds into range', () => {
    const result = parseAction('{"kind":"idle","seconds":99999,"reason":"nap"}', ctx);
    assert.equal(result.ok, true);
    if (result.ok && result.action.kind === 'idle') assert.equal(result.action.seconds, 3600);
  });

  it('rejects a bounty that is not on the board', () => {
    const result = parseAction('{"kind":"bid-bounty","bountyId":99,"plan":"p"}', ctx);
    assert.equal(result.ok, false);
  });

  it('rejects a non-https service URL', () => {
    assert.equal(isBuyableUrl('http://evil.example/x'), false);
    assert.equal(isBuyableUrl('https://ok.example/x'), true);
    const result = parseAction('{"kind":"buy-service","url":"ftp://x/a","maxPrice6":"1"}', ctx);
    assert.equal(result.ok, false);
  });

  it('downgrades retire to idle unless retiring was allowed', () => {
    const refused = parseAction('{"kind":"retire","reason":"bored"}', ctx);
    assert.equal(refused.ok, true);
    if (refused.ok) assert.equal(refused.action.kind, 'idle');

    const allowed = parseAction('{"kind":"retire","reason":"bored"}', ctx, { allowRetire: true });
    assert.equal(allowed.ok, true);
    if (allowed.ok) assert.equal(allowed.action.kind, 'retire');
  });

  it('rejects an unknown kind', () => {
    assert.equal(parseAction('{"kind":"transfer-everything"}', ctx).ok, false);
  });
});

describe('buildUserPrompt', () => {
  it('serialises an action history that contains bigints', () => {
    const withHistory = {
      ...ctx,
      recent: [
        { kind: 'set-price' as const, price6: 10_000n },
        { kind: 'buy-service' as const, url: 'https://x.example/a', maxPrice6: 50_000n, payload: null },
      ],
    };
    const prompt = buildUserPrompt(withHistory);
    assert.match(prompt, /"price6": "10000"/);
    assert.match(prompt, /"maxPrice6": "50000"/);
  });
});
