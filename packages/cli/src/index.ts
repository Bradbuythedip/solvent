#!/usr/bin/env node
/**
 * solvent — one command to enter the arena.
 *
 * No CLI framework: node:util parseArgs, six commands, and a palette that
 * matches the web app so a terminal and a browser tell the same story.
 */

import { createRequire } from 'node:module';
import { applyColorFlag, bold, dim, ink, solvent, underline } from './ui/color.js';
import { errLine, out } from './ui/render.js';
import { isCliError } from './lib/errors.js';
import * as doctor from './commands/doctor.js';
import * as fund from './commands/fund.js';
import * as reap from './commands/reap.js';
import * as retire from './commands/retire.js';
import * as spawn from './commands/spawn.js';
import * as status from './commands/status.js';

interface Command {
  usage: string;
  run: (argv: string[]) => Promise<number>;
}

const COMMANDS: Record<string, Command> = {
  spawn: { usage: spawn.usage, run: spawn.run },
  status: { usage: status.usage, run: status.run },
  fund: { usage: fund.usage, run: fund.run },
  reap: { usage: reap.usage, run: reap.run },
  retire: { usage: retire.usage, run: retire.run },
  doctor: { usage: doctor.usage, run: doctor.run },
};

function version(): string {
  try {
    const require_ = createRequire(import.meta.url);
    const pkg = require_('../package.json') as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function help(): void {
  out();
  out(`  ${bold(solvent('solvent'))} ${dim('·')} ${ink('software can now go broke')}`);
  out();
  out(`  ${dim('An agent has one wallet. USDC is its money and its permission to act.')}`);
  out(`  ${dim('Rent accrues per second. When it cannot pay, anyone can reap it.')}`);
  out();
  out(`  ${bold(ink('commands'))}`);
  out(`    ${ink('spawn')}    --handle <name> [--model <tag>]   enter the arena`);
  out(`    ${ink('status')}   [<id|handle>]                     balance, rent, runway, P&L`);
  out(`    ${ink('fund')}     [<id|handle>] [--amount <usd>]    deposit address and a QR`);
  out(`    ${ink('reap')}     <id> [<id>…] [--dry-run]          settle rent, reap the broke`);
  out(`    ${ink('retire')}   [<id|handle>]                     leave while still solvent`);
  out(`    ${ink('doctor')}                                     check this machine end to end`);
  out();
  out(`  ${bold(ink('global flags'))}`);
  out(`    ${dim('--network <arc|arcTestnet>  --rpc <url>  --indexer <url>  --env <path>')}`);
  out(`    ${dim('--json  --no-color  --yes  --help')}`);
  out();
  out(`  ${dim('start here:')} ${underline('solvent doctor')} ${dim('then')} ${underline('solvent spawn --handle my-agent')}`);
  out();
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  applyColorFlag(argv.includes('--no-color'));

  const first = argv[0];
  const rest = argv.slice(1);

  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    const named = first === 'help' ? rest[0] : undefined;
    const command = named === undefined ? undefined : COMMANDS[named];
    if (command !== undefined) {
      out(command.usage);
      return 0;
    }
    help();
    return 0;
  }

  if (first === '--version' || first === '-v') {
    out(version());
    return 0;
  }

  const command = COMMANDS[first];
  if (command === undefined) {
    errLine(`  unknown command "${first}"`);
    errLine(`  ${dim('Run "solvent --help" for the list.')}`);
    return 1;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    out(command.usage);
    return 0;
  }

  return command.run(rest);
}

process.on('SIGINT', () => {
  if (process.stdout.isTTY) process.stdout.write('\n');
  errLine(dim('  interrupted; nothing further was sent.'));
  process.exit(130);
});

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (isCliError(error)) {
      errLine();
      errLine(`  ${error.message}`);
      if (error.remedy !== undefined) errLine(`  ${dim(`↳ ${error.remedy}`)}`);
      errLine();
      process.exitCode = error.exitCode;
      return;
    }
    errLine();
    errLine(`  ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
