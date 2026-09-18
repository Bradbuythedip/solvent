/**
 * .env reading and writing.
 *
 * The file this CLI writes holds a private key, so it is created with mode 600
 * and never echoed back to the terminal.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CliError } from './errors.js';

export type EnvMap = Record<string, string>;

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function parseEnv(text: string): EnvMap {
  const out: EnvMap = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (m === null) continue;
    const key = m[1];
    let value = (m[2] ?? '').trim();
    if (key === undefined) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

export function readEnvFile(path: string): EnvMap {
  if (!existsSync(path)) return {};
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new CliError(`cannot read ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * The process environment wins over the file, so a one-off
 * `SOLVENT_CHAIN=arc solvent status` behaves the way a shell user expects.
 */
export function loadEnv(envPath: string): EnvMap {
  const fromFile = readEnvFile(envPath);
  const merged: EnvMap = { ...fromFile };
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string' && v !== '') merged[k] = v;
  }
  return merged;
}

export function get(env: EnvMap, key: string): string | undefined {
  const v = env[key];
  return v === undefined || v === '' ? undefined : v;
}

function serialise(key: string, value: string): string {
  const needsQuotes = /[\s#'"]/.test(value);
  return `${key}=${needsQuotes ? JSON.stringify(value) : value}`;
}

export interface WriteEnvResult {
  path: string;
  created: boolean;
  keys: string[];
}

/**
 * Merges entries into an existing .env, preserving unrelated keys, comments and
 * order. The file is written 600 because it carries a key.
 */
export function writeEnvFile(path: string, entries: EnvMap): WriteEnvResult {
  const target = resolve(path);
  const existed = existsSync(target);
  const previous = existed ? readFileSync(target, 'utf8') : '';
  const remaining = new Map(Object.entries(entries));

  const lines = previous === '' ? [] : previous.split('\n');
  const merged = lines.map((raw) => {
    const m = LINE.exec(raw.trim());
    const key = m?.[1];
    if (key === undefined || !remaining.has(key)) return raw;
    const value = remaining.get(key) ?? '';
    remaining.delete(key);
    return serialise(key, value);
  });

  if (remaining.size > 0) {
    if (merged.length > 0 && (merged[merged.length - 1] ?? '').trim() !== '') merged.push('');
    if (!existed) merged.push('# Written by solvent spawn. Contains a private key: keep it out of git.');
    for (const [k, v] of remaining) merged.push(serialise(k, v));
  }

  const body = `${merged.join('\n').replace(/\n+$/, '')}\n`;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body, { mode: 0o600 });
  chmodSync(target, 0o600); // an existing file keeps its old mode without this

  return { path: target, created: !existed, keys: Object.keys(entries) };
}
