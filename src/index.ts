#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CompleteRequestSchema,
  SetLevelRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { loadConfig } from './config.js';
import { createApiClient } from './api.js';
import { TOOLS } from './tools.js';
import { createHandler } from './handlers.js';
import { RESOURCES, RESOURCE_TEMPLATES, createResourceHandler } from './resources.js';
import { PROMPTS, createPromptHandler } from './prompts.js';
import { createCompletionHandler } from './completions.js';
import { mcpLogger } from './logging.js';
import type { LogLevel } from './logging.js';
import { RateLimiter, loadRateLimitConfig, getClientIp } from './rate-limiter.js';

// Read version from package.json to avoid duplication
const __dirname = dirname(fileURLToPath(import.meta.url));
let VERSION = 'unknown';
try {
  const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
  VERSION = pkg.version;
} catch {
  // Fallback to hardcoded version
}

// Handle --version and --help before loading config (which requires a private key)
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`memoclaw-mcp v${VERSION}

Usage: memoclaw-mcp [options]

Options:
  --http          Use Streamable HTTP transport (default: stdio)
  --version, -v   Show version number
  --help, -h      Show this help message

Environment variables:
  MEMOCLAW_PRIVATE_KEY    Wallet private key (required)
  MEMOCLAW_URL            API base URL (default: https://api.memoclaw.com)
  MEMOCLAW_TRANSPORT      Transport mode: stdio | http (default: stdio)
  MEMOCLAW_PORT           HTTP port (default: 3100)
  MEMOCLAW_TIMEOUT        Request timeout in ms (default: 30000)
  MEMOCLAW_MAX_RETRIES    Max retries for transient failures (default: 3)
  MEMOCLAW_HTTP_TOKEN     Bearer token for HTTP transport auth (optional)
  MEMOCLAW_SESSION_TTL_MS Session idle TTL in ms (default: 1800000)
  MEMOCLAW_ALLOWED_ORIGINS Comma-separated allowed origins for HTTP transport
                           (default: localhost only; set to * to allow all)
  MEMOCLAW_MAX_BODY_SIZE  Max request body size in bytes (default: 1048576 = 1MB)
                           Requests exceeding this limit receive 413 Payload Too Large

More info: https://docs.memoclaw.com`);
  process.exit(0);
}

const config = loadConfig();
const api = createApiClient(config);
const handleToolCall = createHandler(api, config);
const handleReadResource = createResourceHandler(api, config);
const handleGetPrompt = createPromptHandler(api, config);
const handleComplete = createCompletionHandler(api, config);

const SERVER_INSTRUCTIONS = [
  'MemoClaw is a semantic memory service for AI agents.',
  'Store, recall, search, and manage memories with vector search.',
  'Key constraints: max 8192 chars per memory, importance must be 0.0–1.0.',
  'Identity is wallet-based — no API keys or registration needed.',
  'Free tier: 100 API calls per wallet, then pay-per-use via x402 (USDC on Base).',
  'Use memoclaw_recall for semantic search, memoclaw_search for text/substring search.',
  'Use namespaces to isolate memories per project or context.',
  'Pin important memories, set immutable to lock from edits.',
  'Check duplicates before storing with memoclaw_check_duplicates.',
].join(' ');

const server = new Server(
  { name: 'memoclaw', version: VERSION },
  {
    capabilities: { tools: {}, resources: {}, prompts: {}, completions: {}, logging: {} },
    instructions: SERVER_INSTRUCTIONS,
  },
);

// Attach logger to server for sending notifications to clients
mcpLogger.attach(server);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// List available resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

// List resource templates
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: RESOURCE_TEMPLATES }));

// Read a resource
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  mcpLogger.debug('resource', { event: 'read', uri });
  try {
    return await handleReadResource(uri);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    mcpLogger.error('resource', { event: 'error', uri, error: msg });
    throw new Error(`Resource read failed: ${msg}`);
  }
});

// List available prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));

