/** Layout primitives: hairline rules, key/value rows, checklists, chips. */

import { bold, colorLevel, dim, dying, ink, ink2, insolvent, qrCell, solvent, visibleWidth } from './color.js';
import type { QrCode } from './qr.js';
import type { SolvencyState } from '@solvent/core';

export function out(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function errLine(line = ''): void {
  process.stderr.write(`${line}\n`);
}

export function rule(width = 64): string {
  return dim('─'.repeat(width));
}

export function heading(text: string): void {
  out();
  out(bold(ink(text)));
  out(rule());
}

export function pad(text: string, width: number): string {
  const short = width - visibleWidth(text);
  return short > 0 ? text + ' '.repeat(short) : text;
}

export interface Row {
  label: string;
  value: string;
  note?: string;
}

export function kv(rows: Row[], labelWidth?: number): void {
  const width = labelWidth ?? rows.reduce((w, r) => Math.max(w, r.label.length), 0);
  for (const r of rows) {
    const note = r.note === undefined ? '' : `  ${dim(r.note)}`;
    out(`  ${dim(pad(r.label, width))}  ${r.value}${note}`);
  }
}

/** A boxed block. Width is measured on visible characters, so ANSI is safe. */
export function box(lines: string[], title?: string): void {
  const inner = lines.reduce((w, l) => Math.max(w, visibleWidth(l)), title ? visibleWidth(title) + 2 : 0);
  const top = title === undefined
    ? `┌${'─'.repeat(inner + 2)}┐`
    : `┌─ ${title} ${'─'.repeat(Math.max(0, inner - visibleWidth(title) - 1))}┐`;
  out(`  ${dim(top)}`);
  for (const l of lines) out(`  ${dim('│')} ${pad(l, inner)} ${dim('│')}`);
  out(`  ${dim(`└${'─'.repeat(inner + 2)}┘`)}`);
}

export type CheckState = 'pass' | 'fail' | 'warn' | 'skip';

export interface CheckLine {
  state: CheckState;
  label: string;
  detail: string;
  /** What to do about it. Printed under the line when the check is not passing. */
  remedy?: string;
}

/** Icon AND word: colour is never the only channel (SPEC.md 6.2). */
function checkGlyph(state: CheckState): string {
  switch (state) {
    case 'pass':
      return solvent('✔ PASS');
    case 'fail':
      return insolvent('✖ FAIL');
    case 'warn':
      return dying('! WARN');
    case 'skip':
      return dim('- SKIP');
  }
}

export function checkLine(c: CheckLine): void {
  out(`  ${pad(checkGlyph(c.state), 16)} ${pad(ink2(c.label), 22)} ${c.detail}`);
  if (c.remedy !== undefined && c.state !== 'pass') out(`  ${' '.repeat(16)} ${dim(`↳ ${c.remedy}`)}`);
}

const STATE_CHIP: Record<SolvencyState, { icon: string; word: string; paint: (s: string) => string }> = {
  solvent: { icon: '●', word: 'SOLVENT', paint: solvent },
  burning: { icon: '◐', word: 'BURNING', paint: dying },
  dying: { icon: '◑', word: 'DYING', paint: dying },
  dead: { icon: '✖', word: 'INSOLVENT', paint: insolvent },
  retired: { icon: '○', word: 'RETIRED', paint: dim },
};

export function chip(state: SolvencyState): string {
  const s = STATE_CHIP[state];
  return s.paint(`${s.icon} ${s.word}`);
}

/** Sign-coloured money, always with an explicit glyph (SPEC.md 6.2). */
export function signed(text: string, value: bigint): string {
  if (value > 0n) return solvent(text);
  if (value < 0n) return insolvent(text);
  return ink(text);
}

export function step(n: number, total: number, text: string): void {
  out();
  out(`${dim(`[${n}/${total}]`)} ${bold(ink(text))}`);
}

export function note(text: string): void {
  out(`  ${dim(text)}`);
}

export function warn(text: string): void {
  out(`  ${dying(`! ${text}`)}`);
}

export function ok(text: string): void {
  out(`  ${solvent('✔')} ${ink(text)}`);
}

/**
 * Half-block rows with a four-module quiet zone: one cell carries two stacked
 * modules, so the code comes out square in a terminal grid.
 *
 * Returns null when colour is off. Polarity is the whole point of a QR code and
 * without colour it would depend on the terminal's theme, so callers print the
 * address in full instead of shipping a code that may not scan.
 */
export function qrLines(code: QrCode, quiet = 4): string[] | null {
  if (colorLevel() === 0) return null;
  const span = code.size + quiet * 2;
  const dark = (x: number, y: number): boolean => {
    const mx = x - quiet;
    const my = y - quiet;
    if (mx < 0 || my < 0 || mx >= code.size || my >= code.size) return false;
    return code.get(mx, my);
  };
  const lines: string[] = [];
  for (let y = 0; y < span; y += 2) {
    let line = '';
    for (let x = 0; x < span; x++) line += qrCell(dark(x, y), dark(x, y + 1));
    lines.push(line);
  }
  return lines;
}

/** An address broken into scannable-by-eye groups, for when the QR is off. */
export function bigAddress(address: string): string[] {
  const body = address.replace(/^0x/, '');
  const groups = body.match(/.{1,8}/g) ?? [body];
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 2) {
    const left = groups[i] ?? '';
    const right = groups[i + 1] ?? '';
    lines.push(bold(ink(`${i === 0 ? '0x' : '  '}${left} ${right}`)));
  }
  return lines;
}

/**
 * A single line that rewrites itself on a TTY and appends on a pipe, so logs
 * stay readable when stdout is redirected.
 */
export class Status {
  private last = '';
  private readonly tty: boolean;

  constructor() {
    this.tty = Boolean(process.stdout.isTTY);
  }

  update(text: string): void {
    if (this.tty) {
      process.stdout.write(`\r\u001b[2K  ${text}`);
      this.last = text;
      return;
    }
    if (text !== this.last) {
      this.last = text;
      process.stdout.write(`  ${text}\n`);
    }
  }

  done(text?: string): void {
    if (this.tty) process.stdout.write('\r\u001b[2K');
    if (text !== undefined) out(`  ${text}`);
  }
}
