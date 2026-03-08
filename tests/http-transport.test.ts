/**
 * Tests for the Streamable HTTP transport mode.
 *
 * These tests spin up the HTTP server on a random port and exercise:
 * - GET /health endpoint
 * - POST /mcp to create a new session (MCP initialize)
 * - Routing subsequent requests to existing sessions via Mcp-Session-Id
 * - GET /mcp without session returns 400
 * - DELETE /mcp to clean up a session
 * - DELETE /mcp with unknown session returns 404
 * - Bearer token auth when MEMOCLAW_HTTP_TOKEN is set
 * - 404 for unknown paths
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

// We can't easily import the full index.ts (it auto-starts), so we replicate
// the HTTP handler logic in a testable way. This tests the HTTP routing layer.

// Mock MCP transports
class MockStreamableHTTPServerTransport {
  sessionId: string | null = null;
  onclose: (() => void) | null = null;
  private sessionIdGenerator: () => string;
  closed = false;

  constructor(opts: { sessionIdGenerator: () => string }) {
    this.sessionIdGenerator = opts.sessionIdGenerator;
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'DELETE') {
      this.closed = true;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: true }));
      return;
    }

    // On first POST, assign session ID
    if (!this.sessionId && req.method === 'POST') {
      this.sessionId = this.sessionIdGenerator();
    }

    // Simulate MCP response with session header
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Mcp-Session-Id': this.sessionId || '',
    });
    res.end(JSON.stringify({ jsonrpc: '2.0', result: { ok: true }, id: 1 }));
  }

  close() {
    this.closed = true;
    this.onclose?.();
  }
}

/** Build the HTTP handler extracted from index.ts logic */
function buildHttpHandler(opts: { token?: string; version?: string; allowedOrigins?: string } = {}) {
  const { token, version = '1.14.0', allowedOrigins: originsEnv } = opts;
  const sessions = new Map<string, MockStreamableHTTPServerTransport>();
  const sessionActivity = new Map<string, number>();

  function touchSession(id: string) {
    sessionActivity.set(id, Date.now());
  }

  // Origin allowlist (mirrors index.ts logic)
  function getAllowedOrigins(): Set<string> | 'any' {
    if (originsEnv === '*') return 'any';
    if (originsEnv) {
      return new Set(originsEnv.split(',').map((o) => o.trim().toLowerCase()).filter(Boolean));
    }
    // Default: allow localhost only (port is dynamic in tests, so accept any localhost)
    return new Set(['http://localhost', 'http://127.0.0.1']);
  }

  const allowedOriginSet = getAllowedOrigins();

  function isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true;
    if (allowedOriginSet === 'any') return true;
    return allowedOriginSet.has(origin.toLowerCase());
  }

  function setCorsHeaders(res: ServerResponse, origin: string | undefined): void {
    if (!origin) return;
    if (allowedOriginSet === 'any') {
      res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  return {
    sessions,
    sessionActivity,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost`);

      // Health check
      if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version, activeSessions: sessions.size }));
        return;
      }

      // Origin validation and CORS for /mcp
      if (url.pathname === '/mcp') {
        const origin = req.headers['origin'] as string | undefined;
        if (!isOriginAllowed(origin)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Origin "${origin}" is not allowed. Set MEMOCLAW_ALLOWED_ORIGINS to configure.` }));
          return;
        }

        setCorsHeaders(res, origin);

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
      }

      // Bearer token auth
      if (token && url.pathname === '/mcp') {
        const authHeader = req.headers['authorization'] || '';
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match || match[1] !== token) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized. Provide Authorization: Bearer <token> header.' }));
          return;
        }
      }

      // MCP endpoint
      if (url.pathname === '/mcp') {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (req.method === 'DELETE') {
          if (sessionId && sessions.has(sessionId)) {
            const transport = sessions.get(sessionId)!;
            await transport.handleRequest(req, res);
            sessions.delete(sessionId);
            sessionActivity.delete(sessionId);
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
          }
          return;
        }

        // Route to existing session
        if (sessionId && sessions.has(sessionId)) {
          const transport = sessions.get(sessionId)!;
          touchSession(sessionId);
          await transport.handleRequest(req, res);
          return;
        }

        if (req.method === 'GET') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing session ID. Send a POST first to initialize.' }));
          return;
        }

        // POST without session → new session
        const transport = new MockStreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            sessionActivity.delete(transport.sessionId);
          }
        };

        await transport.handleRequest(req, res);

        if (transport.sessionId) {
          sessions.set(transport.sessionId, transport);
          touchSession(transport.sessionId);
        }
        return;
      }

      // 404 for everything else
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP protocol or /health for status.' }));
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

