/**
 * A minimal QR encoder, byte mode, versions 1-10, EC levels L and M.
 *
 * Hand-rolled because the funding step has to work from a phone camera and no
 * QR dependency is installed.
 *
 * This module stays free of relative imports so the round-trip test can run
 * under node's type stripping, which does not remap ".js" onto ".ts". Terminal
 * rendering lives in ./render.ts.
 */

export type EcLevel = 'L' | 'M';

export interface QrCode {
  version: number;
  size: number;
  /** Row-major, 1 = dark. */
  modules: Uint8Array;
  get(x: number, y: number): boolean;
}

/** total codewords per version (data + ec), versions 1-10. */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

interface BlockSpec {
  ecPerBlock: number;
  g1Blocks: number;
  g1Data: number;
  g2Blocks: number;
  g2Data: number;
}

/** ISO/IEC 18004 table 13-22, restricted to the versions this CLI needs. */
const BLOCKS: Record<EcLevel, readonly BlockSpec[]> = {
  L: [
    { ecPerBlock: 7, g1Blocks: 1, g1Data: 19, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 10, g1Blocks: 1, g1Data: 34, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 15, g1Blocks: 1, g1Data: 55, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 20, g1Blocks: 1, g1Data: 80, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 26, g1Blocks: 1, g1Data: 108, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 18, g1Blocks: 2, g1Data: 68, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 20, g1Blocks: 2, g1Data: 78, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 24, g1Blocks: 2, g1Data: 97, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 30, g1Blocks: 2, g1Data: 116, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 18, g1Blocks: 2, g1Data: 68, g2Blocks: 2, g2Data: 69 },
  ],
  M: [
    { ecPerBlock: 10, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 16, g1Blocks: 1, g1Data: 28, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 26, g1Blocks: 1, g1Data: 44, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 18, g1Blocks: 2, g1Data: 32, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 24, g1Blocks: 2, g1Data: 43, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 16, g1Blocks: 4, g1Data: 27, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 18, g1Blocks: 4, g1Data: 31, g2Blocks: 0, g2Data: 0 },
    { ecPerBlock: 22, g1Blocks: 2, g1Data: 38, g2Blocks: 2, g2Data: 39 },
    { ecPerBlock: 22, g1Blocks: 3, g1Data: 36, g2Blocks: 2, g2Data: 37 },
    { ecPerBlock: 26, g1Blocks: 4, g1Data: 43, g2Blocks: 1, g2Data: 44 },
  ],
};

export const MAX_VERSION = 10;

// --- GF(256), primitive polynomial 0x11D -----------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255] ?? 0;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[((LOG[a] ?? 0) + (LOG[b] ?? 0)) % 255] ?? 0;
}

function rsGenerator(degree: number): Uint8Array {
  let poly = Uint8Array.from([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      const coef = poly[j] ?? 0;
      next[j] = (next[j] ?? 0) ^ coef;
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(coef, EXP[i] ?? 0);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGenerator(ecLen);
  const rem = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ (rem[0] ?? 0);
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) rem[j] = (rem[j] ?? 0) ^ gfMul(gen[j + 1] ?? 0, factor);
  }
  return rem;
}

// --- bit stream -------------------------------------------------------------

class BitBuffer {
  private readonly bits: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    for (let i = 0; i < this.bits.length; i++) {
      if (this.bits[i] === 1) bytes[i >>> 3] = (bytes[i >>> 3] ?? 0) | (0x80 >>> (i & 7));
    }
    return bytes;
  }
}

function dataCodewords(version: number, ec: EcLevel): number {
  const spec = BLOCKS[ec][version - 1];
  if (spec === undefined) throw new Error(`qr: unsupported version ${version}`);
  return spec.g1Blocks * spec.g1Data + spec.g2Blocks * spec.g2Data;
}

function pickVersion(byteLength: number, ec: EcLevel): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const countBits = version < 10 ? 8 : 16;
    const capacity = dataCodewords(version, ec) * 8 - 4 - countBits;
    if (byteLength * 8 <= capacity) return version;
  }
  throw new Error(`qr: payload too long (${byteLength} bytes) for version ${MAX_VERSION}`);
}

