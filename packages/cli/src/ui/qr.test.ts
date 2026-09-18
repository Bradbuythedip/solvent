/**
 * Round-trip test for the hand-rolled QR encoder.
 *
 * A QR code that does not scan is worse than no QR code at all: the spawn flow
 * would look finished while the operator's phone sees nothing. So this decodes
 * the generated matrix the way a reader does — recover the mask from the format
 * bits, unmask, walk the zigzag, de-interleave the blocks — and then checks each
 * Reed-Solomon block's remainder is zero before comparing the payload.
 *
 * Node's type stripping does not remap a ".js" specifier onto a ".ts" file, so
 * this file imports "./qr.ts" directly. It is excluded from tsconfig, so the
 * package's ".js" import convention is untouched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeQr, qrInternals, qrToAscii, type EcLevel, type QrCode } from './qr.ts';

function recoverMask(code: QrCode, ec: EcLevel): number {
  const size = code.size;
  const positions: Array<[number, number]> = [];
  for (let i = 0; i <= 5; i++) positions.push([8, i]);
  positions.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i < 15; i++) positions.push([14 - i, 8]);

  for (let mask = 0; mask < 8; mask++) {
    const bits = qrInternals.formatBits(ec, mask);
    let match = true;
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      if (p === undefined) continue;
      const expected = ((bits >>> i) & 1) === 1;
      if (code.get(p[0], p[1]) !== expected) {
        match = false;
        break;
      }
    }
    if (match) {
      // The second copy must agree, otherwise the format info is inconsistent.
      for (let i = 0; i < 8; i++) {
        assert.equal(code.get(size - 1 - i, 8), ((bits >>> i) & 1) === 1, 'format copy 2 (horizontal)');
      }
      for (let i = 8; i < 15; i++) {
        assert.equal(code.get(8, size - 15 + i), ((bits >>> i) & 1) === 1, 'format copy 2 (vertical)');
      }
      return mask;
    }
  }
  throw new Error('no mask matched the format bits');
}

function readCodewords(code: QrCode, ec: EcLevel): Uint8Array {
  const size = code.size;
  const mask = recoverMask(code, ec);
  const reserved = qrInternals.reservedMap(code.version, ec);
  const total = qrInternals.totalCodewords(code.version);
  const out = new Uint8Array(total);

  let i = 0;
  const totalBits = total * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y * size + x] === 1 || i >= totalBits) continue;
        const masked = code.get(x, y);
        const bit = qrInternals.maskFn(mask, x, y) ? !masked : masked;
        if (bit) out[i >>> 3] = (out[i >>> 3] ?? 0) | (0x80 >>> (i & 7));
        i++;
      }
    }
  }
  assert.equal(i, totalBits, 'zigzag consumed every codeword bit');
  return out;
}

function decode(code: QrCode, ec: EcLevel): string {
  const raw = readCodewords(code, ec);
  const spec = qrInternals.blockSpec(code.version, ec);

  const sizes: number[] = [];
  for (let b = 0; b < spec.g1Blocks; b++) sizes.push(spec.g1Data);
  for (let b = 0; b < spec.g2Blocks; b++) sizes.push(spec.g2Data);
  const blocks = sizes.map((n) => new Uint8Array(n));

  let k = 0;
  const maxData = Math.max(spec.g1Data, spec.g2Data);
  for (let i = 0; i < maxData; i++) {
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      if (block === undefined || i >= block.length) continue;
      block[i] = raw[k++] ?? 0;
    }
  }
  const eccs = sizes.map(() => new Uint8Array(spec.ecPerBlock));
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const ecc of eccs) ecc[i] = raw[k++] ?? 0;
  }
  assert.equal(k, raw.length, 'de-interleave consumed every codeword');

  // A correct codeword block leaves a zero remainder.
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    const ecc = eccs[b];
    if (block === undefined || ecc === undefined) continue;
    const check = new Uint8Array(block.length + ecc.length);
    check.set(block);
    check.set(ecc, block.length);
    const remainder = qrInternals.rsRemainder(check, spec.ecPerBlock);
    assert.ok(
      remainder.every((v) => v === 0),
      `Reed-Solomon remainder is zero for block ${b}`,
    );
  }

  const data = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const block of blocks) {
    data.set(block, offset);
    offset += block.length;
  }

  const mode = (data[0] ?? 0) >>> 4;
  assert.equal(mode, 0b0100, 'byte mode');
  const countBits = code.version < 10 ? 8 : 16;
  assert.equal(countBits, 8, 'versions under 10 use an 8-bit count');
  const length = (((data[0] ?? 0) & 0x0f) << 4) | ((data[1] ?? 0) >>> 4);
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    bytes[i] = (((data[1 + i] ?? 0) & 0x0f) << 4) | ((data[2 + i] ?? 0) >>> 4);
  }
  return new TextDecoder().decode(bytes);
}

const PAYLOADS = [
  '0x3600000000000000000000000000000000000000',
  '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  'solvent',
  'https://solvent.arc/agent/42',
];

for (const ec of ['L', 'M'] as const) {
  for (const payload of PAYLOADS) {
    test(`round-trips ${payload.slice(0, 24)} at EC ${ec}`, () => {
      const code = encodeQr(payload, ec);
      assert.equal(code.size, code.version * 4 + 17);
      assert.equal(decode(code, ec), payload);
    });
  }
}

test('an Arc address picks a version that fits', () => {
  const code = encodeQr('0x3600000000000000000000000000000000000000', 'M');
  assert.equal(code.version, 3); // 42 bytes is exactly version 3-M capacity
  assert.equal(code.size, 29);
});

test('finder patterns sit in three corners', () => {
  const rows = qrToAscii(encodeQr('0x3600000000000000000000000000000000000000', 'M'));
  const size = rows.length;
  const corners: Array<[number, number]> = [
    [0, 0],
    [size - 7, 0],
    [0, size - 7],
  ];
  for (const [ox, oy] of corners) {
    for (let y = 0; y < 7; y++) {
      const row = rows[oy + y];
      assert.ok(row !== undefined);
      for (let x = 0; x < 7; x++) {
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        const expected = ring !== 2 ? '#' : '.';
        assert.equal(row[ox + x], expected, `finder at ${ox},${oy} module ${x},${y}`);
      }
    }
  }
});

test('refuses a payload beyond version 10', () => {
  assert.throws(() => encodeQr('x'.repeat(400), 'M'), /too long/);
});
