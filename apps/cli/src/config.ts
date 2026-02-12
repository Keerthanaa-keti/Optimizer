import fs from 'node:fs';
import path from 'node:path';

export interface CreditForgeConfig {
  nightMode: {
    enabled: boolean;
    startHour: number;
    endHour: number;
    creditCapPercent: number;
    modelPreference: string;
    maxBudgetPerTaskUsd: number;
  };
  scanner: {
    scanRoots: string[];
    excludePatterns: string[];
    skipNpmAudit: boolean;
    maxTodosPerProject: number;
  };
  credits: {
    windowResetHour: number;
    hardStopMinutesBefore: number;
    estimatedBalanceUsdCents: number;
  };
}

const DEFAULT_CONFIG: CreditForgeConfig = {
  nightMode: {
    enabled: true,
    startHour: 23,
    endHour: 6,
    creditCapPercent: 75,
    modelPreference: 'sonnet',
    maxBudgetPerTaskUsd: 0.50,
  },
  scanner: {
    scanRoots: [],
    excludePatterns: ['**/node_modules/**', '**/GitCode/**'],
    skipNpmAudit: false,
    maxTodosPerProject: 50,
  },
  credits: {
    windowResetHour: 0,
    hardStopMinutesBefore: 30,
    estimatedBalanceUsdCents: 5000, // $50 default estimate
  },
};

const CONFIG_PATHS = [
  path.join(process.cwd(), 'creditforge.toml'),
  path.join(process.env.HOME ?? '~', '.creditforge', 'config.toml'),
];

/**
 * Load config from TOML file or return defaults.
 * Uses a simple TOML parser for the subset we need.
 */
export function loadConfig(configPath?: string): CreditForgeConfig {
  const pathsToTry = configPath ? [configPath] : CONFIG_PATHS;

  for (const p of pathsToTry) {
    const resolved = p.replace(/^~/, process.env.HOME ?? '');
    if (fs.existsSync(resolved)) {
      const content = fs.readFileSync(resolved, 'utf-8');
      return parseToml(content);
    }
  }

  return DEFAULT_CONFIG;
}

/**
 * Minimal TOML parser for our config structure.
 */
function parseToml(content: string): CreditForgeConfig {
  const config = { ...DEFAULT_CONFIG };
  let currentSection = '';

  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    i++;

    if (!line || line.startsWith('#')) continue;

    // Section header
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }

    // Key-value pair
    const kvMatch = line.match(/^(\w+)\s*=\s*(.+)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    let rawValue = kvMatch[2].trim();

    // Handle multi-line arrays: if value starts with '[' but doesn't end with ']'
    if (rawValue.startsWith('[') && !rawValue.endsWith(']')) {
      while (i < lines.length) {
        const nextLine = lines[i].trim();
        i++;
        rawValue += ' ' + nextLine;
        if (nextLine.endsWith(']')) break;
      }
    }

    const value = parseTomlValue(rawValue);

    switch (currentSection) {
      case 'night_mode':
        setNested(config.nightMode, camelCase(key), value);
        break;
      case 'scanner':
        setNested(config.scanner, camelCase(key), value);
        break;
      case 'credits':
        setNested(config.credits, camelCase(key), value);
        break;
    }
  }

  return config;
}

function parseTomlValue(raw: string): unknown {
  // Boolean
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  // Number
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);

  // Array of strings
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => {
      const trimmed = s.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
      }
      return trimmed;
    });
  }

  // String
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }

  return raw;
}

function camelCase(snakeCase: string): string {
  return snakeCase.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function setNested(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (key in obj) {
    obj[key] = value;
  }
}