function buildCodewords(bytes: Uint8Array, version: number, ec: EcLevel): Uint8Array {
  const spec = BLOCKS[ec][version - 1];
  if (spec === undefined) throw new Error(`qr: unsupported version ${version}`);
  const total = dataCodewords(version, ec);

  const bb = new BitBuffer();
  bb.push(0b0100, 4); // byte mode
  bb.push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) bb.push(b, 8);
  const terminator = Math.min(4, total * 8 - bb.length);
  bb.push(0, terminator);
  bb.push(0, (8 - (bb.length % 8)) % 8);

  const data = new Uint8Array(total);
  const encoded = bb.toBytes();
  data.set(encoded);
  for (let i = encoded.length, pad = 0; i < total; i++, pad++) {
    data[i] = pad % 2 === 0 ? 0xec : 0x11;
  }

  // Split into blocks, compute ECC, then interleave both halves.
  const blocks: Uint8Array[] = [];
  const eccs: Uint8Array[] = [];
  let offset = 0;
  const layout: Array<[count: number, size: number]> = [
    [spec.g1Blocks, spec.g1Data],
    [spec.g2Blocks, spec.g2Data],
  ];
  for (const [count, size] of layout) {
    for (let b = 0; b < count; b++) {
      const block = data.subarray(offset, offset + size);
      offset += size;
      blocks.push(block);
      eccs.push(rsRemainder(block, spec.ecPerBlock));
    }
  }

  const out = new Uint8Array(TOTAL_CODEWORDS[version - 1] ?? 0);
  let k = 0;
  const maxData = Math.max(spec.g1Data, spec.g2Data);
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) {
      const v = block[i];
      if (v !== undefined) out[k++] = v;
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const ecc of eccs) out[k++] = ecc[i] ?? 0;
  }
  return out;
}

// --- matrix -----------------------------------------------------------------

function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

class Matrix {
  readonly size: number;
  readonly modules: Uint8Array;
  readonly reserved: Uint8Array;

  constructor(version: number) {
    this.size = version * 4 + 17;
    this.modules = new Uint8Array(this.size * this.size);
    this.reserved = new Uint8Array(this.size * this.size);
  }

  get(x: number, y: number): boolean {
    return this.modules[y * this.size + x] === 1;
  }

  set(x: number, y: number, dark: boolean): void {
    this.modules[y * this.size + x] = dark ? 1 : 0;
  }

  isReserved(x: number, y: number): boolean {
    return this.reserved[y * this.size + x] === 1;
  }

  setFunction(x: number, y: number, dark: boolean): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    this.set(x, y, dark);
    this.reserved[y * this.size + x] = 1;
  }
}

function drawFinder(m: Matrix, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      m.setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignment(m: Matrix, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      m.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function formatBits(ec: EcLevel, mask: number): number {
  const ecBits = ec === 'L' ? 0b01 : 0b00;
  const data = (ecBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const bitAt = (value: number, i: number): boolean => ((value >>> i) & 1) === 1;

function drawFormat(m: Matrix, ec: EcLevel, mask: number): void {
  const bits = formatBits(ec, mask);
  const size = m.size;
  for (let i = 0; i <= 5; i++) m.setFunction(8, i, bitAt(bits, i));
  m.setFunction(8, 7, bitAt(bits, 6));
  m.setFunction(8, 8, bitAt(bits, 7));
  m.setFunction(7, 8, bitAt(bits, 8));
  for (let i = 9; i < 15; i++) m.setFunction(14 - i, 8, bitAt(bits, i));

  for (let i = 0; i < 8; i++) m.setFunction(size - 1 - i, 8, bitAt(bits, i));
  for (let i = 8; i < 15; i++) m.setFunction(8, size - 15 + i, bitAt(bits, i));
  m.setFunction(8, size - 8, true); // always dark
}

function drawFunctionPatterns(m: Matrix, version: number, ec: EcLevel): void {
  const size = m.size;
  for (let i = 0; i < size; i++) {
    m.setFunction(6, i, i % 2 === 0);
    m.setFunction(i, 6, i % 2 === 0);
  }
  drawFinder(m, 3, 3);
  drawFinder(m, size - 4, 3);
  drawFinder(m, 3, size - 4);

  const positions = alignmentPositions(version);
  const last = positions.length - 1;
  for (let i = 0; i <= last; i++) {
    for (let j = 0; j <= last; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue;
      const cx = positions[i];
      const cy = positions[j];
      if (cx === undefined || cy === undefined) continue;
      drawAlignment(m, cx, cy);
    }
  }

  drawFormat(m, ec, 0); // placeholder, rewritten once the mask is chosen

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = bitAt(bits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      m.setFunction(a, b, bit);
      m.setFunction(b, a, bit);
    }
  }
}

function drawCodewords(m: Matrix, codewords: Uint8Array): void {
  const size = m.size;
  let i = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is never data
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!m.isReserved(x, y) && i < totalBits) {
          const byte = codewords[i >>> 3] ?? 0;
          m.set(x, y, ((byte >>> (7 - (i & 7))) & 1) === 1);
          i++;
        }
      }
    }
  }
}

