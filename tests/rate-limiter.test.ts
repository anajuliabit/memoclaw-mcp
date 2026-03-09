/**
 * Tests for the RateLimiter class and HTTP rate limiting integration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../src/rate-limiter.js';
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

// --- HTTP integration tests ---

function buildRateLimitedHandler(opts: {
  perIpLimit?: number;
  globalLimit?: number;
  sessionLimit?: number;
  windowMs?: number;
} = {}) {
  const config = {
    perIpLimit: opts.perIpLimit ?? 5,
    globalLimit: opts.globalLimit ?? 20,
    sessionLimit: opts.sessionLimit ?? 2,
    windowMs: opts.windowMs ?? 60_000,
  };
  const limiter = new RateLimiter();
  const sessions = new Map<string, boolean>();

  function getClientIp(req: IncomingMessage): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress || 'unknown';
  }

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

function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: HttpServer; port: number }> {
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

  it('respects X-Forwarded-For for IP identification', async () => {
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
  });
});
