/**
 * Tests for the API client: retry logic, exponential backoff, timeout handling, and x402 payment flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Set env before any imports
process.env.MEMOCLAW_PRIVATE_KEY = '0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb';
process.env.MEMOCLAW_URL = 'https://test.memoclaw.com';
process.env.MEMOCLAW_TIMEOUT = '5000';
process.env.MEMOCLAW_MAX_RETRIES = '3';

// Mock x402 modules
const mockGetPaymentRequiredResponse = vi.fn().mockReturnValue({ paymentInfo: 'mock' });
const mockCreatePaymentPayload = vi.fn().mockResolvedValue({ payload: 'mock' });
const mockEncodePaymentSignatureHeader = vi.fn().mockReturnValue({ 'x-payment': 'mock-sig' });

vi.mock('@x402/core/client', () => ({
  x402Client: vi.fn().mockImplementation(function (this: any) {
    this.register = vi.fn().mockReturnValue(this);
  }),
}));
vi.mock('@x402/core/http', () => ({
  x402HTTPClient: vi.fn().mockImplementation(function (this: any) {
    this.getPaymentRequiredResponse = mockGetPaymentRequiredResponse;
    this.createPaymentPayload = mockCreatePaymentPayload;
    this.encodePaymentSignatureHeader = mockEncodePaymentSignatureHeader;
  }),
}));
vi.mock('@x402/evm/exact/client', () => ({ ExactEvmScheme: vi.fn() }));
vi.mock('@x402/evm', () => ({ toClientEvmSigner: vi.fn() }));
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    address: '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23',
    signMessage: vi.fn().mockResolvedValue('0xmocksig'),
  }),
}));

import { createApiClient } from '../src/api.js';
import { loadConfig } from '../src/config.js';

// Helper to create a mock Response
function mockResponse(status: number, body: any = {}, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: {
      get: (name: string) => headers[name] || null,
    },
  } as unknown as Response;
}

describe('API Client', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let config: ReturnType<typeof loadConfig>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    config = loadConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful requests', () => {
    it('makes a GET request and returns JSON', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, { memories: [] }));
      const client = createApiClient(config);
      const result = await client.makeRequest('GET', '/v1/memories');
      expect(result).toEqual({ memories: [] });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://test.memoclaw.com/v1/memories');
      expect(opts.method).toBe('GET');
    });

    it('makes a POST request with body', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, { id: '123' }));
      const client = createApiClient(config);
      const result = await client.makeRequest('POST', '/v1/memories', { content: 'test' });
      expect(result).toEqual({ id: '123' });
      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(opts.body)).toEqual({ content: 'test' });
    });

    it('includes wallet auth header', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(200, {}));
      const client = createApiClient(config);
      await client.makeRequest('GET', '/v1/memories');
      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.headers['x-wallet-auth']).toMatch(/^0x2c7536E3605D9C16a7a3D7b1898e529396a65c23:\d+:0xmocksig$/);
    });
  });

  // Use low maxRetries and real timers — backoff delays are small with attempt 0/1
  describe('retry logic', () => {
    it('retries on 503 and succeeds', async () => {
      const retryConfig = { ...config, maxRetries: 1 };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const client = createApiClient(retryConfig);
      const result = await client.makeRequest('GET', '/v1/memories');
      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 15000);

    it('retries on 429 (rate limit)', async () => {
      const retryConfig = { ...config, maxRetries: 1 };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, 'Too Many Requests'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const client = createApiClient(retryConfig);
      const result = await client.makeRequest('GET', '/v1/memories');
      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 15000);

    it('respects Retry-After header (delta-seconds) on 429', async () => {
      const retryConfig = { ...config, maxRetries: 1 };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, 'Too Many Requests', { 'Retry-After': '1' }))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const start = Date.now();
      const client = createApiClient(retryConfig);
      const result = await client.makeRequest('GET', '/v1/memories');
      const elapsed = Date.now() - start;

      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // Should wait ~1000ms (Retry-After: 1), not default backoff
      expect(elapsed).toBeGreaterThanOrEqual(900);
      expect(elapsed).toBeLessThan(3000);
    }, 15000);

    it('respects Retry-After header (HTTP-date) on 429', async () => {
      // Use 2 seconds ahead to account for second-level precision in toUTCString()
      const futureDate = new Date(Date.now() + 2000).toUTCString();
      const retryConfig = { ...config, maxRetries: 1 };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, 'Too Many Requests', { 'Retry-After': futureDate }))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const start = Date.now();
      const client = createApiClient(retryConfig);
      const result = await client.makeRequest('GET', '/v1/memories');
      const elapsed = Date.now() - start;

      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // Should wait based on the HTTP-date (at least 500ms given second rounding)
      expect(elapsed).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThan(4000);
    }, 15000);

    it('caps Retry-After at 60 seconds', async () => {
      const retryConfig = { ...config, maxRetries: 1 };
      // Server says wait 120 seconds, but we cap at 60
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, 'Too Many Requests', { 'Retry-After': '120' }))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const client = createApiClient(retryConfig);
      // Use fake timers for this test to avoid actually waiting 60s
      vi.useFakeTimers();
      const promise = client.makeRequest('GET', '/v1/memories');

      // Advance time to just past 60s (the cap)
      await vi.advanceTimersByTimeAsync(61_000);

      const result = await promise;
      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    }, 15000);

    it('falls back to exponential backoff when Retry-After header is missing', async () => {
      const retryConfig = { ...config, maxRetries: 1 };
      // 429 without Retry-After header
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, 'Too Many Requests'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const start = Date.now();
      const client = createApiClient(retryConfig);
      const result = await client.makeRequest('GET', '/v1/memories');
      const elapsed = Date.now() - start;

      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      // Default backoff for attempt 0: base(1000) * 2^0 + jitter = ~1000-1500ms
      expect(elapsed).toBeGreaterThanOrEqual(900);
    }, 15000);

    it('ignores invalid Retry-After header values', async () => {
      const retryConfig = { ...config, maxRetries: 1 };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(429, 'Too Many Requests', { 'Retry-After': 'not-a-number' }))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const client = createApiClient(retryConfig);
      const result = await client.makeRequest('GET', '/v1/memories');
      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 15000);

    it('retries on 502 and 504', async () => {
      const retryConfig = { ...config, maxRetries: 2 };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(502, 'Bad Gateway'))
        .mockResolvedValueOnce(mockResponse(504, 'Gateway Timeout'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const client = createApiClient(retryConfig);
      const result = await client.makeRequest('GET', '/v1/memories');
      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    }, 30000);

    it('gives up after maxRetries exhausted', async () => {
      const retryConfig = { ...config, maxRetries: 1 };
      fetchSpy.mockResolvedValue(mockResponse(503, 'Service Unavailable'));

      const client = createApiClient(retryConfig);
      await expect(client.makeRequest('GET', '/v1/memories')).rejects.toThrow('HTTP 503');
      // initial + 1 retry = 2 calls
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 15000);

    it('does not retry on 400 (client error)', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(400, 'Bad Request'));

      const client = createApiClient(config);
      await expect(client.makeRequest('GET', '/v1/memories')).rejects.toThrow('HTTP 400');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 404', async () => {
      fetchSpy.mockResolvedValueOnce(mockResponse(404, 'Not Found'));

      const client = createApiClient(config);
      await expect(client.makeRequest('GET', '/v1/memories')).rejects.toThrow('HTTP 404');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('retries on network error', async () => {
      const retryConfig = { ...config, maxRetries: 1 };
      fetchSpy
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      const client = createApiClient(retryConfig);
      const result = await client.makeRequest('GET', '/v1/memories');
      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 15000);
  });

  describe('timeout handling', () => {
    it('aborts request after timeout', async () => {
      const shortConfig = { ...config, timeout: 50, maxRetries: 0 };

      fetchSpy.mockImplementation(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );

      const client = createApiClient(shortConfig);
      await expect(client.makeRequest('GET', '/v1/memories')).rejects.toThrow('timed out');
    });
  });

  describe('x402 payment flow', () => {
    it('handles 402 by retrying with payment headers', async () => {
      const paymentHeaders = { 'x-402-receipt': 'mock-receipt' };
      fetchSpy
        .mockResolvedValueOnce(mockResponse(402, { error: 'payment required' }, paymentHeaders))
        .mockResolvedValueOnce(mockResponse(200, { id: '123' }));

      const client = createApiClient(config);
      const result = await client.makeRequest('POST', '/v1/memories', { content: 'test' });
      expect(result).toEqual({ id: '123' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Second call should have been made (payment retry)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('propagates error when payment retry also fails', async () => {
      fetchSpy
        .mockResolvedValueOnce(mockResponse(402, { error: 'payment required' }))
        .mockResolvedValueOnce(mockResponse(500, 'Server Error'));

      const client = createApiClient({ ...config, maxRetries: 0 });
      await expect(client.makeRequest('GET', '/v1/memories')).rejects.toThrow('HTTP 500');
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('zero retries config', () => {
    it('does not retry when maxRetries is 0', async () => {
      const noRetryConfig = { ...config, maxRetries: 0 };
      fetchSpy.mockResolvedValueOnce(mockResponse(503, 'Service Unavailable'));

      const client = createApiClient(noRetryConfig);
      await expect(client.makeRequest('GET', '/v1/memories')).rejects.toThrow('HTTP 503');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('external signal (MCP cancellation)', () => {
    it('aborts immediately when external signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const client = createApiClient({ ...config, maxRetries: 0 });
      await expect(client.makeRequest('GET', '/v1/memories', undefined, controller.signal)).rejects.toThrow(
        'Operation cancelled by client',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight fetch when external signal fires', async () => {
      const controller = new AbortController();
      // Simulate a long-running fetch that responds to abort
      fetchSpy.mockImplementation(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );

      const client = createApiClient({ ...config, timeout: 30000, maxRetries: 0 });
      const promise = client.makeRequest('GET', '/v1/memories', undefined, controller.signal);

      // Give the fetch a moment to start, then cancel
      await new Promise((r) => setTimeout(r, 10));
      controller.abort();

      await expect(promise).rejects.toThrow('Operation cancelled by client');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('throws CancellationError (not timeout) when external signal aborts', async () => {
      const controller = new AbortController();
      fetchSpy.mockImplementation(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );

      const client = createApiClient({ ...config, timeout: 30000, maxRetries: 0 });
      const promise = client.makeRequest('GET', '/v1/memories', undefined, controller.signal);

      await new Promise((r) => setTimeout(r, 10));
      controller.abort();

      try {
        await promise;
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.name).toBe('CancellationError');
        expect(err.message).toContain('cancelled');
      }
    });

    it('does not retry when cancelled via external signal', async () => {
      const controller = new AbortController();
      fetchSpy.mockImplementation(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      );

      const client = createApiClient({ ...config, timeout: 30000, maxRetries: 3 });
      const promise = client.makeRequest('GET', '/v1/memories', undefined, controller.signal);

      await new Promise((r) => setTimeout(r, 10));
      controller.abort();

      await expect(promise).rejects.toThrow('Operation cancelled by client');
      // Should NOT retry — only 1 fetch call
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