// Get a prompt
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    return await handleGetPrompt(name, args);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Prompt failed: ${msg}`);
  }
});

// Handle completion requests (autocomplete for prompt/resource arguments)
server.setRequestHandler(CompleteRequestSchema, async (request) => {
  const { ref, argument } = request.params;
  return await handleComplete(ref, argument);
});

// Handle logging level changes
server.setRequestHandler(SetLevelRequestSchema, async (request) => {
  const level = request.params.level as LogLevel;
  mcpLogger.setLevel(level);
  mcpLogger.info('memoclaw', `Log level set to ${level}`);
  return {};
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args, _meta } = request.params;
  mcpLogger.debug('tool', { event: 'call', tool: name, args });

  // Extract progressToken from _meta (MCP spec: optional progress reporting)
  const progressToken = _meta?.progressToken;
  const progress = progressToken
    ? async (current: number, total: number) => {
        try {
          await server.notification({
            method: 'notifications/progress' as const,
            params: { progressToken, progress: current, total },
          });
        } catch {
          // Don't let progress notification failures break the tool call
        }
      }
    : undefined;

  // Pass the abort signal from the MCP protocol layer — it fires when the
  // client sends notifications/cancelled for this request.
  const signal = extra?.signal;

  try {
    const result = await handleToolCall(name, args as any, progress, signal);
    mcpLogger.debug('tool', { event: 'success', tool: name });
    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    mcpLogger.error('tool', { event: 'error', tool: name, error: msg });
    return {
      content: [{ type: 'text', text: `Error: ${msg}`, annotations: { audience: ['user'], priority: 1.0 } }],
      isError: true,
    };
  }
});

/**
 * Determine transport mode from CLI args and env vars.
 * --http or MEMOCLAW_TRANSPORT=http → Streamable HTTP
 * Otherwise → stdio (default, backward-compatible)
 */
function getTransportMode(): 'stdio' | 'http' {
  if (process.argv.includes('--http')) return 'http';
  if (process.env.MEMOCLAW_TRANSPORT?.toLowerCase() === 'http') return 'http';
  return 'stdio';
}

/** Optional bearer token for HTTP transport auth */
function getHttpToken(): string | undefined {
  return process.env.MEMOCLAW_HTTP_TOKEN || undefined;
}

/** Default port for HTTP transport */
function getHttpPort(): number {
  const envPort = process.env.MEMOCLAW_PORT || process.env.PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed < 65536) return parsed;
  }
  return 3100;
}

// Module-level refs for graceful shutdown in HTTP mode
let _httpServer: import('node:http').Server | null = null;
let _cleanupHttp: (() => void) | null = null;

// Start server
async function main() {
  const mode = getTransportMode();

  if (mode === 'http') {
    const port = getHttpPort();

    // Session store: map session IDs to their transports + last activity time
    const sessions = new Map<string, StreamableHTTPServerTransport>();
    const sessionActivity = new Map<string, number>();

    /** Session idle TTL in ms (default 30 min, configurable via MEMOCLAW_SESSION_TTL_MS) */
    const SESSION_TTL_MS = parseInt(process.env.MEMOCLAW_SESSION_TTL_MS || '', 10) || 30 * 60 * 1000;

    /** Sweep interval to clean up idle sessions (every 5 min) */
    const sweepInterval = setInterval(
      () => {
        const now = Date.now();
        for (const [id, lastActive] of sessionActivity) {
          if (now - lastActive > SESSION_TTL_MS) {
            const transport = sessions.get(id);
            if (transport) {
              try {
                transport.close?.();
              } catch {
                /* ignore */
              }
            }
            sessions.delete(id);
            sessionActivity.delete(id);
          }
        }
      },
      5 * 60 * 1000,
    );
    sweepInterval.unref(); // Don't prevent process exit

    /** Touch session activity timestamp */
    function touchSession(id: string) {
      sessionActivity.set(id, Date.now());
    }

    const httpToken = getHttpToken();

    // Rate limiting
    const rateLimitConfig = loadRateLimitConfig();
    const rateLimiter = new RateLimiter();

    /**
     * Allowed origins for HTTP transport.
     * Validates Origin header to prevent DNS rebinding attacks.
     * Set MEMOCLAW_ALLOWED_ORIGINS to a comma-separated list of origins,
     * or leave unset to allow only localhost/127.0.0.1 origins by default.
     */
    function getAllowedOrigins(): Set<string> | 'any' {
      const env = process.env.MEMOCLAW_ALLOWED_ORIGINS;
      if (env === '*') return 'any';
      if (env) {
        return new Set(
          env
            .split(',')
            .map((o) => o.trim().toLowerCase())
            .filter(Boolean),
        );
      }
      // Default: allow localhost origins only (prevents DNS rebinding)
      return new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
    }

    const allowedOrigins = getAllowedOrigins();

    /**
     * Max request body size in bytes (default 1MB, configurable via MEMOCLAW_MAX_BODY_SIZE).
     * Requests exceeding this limit are rejected with 413 Payload Too Large.
     */
    const MAX_BODY_SIZE = parseInt(process.env.MEMOCLAW_MAX_BODY_SIZE || '', 10) || 1048576;

    /**
     * Check Content-Length header upfront and enforce body size limit while streaming.
     * Returns true if the request was rejected (caller should return early).
     */
    function checkBodySize(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): boolean {
      const contentLength = req.headers['content-length'];
      if (contentLength) {
        const len = parseInt(contentLength, 10);
        if (!isNaN(len) && len > MAX_BODY_SIZE) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: `Request body too large. Maximum allowed size is ${MAX_BODY_SIZE} bytes.`,
            }),
          );
          return true;
        }
      }
      return false;
    }

    /**
     * Enforce body size limit on streaming request bodies (for chunked transfers
     * or when Content-Length is missing/understated). Uses a standard 'data'
     * event listener to track incoming bytes and destroys the request if the
     * limit is exceeded.
     */
    function enforceBodyLimit(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
      let received = 0;
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_BODY_SIZE) {
          req.destroy();
          if (!res.headersSent) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: `Request body too large. Maximum allowed size is ${MAX_BODY_SIZE} bytes.`,
              }),
            );
          }
        }
      });
    }

    /**
     * Check if the Origin header is allowed.
     * Requests without an Origin header are allowed (non-browser clients, stdio proxies).
     * Requests WITH an Origin must match the allowlist to prevent DNS rebinding.
     */
    function isOriginAllowed(origin: string | undefined): boolean {
      if (!origin) return true; // Non-browser clients (curl, SDK, stdio proxy)
      if (allowedOrigins === 'any') return true;
      return allowedOrigins.has(origin.toLowerCase());
    }

    /**
     * Set CORS response headers for browser-based MCP clients.
     * Only sets Access-Control-Allow-Origin when the request Origin is validated.
     */
    function setCorsHeaders(res: import('node:http').ServerResponse, origin: string | undefined): void {
      if (!origin) return; // Non-browser request — no CORS headers needed

      // Reflect the validated origin (already checked by isOriginAllowed)
      if (allowedOrigins === 'any') {
        res.setHeader('Access-Control-Allow-Origin', '*');
      } else {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
      res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24h
    }

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // Health check endpoint (no auth required, no origin check)
      if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', version: VERSION, activeSessions: sessions.size }));
        return;
      }

      // Origin validation and CORS for /mcp
      if (url.pathname === '/mcp') {
        const origin = req.headers['origin'] as string | undefined;
        if (!isOriginAllowed(origin)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({ error: `Origin "${origin}" is not allowed. Set MEMOCLAW_ALLOWED_ORIGINS to configure.` }),
          );
          return;
        }

        // Set CORS headers on all /mcp responses (including errors below)
        setCorsHeaders(res, origin);

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }
      }

      // Bearer token auth for /mcp when MEMOCLAW_HTTP_TOKEN is set
      if (httpToken && url.pathname === '/mcp') {
        const authHeader = req.headers['authorization'] || '';
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!match || match[1] !== httpToken) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized. Provide Authorization: Bearer <token> header.' }));
          return;
        }
      }

      // MCP endpoint
      if (url.pathname === '/mcp') {
        // Rate limiting (per-IP and global)
        const clientIp = getClientIp(req);

        // Check global rate limit
        const globalCheck = rateLimiter.check('__global__', rateLimitConfig.globalLimit, rateLimitConfig.windowMs);
        if (!globalCheck.allowed) {
          const retryAfter = Math.ceil(globalCheck.retryAfterMs / 1000);
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          });
          res.end(JSON.stringify({ error: 'Too many requests (global limit). Try again later.' }));
          return;
        }

        // Check per-IP rate limit
        const ipCheck = rateLimiter.check(`ip:${clientIp}`, rateLimitConfig.perIpLimit, rateLimitConfig.windowMs);
        if (!ipCheck.allowed) {
          const retryAfter = Math.ceil(ipCheck.retryAfterMs / 1000);
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          });
          res.end(JSON.stringify({ error: 'Too many requests. Try again later.' }));
          return;
        }

        // Enforce request body size limit for POST requests (prevents DoS via large payloads)
        if (req.method === 'POST') {
          if (checkBodySize(req, res)) return;
          enforceBodyLimit(req, res);
        }

        // Extract session ID from header for existing sessions
        const sessionId = req.headers['mcp-session-id'] as string | undefined;

        if (req.method === 'DELETE') {
          // Session cleanup
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

        // For GET (SSE) and POST, route to existing session or create new one
        if (sessionId && sessions.has(sessionId)) {
          // Route to existing session transport
          const transport = sessions.get(sessionId)!;
          touchSession(sessionId);
          await transport.handleRequest(req, res);
          return;
        }

        if (req.method === 'GET') {
          // GET without valid session → error (SSE needs an existing session)
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing session ID. Send a POST first to initialize.' }));
          return;
        }

        // Check session creation rate limit (per-IP)
        const sessionCheck = rateLimiter.check(
          `session:${clientIp}`,
          rateLimitConfig.sessionLimit,
          rateLimitConfig.windowMs,
        );
        if (!sessionCheck.allowed) {
          const retryAfter = Math.ceil(sessionCheck.retryAfterMs / 1000);
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
          });
          res.end(JSON.stringify({ error: 'Too many new sessions. Try again later.' }));
          return;
        }

        // POST without session ID → new session (initialization)
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });

        // When the transport assigns a session ID, store it
        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            sessionActivity.delete(transport.sessionId);
          }
        };

        await server.connect(transport);

        // Store the session after connect so sessionId is available after first response
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
    });

    // Expose for graceful shutdown
    _httpServer = httpServer;
    _cleanupHttp = () => {
      clearInterval(sweepInterval);
      for (const [, transport] of sessions) {
        try {
          transport.close?.();
        } catch {
          /* ignore */
        }
      }
      sessions.clear();
      sessionActivity.clear();
    };

    httpServer.listen(port, () => {
      console.error(`MemoClaw MCP server running on http://localhost:${port}/mcp (Streamable HTTP)`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MemoClaw MCP server running (free tier enabled)');
  }
}

main().catch(console.error);

// Graceful shutdown
function shutdown() {
  console.error('MemoClaw MCP server shutting down...');
  // Clean up HTTP sessions, sweep interval, and stop accepting connections
  _cleanupHttp?.();
  _httpServer?.close();
  server.close().catch(() => {});
  // Give transports time to flush, then exit
  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