describe('HTTP Transport', () => {
  let server: HttpServer;
  let port: number;
  let ctx: ReturnType<typeof buildHttpHandler>;

  beforeEach(async () => {
    ctx = buildHttpHandler({ version: '1.14.0-test' });
    const result = await startServer(ctx.handler);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    await stopServer(server);
  });

  describe('GET /health', () => {
    it('returns 200 with status, version, and activeSessions', async () => {
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        status: 'ok',
        version: '1.14.0-test',
        activeSessions: 0,
      });
    });

    it('shows active session count', async () => {
      // Create a session first
      await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      const res = await fetch(`http://localhost:${port}/health`);
      const body = await res.json();
      expect(body.activeSessions).toBe(1);
    });
  });

  describe('POST /mcp (new session)', () => {
    it('creates a new session and returns Mcp-Session-Id header', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      expect(res.status).toBe(200);
      const sessionId = res.headers.get('mcp-session-id');
      expect(sessionId).toBeTruthy();
      expect(ctx.sessions.size).toBe(1);
      expect(ctx.sessions.has(sessionId!)).toBe(true);
    });

    it('tracks session activity', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      const sessionId = res.headers.get('mcp-session-id')!;
      expect(ctx.sessionActivity.has(sessionId)).toBe(true);
      const ts = ctx.sessionActivity.get(sessionId)!;
      expect(Date.now() - ts).toBeLessThan(1000);
    });
  });

  describe('POST /mcp (existing session)', () => {
    it('routes to existing session via Mcp-Session-Id header', async () => {
      // Create session
      const initRes = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      const sessionId = initRes.headers.get('mcp-session-id')!;

      // Send another request with session ID
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
      });

      expect(res.status).toBe(200);
      // Should still be the same session, not a new one
      expect(ctx.sessions.size).toBe(1);
    });

    it('updates session activity on subsequent requests', async () => {
      const initRes = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      const sessionId = initRes.headers.get('mcp-session-id')!;
      const firstTs = ctx.sessionActivity.get(sessionId)!;

      // Small delay
      await new Promise(r => setTimeout(r, 10));

      await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': sessionId,
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
      });

      const secondTs = ctx.sessionActivity.get(sessionId)!;
      expect(secondTs).toBeGreaterThanOrEqual(firstTs);
    });

    it('creates new session if unknown session ID is provided on POST', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Mcp-Session-Id': 'nonexistent-session-id',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      expect(res.status).toBe(200);
      expect(ctx.sessions.size).toBe(1);
      // The session ID should be newly generated, not the nonexistent one
      expect(ctx.sessions.has('nonexistent-session-id')).toBe(false);
    });
  });

  describe('GET /mcp (SSE)', () => {
    it('returns 400 without valid session ID', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, { method: 'GET' });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/session/i);
    });

    it('returns 400 with invalid session ID', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'GET',
        headers: { 'Mcp-Session-Id': 'invalid-id' },
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /mcp', () => {
    it('cleans up an existing session', async () => {
      // Create session
      const initRes = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      const sessionId = initRes.headers.get('mcp-session-id')!;
      expect(ctx.sessions.size).toBe(1);

      // Delete session
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sessionId },
      });

      expect(res.status).toBe(200);
      expect(ctx.sessions.size).toBe(0);
      expect(ctx.sessionActivity.has(sessionId)).toBe(false);
    });

    it('returns 404 for unknown session', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': 'unknown-session' },
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/session not found/i);
    });

    it('returns 404 when no session ID provided', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('Unknown paths', () => {
    it('returns 404 for unknown paths', async () => {
      const res = await fetch(`http://localhost:${port}/unknown`);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found/i);
    });

    it('returns 404 for root path', async () => {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(404);
    });
  });

  describe('Multiple sessions', () => {
    it('manages multiple concurrent sessions independently', async () => {
      // Create two sessions
      const res1 = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      const res2 = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 2 }),
      });

      const sid1 = res1.headers.get('mcp-session-id')!;
      const sid2 = res2.headers.get('mcp-session-id')!;

      expect(sid1).not.toBe(sid2);
      expect(ctx.sessions.size).toBe(2);

      // Delete one session
      await fetch(`http://localhost:${port}/mcp`, {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': sid1 },
      });

      expect(ctx.sessions.size).toBe(1);
      expect(ctx.sessions.has(sid1)).toBe(false);
      expect(ctx.sessions.has(sid2)).toBe(true);
    });
  });
});

