/**
 * Tests for the RateLimiter class and HTTP rate limiting integration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter, getClientIp, trustProxy } from '../src/rate-limiter.js';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  afterEach(() => {
    limiter.dispose();
  });

  it('allows requests within the limit', () => {
    for (let i = 0; i < 5; i++) {
      const result = limiter.check('test-key', 5, 60_000);
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    }
  });

  it('rejects requests exceeding the limit', () => {
    for (let i = 0; i < 3; i++) {
      limiter.check('test-key', 3, 60_000);
    }
    const result = limiter.check('test-key', 3, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('allows requests after window expires', () => {
    vi.useFakeTimers();
    try {
      // Fill up the limit
      for (let i = 0; i < 3; i++) {
        limiter.check('test-key', 3, 1000);
      }
      expect(limiter.check('test-key', 3, 1000).allowed).toBe(false);

      // Advance past window
      vi.advanceTimersByTime(1001);
      expect(limiter.check('test-key', 3, 1000).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks different keys independently', () => {
    for (let i = 0; i < 3; i++) {
      limiter.check('key-a', 3, 60_000);
    }
    expect(limiter.check('key-a', 3, 60_000).allowed).toBe(false);
    expect(limiter.check('key-b', 3, 60_000).allowed).toBe(true);
  });

  it('returns allowed when limit is 0 (disabled)', () => {
    const result = limiter.check('any-key', 0, 60_000);
    expect(result.allowed).toBe(true);
  });

  it('returns retryAfterMs close to remaining window time', () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 2; i++) {
        limiter.check('test-key', 2, 10_000);
      }
      vi.advanceTimersByTime(3000);
      const result = limiter.check('test-key', 2, 10_000);
      expect(result.allowed).toBe(false);
      // Should be ~7000ms remaining
      expect(result.retryAfterMs).toBeLessThanOrEqual(7000);
      expect(result.retryAfterMs).toBeGreaterThan(6000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('trustProxy', () => {
  afterEach(() => {
    delete process.env.MEMOCLAW_TRUST_PROXY;
  });

  it('returns false when env var is not set', () => {
    delete process.env.MEMOCLAW_TRUST_PROXY;
    expect(trustProxy()).toBe(false);
  });

  it('returns true when set to "true"', () => {
    process.env.MEMOCLAW_TRUST_PROXY = 'true';
    expect(trustProxy()).toBe(true);
  });

  it('returns true when set to "1"', () => {
    process.env.MEMOCLAW_TRUST_PROXY = '1';
    expect(trustProxy()).toBe(true);
  });

  it('returns false for other values', () => {
    process.env.MEMOCLAW_TRUST_PROXY = 'yes';
    expect(trustProxy()).toBe(false);
    process.env.MEMOCLAW_TRUST_PROXY = '0';
    expect(trustProxy()).toBe(false);
    process.env.MEMOCLAW_TRUST_PROXY = 'false';
    expect(trustProxy()).toBe(false);
  });
});

describe('getClientIp', () => {
  function mockReq(headers: Record<string, string | undefined>, remoteAddress?: string) {
    return {
      headers,
      socket: { remoteAddress: remoteAddress || '127.0.0.1' },
    } as unknown as import('node:http').IncomingMessage;
  }

  afterEach(() => {
    delete process.env.MEMOCLAW_TRUST_PROXY;
  });

  it('returns socket address when trust proxy is disabled', () => {
    delete process.env.MEMOCLAW_TRUST_PROXY;
    const req = mockReq({ 'x-forwarded-for': '10.0.0.1' }, '192.168.1.1');
    expect(getClientIp(req)).toBe('192.168.1.1');
  });

  it('returns X-Forwarded-For first IP when trust proxy is enabled', () => {
    process.env.MEMOCLAW_TRUST_PROXY = 'true';
    const req = mockReq({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }, '192.168.1.1');
    expect(getClientIp(req)).toBe('10.0.0.1');
  });

  it('falls back to socket address when XFF is missing even with trust proxy', () => {
    process.env.MEMOCLAW_TRUST_PROXY = 'true';
    const req = mockReq({}, '192.168.1.1');
    expect(getClientIp(req)).toBe('192.168.1.1');
  });

  it('returns "unknown" when no IP available', () => {
    delete process.env.MEMOCLAW_TRUST_PROXY;
    const req = { headers: {}, socket: {} } as unknown as import('node:http').IncomingMessage;
    expect(getClientIp(req)).toBe('unknown');
  });
});

// --- HTTP integration tests ---

function buildRateLimitedHandler(
  opts: {
    perIpLimit?: number;
    globalLimit?: number;
    sessionLimit?: number;
    windowMs?: number;
  } = {},
) {
  const config = {
    perIpLimit: opts.perIpLimit ?? 5,
    globalLimit: opts.globalLimit ?? 20,
    sessionLimit: opts.sessionLimit ?? 2,
    windowMs: opts.windowMs ?? 60_000,
  };
  const limiter = new RateLimiter();
  const sessions = new Map<string, boolean>();


  return {
    limiter,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', 'http://localhost');

      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (url.pathname === '/mcp') {
        const clientIp = getClientIp(req);

        // Global rate limit
        const globalCheck = limiter.check('__global__', config.globalLimit, config.windowMs);
        if (!globalCheck.allowed) {
          const retryAfter = Math.ceil(globalCheck.retryAfterMs / 1000);
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) });
          res.end(JSON.stringify({ error: 'Too many requests (global limit). Try again later.' }));
          return;
        }

        // Per-IP rate limit
        const ipCheck = limiter.check(`ip:${clientIp}`, config.perIpLimit, config.windowMs);
        if (!ipCheck.allowed) {
          const retryAfter = Math.ceil(ipCheck.retryAfterMs / 1000);
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) });
          res.end(JSON.stringify({ error: 'Too many requests. Try again later.' }));
          return;
        }

        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        // Session creation (POST without session ID)
        if (req.method === 'POST' && !sessionId) {
          const sessionCheck = limiter.check(`session:${clientIp}`, config.sessionLimit, config.windowMs);
          if (!sessionCheck.allowed) {
            const retryAfter = Math.ceil(sessionCheck.retryAfterMs / 1000);
            res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) });
            res.end(JSON.stringify({ error: 'Too many new sessions. Try again later.' }));
            return;
          }
          const newId = `session-${sessions.size + 1}`;
          sessions.set(newId, true);
          res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': newId });
          res.end(JSON.stringify({ jsonrpc: '2.0', result: { ok: true }, id: 1 }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', result: { ok: true }, id: 1 }));
        return;
      }

      res.writeHead(404);
      res.end();
    },
  };
}

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: HttpServer; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function stopServer(server: HttpServer): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('HTTP Rate Limiting Integration', () => {
  let server: HttpServer;
  let port: number;
  let ctx: ReturnType<typeof buildRateLimitedHandler>;

  beforeEach(async () => {
    ctx = buildRateLimitedHandler({ perIpLimit: 3, globalLimit: 10, sessionLimit: 2 });
    const result = await startServer(ctx.handler);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    ctx.limiter.dispose();
    await stopServer(server);
  });

  it('allows requests within per-IP limit', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'existing' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
      });
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 when per-IP limit exceeded', async () => {
    // Use up the limit
    for (let i = 0; i < 3; i++) {
      await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'existing' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
      });
    }

    // Next request should be rate limited
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'existing' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('Too many requests');
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('does not rate limit /health endpoint', async () => {
    // Exhaust per-IP limit on /mcp
    for (let i = 0; i < 3; i++) {
      await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'existing' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
      });
    }

    // Health check should still work
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
  });

  it('returns 429 when session creation limit exceeded', async () => {
    // Create sessions up to the limit
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      expect(res.status).toBe(200);
    }

    // Third session creation should be rate limited
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('Too many new sessions');
  });

  it('returns 429 when global limit exceeded', async () => {
    // Use a handler with a very low global limit
    ctx.limiter.dispose();
    await stopServer(server);

    ctx = buildRateLimitedHandler({ perIpLimit: 100, globalLimit: 3, sessionLimit: 100 });
    const result = await startServer(ctx.handler);
    server = result.server;
    port = result.port;

    for (let i = 0; i < 3; i++) {
      await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'existing' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
      });
    }

    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'existing' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain('global limit');
  });

  it('ignores X-Forwarded-For when MEMOCLAW_TRUST_PROXY is not set', async () => {
    // Without trust proxy, all requests from the same socket IP should share rate limits
    // regardless of X-Forwarded-For header values
    delete process.env.MEMOCLAW_TRUST_PROXY;

    for (let i = 0; i < 3; i++) {
      await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `10.0.0.${i}`,
          'Mcp-Session-Id': 'existing',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
      });
    }

    // Even with a different X-Forwarded-For, should be rate limited (same socket IP)
    const blocked = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '99.99.99.99',
        'Mcp-Session-Id': 'existing',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });
    expect(blocked.status).toBe(429);
  });

  it('respects X-Forwarded-For when MEMOCLAW_TRUST_PROXY is enabled', async () => {
    // Recreate with trust proxy enabled
    ctx.limiter.dispose();
    await stopServer(server);
    process.env.MEMOCLAW_TRUST_PROXY = 'true';

    ctx = buildRateLimitedHandler({ perIpLimit: 3, globalLimit: 100, sessionLimit: 100 });
    const result = await startServer(ctx.handler);
    server = result.server;
    port = result.port;

    // Exhaust limit for IP 1.2.3.4
    for (let i = 0; i < 3; i++) {
      await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '1.2.3.4',
          'Mcp-Session-Id': 'existing',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
      });
    }

    // 1.2.3.4 should be rate limited
    const blocked = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '1.2.3.4',
        'Mcp-Session-Id': 'existing',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });
    expect(blocked.status).toBe(429);

    // Different IP should still be allowed
    const allowed = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '5.6.7.8',
        'Mcp-Session-Id': 'existing',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'test', id: 1 }),
    });
    expect(allowed.status).toBe(200);

    delete process.env.MEMOCLAW_TRUST_PROXY;
  });
});
