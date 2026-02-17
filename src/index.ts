#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from './config.js';
import { createApiClient } from './api.js';
import { TOOLS } from './tools.js';
import { createHandler } from './handlers.js';

// Read version from package.json to avoid duplication
const __dirname = dirname(fileURLToPath(import.meta.url));
let VERSION = '1.13.0';
try {
  const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf-8'));
  VERSION = pkg.version;
} catch {
  // Fallback to hardcoded version
}

const config = loadConfig();
const api = createApiClient(config);
const handleToolCall = createHandler(api, config);

const server = new Server(
  { name: 'memoclaw', version: VERSION },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    return await handleToolCall(name, args as any);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MemoClaw MCP server running (free tier enabled)');
}

main().catch(console.error);
