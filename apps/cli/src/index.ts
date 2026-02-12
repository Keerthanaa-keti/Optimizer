#!/usr/bin/env node

import { runScan } from './scan.js';
import { runExecute } from './run.js';
import { runStatus } from './status.js';
import { runTokens } from './tokens.js';
import { runOptimize } from './optimize.js';
import { runDashboard } from './dashboard.js';

const USAGE = `
CreditForge - Claude Subscription Optimizer

Usage:
  creditforge scan [--verbose] [--quick]     Scan projects for automatable tasks
  creditforge run --task <id>                Execute a single task
  creditforge run --mode night [--dry-run]   Run night mode batch execution
  creditforge status                         Show current status
  creditforge status --report                Show morning report
  creditforge tokens [--json]                Show real token usage from Claude
  creditforge optimize [--dry-run] [--yes]   Scan, plan, approve, and execute
  creditforge dashboard [--port N] [--open]  Launch web dashboard

Options:
  --verbose, -v    Show detailed scan output
  --quick          Skip slow scanners (npm audit)
  --dry-run        Preview without executing
  --task <id>      Specify task ID to execute
  --mode night     Enable night mode batch execution
  --skip-scan      Use existing DB tasks (optimize)
  --yes            Auto-approve optimization plan
  --port <N>       Dashboard port (default: 3141)
  --open           Auto-open dashboard in browser
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

    case 'tokens':
      await runTokens(args.slice(1));
      break;

    case 'optimize':
      await runOptimize(args.slice(1));
      break;

    case 'dashboard':
      await runDashboard(args.slice(1));
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
