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

  async function makeRequest(method: string, path: string, body?: any) {
    const url = `${apiUrl}${path}`;
    const headers: Record<string, string> = {};
    const options: RequestInit = { method, headers };
    if (body) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    // Try free tier first
    const walletAuth = await getWalletAuthHeader();
    headers['x-wallet-auth'] = walletAuth;

    let res = await fetch(url, { ...options, headers });

    // Handle 402 Payment Required (free tier exhausted)
    if (res.status === 402) {
      const errorBody = await res.json();
      const client = getX402Client();
      const paymentRequired = client.getPaymentRequiredResponse(
        (name: string) => res.headers.get(name),
        errorBody
      );

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      const paymentHeaders = client.encodePaymentSignatureHeader(paymentPayload);

      // Ensure Content-Type is preserved on retry when body is present
      const retryHeaders: Record<string, string> = { ...headers, ...paymentHeaders };
      if (body && !retryHeaders['Content-Type']) {
        retryHeaders['Content-Type'] = 'application/json';
      }

      res = await fetch(url, {
        method,
        headers: retryHeaders,
        body: body ? JSON.stringify(body) : undefined,
      });
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }

    return res.json();
  }

  return { makeRequest, account };
}

export type ApiClient = ReturnType<typeof createApiClient>;
