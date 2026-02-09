#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
const API_URL = process.env.MEMOCLAW_URL || 'https://api.memoclaw.com';
const PRIVATE_KEY = process.env.MEMOCLAW_PRIVATE_KEY;
if (!PRIVATE_KEY) {
    console.error('MEMOCLAW_PRIVATE_KEY environment variable required');
    process.exit(1);
}
// x402 payment client setup
const account = privateKeyToAccount(PRIVATE_KEY);
const signer = toClientEvmSigner(account);
const coreClient = new x402Client().register('eip155:*', new ExactEvmScheme(signer));
const client = new x402HTTPClient(coreClient);
async function makeRequest(method, path, body) {
    const url = `${API_URL}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    const options = { method, headers };
    if (body)
        options.body = JSON.stringify(body);
    let res = await fetch(url, options);
    // Handle 402 Payment Required
    if (res.status === 402) {
        const errorBody = await res.json();
        const paymentRequired = client.getPaymentRequiredResponse((name) => res.headers.get(name), errorBody);
        const paymentPayload = await client.createPaymentPayload(paymentRequired);
        const paymentHeaders = client.encodePaymentSignatureHeader(paymentPayload);
        res = await fetch(url, {
            method,
            headers: { ...headers, ...paymentHeaders },
            body: body ? JSON.stringify(body) : undefined,
        });
    }
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`HTTP ${res.status}: ${err}`);
    }
    return res.json();
}
const server = new Server({ name: 'memoclaw', version: '1.0.0' }, { capabilities: { tools: {} } });
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'memoclaw_store',
            description: 'Store a memory with semantic embeddings for later recall',
            inputSchema: {
                type: 'object',
                properties: {
                    content: { type: 'string', description: 'Memory content to store' },
                    importance: { type: 'number', description: 'Importance score 0-1 (default 0.5)' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
                    namespace: { type: 'string', description: 'Namespace for organization' },
                },
                required: ['content'],
            },
        },
        {
            name: 'memoclaw_recall',
            description: 'Recall memories via semantic search',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search query' },
                    limit: { type: 'number', description: 'Max results (default 5)' },
                    min_similarity: { type: 'number', description: 'Min similarity threshold 0-1' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
                    namespace: { type: 'string', description: 'Filter by namespace' },
                },
                required: ['query'],
            },
        },
        {
            name: 'memoclaw_list',
            description: 'List stored memories',
            inputSchema: {
                type: 'object',
                properties: {
                    limit: { type: 'number', description: 'Max results (default 20)' },
                    offset: { type: 'number', description: 'Pagination offset' },
                    tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
                    namespace: { type: 'string', description: 'Filter by namespace' },
                },
            },
        },
        {
            name: 'memoclaw_delete',
            description: 'Delete a memory by ID',
            inputSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string', description: 'Memory ID to delete' },
                },
                required: ['id'],
            },
        },
    ],
}));
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'memoclaw_store': {
                const { content, importance, tags, namespace } = args;
                const result = await makeRequest('POST', '/v1/store', {
                    content,
                    importance,
                    metadata: tags ? { tags } : undefined,
                    namespace,
                });
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'memoclaw_recall': {
                const { query, limit, min_similarity, tags, namespace } = args;
                const result = await makeRequest('POST', '/v1/recall', {
                    query,
                    limit,
                    min_similarity,
                    filters: tags ? { tags } : undefined,
                    namespace,
                });
                // Format results nicely
                const memories = result.memories || [];
                const formatted = memories.map((m) => `[${m.score?.toFixed(3) || '?'}] ${m.content}\n  tags: ${m.metadata?.tags?.join(', ') || 'none'}`).join('\n\n');
                return { content: [{ type: 'text', text: formatted || 'No memories found' }] };
            }
            case 'memoclaw_list': {
                const { limit, offset, tags, namespace } = args;
                const params = new URLSearchParams();
                if (limit)
                    params.set('limit', String(limit));
                if (offset)
                    params.set('offset', String(offset));
                if (namespace)
                    params.set('namespace', namespace);
                const result = await makeRequest('GET', `/v1/memories?${params}`);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'memoclaw_delete': {
                const { id } = args;
                const result = await makeRequest('DELETE', `/v1/memories/${id}`);
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
});
// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('MemoClaw MCP server running');
}
main().catch(console.error);
