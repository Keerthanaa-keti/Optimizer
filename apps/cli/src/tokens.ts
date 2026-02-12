import { TokenMonitor } from '@creditforge/token-monitor';
import { loadConfig } from './config.js';

export async function runTokens(args: string[]): Promise<void> {
  const config = loadConfig();
  const jsonOutput = args.includes('--json');
  const tier = config.subscription?.tier ?? 'max5';

  const monitor = new TokenMonitor(tier);

  if (!monitor.isAvailable) {
    console.error('Could not load Claude stats. Check ~/.claude/stats-cache.json exists.');
    process.exit(1);
  }

  if (jsonOutput) {
    console.log(monitor.toJSON());
    return;
  }

  const summary = monitor.getSummary();
  console.log(monitor.formatForTerminal(summary));
}
