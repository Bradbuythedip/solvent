#!/usr/bin/env node
/**
 * Runs the indexer and the web app together, with prefixed, colour-coded output.
 * Demo mode by default, so `pnpm dev` works with no RPC and no API key.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const NO_COLOR = Boolean(process.env['NO_COLOR']) || !process.stdout.isTTY;
const paint = (code, s) => (NO_COLOR ? s : `\u001b[${code}m${s}\u001b[0m`);

const SERVICES = [
  { name: 'indexer', filter: '@solvent/indexer', color: '36', script: 'dev' },
  { name: 'web    ', filter: '@solvent/web', color: '35', script: 'dev' },
];

const children = [];
let shuttingDown = false;

function run({ name, filter, color, script }) {
  const child = spawn('pnpm', ['--filter', filter, script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, SOLVENT_MODE: process.env['SOLVENT_MODE'] ?? 'demo', FORCE_COLOR: '1' },
  });

  const prefix = paint(color, `${name} │ `);
  const pipe = (stream) => {
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    process.stdout.write(prefix + paint('31', `exited (${signal ?? code})`) + '\n');
    shutdown(code ?? 1);
  });

  children.push(child);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 400).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(paint('2', 'solvent — starting indexer + web in ' + (process.env['SOLVENT_MODE'] ?? 'demo') + ' mode'));
console.log(paint('2', '  indexer  http://localhost:8787'));
console.log(paint('2', '  web      http://localhost:3000'));
console.log('');
SERVICES.forEach(run);
