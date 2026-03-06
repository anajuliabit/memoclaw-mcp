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
function buildHttpHandler(opts: { token?: string; version?: string } = {}) {
  const { token, version = '1.14.0' } = opts;
  const sessions = new Map<string, MockStreamableHTTPServerTransport>();
  const sessionActivity = new Map<string, number>();

  function touchSession(id: string) {
    sessionActivity.set(id, Date.now());
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
