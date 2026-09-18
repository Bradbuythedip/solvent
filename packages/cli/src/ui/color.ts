/**
 * Terminal palette, kept in lockstep with the web tokens (SPEC.md 6.1):
 * cyan = solvent, red = insolvent, amber = dying, grey = chrome.
 *
 * Colour is reserved for solvency state here exactly as it is on the web. Chrome
 * is dim grey; nothing else gets a hue.
 */

export type ColorLevel = 0 | 1 | 2; // none | 16-colour | truecolor

interface Tone {
  /** 24-bit value, matching the web token. */
  rgb: readonly [number, number, number];
  /** Closest SGR code in the 16-colour fallback. */
  basic: number;
}

const TONES = {
  solvent: { rgb: [0x3d, 0xe0, 0xf5], basic: 36 }, // --pnl-pos
  insolvent: { rgb: [0xff, 0x7a, 0x90], basic: 31 }, // --pnl-neg
  dying: { rgb: [0xf5, 0xb9, 0x4a], basic: 33 }, // --pnl-warn
  ink: { rgb: [0xe8, 0xe9, 0xed], basic: 39 }, // --ink
  ink2: { rgb: [0xa7, 0xaf, 0xbc], basic: 37 }, // --ink-2
  muted: { rgb: [0x6b, 0x74, 0x84], basic: 90 }, // --ink-muted
} as const satisfies Record<string, Tone>;

export type ToneName = keyof typeof TONES;

let level: ColorLevel = detectLevel();

function detectLevel(): ColorLevel {
  const env = process.env;
  // NO_COLOR: any non-empty value disables colour entirely.
  if ((env['NO_COLOR'] ?? '') !== '') return 0;
  const force = env['FORCE_COLOR'];
  if (force !== undefined && force !== '' && force !== '0' && force !== 'false') {
    return force === '3' || force === '2' ? 2 : 1;
  }
  if (!process.stdout.isTTY) return 0;
  const term = env['TERM'] ?? '';
  if (term === 'dumb' || term === '') return 0;
  const colorterm = (env['COLORTERM'] ?? '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 2;
  if (/-256(color)?$/.test(term)) return 2;
  return 1;
}

export function colorLevel(): ColorLevel {
  return level;
}

/** Called once after argv parsing, so --no-color can override detection. */
export function applyColorFlag(noColor: boolean): void {
  if (noColor) level = 0;
}

function fg(tone: Tone): string {
  if (level === 2) return `\u001b[38;2;${tone.rgb[0]};${tone.rgb[1]};${tone.rgb[2]}m`;
  return `\u001b[${tone.basic}m`;
}

const RESET = '\u001b[0m';

function wrap(open: string, text: string): string {
  if (level === 0) return text;
  return `${open}${text}${RESET}`;
}

export function tone(name: ToneName, text: string): string {
  return wrap(fg(TONES[name]), text);
}

export const solvent = (s: string): string => tone('solvent', s);
export const insolvent = (s: string): string => tone('insolvent', s);
export const dying = (s: string): string => tone('dying', s);
export const ink = (s: string): string => tone('ink', s);
export const ink2 = (s: string): string => tone('ink2', s);
export const dim = (s: string): string => tone('muted', s);

export const bold = (s: string): string => wrap('\u001b[1m', s);
export const underline = (s: string): string => wrap('\u001b[4m', s);

/**
 * QR modules need absolute black and white, not palette tones: a scanner reads
 * polarity, and the terminal's own background is unknown. Callers must check
 * colorLevel() first — with colour off there is no safe polarity to assume.
 */
export function qrCell(upperDark: boolean, lowerDark: boolean): string {
  const fgCode = level === 2 ? (upperDark ? '\u001b[38;2;0;0;0m' : '\u001b[38;2;255;255;255m') : upperDark ? '\u001b[30m' : '\u001b[97m';
  const bgCode = level === 2 ? (lowerDark ? '\u001b[48;2;0;0;0m' : '\u001b[48;2;255;255;255m') : lowerDark ? '\u001b[40m' : '\u001b[107m';
  return `${bgCode}${fgCode}▀${RESET}`;
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '');
}

export function visibleWidth(s: string): number {
  return [...stripAnsi(s)].length;
}
