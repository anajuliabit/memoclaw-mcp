#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { createApiClient } from './api.js';
import { TOOLS } from './tools.js';
import { createHandler } from './handlers.js';
// Read version from package.json to avoid duplication
const __dirname = dirname(fileURLToPath(import.meta.url));
let VERSION = '1.14.0';
try {
    const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
    VERSION = pkg.version;
}
catch {
    // Fallback to hardcoded version
}
const config = loadConfig();
const api = createApiClient(config);
const handleToolCall = createHandler(api, config);
const server = new Server({ name: 'memoclaw', version: VERSION }, { capabilities: { tools: {} } });
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        return await handleToolCall(name, args);
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: 'text', text: `Error: ${msg}` }],
            isError: true,
        };
    }
});
/**
 * Determine transport mode from CLI args and env vars.
 * --http or MEMOCLAW_TRANSPORT=http → Streamable HTTP
 * Otherwise → stdio (default, backward-compatible)
 */
function getTransportMode() {
    if (process.argv.includes('--http'))
        return 'http';
    if (process.env.MEMOCLAW_TRANSPORT?.toLowerCase() === 'http')
        return 'http';
    return 'stdio';
}
/** Default port for HTTP transport */
function getHttpPort() {
    const envPort = process.env.MEMOCLAW_PORT || process.env.PORT;
    if (envPort) {
        const parsed = parseInt(envPort, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed < 65536)
            return parsed;
    }
    return 3100;
}
// Start server
async function main() {
    const mode = getTransportMode();
    if (mode === 'http') {
        const port = getHttpPort();
        // Session store: map session IDs to their transports
        const sessions = new Map();
        const httpServer = createServer(async (req, res) => {
            const url = new URL(req.url || '/', `http://localhost:${port}`);
            // Health check endpoint
            if (url.pathname === '/health' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', version: VERSION }));
                return;
            }
            // MCP endpoint
            if (url.pathname === '/mcp') {
                // Extract session ID from header for existing sessions
                const sessionId = req.headers['mcp-session-id'];
                if (req.method === 'DELETE') {
                    // Session cleanup
                    if (sessionId && sessions.has(sessionId)) {
                        const transport = sessions.get(sessionId);
                        await transport.handleRequest(req, res);
                        sessions.delete(sessionId);
                    }
                    else {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'Session not found' }));
                    }
                    return;
                }
                // For GET (SSE) and POST, route to existing session or create new one
                if (sessionId && sessions.has(sessionId)) {
                    // Route to existing session transport
                    const transport = sessions.get(sessionId);
                    await transport.handleRequest(req, res);
                    return;
                }
                if (req.method === 'GET') {
                    // GET without valid session → error (SSE needs an existing session)
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid or missing session ID. Send a POST first to initialize.' }));
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
                    }
                };
                await server.connect(transport);
                // Store the session after connect so sessionId is available after first response
                await transport.handleRequest(req, res);
                if (transport.sessionId) {
                    sessions.set(transport.sessionId, transport);
                }
                return;
            }
            // 404 for everything else
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP protocol or /health for status.' }));
        });
        httpServer.listen(port, () => {
            console.error(`MemoClaw MCP server running on http://localhost:${port}/mcp (Streamable HTTP)`);
        });
    }
    else {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('MemoClaw MCP server running (free tier enabled)');
    }
}
main().catch(console.error);