describe('HTTP Transport with Bearer Auth', () => {
  let server: HttpServer;
  let port: number;
  let ctx: ReturnType<typeof buildHttpHandler>;
  const TEST_TOKEN = 'test-secret-token-123';

  beforeEach(async () => {
    ctx = buildHttpHandler({ token: TEST_TOKEN });
    const result = await startServer(ctx.handler);
    server = result.server;
    port = result.port;
  });

  afterEach(async () => {
    await stopServer(server);
  });

  it('rejects /mcp without auth header', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  it('rejects /mcp with wrong token', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer wrong-token',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('accepts /mcp with correct token', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    expect(res.status).toBe(200);
  });

  it('allows /health without auth', async () => {
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
  });

  it('rejects DELETE /mcp without auth', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'DELETE',
      headers: { 'Mcp-Session-Id': 'some-id' },
    });
    expect(res.status).toBe(401);
  });

  it('case-insensitive Bearer prefix', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `bearer ${TEST_TOKEN}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    });
    expect(res.status).toBe(200);
  });
});

describe('CORS and Origin Validation', () => {
  describe('with default origins (localhost only)', () => {
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
      const ctx = buildHttpHandler();
      const result = await startServer(ctx.handler);
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it('allows requests without Origin header (non-browser clients)', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      expect(res.status).toBe(200);
      // No CORS headers when no Origin is sent
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('allows localhost Origin and returns CORS headers', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost');
      expect(res.headers.get('access-control-expose-headers')).toBe('Mcp-Session-Id');
      expect(res.headers.get('vary')).toContain('Origin');
    });

    it('rejects disallowed Origin with 403', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://evil.com',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/origin.*not allowed/i);
    });
  });

  describe('with wildcard origins (*)', () => {
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
      const ctx = buildHttpHandler({ allowedOrigins: '*' });
      const result = await startServer(ctx.handler);
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it('allows any Origin and returns * for Access-Control-Allow-Origin', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://any-site.com',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      // No Vary header when using wildcard
      expect(res.headers.get('vary')).toBeNull();
    });
  });

  describe('with custom origins', () => {
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
      const ctx = buildHttpHandler({ allowedOrigins: 'https://app.example.com,https://dev.example.com' });
      const result = await startServer(ctx.handler);
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it('allows configured origin', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://app.example.com',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    });

    it('rejects origin not in the list', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://other.com',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('OPTIONS preflight', () => {
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
      const ctx = buildHttpHandler({ allowedOrigins: '*' });
      const result = await startServer(ctx.handler);
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it('returns 204 with CORS headers for OPTIONS /mcp', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://webapp.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
        },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-methods')).toContain('DELETE');
      expect(res.headers.get('access-control-allow-methods')).toContain('OPTIONS');
      expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
      expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
      expect(res.headers.get('access-control-allow-headers')).toContain('Mcp-Session-Id');
      expect(res.headers.get('access-control-expose-headers')).toBe('Mcp-Session-Id');
      expect(res.headers.get('access-control-max-age')).toBe('86400');
    });

    it('returns 204 with no body for preflight', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://webapp.example.com' },
      });
      expect(res.status).toBe(204);
      const body = await res.text();
      expect(body).toBe('');
    });

    it('rejects OPTIONS from disallowed origin', async () => {
      // Use a handler with restricted origins
      await stopServer(server);
      const ctx = buildHttpHandler({ allowedOrigins: 'https://allowed.com' });
      const result = await startServer(ctx.handler);
      server = result.server;
      port = result.port;

      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://evil.com' },
      });
      expect(res.status).toBe(403);
    });
  });

  describe('CORS headers on error responses', () => {
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
      const ctx = buildHttpHandler({ allowedOrigins: '*' });
      const result = await startServer(ctx.handler);
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it('includes CORS headers on GET /mcp error response', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'GET',
        headers: { 'Origin': 'https://webapp.example.com' },
      });
      // GET without session returns 400, but should still have CORS headers
      expect(res.status).toBe(400);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('includes CORS headers on DELETE /mcp 404 response', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'DELETE',
        headers: {
          'Mcp-Session-Id': 'nonexistent',
          'Origin': 'https://webapp.example.com',
        },
      });
      expect(res.status).toBe(404);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });
});

describe('HTTP Transport CORS', () => {
  describe('with specific allowed origins', () => {
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
      const ctx = buildHttpHandler({ allowedOrigins: 'http://example.com,http://app.test' });
      const result = await startServer(ctx.handler);
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it('returns CORS headers for allowed origin', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://example.com',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://example.com');
      expect(res.headers.get('access-control-expose-headers')).toBe('Mcp-Session-Id');
      expect(res.headers.get('vary')).toBe('Origin');
    });

    it('handles OPTIONS preflight for allowed origin', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Mcp-Session-Id',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://example.com');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toContain('Mcp-Session-Id');
      expect(res.headers.get('access-control-max-age')).toBe('86400');
    });

    it('rejects disallowed origin with 403', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://evil.com',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects OPTIONS preflight for disallowed origin', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://evil.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(res.status).toBe(403);
    });

    it('does not set CORS headers when no Origin is provided', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('includes CORS headers on error responses (401)', async () => {
      const ctx2 = buildHttpHandler({ token: 'secret', allowedOrigins: 'http://example.com' });
      const { server: s2, port: p2 } = await startServer(ctx2.handler);

      try {
        const res = await fetch(`http://localhost:${p2}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Origin': 'http://example.com',
          },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
        });

        expect(res.status).toBe(401);
        // CORS headers should still be present so browser can read the error
        expect(res.headers.get('access-control-allow-origin')).toBe('http://example.com');
      } finally {
        await stopServer(s2);
      }
    });
  });

  describe('with wildcard origins', () => {
    let server: HttpServer;
    let port: number;

    beforeEach(async () => {
      const ctx = buildHttpHandler({ allowedOrigins: '*' });
      const result = await startServer(ctx.handler);
      server = result.server;
      port = result.port;
    });

    afterEach(async () => {
      await stopServer(server);
    });

    it('returns * for Access-Control-Allow-Origin', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://anything.com',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      // Wildcard should not set Vary: Origin
      expect(res.headers.get('vary')).toBeNull();
    });

    it('handles OPTIONS preflight with wildcard', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://anything.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    });
  });
});
