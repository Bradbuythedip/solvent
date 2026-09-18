/**
 * Argument parsing on node:util parseArgs. No CLI framework is installed and one
 * would not earn its bytes here: six commands, flat flags, no subcommand trees.
 */

import { parseArgs } from 'node:util';
import { CliError } from './errors.js';

export type OptionType = { type: 'string' | 'boolean'; short?: string; multiple?: boolean; default?: string | boolean };
export type Options = Record<string, OptionType>;
export type Values = Record<string, string | boolean | Array<string | boolean> | undefined>;

export interface Parsed {
  values: Values;
  positionals: string[];
}

/** Flags every command accepts. */
export const GLOBAL_OPTIONS: Options = {
  network: { type: 'string' },
  rpc: { type: 'string' },
  indexer: { type: 'string' },
  env: { type: 'string' },
  json: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  yes: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

export function parse(argv: string[], options: Options, command: string): Parsed {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: { ...GLOBAL_OPTIONS, ...options },
      allowPositionals: true,
      strict: true,
    });
    return { values: values as Values, positionals };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CliError(message, `Run "solvent ${command} --help" for the accepted flags.`);
  }
}

export function str(values: Values, key: string): string | undefined {
  const v = values[key];
  return typeof v === 'string' ? v : undefined;
}

export function flag(values: Values, key: string): boolean {
  return values[key] === true;
}

export function num(values: Values, key: string): number | undefined {
  const raw = str(values, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new CliError(`--${key} must be a number, got "${raw}"`);
  return n;
}

/** True when the flag was typed on the command line, not inherited from .env. */
export function explicitlyPassed(argv: string[], name: string): boolean {
  return argv.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}
