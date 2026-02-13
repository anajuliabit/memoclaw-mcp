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
// Wallet setup
const account = privateKeyToAccount(PRIVATE_KEY);
// x402 client (lazy init - only when free tier exhausted)
let _x402Client = null;
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
async function getWalletAuthHeader() {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `memoclaw-auth:${timestamp}`;
    const signature = await account.signMessage({ message });
    return `${account.address}:${timestamp}:${signature}`;
}
async function makeRequest(method, path, body) {
    const url = `${API_URL}${path}`;
    const headers = {};
    const options = { method, headers };
    if (body) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    // Try free tier first
    const walletAuth = await getWalletAuthHeader();
    headers['x-wallet-auth'] = walletAuth;
    let res = await fetch(url, { ...options, headers });
    // Handle 402 Payment Required (free tier exhausted)
    if (res.status === 402) {
        const errorBody = await res.json();
        const client = getX402Client();
        const paymentRequired = client.getPaymentRequiredResponse((name) => res.headers.get(name), errorBody);
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
/**
 * Format a memory object for human-readable display.
 */
function formatMemory(m) {
    const parts = [`📝 ${m.content}`];
    if (m.id)
        parts.push(`  id: ${m.id}`);
    if (m.similarity !== undefined)
        parts.push(`  similarity: ${m.similarity.toFixed(3)}`);
    if (m.importance !== undefined)
        parts.push(`  importance: ${m.importance}`);
    if (m.memory_type)
        parts.push(`  type: ${m.memory_type}`);
    if (m.namespace)
        parts.push(`  namespace: ${m.namespace}`);
    const tags = m.tags || m.metadata?.tags;
    if (tags?.length)
        parts.push(`  tags: ${tags.join(', ')}`);
    if (m.pinned)
        parts.push(`  📌 pinned`);
    if (m.created_at)
        parts.push(`  created: ${m.created_at}`);
    return parts.join('\n');
}
const server = new Server({ name: 'memoclaw', version: '1.5.0' }, { capabilities: { tools: {} } });
// ─── Tool Definitions ────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'memoclaw_store',
        description: 'Store a new memory. The content is embedded for semantic search. ' +
            'Use tags and namespace to organize memories. Set importance (0-1) to influence recall ranking. ' +
            'Use memory_type to control how the memory decays over time. Pin important memories to prevent decay. ' +
            'Returns the created memory object with its ID. Free tier: 1000 calls/wallet.',
        inputSchema: {
            type: 'object',
            properties: {
                content: { type: 'string', description: 'The text content to remember. Be specific and self-contained — this is what gets embedded and searched.' },
                importance: { type: 'number', description: 'Importance score from 0.0 (trivial) to 1.0 (critical). Default: 0.5. Higher importance memories rank higher in recall.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization and filtering, e.g. ["project-x", "frontend"]' },
                namespace: { type: 'string', description: 'Namespace to isolate this memory, e.g. "work" or "personal". Memories in different namespaces are separate.' },
                memory_type: { type: 'string', enum: ['correction', 'preference', 'decision', 'project', 'observation', 'general'], description: 'Memory type controls decay rate. "correction" and "preference" decay slowest; "observation" decays fastest. Default: "general".' },
                session_id: { type: 'string', description: 'Session ID to group memories from the same conversation.' },
                agent_id: { type: 'string', description: 'Agent ID to scope memories to a specific agent.' },
                pinned: { type: 'boolean', description: 'If true, this memory is exempt from decay and will persist indefinitely.' },
                expires_at: { type: 'string', description: 'ISO 8601 date when this memory auto-deletes, e.g. "2025-12-31T00:00:00Z".' },
            },
            required: ['content'],
        },
    },
    {
        name: 'memoclaw_recall',
        description: 'Search memories by semantic similarity to a natural language query. ' +
            'Returns the most relevant memories ranked by similarity score (0-1). ' +
            'Use filters (tags, namespace, memory_type, after) to narrow results. ' +
            'Set include_relations=true to also fetch related memories. ' +
            'This is the primary way to retrieve memories — prefer this over memoclaw_list for finding specific information.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language search query. Describe what you\'re looking for, e.g. "user\'s favorite programming language" or "decisions about database architecture".' },
                limit: { type: 'number', description: 'Maximum number of results to return. Default: 5. Max: 50.' },
                min_similarity: { type: 'number', description: 'Minimum similarity threshold (0.0-1.0). Only return memories above this score. Default: 0. Recommended: 0.3+ for relevant results.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Only return memories that have ALL of these tags.' },
                namespace: { type: 'string', description: 'Only search within this namespace.' },
                memory_type: { type: 'string', enum: ['correction', 'preference', 'decision', 'project', 'observation', 'general'], description: 'Only return memories of this type.' },
                session_id: { type: 'string', description: 'Only return memories from this session.' },
                agent_id: { type: 'string', description: 'Only return memories from this agent.' },
                include_relations: { type: 'boolean', description: 'If true, include related memories (via relations) in the response. Useful for exploring memory graphs.' },
                after: { type: 'string', description: 'Only return memories created after this ISO 8601 date, e.g. "2025-01-01T00:00:00Z".' },
            },
            required: ['query'],
        },
    },
    {
        name: 'memoclaw_get',
        description: 'Retrieve a single memory by its exact ID. Use this when you already know the memory ID ' +
            '(e.g. from a previous recall or list result) and want to fetch its full details.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The memory ID to retrieve.' },
            },
            required: ['id'],
        },
    },
    {
        name: 'memoclaw_list',
        description: 'List memories with pagination. Returns memories in reverse chronological order. ' +
            'Use this for browsing or when you need to paginate through all memories. ' +
            'For finding specific memories, prefer memoclaw_recall (semantic search) instead.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Max results per page. Default: 20. Max: 100.' },
                offset: { type: 'number', description: 'Pagination offset (number of memories to skip). Default: 0.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (memories must have ALL specified tags).' },
                namespace: { type: 'string', description: 'Filter by namespace.' },
                session_id: { type: 'string', description: 'Filter by session ID.' },
                agent_id: { type: 'string', description: 'Filter by agent ID.' },
            },
        },
    },
    {
        name: 'memoclaw_delete',
        description: 'Permanently delete a single memory by its ID. This cannot be undone. ' +
            'Use memoclaw_recall or memoclaw_list first to find the memory ID.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The memory ID to delete.' },
            },
            required: ['id'],
        },
    },
    {
        name: 'memoclaw_bulk_delete',
        description: 'Delete multiple memories at once by their IDs. This cannot be undone. ' +
            'More efficient than calling memoclaw_delete multiple times. Max 100 IDs per call.',
        inputSchema: {
            type: 'object',
            properties: {
                ids: { type: 'array', items: { type: 'string' }, description: 'Array of memory IDs to delete. Max 100.' },
            },
            required: ['ids'],
        },
    },
    {
        name: 'memoclaw_update',
        description: 'Update an existing memory by its ID. Only the provided fields are changed — omitted fields stay the same. ' +
            'If you update content, the semantic embedding is automatically regenerated.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The memory ID to update.' },
                content: { type: 'string', description: 'New content (re-embeds automatically).' },
                importance: { type: 'number', description: 'New importance score (0.0-1.0).' },
                memory_type: { type: 'string', enum: ['correction', 'preference', 'decision', 'project', 'observation', 'general'], description: 'New memory type.' },
                namespace: { type: 'string', description: 'Move memory to a different namespace.' },
                metadata: { type: 'object', description: 'Replace metadata object.' },
                expires_at: { type: 'string', description: 'New expiry date (ISO 8601) or null to remove expiry.' },
                pinned: { type: 'boolean', description: 'Pin or unpin the memory.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags array.' },
            },
            required: ['id'],
        },
    },
    {
        name: 'memoclaw_status',
        description: 'Check your wallet\'s free tier usage. Shows remaining API calls out of the 1000 free calls per wallet. ' +
            'Call this to know if you\'re about to hit the limit before paid (x402) kicks in.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'memoclaw_ingest',
        description: 'Bulk-ingest a conversation or raw text. The server extracts facts, deduplicates against existing memories, ' +
            'and optionally creates relations between them. This is the easiest way to store many memories at once — ' +
            'just dump the conversation and let the server do the work. Provide either messages OR text, not both.',
        inputSchema: {
            type: 'object',
            properties: {
                messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } }, description: 'Conversation messages array [{role: "user", content: "..."}, {role: "assistant", content: "..."}].' },
                text: { type: 'string', description: 'Raw text to extract facts from (alternative to messages).' },
                namespace: { type: 'string', description: 'Namespace for all extracted memories.' },
                session_id: { type: 'string', description: 'Session ID for all extracted memories.' },
                agent_id: { type: 'string', description: 'Agent ID for all extracted memories.' },
                auto_relate: { type: 'boolean', description: 'Auto-create relations between extracted facts. Default: true.' },
            },
        },
    },
    {
        name: 'memoclaw_extract',
        description: 'Extract structured facts from a conversation via LLM, without auto-relating them. ' +
            'Unlike memoclaw_ingest, this does NOT create relations between facts. ' +
            'Use this when you want to review extracted facts before relating them.',
        inputSchema: {
            type: 'object',
            properties: {
                messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } }, description: 'Conversation messages to extract facts from.' },
                namespace: { type: 'string', description: 'Namespace for extracted memories.' },
                session_id: { type: 'string', description: 'Session ID.' },
                agent_id: { type: 'string', description: 'Agent ID.' },
            },
            required: ['messages'],
        },
    },
    {
        name: 'memoclaw_consolidate',
        description: 'Merge similar/duplicate memories by clustering. Reduces memory clutter and combines redundant information. ' +
            'Use dry_run=true first to preview what would be merged without actually changing anything.',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: { type: 'string', description: 'Only consolidate within this namespace.' },
                min_similarity: { type: 'number', description: 'Minimum similarity (0.0-1.0) for two memories to be considered duplicates. Higher = stricter. Default: server-side default.' },
                mode: { type: 'string', description: 'Consolidation strategy/mode.' },
                dry_run: { type: 'boolean', description: 'If true, returns what WOULD be merged without actually merging. Always try this first.' },
            },
        },
    },
    {
        name: 'memoclaw_suggested',
        description: 'Get proactive memory suggestions: stale memories that may need refreshing, fresh/hot memories trending up, ' +
            'or decaying memories that might be lost soon. Useful for memory maintenance and review.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Max results. Default: 10.' },
                namespace: { type: 'string', description: 'Filter by namespace.' },
                session_id: { type: 'string', description: 'Filter by session.' },
                agent_id: { type: 'string', description: 'Filter by agent.' },
                category: { type: 'string', enum: ['stale', 'fresh', 'hot', 'decaying'], description: 'Filter by category: "stale" = not accessed recently, "fresh" = recently created, "hot" = frequently accessed, "decaying" = losing importance over time.' },
            },
        },
    },
    {
        name: 'memoclaw_create_relation',
        description: 'Create a directed relationship between two memories. Relations form a knowledge graph ' +
            'that helps with contextual recall. Example: memory A "supersedes" memory B (correction).',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: { type: 'string', description: 'Source memory ID (the "from" side of the relation).' },
                target_id: { type: 'string', description: 'Target memory ID (the "to" side of the relation).' },
                relation_type: { type: 'string', enum: ['related_to', 'derived_from', 'contradicts', 'supersedes', 'supports'], description: 'Type of relationship: "related_to" = general association, "derived_from" = B was source for A, "contradicts" = A conflicts with B, "supersedes" = A replaces B, "supports" = A reinforces B.' },
                metadata: { type: 'object', description: 'Optional metadata for the relation.' },
            },
            required: ['memory_id', 'target_id', 'relation_type'],
        },
    },
    {
        name: 'memoclaw_list_relations',
        description: 'List all relationships for a specific memory (both incoming and outgoing). ' +
            'Use this to explore the memory graph and understand how memories connect.',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: { type: 'string', description: 'Memory ID to list relations for.' },
            },
            required: ['memory_id'],
        },
    },
    {
        name: 'memoclaw_delete_relation',
        description: 'Delete a specific relationship between memories.',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: { type: 'string', description: 'Source memory ID.' },
                relation_id: { type: 'string', description: 'The relation ID to delete (from memoclaw_list_relations).' },
            },
            required: ['memory_id', 'relation_id'],
        },
    },
    {
        name: 'memoclaw_export',
        description: 'Export all memories as a JSON array. Useful for backup, migration, or analysis. ' +
            'Optionally filter by namespace or agent_id. Returns the full memory objects.',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: { type: 'string', description: 'Only export memories from this namespace.' },
                agent_id: { type: 'string', description: 'Only export memories from this agent.' },
                format: { type: 'string', enum: ['json', 'jsonl'], description: 'Export format. Default: "json".' },
            },
        },
    },
    {
        name: 'memoclaw_bulk_store',
        description: 'Store multiple memories in a single call. More efficient than calling memoclaw_store in a loop. ' +
            'Each memory in the array can have its own tags, namespace, importance, etc. Max 50 memories per call. ' +
            'Returns the list of created memory objects with their IDs.',
        inputSchema: {
            type: 'object',
            properties: {
                memories: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: 'The text content to remember.' },
                            importance: { type: 'number', description: 'Importance score (0.0-1.0). Default: 0.5.' },
                            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization.' },
                            namespace: { type: 'string', description: 'Namespace to isolate this memory.' },
                            memory_type: { type: 'string', enum: ['correction', 'preference', 'decision', 'project', 'observation', 'general'], description: 'Memory type.' },
                            pinned: { type: 'boolean', description: 'Pin to prevent decay.' },
                        },
                        required: ['content'],
                    },
                    description: 'Array of memory objects to store. Each must have at least a "content" field. Max 50.',
                },
                session_id: { type: 'string', description: 'Session ID applied to all memories.' },
                agent_id: { type: 'string', description: 'Agent ID applied to all memories.' },
            },
            required: ['memories'],
        },
    },
    {
        name: 'memoclaw_count',
        description: 'Get a count of memories, optionally filtered by namespace, tags, or agent_id. ' +
            'Faster than memoclaw_list when you only need the total number. ' +
            'Useful for monitoring memory usage or checking if a namespace has any memories.',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: { type: 'string', description: 'Count only memories in this namespace.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Count only memories with ALL of these tags.' },
                agent_id: { type: 'string', description: 'Count only memories from this agent.' },
                memory_type: { type: 'string', enum: ['correction', 'preference', 'decision', 'project', 'observation', 'general'], description: 'Count only memories of this type.' },
            },
        },
    },
];
// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            case 'memoclaw_store': {
                const { content, importance, tags, namespace, memory_type, session_id, agent_id, expires_at, pinned } = args;
                if (!content || (typeof content === 'string' && content.trim() === '')) {
                    throw new Error('content is required and cannot be empty');
                }
                const body = { content };
                if (importance !== undefined)
                    body.importance = importance;
                if (tags)
                    body.tags = tags;
                if (namespace)
                    body.namespace = namespace;
                if (memory_type)
                    body.memory_type = memory_type;
                if (session_id)
                    body.session_id = session_id;
                if (agent_id)
                    body.agent_id = agent_id;
                if (expires_at)
                    body.expires_at = expires_at;
                if (pinned !== undefined)
                    body.pinned = pinned;
                const result = await makeRequest('POST', '/v1/store', body);
                return { content: [{ type: 'text', text: `✅ Memory stored\n${formatMemory(result.memory || result)}\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_recall': {
                const { query, limit, min_similarity, tags, namespace, memory_type, session_id, agent_id, include_relations, after } = args;
                if (!query || (typeof query === 'string' && query.trim() === '')) {
                    throw new Error('query is required and cannot be empty');
                }
                const filters = {};
                if (tags)
                    filters.tags = tags;
                if (memory_type)
                    filters.memory_type = memory_type;
                if (after)
                    filters.after = after;
                const result = await makeRequest('POST', '/v1/recall', {
                    query,
                    limit,
                    min_similarity,
                    filters: Object.keys(filters).length > 0 ? filters : undefined,
                    namespace,
                    session_id,
                    agent_id,
                    include_relations,
                });
                const memories = result.memories || [];
                if (memories.length === 0) {
                    return { content: [{ type: 'text', text: `No memories found for query: "${query}"` }] };
                }
                const formatted = memories.map((m) => formatMemory(m)).join('\n\n');
                return { content: [{ type: 'text', text: `Found ${memories.length} memories:\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_get': {
                const { id } = args;
                if (!id)
                    throw new Error('id is required');
                const result = await makeRequest('GET', `/v1/memories/${id}`);
                return { content: [{ type: 'text', text: `${formatMemory(result.memory || result)}\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_list': {
                const { limit, offset, tags, namespace, session_id, agent_id } = args;
                const params = new URLSearchParams();
                if (limit !== undefined)
                    params.set('limit', String(limit));
                if (offset !== undefined)
                    params.set('offset', String(offset));
                if (namespace)
                    params.set('namespace', namespace);
                if (tags && Array.isArray(tags) && tags.length > 0)
                    params.set('tags', tags.join(','));
                if (session_id)
                    params.set('session_id', session_id);
                if (agent_id)
                    params.set('agent_id', agent_id);
                const result = await makeRequest('GET', `/v1/memories?${params}`);
                const memories = result.memories || result.data || [];
                const total = result.total ?? memories.length;
                const summary = `Showing ${memories.length} of ${total} memories`;
                return { content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_delete': {
                const { id } = args;
                if (!id)
                    throw new Error('id is required');
                const result = await makeRequest('DELETE', `/v1/memories/${id}`);
                return { content: [{ type: 'text', text: `🗑️ Memory ${id} deleted\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_bulk_delete': {
                const { ids } = args;
                if (!ids || !Array.isArray(ids) || ids.length === 0) {
                    throw new Error('ids is required and must be a non-empty array');
                }
                if (ids.length > 100) {
                    throw new Error('Maximum 100 IDs per bulk delete call');
                }
                // Delete in parallel with concurrency limit
                const results = await Promise.allSettled(ids.map((id) => makeRequest('DELETE', `/v1/memories/${id}`)));
                const succeeded = results.filter(r => r.status === 'fulfilled').length;
                const failed = results.filter(r => r.status === 'rejected').length;
                const errors = results
                    .map((r, i) => r.status === 'rejected' ? `${ids[i]}: ${r.reason?.message || 'unknown error'}` : null)
                    .filter(Boolean);
                let text = `🗑️ Bulk delete: ${succeeded} succeeded, ${failed} failed`;
                if (errors.length > 0)
                    text += `\n\nErrors:\n${errors.join('\n')}`;
                return { content: [{ type: 'text', text }] };
            }
            case 'memoclaw_status': {
                const data = await makeRequest('GET', '/v1/free-tier/status');
                const remaining = data.free_tier_remaining ?? 'unknown';
                const total = data.free_tier_total ?? 1000;
                const pct = typeof remaining === 'number' ? Math.round((remaining / total) * 100) : '?';
                return {
                    content: [{
                            type: 'text',
                            text: `Wallet: ${data.wallet || account.address}\nFree tier: ${remaining}/${total} calls remaining (${pct}%)`
                        }]
                };
            }
            case 'memoclaw_ingest': {
                const { messages, text, namespace, session_id, agent_id, auto_relate } = args;
                if (!messages && !text) {
                    throw new Error('Either messages or text is required');
                }
                const result = await makeRequest('POST', '/v1/ingest', {
                    messages,
                    text,
                    namespace,
                    session_id,
                    agent_id,
                    auto_relate: auto_relate !== false,
                });
                const count = result.memories_created ?? result.count ?? '?';
                return { content: [{ type: 'text', text: `📥 Ingested: ${count} memories created\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_extract': {
                const { messages, namespace, session_id, agent_id } = args;
                if (!messages || !Array.isArray(messages) || messages.length === 0) {
                    throw new Error('messages is required and must be a non-empty array');
                }
                const result = await makeRequest('POST', '/v1/memories/extract', {
                    messages, namespace, session_id, agent_id,
                });
                return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
            }
            case 'memoclaw_consolidate': {
                const { namespace, min_similarity, mode, dry_run } = args;
                const body = {};
                if (namespace)
                    body.namespace = namespace;
                if (min_similarity !== undefined)
                    body.min_similarity = min_similarity;
                if (mode)
                    body.mode = mode;
                if (dry_run !== undefined)
                    body.dry_run = dry_run;
                const result = await makeRequest('POST', '/v1/memories/consolidate', body);
                const prefix = dry_run ? '🔍 Consolidation preview (dry run)' : '✅ Consolidation complete';
                return { content: [{ type: 'text', text: `${prefix}\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_suggested': {
                const { limit, namespace, session_id, agent_id, category } = args;
                const params = new URLSearchParams();
                if (limit !== undefined)
                    params.set('limit', String(limit));
                if (namespace)
                    params.set('namespace', namespace);
                if (session_id)
                    params.set('session_id', session_id);
                if (agent_id)
                    params.set('agent_id', agent_id);
                if (category)
                    params.set('category', category);
                const qs = params.toString();
                const result = await makeRequest('GET', `/v1/suggested${qs ? '?' + qs : ''}`);
                const suggestions = result.suggestions || result.memories || [];
                if (suggestions.length === 0) {
                    return { content: [{ type: 'text', text: `No suggestions found${category ? ` for category "${category}"` : ''}.` }] };
                }
                const formatted = suggestions.map((m) => formatMemory(m)).join('\n\n');
                return { content: [{ type: 'text', text: `💡 ${suggestions.length} suggestions${category ? ` (${category})` : ''}:\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_update': {
                const { id, ...updateFields } = args;
                if (!id)
                    throw new Error('id is required');
                const result = await makeRequest('PATCH', `/v1/memories/${id}`, updateFields);
                return { content: [{ type: 'text', text: `✅ Memory ${id} updated\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_create_relation': {
                const { memory_id, target_id, relation_type, metadata } = args;
                if (!memory_id || !target_id || !relation_type) {
                    throw new Error('memory_id, target_id, and relation_type are all required');
                }
                const body = { target_id, relation_type };
                if (metadata)
                    body.metadata = metadata;
                const result = await makeRequest('POST', `/v1/memories/${memory_id}/relations`, body);
                return { content: [{ type: 'text', text: `🔗 Relation created: ${memory_id} —[${relation_type}]→ ${target_id}\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_list_relations': {
                const { memory_id } = args;
                if (!memory_id)
                    throw new Error('memory_id is required');
                const result = await makeRequest('GET', `/v1/memories/${memory_id}/relations`);
                const relations = result.relations || [];
                if (relations.length === 0) {
                    return { content: [{ type: 'text', text: `No relations found for memory ${memory_id}.` }] };
                }
                const formatted = relations.map((r) => `🔗 ${r.id || '?'}: ${r.source_id || memory_id} —[${r.relation_type}]→ ${r.target_id}`).join('\n');
                return { content: [{ type: 'text', text: `Relations for ${memory_id}:\n${formatted}\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_delete_relation': {
                const { memory_id, relation_id } = args;
                if (!memory_id || !relation_id)
                    throw new Error('memory_id and relation_id are required');
                const result = await makeRequest('DELETE', `/v1/memories/${memory_id}/relations/${relation_id}`);
                return { content: [{ type: 'text', text: `🗑️ Relation ${relation_id} deleted\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_bulk_store': {
                const { memories, session_id, agent_id } = args;
                if (!memories || !Array.isArray(memories) || memories.length === 0) {
                    throw new Error('memories is required and must be a non-empty array');
                }
                if (memories.length > 50) {
                    throw new Error('Maximum 50 memories per bulk store call');
                }
                for (const [i, m] of memories.entries()) {
                    if (!m.content || (typeof m.content === 'string' && m.content.trim() === '')) {
                        throw new Error(`Memory at index ${i} has empty content`);
                    }
                }
                // Store in parallel
                const results = await Promise.allSettled(memories.map((m) => {
                    const body = { ...m };
                    if (session_id)
                        body.session_id = session_id;
                    if (agent_id)
                        body.agent_id = agent_id;
                    return makeRequest('POST', '/v1/store', body);
                }));
                const succeeded = results.filter(r => r.status === 'fulfilled');
                const failed = results.filter(r => r.status === 'rejected');
                const stored = succeeded.map(r => r.value?.memory || r.value);
                const errors = failed.map((r, i) => {
                    const idx = results.indexOf(r);
                    return `index ${idx}: ${r.reason?.message || 'unknown error'}`;
                });
                let text = `✅ Bulk store: ${succeeded.length} stored, ${failed.length} failed`;
                if (stored.length > 0)
                    text += `\n\n${stored.map((m) => formatMemory(m)).join('\n\n')}`;
                if (errors.length > 0)
                    text += `\n\nErrors:\n${errors.join('\n')}`;
                return { content: [{ type: 'text', text }] };
            }
            case 'memoclaw_count': {
                const { namespace, tags, agent_id, memory_type } = args;
                const params = new URLSearchParams();
                params.set('limit', '1');
                params.set('offset', '0');
                if (namespace)
                    params.set('namespace', namespace);
                if (tags && Array.isArray(tags) && tags.length > 0)
                    params.set('tags', tags.join(','));
                if (agent_id)
                    params.set('agent_id', agent_id);
                if (memory_type)
                    params.set('memory_type', memory_type);
                const result = await makeRequest('GET', `/v1/memories?${params}`);
                const total = result.total ?? (result.memories || result.data || []).length;
                const filters = [namespace && `namespace=${namespace}`, memory_type && `type=${memory_type}`, agent_id && `agent=${agent_id}`, tags?.length && `tags=${tags.join(',')}`].filter(Boolean);
                const filterStr = filters.length > 0 ? ` (${filters.join(', ')})` : '';
                return { content: [{ type: 'text', text: `📊 Total memories${filterStr}: ${total}` }] };
            }
            case 'memoclaw_export': {
                const { namespace, agent_id, format: fmt } = args;
                // Fetch all memories with pagination
                const allMemories = [];
                let offset = 0;
                const pageSize = 100;
                while (true) {
                    const params = new URLSearchParams();
                    params.set('limit', String(pageSize));
                    params.set('offset', String(offset));
                    if (namespace)
                        params.set('namespace', namespace);
                    if (agent_id)
                        params.set('agent_id', agent_id);
                    const result = await makeRequest('GET', `/v1/memories?${params}`);
                    const memories = result.memories || result.data || [];
                    allMemories.push(...memories);
                    if (memories.length < pageSize)
                        break;
                    offset += pageSize;
                }
                let output;
                if (fmt === 'jsonl') {
                    output = allMemories.map(m => JSON.stringify(m)).join('\n');
                }
                else {
                    output = JSON.stringify(allMemories, null, 2);
                }
                return { content: [{ type: 'text', text: `📦 Exported ${allMemories.length} memories\n\n${output}` }] };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
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
