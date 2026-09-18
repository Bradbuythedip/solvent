/**
 * requestHash is what makes an x402 receipt mean something: it binds a payment
 * to one method, one URL, one body and one nonce. These tests pin that binding,
 * the header codec, and the two computed numbers a brain is handed - runway and
 * a discovered price.
 *
 *   node --test --experimental-strip-types src/x402/x402.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bodyHashOf, canonicalUrl, randomNonce, requestHashOf } from './hash.ts';
import { decodePaymentHeader, encodePaymentHeader, parseRequirements } from './types.ts';
import type { PaymentPayload } from './types.ts';
import { localRunwaySeconds } from '../wallet.ts';
import { priceOfAccept } from '../discovery.ts';

const NONCE = '0x' + '11'.repeat(32);

describe('requestHash', () => {
  it('is stable for identical inputs', () => {
    const parts = { method: 'GET', url: 'https://a.example/x', bodyHash: bodyHashOf(''), nonce: NONCE as `0x${string}` };
    assert.equal(requestHashOf(parts), requestHashOf(parts));
  });

  it('changes when any one input changes', () => {
    const base = { method: 'GET', url: 'https://a.example/x', bodyHash: bodyHashOf(''), nonce: NONCE as `0x${string}` };
    const baseline = requestHashOf(base);
    assert.notEqual(requestHashOf({ ...base, url: 'https://a.example/y' }), baseline);
    assert.notEqual(requestHashOf({ ...base, bodyHash: bodyHashOf('payload') }), baseline);
    assert.notEqual(requestHashOf({ ...base, nonce: randomNonce() }), baseline);
  });

  it('normalises the URL the same way on both sides', () => {
    assert.equal(canonicalUrl('https://a.example/x#frag'), 'https://a.example/x');
  });
});

describe('X-PAYMENT header', () => {
  const payload: PaymentPayload = {
    x402Version: 1,
    scheme: 'solvent-service-meter',
    requestHash: '0xabc',
    method: 'GET',
    url: 'https://a.example/x',
    bodyHash: bodyHashOf(''),
    nonce: NONCE as `0x${string}`,
    payerAgentId: 4,
    amount6: '10000',
    txHash: '0xdead',
  };

  it('round-trips', () => {
    assert.deepEqual(decodePaymentHeader(encodePaymentHeader(payload)), payload);
  });

  it('returns null on rubbish', () => {
    assert.equal(decodePaymentHeader('not base64 json'), null);
  });
});

describe('payment requirements', () => {
  it('rejects a quote with no price or no payee', () => {
    assert.equal(parseRequirements({ price6: 'free' }), null);
    assert.equal(parseRequirements({ price6: '1000' }), null);
  });

  it('accepts a well-formed quote', () => {
    const parsed = parseRequirements({
      price6: '10000',
      payTo: { serviceMeter: '0x3333333333333333333333333333333333333333', providerAgentId: 9, wallet: '0x44' },
      network: { chainId: 5042002, name: 'Arc Testnet' },
    });
    assert.notEqual(parsed, null);
    assert.equal(parsed?.payTo.providerAgentId, 9);
  });
});

describe('runway', () => {
  it('is bounded by the allowance, not just the balance', () => {
    // $1.00 balance but only $0.10 approved: rent can only ever take $0.10.
    const seconds = localRunwaySeconds({
      balance6: 1_000_000n,
      allowance6: 100_000n,
      owed6: 0n,
      rentPerHour6: 10_000n,
    });
    assert.equal(seconds, 10 * 3600);
  });

  it('is zero once the debt exceeds what can be paid', () => {
    assert.equal(
      localRunwaySeconds({ balance6: 5_000n, allowance6: 5_000n, owed6: 10_000n, rentPerHour6: 10_000n }),
      0,
    );
  });

  it('encodes no burn rate as -1', () => {
    assert.equal(localRunwaySeconds({ balance6: 1n, allowance6: 1n, owed6: 0n, rentPerHour6: 0n }), -1);
  });
});

describe('discovered prices', () => {
  it('reads a 6-decimal USDC quote', () => {
    assert.equal(
      priceOfAccept({ maxAmountRequired: '10000', asset: '0x3600000000000000000000000000000000000000' }),
      10_000n,
    );
  });

  it('rescales a declared decimals field down to 6', () => {
    assert.equal(priceOfAccept({ maxAmountRequired: '1000000000000000000', extra: { decimals: 18 } }), 1_000_000n);
  });

  it('returns null when the asset and decimals are both unknown', () => {
    assert.equal(priceOfAccept({ maxAmountRequired: '10000', asset: '0x9999999999999999999999999999999999999999' }), null);
  });
});
