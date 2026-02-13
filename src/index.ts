#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
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

// Wallet setup
const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

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
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const options: RequestInit = { method, headers };
  if (body) options.body = JSON.stringify(body);

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
    
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...paymentHeaders },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HTTP ${res.status}: ${err}`);
  }

  return res.json();
}

const server = new Server(
  { name: 'memoclaw', version: '1.2.0' },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'memoclaw_store',
      description: 'Store a memory with semantic embeddings for later recall. Free tier: 1000 calls per wallet.',
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
      description: 'Recall memories via semantic search. Free tier: 1000 calls per wallet.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 5)' },
          min_similarity: { type: 'number', description: 'Min similarity threshold 0-1' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags' },
          namespace: { type: 'string', description: 'Filter by namespace' },
          memory_type: { type: 'string', enum: ['correction', 'preference', 'decision', 'project', 'observation', 'general'], description: 'Filter by memory type' },
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
    {
      name: 'memoclaw_status',
      description: 'Check free tier remaining calls for this wallet',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'memoclaw_ingest',
      description: 'Zero-effort ingestion: dump a conversation or raw text, get extracted facts, dedup, and auto-relations. Free tier: 1000 calls per wallet.',
      inputSchema: {
        type: 'object',
        properties: {
          messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } }, description: 'Conversation messages' } },
          text: { type: 'string', description: 'Raw text to ingest' },
          namespace: { type: 'string', description: 'Namespace for memories' },
          session_id: { type: 'string', description: 'Session identifier' },
          agent_id: { type: 'string', description: 'Agent identifier' },
          auto_relate: { type: 'boolean', description: 'Auto-create relations between facts (default: true)' },
        },
      },
    },
    {
      name: 'memoclaw_extract',
      description: 'Extract structured facts from a conversation via LLM without auto-relating.',
      inputSchema: {
        type: 'object',
        properties: {
          messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } }, description: 'Conversation messages' },
          namespace: { type: 'string', description: 'Namespace for memories' },
          session_id: { type: 'string', description: 'Session identifier' },
          agent_id: { type: 'string', description: 'Agent identifier' },
        },
        required: ['messages'],
      },
    },
    {
      name: 'memoclaw_consolidate',
      description: 'Merge similar memories by clustering. Use dry_run to preview.',
      inputSchema: {
        type: 'object',
        properties: {
          namespace: { type: 'string', description: 'Namespace to consolidate' },
          min_similarity: { type: 'number', description: 'Minimum similarity threshold for clustering' },
          mode: { type: 'string', description: 'Consolidation mode' },
          dry_run: { type: 'boolean', description: 'Preview without merging' },
        },
      },
    },
    {
      name: 'memoclaw_suggested',
      description: 'Get proactive memory suggestions (stale, fresh, hot, decaying).',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max results' },
          namespace: { type: 'string', description: 'Filter by namespace' },
          session_id: { type: 'string', description: 'Session identifier' },
          agent_id: { type: 'string', description: 'Agent identifier' },
          category: { type: 'string', enum: ['stale', 'fresh', 'hot', 'decaying'], description: 'Filter by category' },
        },
      },
    },
    {
      name: 'memoclaw_update',
      description: 'Update a memory by ID. Only provided fields are changed.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID to update' },
          content: { type: 'string', description: 'New content' },
          importance: { type: 'number', description: 'New importance score' },
          memory_type: { type: 'string', description: 'New memory type' },
          namespace: { type: 'string', description: 'New namespace' },
          metadata: { type: 'object', description: 'New metadata' },
          expires_at: { type: 'string', description: 'New expiry (ISO date or null)' },
          pinned: { type: 'boolean', description: 'Pin/unpin memory' },
        },
        required: ['id'],
      },
    },
    {
      name: 'memoclaw_create_relation',
      description: 'Create a relationship between two memories.',
      inputSchema: {
        type: 'object',
        properties: {
          memory_id: { type: 'string', description: 'Source memory ID' },
          target_id: { type: 'string', description: 'Target memory ID' },
          relation_type: { type: 'string', enum: ['related_to', 'derived_from', 'contradicts', 'supersedes', 'supports'], description: 'Relation type' },
          metadata: { type: 'object', description: 'Optional metadata' },
        },
        required: ['memory_id', 'target_id', 'relation_type'],
      },
    },
    {
      name: 'memoclaw_list_relations',
      description: 'List all relationships for a memory.',
      inputSchema: {
        type: 'object',
        properties: {
          memory_id: { type: 'string', description: 'Memory ID' },
        },
        required: ['memory_id'],
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
        const { content, importance, tags, namespace } = args as any;
        const result = await makeRequest('POST', '/v1/store', {
          content,
          importance,
          metadata: tags ? { tags } : undefined,
          namespace,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_recall': {
        const { query, limit, min_similarity, tags, namespace, memory_type } = args as any;
        const filters: Record<string, any> = {};
        if (tags) filters.tags = tags;
        if (memory_type) filters.memory_type = memory_type;
        const result = await makeRequest('POST', '/v1/recall', {
          query,
          limit,
          min_similarity,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
          namespace,
        });
        
        // Format results nicely
        const memories = result.memories || [];
        const formatted = memories.map((m: any) => 
          `[${m.similarity?.toFixed(3) || '?'}] ${m.content}\n  tags: ${m.metadata?.tags?.join(', ') || 'none'}`
        ).join('\n\n');
        
        return { content: [{ type: 'text', text: formatted || 'No memories found' }] };
      }

      case 'memoclaw_list': {
        const { limit, offset, tags, namespace } = args as any;
        const params = new URLSearchParams();
        if (limit) params.set('limit', String(limit));
        if (offset) params.set('offset', String(offset));
        if (namespace) params.set('namespace', namespace);
        
        const result = await makeRequest('GET', `/v1/memories?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_delete': {
        const { id } = args as any;
        const result = await makeRequest('DELETE', `/v1/memories/${id}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_status': {
        const walletAuth = await getWalletAuthHeader();
        const res = await fetch(`${API_URL}/v1/free-tier/status`, {
          headers: { 'x-wallet-auth': walletAuth }
        });
        
        if (res.ok) {
          const data = await res.json();
          return {
            content: [{
              type: 'text',
              text: `Wallet: ${data.wallet}\nFree tier: ${data.free_tier_remaining}/${data.free_tier_total} calls remaining`
            }]
          };
        } else {
          throw new Error('Failed to get status');
        }
      }

      case 'memoclaw_ingest': {
        const { messages, text, namespace, session_id, agent_id, auto_relate } = args as any;
        const result = await makeRequest('POST', '/v1/ingest', {
          messages,
          text,
          namespace,
          session_id,
          agent_id,
          auto_relate: auto_relate !== false,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_extract': {
        const { messages, namespace, session_id, agent_id } = args as any;
        const result = await makeRequest('POST', '/v1/memories/extract', {
          messages, namespace, session_id, agent_id,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_consolidate': {
        const { namespace, min_similarity, mode, dry_run } = args as any;
        const body: any = {};
        if (namespace) body.namespace = namespace;
        if (min_similarity !== undefined) body.min_similarity = min_similarity;
        if (mode) body.mode = mode;
        if (dry_run !== undefined) body.dry_run = dry_run;
        const result = await makeRequest('POST', '/v1/memories/consolidate', body);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_suggested': {
        const { limit, namespace, session_id, agent_id, category } = args as any;
        const params = new URLSearchParams();
        if (limit) params.set('limit', String(limit));
        if (namespace) params.set('namespace', namespace);
        if (session_id) params.set('session_id', session_id);
        if (agent_id) params.set('agent_id', agent_id);
        if (category) params.set('category', category);
        const qs = params.toString();
        const result = await makeRequest('GET', `/v1/suggested${qs ? '?' + qs : ''}`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_update': {
        const { id, ...updateFields } = args as any;
        const result = await makeRequest('PATCH', `/v1/memories/${id}`, updateFields);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_create_relation': {
        const { memory_id, target_id, relation_type, metadata } = args as any;
        const body: any = { target_id, relation_type };
        if (metadata) body.metadata = metadata;
        const result = await makeRequest('POST', `/v1/memories/${memory_id}/relations`, body);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_list_relations': {
        const { memory_id } = args as any;
        const result = await makeRequest('GET', `/v1/memories/${memory_id}/relations`);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
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
  console.error('MemoClaw MCP server running (free tier enabled)');
}

main().catch(console.error);
