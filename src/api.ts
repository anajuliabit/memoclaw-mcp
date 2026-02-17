import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import type { Config } from './config.js';

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

  /**
   * Sleep for exponential backoff: base * 2^attempt (with jitter).
   */
  function backoff(attempt: number): Promise<void> {
    const base = 1000;
    const delay = base * Math.pow(2, attempt) + Math.random() * 500;
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  async function makeRequest(method: string, path: string, body?: any) {
    const url = `${apiUrl}${path}`;
    const { timeout, maxRetries } = config;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await backoff(attempt - 1);
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

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

        // Handle 402 Payment Required (free tier exhausted) — no retry needed
        if (res.status === 402) {
          const errorBody = await res.json();
          const client = getX402Client();
          const paymentRequired = client.getPaymentRequiredResponse(
            (name: string) => res.headers.get(name),
            errorBody
          );

          const paymentPayload = await client.createPaymentPayload(paymentRequired);
          const paymentHeaders = client.encodePaymentSignatureHeader(paymentPayload);

          const retryHeaders: Record<string, string> = { ...headers, ...paymentHeaders };
          if (body && !retryHeaders['Content-Type']) {
            retryHeaders['Content-Type'] = 'application/json';
          }

          const controller2 = new AbortController();
          const timer2 = setTimeout(() => controller2.abort(), timeout);

          res = await fetch(url, {
            method,
            headers: retryHeaders,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller2.signal,
          });

          clearTimeout(timer2);
        }

        // Retry on transient server errors
        if (isTransient(res.status) && attempt < maxRetries) {
          lastError = new Error(`HTTP ${res.status}`);
          continue;
        }

        if (!res.ok) {
          const err = await res.text();
          throw new Error(`HTTP ${res.status}: ${err}`);
        }

        return res.json();
      } catch (err: any) {
        // Retry on network errors and timeouts (but not client errors)
        if (err.name === 'AbortError') {
          lastError = new Error(`Request timed out after ${timeout}ms`);
        } else if (err.message?.startsWith('HTTP 4')) {
          // Don't retry 4xx (except transient ones handled above)
          throw err;
        } else {
          lastError = err;
        }

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
