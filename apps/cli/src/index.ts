#!/usr/bin/env node

import { runScan } from './scan.js';
import { runExecute } from './run.js';
import { runStatus } from './status.js';

const USAGE = `
CreditForge - Claude Subscription Optimizer

Usage:
  creditforge scan [--verbose] [--quick]     Scan projects for automatable tasks
  creditforge run --task <id>                Execute a single task
  creditforge run --mode night [--dry-run]   Run night mode batch execution
  creditforge status                         Show current status
  creditforge status --report                Show morning report

Options:
  --verbose, -v    Show detailed scan output
  --quick          Skip slow scanners (npm audit)
  --dry-run        Preview without executing
  --task <id>      Specify task ID to execute
  --mode night     Enable night mode batch execution
`.trim();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'scan':
      await runScan(args.slice(1));
      break;

    case 'run':
      await runExecute(args.slice(1));
      break;

    case 'status':
      await runStatus(args.slice(1));
      break;

    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      break;

    default:
      if (command) {
        console.error(`Unknown command: ${command}\n`);
      }
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
