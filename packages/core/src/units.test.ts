/**
 * Unit tests for the USDC money layer.
 *
 * The 6-vs-18 decimal boundary is the one place in this repo where a silent bug is
 * worth exactly 1e12 times the intended amount, so both directions and the ceiling
 * variant are pinned here. The formatters are pinned too: a scoreboard that spans
 * $12,400.00 and $0.000061 in the same column only works if the adaptive precision
 * and the sign glyph behave the same every time.
 *
 * Node's type stripping does not remap a ".js" specifier onto a ".ts" file, so this
 * file imports "./units.ts" directly. It is excluded from tsconfig, so the package's
 * ".js" import convention is untouched.
 *
 *   node --test --experimental-strip-types src/units.test.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NATIVE_PER_USDC6,
  ONE_USD,
  formatDuration,
  formatRunway,
  formatUsd,
  formatUsdCompact,
  fromWire,
  nativeToUsdc6,
  nativeToUsdc6Ceil,
  parseUsd,
  shortHex,
  toWire,
  usdc6ToNative,
} from './units.ts';

/** U+2212 MINUS SIGN — the formatters use the typographic minus, not a hyphen. */
const MINUS = '−';

describe('decimal constants', () => {
  it('pins the Arc conversion factor', () => {
    assert.equal(NATIVE_PER_USDC6, 10n ** 12n);
    assert.equal(ONE_USD, 10n ** 6n);
  });
});

describe('usdc6ToNative', () => {
  it('scales 6-decimal USDC up to 18-decimal native units', () => {
    assert.equal(usdc6ToNative(ONE_USD), 10n ** 18n);
    assert.equal(usdc6ToNative(0n), 0n);
    assert.equal(usdc6ToNative(1n), 1_000_000_000_000n);
    assert.equal(usdc6ToNative(12_400_000_000n), 12_400_000_000n * 10n ** 12n);
  });

  it('carries the sign', () => {
    assert.equal(usdc6ToNative(-1_500_000n), -1_500_000_000_000_000_000n);
  });
});

describe('nativeToUsdc6', () => {
  it('scales 18-decimal native units down to 6-decimal USDC', () => {
    assert.equal(nativeToUsdc6(10n ** 18n), ONE_USD);
    assert.equal(nativeToUsdc6(0n), 0n);
    assert.equal(nativeToUsdc6(1_000_000_000_000n), 1n);
  });

  it('truncates the sub-micro-dollar remainder', () => {
    assert.equal(nativeToUsdc6(1_999_999_999_999n), 1n);
    assert.equal(nativeToUsdc6(999_999_999_999n), 0n);
  });

  it('round-trips every 6-decimal value', () => {
    for (const v of [0n, 1n, 61n, 10_000n, ONE_USD, 12_400_000_000n]) {
      assert.equal(nativeToUsdc6(usdc6ToNative(v)), v);
    }
  });
});

describe('nativeToUsdc6Ceil', () => {
  it('rounds up so value cannot leak through the boundary', () => {
    assert.equal(nativeToUsdc6Ceil(999_999_999_999n), 1n);
    assert.equal(nativeToUsdc6Ceil(1_000_000_000_001n), 2n);
    assert.equal(nativeToUsdc6Ceil(1n), 1n);
  });

  it('agrees with the truncating variant on exact multiples', () => {
    for (const v of [0n, 10n ** 12n, 10n ** 18n, 47n * 10n ** 12n]) {
      assert.equal(nativeToUsdc6Ceil(v), nativeToUsdc6(v));
    }
  });

  it('is never below the truncating variant', () => {
    for (const v of [1n, 999n, 10n ** 12n + 1n, 3_141_592_653_589n]) {
      assert.ok(nativeToUsdc6Ceil(v) >= nativeToUsdc6(v));
    }
  });
});