function maskFn(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(m: Matrix, mask: number): void {
  for (let y = 0; y < m.size; y++) {
    for (let x = 0; x < m.size; x++) {
      if (m.isReserved(x, y)) continue;
      if (maskFn(mask, x, y)) m.set(x, y, !m.get(x, y));
    }
  }
}

/** 1:1:3:1:1 finder proportions with four light modules on one side. */
const FINDER_A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
const FINDER_B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];

function penalty(m: Matrix): number {
  const size = m.size;
  let score = 0;

  // Rule 1: runs of five or more same-coloured modules.
  const runScore = (run: number): number => (run >= 5 ? run - 2 : 0);
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (m.get(x, y) === m.get(x - 1, y)) run++;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (m.get(x, y) === m.get(x, y - 1)) run++;
      else {
        score += runScore(run);
        run = 1;
      }
    }
    score += runScore(run);
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const a = m.get(x, y);
      if (a === m.get(x + 1, y) && a === m.get(x, y + 1) && a === m.get(x + 1, y + 1)) score += 3;
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules on a side.
  const matches = (read: (i: number) => boolean, at: number, template: number[]): boolean => {
    for (let k = 0; k < template.length; k++) {
      if (read(at + k) !== (template[k] === 1)) return false;
    }
    return true;
  };
  for (let y = 0; y < size; y++) {
    const read = (i: number): boolean => m.get(i, y);
    for (let x = 0; x + 11 <= size; x++) {
      if (matches(read, x, FINDER_A) || matches(read, x, FINDER_B)) score += 40;
    }
  }
  for (let x = 0; x < size; x++) {
    const read = (i: number): boolean => m.get(x, i);
    for (let y = 0; y + 11 <= size; y++) {
      if (matches(read, y, FINDER_A) || matches(read, y, FINDER_B)) score += 40;
    }
  }

  // Rule 4: deviation from an even split of dark and light.
  let dark = 0;
  for (const v of m.modules) if (v === 1) dark++;
  const total = size * size;
  score += Math.floor(Math.abs(dark * 100 - total * 50) / (total * 5)) * 10;

  return score;
}

export function encodeQr(text: string, ec: EcLevel = 'M'): QrCode {
  const bytes = new TextEncoder().encode(text);
  const version = pickVersion(bytes.length, ec);
  const codewords = buildCodewords(bytes, version, ec);

  let best: Matrix | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask++) {
    const m = new Matrix(version);
    drawFunctionPatterns(m, version, ec);
    drawCodewords(m, codewords);
    applyMask(m, mask);
    drawFormat(m, ec, mask);
    const score = penalty(m);
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  if (best === null) throw new Error('qr: no mask selected');
  const chosen = best;

  return {
    version,
    size: chosen.size,
    modules: chosen.modules,
    get: (x: number, y: number): boolean => chosen.get(x, y),
  };
}

/**
 * Encoder internals, exported for the round-trip test only. The test decodes a
 * generated matrix back to its payload and checks every Reed-Solomon block, so
 * it needs the same geometry and block layout the encoder used.
 */
export const qrInternals = {
  blockSpec: (version: number, ec: EcLevel): BlockSpec => {
    const spec = BLOCKS[ec][version - 1];
    if (spec === undefined) throw new Error(`qr: unsupported version ${version}`);
    return spec;
  },
  totalCodewords: (version: number): number => TOTAL_CODEWORDS[version - 1] ?? 0,
  formatBits,
  maskFn,
  rsRemainder,
  /** 1 where a module is a function pattern and therefore not data. */
  reservedMap: (version: number, ec: EcLevel): Uint8Array => {
    const m = new Matrix(version);
    drawFunctionPatterns(m, version, ec);
    return m.reserved;
  },
};

/** Plain text fallback: the matrix as '#' and '.', for tests and debugging. */
export function qrToAscii(code: QrCode): string[] {
  const lines: string[] = [];
  for (let y = 0; y < code.size; y++) {
    let line = '';
    for (let x = 0; x < code.size; x++) line += code.get(x, y) ? '#' : '.';
    lines.push(line);
  }
  return lines;
}
