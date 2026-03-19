import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import type { Config } from './config.js';
import { mcpLogger } from './logging.js';

const BASE_BACKOFF_MS = 1000;
const BACKOFF_JITTER_MS = 500;
const MAX_RETRY_AFTER_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateBackoffDelay(attempt: number): number {
  return BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * BACKOFF_JITTER_MS;
}

function clampRetryAfter(delayMs: number): number {
  return Math.min(Math.max(delayMs, 0), MAX_RETRY_AFTER_MS);
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) {
    return null;
  }

  const trimmed = headerValue.trim();
  if (!trimmed) {
    return null;
  }

  const secondsDelay = Number(trimmed);
  if (!Number.isNaN(secondsDelay)) {
    return clampRetryAfter(secondsDelay * 1000);
  }

  const dateDelay = Date.parse(trimmed);
  if (!Number.isNaN(dateDelay)) {
    return clampRetryAfter(dateDelay - Date.now());
  }

  return null;
}

function backoff(attempt: number, overrideDelayMs?: number | null): Promise<void> {
  const delay = overrideDelayMs ?? calculateBackoffDelay(attempt);
  return sleep(delay);
}

export function createApiClient(config: Config) {
  const account = privateKeyToAccount(config.privateKey as `0x${string}`);
  const apiUrl = config.apiUrl;

  // x402 client (lazy init - only when free tier exhausted)
  let _x402Client: x402HTTPClient | null = null;
  function getX402Client() {
    if (!_x402Client) {
      const signer = toClientEvmSigner(account);
      const coreClient = new x402Client().register('eip155:*', new ExactEvmScheme(signer));
      _x402Client = new x402HTTPClient(coreClient);
    }
    return _x402Client;
  }

  /**
   * Generate wallet auth header for free tier
   * Format: {address}:{timestamp}:{signature}
   */
  async function getWalletAuthHeader(): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `memoclaw-auth:${timestamp}`;
    const signature = await account.signMessage({ message });
    return `${account.address}:${timestamp}:${signature}`;
  }

  /**
   * Determine if an error/status is transient and worth retrying.
   */
  function isTransient(status: number): boolean {
    return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
  }

  async function makeRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    externalSignal?: AbortSignal,
  ) {
    const url = `${apiUrl}${path}`;
    const { timeout, maxRetries } = config;
    let lastError: Error | null = null;
    let lastRetryAfterMs: number | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Bail out immediately if already cancelled before starting the attempt
      if (externalSignal?.aborted) {
        const err = new Error('Operation cancelled by client');
        err.name = 'CancellationError';
        throw err;
      }

      if (attempt > 0) {
        mcpLogger.debug('api', { event: 'retry', method, path, attempt });
        await backoff(attempt - 1, lastRetryAfterMs);
        lastRetryAfterMs = null;
      }

      let onExternalAbort: (() => void) | undefined;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        // If an external signal (e.g. MCP cancellation) is provided, abort
        // the fetch when either the timeout or the external signal fires.
        if (externalSignal && !externalSignal.aborted) {
          onExternalAbort = () => controller.abort();
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }

        const headers: Record<string, string> = {};
        if (body) {
          headers['Content-Type'] = 'application/json';
        }

        // Try free tier first
        const walletAuth = await getWalletAuthHeader();
        headers['x-wallet-auth'] = walletAuth;

        let res = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timer);
        if (onExternalAbort) externalSignal!.removeEventListener('abort', onExternalAbort);

        // Handle 402 Payment Required (free tier exhausted) — no retry needed
        if (res.status === 402) {
          mcpLogger.info('api', {
            event: 'payment_required',
            method,
            path,
            message: 'Free tier exhausted, using x402 payment',
          });
          const errorBody = await res.json();
          const client = getX402Client();
          const paymentRequired = client.getPaymentRequiredResponse((name: string) => res.headers.get(name), errorBody);

          const paymentPayload = await client.createPaymentPayload(paymentRequired);
          const paymentHeaders = client.encodePaymentSignatureHeader(paymentPayload);

          const retryHeaders: Record<string, string> = { ...headers, ...paymentHeaders };
          if (body && !retryHeaders['Content-Type']) {
            retryHeaders['Content-Type'] = 'application/json';
          }

          const controller2 = new AbortController();
          const timer2 = setTimeout(() => controller2.abort(), timeout);
          let onExternalAbort2: (() => void) | undefined;
          if (externalSignal && !externalSignal.aborted) {
            onExternalAbort2 = () => controller2.abort();
            externalSignal.addEventListener('abort', onExternalAbort2, { once: true });
          }

          res = await fetch(url, {
            method,
            headers: retryHeaders,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller2.signal,
          });

          clearTimeout(timer2);
          if (onExternalAbort2) externalSignal!.removeEventListener('abort', onExternalAbort2);
        }

        // Retry on transient server errors
        if (isTransient(res.status) && attempt < maxRetries) {
          if (res.status === 429) {
            lastRetryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
          } else {
            lastRetryAfterMs = null;
          }
          lastError = new Error(`HTTP ${res.status}`);
          continue;
        }

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`HTTP ${res.status}: ${err}`);
        }

        return res.json();
      } catch (err: unknown) {
        // Clean up listeners on error paths
        if (onExternalAbort) externalSignal!.removeEventListener('abort', onExternalAbort);

        const errObj = err instanceof Error ? err : new Error(String(err));

        // If the external signal caused the abort, surface it as cancellation (no retry)
        if (errObj.name === 'AbortError' && externalSignal?.aborted) {
          const cancelErr = new Error('Operation cancelled by client');
          cancelErr.name = 'CancellationError';
          throw cancelErr;
        }

        // Retry on network errors and timeouts (but not client errors)
        if (errObj.name === 'AbortError') {
          lastError = new Error(`Request timed out after ${timeout}ms`);
        } else if (errObj.message?.startsWith('HTTP 4')) {
          // Don't retry 4xx (except transient ones handled above)
          throw errObj;
        } else {
          lastError = errObj;
        }

        lastRetryAfterMs = null;

        if (attempt >= maxRetries) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error('Request failed');
  }

  return { makeRequest, account };
}

export type ApiClient = ReturnType<typeof createApiClient>;