describe('parseUsd', () => {
  it('parses plain dollar strings', () => {
    assert.equal(parseUsd('10'), 10_000_000n);
    assert.equal(parseUsd('0'), 0n);
    assert.equal(parseUsd('0.0061'), 6_100n);
    assert.equal(parseUsd('0.000061'), 61n);
    assert.equal(parseUsd('12.000061'), 12_000_061n);
  });

  it('accepts dollar signs, commas and surrounding whitespace', () => {
    assert.equal(parseUsd('$1,200.50'), 1_200_500_000n);
    assert.equal(parseUsd('  $9.00  '), 9_000_000n);
    assert.equal(parseUsd('$12,400'), 12_400_000_000n);
  });

  it('accepts negatives and lazy decimal points', () => {
    assert.equal(parseUsd('-3.5'), -3_500_000n);
    assert.equal(parseUsd('.5'), 500_000n);
    assert.equal(parseUsd('7.'), 7_000_000n);
  });

  it('truncates beyond USDC resolution rather than rounding', () => {
    assert.equal(parseUsd('1.99999999'), 1_999_999n);
    assert.equal(parseUsd('0.0000009'), 0n);
  });

  it('round-trips through formatUsd at full precision', () => {
    for (const v of [0n, 61n, 6_100n, 9_000_000n, 12_400_000_000n]) {
      assert.equal(parseUsd(formatUsd(v, { precision: 6 })), v);
    }
  });

  it('rejects anything that is not a number', () => {
    for (const bad of ['', '   ', '.', '$', 'abc', 'NaN', '1e6', '1.2.3', '--5', '0x10', '1/2']) {
      assert.throws(() => parseUsd(bad), /parseUsd/, `expected "${bad}" to throw`);
    }
  });

  // A decimal comma is a different number, not a separator to delete. Reading "12,34"
  // as $1,234 would loosen a rent allowance or SOLVENT_MAX_SPEND_PER_ACTION_6 by 100x.
  it('rejects a comma that is not a thousands separator', () => {
    for (const bad of ['12,34', '1,5', '0,05', '1.234,56', '1,2345', '1,23,4', '1,,,5', ',5', '1,']) {
      assert.throws(() => parseUsd(bad), /parseUsd/, `expected "${bad}" to throw`);
    }
  });

  it('still accepts correctly grouped thousands', () => {
    assert.equal(parseUsd('1,234'), 1_234_000_000n);
    assert.equal(parseUsd('12,345,678.90'), 12_345_678_900_000n);
  });

  it('rejects internal whitespace while still trimming the ends', () => {
    assert.equal(parseUsd('  12.34  '), 12_340_000n);
    for (const bad of ['1 2', '$ 9.00', '1\t2']) {
      assert.throws(() => parseUsd(bad), /parseUsd/, `expected "${bad}" to throw`);
    }
  });

  it('rejects a bare sign or currency symbol instead of reading it as zero', () => {
    for (const bad of ['-', '$-', '-.', '-$']) {
      assert.throws(() => parseUsd(bad), /parseUsd/, `expected "${bad}" to throw`);
    }
  });
});

describe('formatUsd adaptive precision', () => {
  it('uses 2dp at or above a dollar, with thousands separators', () => {
    assert.equal(formatUsd(12_400_000_000n), '$12,400.00');
    assert.equal(formatUsd(1_000_000n), '$1.00');
    assert.equal(formatUsd(1_234_567n), '$1.23');
  });

  it('uses 4dp between a cent and a dollar', () => {
    assert.equal(formatUsd(10_000n), '$0.0100');
    assert.equal(formatUsd(123_456n), '$0.1234');
    assert.equal(formatUsd(999_999n), '$0.9999');
  });

  it('uses full 6dp resolution below a cent', () => {
    assert.equal(formatUsd(9_999n), '$0.009999');
    assert.equal(formatUsd(61n), '$0.000061');
    assert.equal(formatUsd(6n), '$0.000006');
    assert.equal(formatUsd(0n), '$0.000000');
  });

  it('honours an explicit precision and the bare option', () => {
    assert.equal(formatUsd(1_234_567n, { precision: 6 }), '$1.234567');
    assert.equal(formatUsd(1_234_567n, { precision: 0 }), '$1');
    assert.equal(formatUsd(1_500_000n, { bare: true }), '1.50');
  });
});

