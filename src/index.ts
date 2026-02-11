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
  { name: 'memoclaw', version: '1.1.0' },
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
      name: 'memoclaw_update',
      description: 'Update a memory by ID. Can change content (triggers re-embedding), metadata, importance, memory_type, namespace, or expires_at. Only provided fields are updated.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory ID to update' },
          content: { type: 'string', description: 'New memory content (triggers re-embedding)' },
          metadata: { type: 'object', description: 'New metadata (replaces existing)' },
          importance: { type: 'number', description: 'New importance score 0-1' },
          memory_type: { type: 'string', description: 'New memory type: correction, preference, decision, project, observation, general' },
          namespace: { type: 'string', description: 'Move to a different namespace' },
          expires_at: { type: ['string', 'null'], description: 'ISO 8601 expiration date, or null to clear' },
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
      description: 'Ingest a conversation or text and auto-extract + relate memories. Zero-effort: just send messages and MemoClaw handles extraction, storage, deduplication, and relationship creation.',
      inputSchema: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', description: 'Message role (user, assistant, system)' },
                content: { type: 'string', description: 'Message content' },
              },
              required: ['role', 'content'],
            },
            description: 'Conversation messages to ingest',
          },
          text: { type: 'string', description: 'Raw text to ingest (alternative to messages)' },
          namespace: { type: 'string', description: 'Namespace for organization' },
          session_id: { type: 'string', description: 'Session ID for grouping' },
          agent_id: { type: 'string', description: 'Agent ID for attribution' },
          auto_relate: { type: 'boolean', description: 'Auto-create relations between co-extracted facts (default true)' },
        },
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
        const { query, limit, min_similarity, tags, namespace } = args as any;
        const result = await makeRequest('POST', '/v1/recall', {
          query,
          limit,
          min_similarity,
          filters: tags ? { tags } : undefined,
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

      case 'memoclaw_update': {
        const { id, content, metadata, importance, memory_type, namespace, expires_at } = args as any;
        const body: any = {};
        if (content !== undefined) body.content = content;
        if (metadata !== undefined) body.metadata = metadata;
        if (importance !== undefined) body.importance = importance;
        if (memory_type !== undefined) body.memory_type = memory_type;
        if (namespace !== undefined) body.namespace = namespace;
        if (expires_at !== undefined) body.expires_at = expires_at;

        const result = await makeRequest('PATCH', `/v1/memories/${id}`, body);
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
        const body: any = {};
        if (messages) body.messages = messages;
        if (text) body.text = text;
        if (namespace) body.namespace = namespace;
        if (session_id) body.session_id = session_id;
        if (agent_id) body.agent_id = agent_id;
        if (auto_relate !== undefined) body.auto_relate = auto_relate;

        const result = await makeRequest('POST', '/v1/ingest', body);

        const summary = [
          `Facts extracted: ${result.facts_extracted}`,
          `Facts stored: ${result.facts_stored}`,
          `Facts deduplicated: ${result.facts_deduplicated}`,
          `Relations created: ${result.relations_created}`,
          `Memory IDs: ${result.memory_ids?.join(', ') || 'none'}`,
          `Tokens used: ${result.tokens_used}`,
        ].join('\n');

        return { content: [{ type: 'text', text: summary }] };
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
