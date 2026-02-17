import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface Config {
  privateKey: string;
  apiUrl: string;
  configSource: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout: number;
  /** Max retries for transient failures (default: 3) */
  maxRetries: number;
}

/**
 * Load config from ~/.memoclaw/config.json if it exists.
 * Resolution order: explicit env var → config file → default.
 */
export function loadConfig(): Config {
  let privateKey = process.env.MEMOCLAW_PRIVATE_KEY || '';
  let apiUrl = process.env.MEMOCLAW_URL || '';
  let configSource = 'env';

  // Try config file if env vars are missing
  if (!privateKey || !apiUrl) {
    try {
      const configPath = join(homedir(), '.memoclaw', 'config.json');
      const raw = readFileSync(configPath, 'utf-8');
      const config = JSON.parse(raw);
      if (!privateKey && config.privateKey) {
        privateKey = config.privateKey;
        configSource = 'config file (~/.memoclaw/config.json)';
      }
      if (!apiUrl && config.url) {
        apiUrl = config.url;
      }
    } catch {
      // Config file doesn't exist or is invalid — that's fine
    }
  }

  if (!apiUrl) apiUrl = 'https://api.memoclaw.com';

  if (!privateKey) {
    console.error(
      'MemoClaw: No private key found. Set MEMOCLAW_PRIVATE_KEY env var or run `memoclaw init`.'
    );
    process.exit(1);
  }

  const parsedTimeout = parseInt(process.env.MEMOCLAW_TIMEOUT || '', 10);
  const timeout = Number.isNaN(parsedTimeout) ? 30_000 : parsedTimeout;
  const parsedRetries = parseInt(process.env.MEMOCLAW_MAX_RETRIES || '', 10);
  const maxRetries = Number.isNaN(parsedRetries) ? 3 : parsedRetries;

  return { privateKey, apiUrl, configSource, timeout, maxRetries };
}