describe('formatUsd sign glyph', () => {
  it('renders a typographic minus for negatives, always', () => {
    assert.equal(formatUsd(-1_500_000n), `${MINUS}$1.50`);
    assert.equal(formatUsd(-61n), `${MINUS}$0.000061`);
    assert.ok(!formatUsd(-1_500_000n).includes('-'), 'hyphen-minus must not appear');
  });

  it('renders an explicit plus only when asked', () => {
    assert.equal(formatUsd(1_500_000n), '$1.50');
    assert.equal(formatUsd(1_500_000n, { sign: true }), '+$1.50');
    assert.equal(formatUsd(0n, { sign: true }), '+$0.000000');
  });

  it('keeps the minus when a sign is requested', () => {
    assert.equal(formatUsd(-1_500_000n, { sign: true }), `${MINUS}$1.50`);
  });

  it('picks precision from the magnitude, not the sign', () => {
    assert.equal(formatUsd(-123_456n), `${MINUS}$0.1234`);
  });
});

describe('formatUsdCompact', () => {
  it('abbreviates thousands and millions', () => {
    assert.equal(formatUsdCompact(1_200_000_000n), '$1.2K');
    assert.equal(formatUsdCompact(2_500_000_000_000n), '$2.5M');
    assert.equal(formatUsdCompact(1_000_000_000n), '$1.0K');
  });

  it('switches to K exactly at a thousand dollars', () => {
    assert.equal(formatUsdCompact(999_999_999n), '$999.99');
    assert.equal(formatUsdCompact(1_000_000_000n), '$1.0K');
  });

  it('falls through to formatUsd under a thousand dollars', () => {
    assert.equal(formatUsdCompact(12_340_000n), '$12.34');
    assert.equal(formatUsdCompact(61n), '$0.000061');
  });

  it('keeps the sign glyph', () => {
    assert.equal(formatUsdCompact(-1_200_000_000n), `${MINUS}$1.2K`);
    assert.equal(formatUsdCompact(-12_340_000n), `${MINUS}$12.34`);
  });
});

describe('formatDuration', () => {
  it('drops to the two most significant units', () => {
    assert.equal(formatDuration(273_600), '3d 04h');
    assert.equal(formatDuration(86_400), '1d 00h');
    assert.equal(formatDuration(3_661), '1h 01m');
    assert.equal(formatDuration(2_472), '41m 12s');
    assert.equal(formatDuration(59), '59s');
    assert.equal(formatDuration(0), '0s');
  });

  it('switches units exactly on the boundary', () => {
    assert.equal(formatDuration(59.9), '59s');
    assert.equal(formatDuration(60), '1m 00s');
    assert.equal(formatDuration(3_599), '59m 59s');
    assert.equal(formatDuration(3_600), '1h 00m');
    assert.equal(formatDuration(86_399), '23h 59m');
  });

  it('floors fractional seconds', () => {
    assert.equal(formatDuration(90.9), '1m 30s');
  });

  it('renders an em dash for anything that is not a duration', () => {
    assert.equal(formatDuration(-5), '—');
    assert.equal(formatDuration(Number.NaN), '—');
    assert.equal(formatDuration(Number.POSITIVE_INFINITY), '—');
  });
});

describe('formatRunway', () => {
  it('reads null as no runway to speak of', () => {
    assert.equal(formatRunway(null), '—');
  });

  it('reads the -1 wire encoding as infinite', () => {
    assert.equal(formatRunway(-1), '∞');
    assert.equal(formatRunway(-3_600), '∞');
  });

  it('renders zero as a padded second count, not an em dash', () => {
    assert.equal(formatRunway(0), '00s');
  });

  it('otherwise matches formatDuration', () => {
    for (const s of [1, 59, 60, 3_600, 3_661, 273_600]) {
      assert.equal(formatRunway(s), formatDuration(s));
    }
  });
});

describe('shortHex', () => {
  it('elides the middle of an address', () => {
    assert.equal(shortHex('0x3600000000000000000000000000000000000000'), '0x3600…0000');
  });

  it('respects custom lead and tail widths', () => {
    assert.equal(shortHex('0xabcdef0123456789', 4, 6), '0xab…456789');
  });

  it('leaves anything already short enough alone', () => {
    assert.equal(shortHex('0x1234'), '0x1234');
  });
});

describe('wire encoding', () => {
  it('moves bigints across the API as decimal strings', () => {
    assert.equal(toWire(12_400_000_000n), '12400000000');
    assert.equal(toWire(-61n), '-61');
    assert.equal(fromWire('12400000000'), 12_400_000_000n);
    assert.equal(fromWire(toWire(9_000_000n)), 9_000_000n);
  });
});
