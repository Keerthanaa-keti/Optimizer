import { startServer } from '@creditforge/dashboard';
import { exec } from 'node:child_process';

const DEFAULT_PORT = 3141;

export async function runDashboard(args: string[]): Promise<void> {
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 && args[portIdx + 1]
    ? parseInt(args[portIdx + 1], 10)
    : DEFAULT_PORT;

  const shouldOpen = args.includes('--open');

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error('Invalid port number');
    process.exit(1);
  }

  const server = startServer(port);

  if (shouldOpen) {
    const url = `http://localhost:${port}`;
    // macOS open
    exec(`open ${url}`, (err) => {
      if (err) console.log(`Open ${url} in your browser`);
    });
  }

  // Keep running until Ctrl+C
  process.on('SIGINT', () => {
    console.log('\nShutting down dashboard...');
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
  });
}
