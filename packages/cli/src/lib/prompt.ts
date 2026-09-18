/**
 * Interactive confirmations.
 *
 * Irreversible actions ask for a typed phrase, never a bare y/n: the point is to
 * make the operator read the sentence. Without a TTY the answer cannot be typed,
 * so the action is refused rather than assumed.
 */

import { createInterface } from 'node:readline/promises';
import { dim, ink } from '../ui/color.js';
import { CliError } from './errors.js';

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

export async function ask(question: string): Promise<string> {
  if (!isInteractive()) {
    throw new CliError('this step needs an interactive terminal', 'Re-run it in a terminal, or pass the flag that skips the prompt.');
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Requires the operator to type `expected` exactly. Returns nothing: a wrong
 * answer aborts, because there is no second meaning for "no" here.
 */
export async function typedConfirm(prompt: string, expected: string): Promise<void> {
  const answer = await ask(`  ${ink(prompt)}\n  ${dim(`type "${expected}" to continue:`)} `);
  if (answer !== expected) {
    throw new CliError('confirmation did not match, nothing was done');
  }
}

export async function confirm(question: string): Promise<boolean> {
  const answer = (await ask(`  ${ink(question)} ${dim('[y/N]')} `)).toLowerCase();
  return answer === 'y' || answer === 'yes';
}
