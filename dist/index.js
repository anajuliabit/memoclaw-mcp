#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { toClientEvmSigner } from '@x402/evm';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { homedir } from 'node:os';
/**
 * Load config from ~/.memoclaw/config.json if it exists.
 * Resolution order: explicit env var → config file → default.
 */
function loadConfig() {
    let privateKey = process.env.MEMOCLAW_PRIVATE_KEY || '';
    let apiUrl = process.env.MEMOCLAW_URL || '';
    let configSource = 'env';
    // Try config file if env vars are missing
    if (!privateKey || !apiUrl) {
        try {
            const configPath = join(homedir(), '.memoclaw', 'config.json');
            const raw = readFileSync(configPath, 'utf-8');
            const config = JSON.parse(raw);
            if (!privateKey && config.privateKey) {
                privateKey = config.privateKey;
                configSource = 'config file (~/.memoclaw/config.json)';
            }
            if (!apiUrl && config.url) {
                apiUrl = config.url;
            }
        }
        catch {
            // Config file doesn't exist or is invalid — that's fine
        }
    }
    if (!apiUrl)
        apiUrl = 'https://api.memoclaw.com';
    if (!privateKey) {
        console.error('MemoClaw: No private key found. Set MEMOCLAW_PRIVATE_KEY env var or run `memoclaw init`.');
        process.exit(1);
    }
    return { privateKey, apiUrl, configSource };
}
const { privateKey: PRIVATE_KEY, apiUrl: API_URL, configSource: CONFIG_SOURCE } = loadConfig();
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
        // Ensure Content-Type is preserved on retry when body is present
        const retryHeaders = { ...headers, ...paymentHeaders };
        if (body && !retryHeaders['Content-Type']) {
            retryHeaders['Content-Type'] = 'application/json';
        }
        res = await fetch(url, {
            method,
            headers: retryHeaders,
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
 * Handles missing/malformed fields gracefully.
 */
function formatMemory(m) {
    if (!m)
        return '(empty memory)';
    const parts = [`📝 ${m.content || '(no content)'}`];
    if (m.id)
        parts.push(`  id: ${m.id}`);
    if (m.similarity !== undefined && m.similarity !== null) {
        parts.push(`  similarity: ${typeof m.similarity === 'number' ? m.similarity.toFixed(3) : String(m.similarity)}`);
    }
    if (m.importance !== undefined && m.importance !== null)
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
    if (m.expires_at)
        parts.push(`  expires: ${m.expires_at}`);
    if (m.created_at)
        parts.push(`  created: ${m.created_at}`);
    if (m.updated_at && m.updated_at !== m.created_at)
        parts.push(`  updated: ${m.updated_at}`);
    return parts.join('\n');
}
/**
 * Run promises with concurrency limit.
 */
async function withConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let idx = 0;
    async function worker() {
        while (idx < tasks.length) {
            const i = idx++;
            try {
                results[i] = { status: 'fulfilled', value: await tasks[i]() };
            }
            catch (reason) {
                results[i] = { status: 'rejected', reason };
            }
        }
    }
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
}
/** Maximum content length per memory (server enforces 8192 chars) */
const MAX_CONTENT_LENGTH = 8192;
function validateContentLength(content, label = 'content') {
    if (content.length > MAX_CONTENT_LENGTH) {
        throw new Error(`${label} exceeds the ${MAX_CONTENT_LENGTH} character limit (got ${content.length} chars). ` +
            `Split the content into smaller memories or summarize it.`);
    }
}
/** Allowed fields for the update endpoint */
const UPDATE_FIELDS = new Set([
    'content', 'importance', 'memory_type', 'namespace',
    'metadata', 'expires_at', 'pinned', 'tags',
]);
const server = new Server({ name: 'memoclaw', version: '1.13.0' }, { capabilities: { tools: {} } });
// ─── Tool Definitions ────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'memoclaw_store',
        description: 'Store a new memory. The content is embedded for semantic search. ' +
            'Use tags and namespace to organize memories. Set importance (0-1) to influence recall ranking. ' +
            'Use memory_type to control how the memory decays over time. Pin important memories to prevent decay. ' +
            'Returns the created memory object with its ID. Free tier: 100 calls/wallet.',
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
        description: '🔍 SEMANTIC SEARCH: Find memories by meaning, not exact words. ' +
            'This tool finds memories that are similar in meaning to your query, even if they don\'t contain the exact same words. ' +
            'Example queries: "what does the user prefer for X?" finds memories about user preferences; "decisions about database" finds memories about DB decisions. ' +
            'Returns results ranked by similarity score (0-1). Use min_similarity=0.3+ to filter low-quality matches. ' +
            'Use filters (tags, namespace, memory_type, session_id, agent_id, after) to narrow results. ' +
            'Set include_relations=true to also fetch related memories via the knowledge graph. ' +
            '💡 TIP: If you know the memory ID, use memoclaw_get (faster). For exact keyword matching, use memoclaw_search.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Natural language search query. Describe what you\'re looking for in plain English, e.g. "user\'s favorite programming language" or "what was decided about the database".' },
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
        name: 'memoclaw_search',
        description: '🔎 KEYWORD SEARCH: Find memories containing exact keywords or phrases. ' +
            'Unlike memoclaw_recall (semantic search), this does exact string matching — finds memories that contain the exact words you specify. ' +
            'Example: query="python" finds memories with "python" in them; query="error failed" finds memories with both words. ' +
            'Use this for debugging, finding specific technical terms, or when you need exact matches. ' +
            'For finding similar meanings (semantic search), use memoclaw_recall instead.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Keyword or phrase to search for. Matches memories containing this text (case-insensitive).' },
                limit: { type: 'number', description: 'Maximum number of results. Default: 20. Max: 100.' },
                namespace: { type: 'string', description: 'Only search within this namespace.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Only return memories with ALL of these tags.' },
                memory_type: { type: 'string', enum: ['correction', 'preference', 'decision', 'project', 'observation', 'general'], description: 'Only return memories of this type.' },
                session_id: { type: 'string', description: 'Only return memories from this session.' },
                agent_id: { type: 'string', description: 'Only return memories from this agent.' },
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
        description: '📋 LIST: Browse all memories chronologically (newest first). ' +
            'Use this for pagination through all memories or browsing recent entries. ' +
            'Supports filtering by tags, namespace, memory_type, session_id, agent_id. ' +
            '💡 TIP: For finding specific information by meaning, use memoclaw_recall (semantic search). ' +
            '💡 TIP: For finding specific keywords, use memoclaw_search (keyword search).',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Max results per page. Default: 20. Max: 100.' },
                offset: { type: 'number', description: 'Pagination offset (number of memories to skip). Default: 0.' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (memories must have ALL specified tags).' },
                namespace: { type: 'string', description: 'Filter by namespace.' },
                memory_type: { type: 'string', enum: ['correction', 'preference', 'decision', 'project', 'observation', 'general'], description: 'Filter by memory type.' },
                session_id: { type: 'string', description: 'Filter by session ID.' },
                agent_id: { type: 'string', description: 'Filter by agent ID.' },
                after: { type: 'string', description: 'Only return memories created after this ISO 8601 date, e.g. "2025-01-01T00:00:00Z".' },
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
        description: 'Check your wallet\'s free tier usage. Shows remaining API calls out of the 100 free calls per wallet. ' +
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
        name: 'memoclaw_import',
        description: 'Import memories from a JSON array. Each object must have a "content" field. ' +
            'Useful for restoring from a backup or migrating from another system. ' +
            'Optional fields: importance, tags, namespace, memory_type, pinned. Max 100 per call.',
        inputSchema: {
            type: 'object',
            properties: {
                memories: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: 'Memory content.' },
                            importance: { type: 'number', description: 'Importance (0.0-1.0).' },
                            tags: { type: 'array', items: { type: 'string' }, description: 'Tags.' },
                            namespace: { type: 'string', description: 'Namespace.' },
                            memory_type: { type: 'string', description: 'Memory type.' },
                            pinned: { type: 'boolean', description: 'Pin status.' },
                        },
                        required: ['content'],
                    },
                    description: 'Array of memory objects to import. Each must have "content". Max 100.',
                },
                session_id: { type: 'string', description: 'Session ID applied to all imported memories.' },
                agent_id: { type: 'string', description: 'Agent ID applied to all imported memories.' },
            },
            required: ['memories'],
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
        description: 'Get a count of memories, optionally filtered by namespace, tags, memory_type, or agent_id. ' +
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
    {
        name: 'memoclaw_delete_namespace',
        description: 'Delete ALL memories in a namespace. This is destructive and cannot be undone. ' +
            'Use memoclaw_count first to see how many memories will be affected. ' +
            'Requires the namespace parameter — will not delete unnamespaced memories.',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: { type: 'string', description: 'The namespace whose memories will be deleted. All memories in this namespace are permanently removed.' },
                agent_id: { type: 'string', description: 'Only delete memories from this agent within the namespace.' },
            },
            required: ['namespace'],
        },
    },
    {
        name: 'memoclaw_init',
        description: 'Check if MemoClaw is properly configured and ready to use. ' +
            'Returns configuration status: whether MEMOCLAW_PRIVATE_KEY is set, the API URL, ' +
            'wallet address, and free tier remaining calls. ' +
            'Call this FIRST before using any other MemoClaw tools to verify the connection works. ' +
            'If something is misconfigured, the response includes setup instructions.',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'memoclaw_migrate',
        description: 'Migrate local markdown memory files into MemoClaw in bulk. ' +
            'Accepts EITHER a directory/file path OR an array of file objects with content. ' +
            'Each markdown file is parsed and sent to the MemoClaw /v1/migrate endpoint for server-side ' +
            'extraction, deduplication, and storage. ' +
            'Use this to onboard existing agent memory files (e.g. daily notes, MEMORY.md) into MemoClaw. ' +
            'Supports .md and .txt files. Recursively scans directories. ' +
            'Returns a summary of how many memories were created and any errors.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Absolute or relative path to a markdown file or directory of markdown files. Directories are scanned recursively for .md and .txt files.' },
                files: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            filename: { type: 'string', description: 'Original filename (for context, e.g. "2025-01-15.md").' },
                            content: { type: 'string', description: 'The full text content of the file.' },
                        },
                        required: ['content'],
                    },
                    description: 'Array of file objects to migrate. Use this when you already have the file contents in memory. Each object needs at least "content".',
                },
                namespace: { type: 'string', description: 'Namespace for all migrated memories. Defaults to "migrated".' },
                agent_id: { type: 'string', description: 'Agent ID to associate with migrated memories.' },
                deduplicate: { type: 'boolean', description: 'If true (default), the server deduplicates against existing memories before storing.' },
                dry_run: { type: 'boolean', description: 'If true, returns what WOULD be migrated without actually storing anything.' },
            },
        },
    },
    {
        name: 'memoclaw_graph',
        description: 'Traverse the memory graph starting from a given memory. Returns the memory and its connected ' +
            'neighbors up to the specified depth. Useful for exploring clusters of related memories. ' +
            'Each result includes the relation type and direction.',
        inputSchema: {
            type: 'object',
            properties: {
                memory_id: { type: 'string', description: 'Starting memory ID for graph traversal.' },
                depth: { type: 'number', description: 'How many hops to traverse. Default: 1. Max: 3.' },
                relation_type: { type: 'string', enum: ['related_to', 'derived_from', 'contradicts', 'supersedes', 'supports'], description: 'Only follow relations of this type. Default: all types.' },
            },
            required: ['memory_id'],
        },
    },
    {
        name: 'memoclaw_pin',
        description: '📌 Pin a memory to prevent it from decaying over time. ' +
            'Pinned memories persist indefinitely and are never auto-deleted by decay. ' +
            'Shortcut for memoclaw_update with pinned=true.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The memory ID to pin.' },
            },
            required: ['id'],
        },
    },
    {
        name: 'memoclaw_unpin',
        description: '📌 Unpin a memory, re-enabling normal decay behavior. ' +
            'After unpinning, the memory will decay according to its memory_type. ' +
            'Shortcut for memoclaw_update with pinned=false.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The memory ID to unpin.' },
            },
            required: ['id'],
        },
    },
    {
        name: 'memoclaw_tags',
        description: '🏷️ List all unique tags across your memories with counts. ' +
            'Use this to discover what tags exist before filtering recall/list/search by tags. ' +
            'Returns tags sorted by usage count (most used first). ' +
            '⚠️ May be slow for wallets with many memories (falls back to client-side pagination if /v1/tags is unavailable).',
        inputSchema: {
            type: 'object',
            properties: {
                namespace: { type: 'string', description: 'Only list tags from memories in this namespace.' },
                agent_id: { type: 'string', description: 'Only list tags for this agent.' },
            },
        },
    },
    {
        name: 'memoclaw_history',
        description: '📜 View the edit history of a specific memory. Shows all past versions including content changes, ' +
            'importance updates, tag modifications, and other field changes over time. ' +
            'Use this to audit how a memory evolved or to understand when and what was changed.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'The memory ID to view history for.' },
            },
            required: ['id'],
        },
    },
    {
        name: 'memoclaw_namespaces',
        description: 'List all namespaces that contain memories. Returns an array of namespace names with memory counts. ' +
            'Use this to discover what namespaces exist before filtering recall/list/search by namespace. ' +
            'Memories without a namespace appear under "(default)". ' +
            '⚠️ May be slow for wallets with many memories (falls back to client-side pagination if /v1/namespaces is unavailable).',
        inputSchema: {
            type: 'object',
            properties: {
                agent_id: { type: 'string', description: 'Only list namespaces for this agent.' },
            },
        },
    },
    {
        name: 'memoclaw_context',
        description: '🧠 CONTEXT: Get contextually relevant memories for your current situation. ' +
            'Unlike memoclaw_recall (single query), this uses GPT-4o-mini to analyze your prompt and ' +
            'intelligently select the most relevant memories across multiple dimensions (semantic similarity, ' +
            'recency, importance, relations). ' +
            'Use this when you need a curated set of memories for a complex task — e.g. "prepare for a meeting with Bob" ' +
            'or "what do I know about the frontend migration?". ' +
            'Returns a ranked list of memories with relevance explanations. ' +
            'Costs $0.01 per call (uses GPT-4o-mini + embeddings).',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Describe your current situation or what you need context for. Be descriptive — e.g. "preparing a code review for the auth module" rather than just "auth".' },
                limit: { type: 'number', description: 'Maximum number of memories to return. Default: 10. Max: 50.' },
                namespace: { type: 'string', description: 'Only include memories from this namespace.' },
                session_id: { type: 'string', description: 'Prioritize memories from this session.' },
                agent_id: { type: 'string', description: 'Only include memories from this agent.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'memoclaw_batch_update',
        description: 'Update multiple memories in a single call. Each update specifies a memory ID and the fields to change. ' +
            'More efficient than calling memoclaw_update in a loop. Max 50 updates per call. ' +
            'If any update changes content, the embedding is regenerated. ' +
            'Costs $0.005 per call (uses embeddings).',
        inputSchema: {
            type: 'object',
            properties: {
                updates: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', description: 'The memory ID to update.' },
                            content: { type: 'string', description: 'New content (re-embeds automatically).' },
                            importance: { type: 'number', description: 'New importance score (0.0-1.0).' },
                            memory_type: { type: 'string', enum: ['correction', 'preference', 'decision', 'project', 'observation', 'general'], description: 'New memory type.' },
                            namespace: { type: 'string', description: 'Move memory to a different namespace.' },
                            metadata: { type: 'object', description: 'Replace metadata object.' },
                            expires_at: { type: 'string', description: 'New expiry date (ISO 8601) or null to remove.' },
                            pinned: { type: 'boolean', description: 'Pin or unpin the memory.' },
                            tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags array.' },
                        },
                        required: ['id'],
                    },
                    description: 'Array of update objects. Each must have an "id" and at least one field to change. Max 50.',
                },
            },
            required: ['updates'],
        },
    },
    {
        name: 'memoclaw_core_memories',
        description: '⭐ Get your most important memories — high importance, frequently accessed, or pinned. ' +
            'Core memories are the foundational facts the agent should always have available: user preferences, ' +
            'critical corrections, key decisions. Use this at the start of a session to load essential context. ' +
            'Returns memories sorted by importance and access frequency. FREE endpoint.',
        inputSchema: {
            type: 'object',
            properties: {
                limit: { type: 'number', description: 'Maximum number of core memories to return. Default: 10. Max: 50.' },
                namespace: { type: 'string', description: 'Only return core memories from this namespace.' },
                agent_id: { type: 'string', description: 'Only return core memories for this agent.' },
            },
        },
    },
    {
        name: 'memoclaw_stats',
        description: '📊 Get memory usage statistics for your wallet. Returns aggregate stats including total memories, ' +
            'pinned count, access counts, average importance, oldest/newest memory timestamps, and breakdowns ' +
            'by memory type and namespace. FREE endpoint — call this to get an overview of your memory usage.',
        inputSchema: {
            type: 'object',
            properties: {},
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
                validateContentLength(content);
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
            case 'memoclaw_search': {
                const { query, limit, namespace, tags, memory_type, session_id, agent_id, after } = args;
                if (!query || (typeof query === 'string' && query.trim() === '')) {
                    throw new Error('query is required and cannot be empty');
                }
                // Build query params for keyword search
                const params = new URLSearchParams();
                params.set('q', query); // keyword query
                if (limit !== undefined)
                    params.set('limit', String(limit));
                if (namespace)
                    params.set('namespace', namespace);
                if (tags && Array.isArray(tags) && tags.length > 0)
                    params.set('tags', tags.join(','));
                if (memory_type)
                    params.set('memory_type', memory_type);
                if (session_id)
                    params.set('session_id', session_id);
                if (agent_id)
                    params.set('agent_id', agent_id);
                if (after)
                    params.set('after', after);
                const result = await makeRequest('GET', `/v1/memories/search?${params}`);
                const memories = result.memories || result.data || [];
                if (memories.length === 0) {
                    return { content: [{ type: 'text', text: `No memories found containing: "${query}"` }] };
                }
                const formatted = memories.map((m) => formatMemory(m)).join('\n\n');
                return { content: [{ type: 'text', text: `Found ${memories.length} memories containing "${query}":\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_get': {
                const { id } = args;
                if (!id)
                    throw new Error('id is required');
                const result = await makeRequest('GET', `/v1/memories/${id}`);
                return { content: [{ type: 'text', text: `${formatMemory(result.memory || result)}\n\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_list': {
                const { limit, offset, tags, namespace, memory_type, session_id, agent_id, after } = args;
                const params = new URLSearchParams();
                if (limit !== undefined)
                    params.set('limit', String(limit));
                if (offset !== undefined)
                    params.set('offset', String(offset));
                if (namespace)
                    params.set('namespace', namespace);
                if (memory_type)
                    params.set('memory_type', memory_type);
                if (tags && Array.isArray(tags) && tags.length > 0)
                    params.set('tags', tags.join(','));
                if (session_id)
                    params.set('session_id', session_id);
                if (agent_id)
                    params.set('agent_id', agent_id);
                if (after)
                    params.set('after', after);
                const result = await makeRequest('GET', `/v1/memories?${params}`);
                const memories = result.memories || result.data || [];
                const total = result.total ?? memories.length;
                const formatted = memories.length > 0
                    ? '\n\n' + memories.map((m) => formatMemory(m)).join('\n\n')
                    : '';
                const summary = `Showing ${memories.length} of ${total} memories`;
                return { content: [{ type: 'text', text: `${summary}${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
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
                const results = await withConcurrency(ids.map((id) => () => makeRequest('DELETE', `/v1/memories/${id}`)), 10);
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
                const total = data.free_tier_total ?? 100;
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
                const { id, ...allFields } = args;
                if (!id)
                    throw new Error('id is required');
                // Only send known update fields to avoid leaking unexpected params
                const updateFields = {};
                for (const [key, value] of Object.entries(allFields)) {
                    if (UPDATE_FIELDS.has(key) && value !== undefined) {
                        updateFields[key] = value;
                    }
                }
                if (Object.keys(updateFields).length === 0) {
                    throw new Error('No valid update fields provided. Allowed: ' + [...UPDATE_FIELDS].join(', '));
                }
                if (typeof updateFields.content === 'string') {
                    validateContentLength(updateFields.content);
                }
                const result = await makeRequest('PATCH', `/v1/memories/${id}`, updateFields);
                return { content: [{ type: 'text', text: `✅ Memory ${id} updated\n${formatMemory(result.memory || result)}\n\n${JSON.stringify(result, null, 2)}` }] };
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
            case 'memoclaw_export': {
                const { namespace, agent_id, format: fmt } = args;
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
            case 'memoclaw_import': {
                const { memories, session_id, agent_id } = args;
                if (!memories || !Array.isArray(memories) || memories.length === 0) {
                    throw new Error('memories is required and must be a non-empty array');
                }
                if (memories.length > 100) {
                    throw new Error('Maximum 100 memories per import call');
                }
                for (const [i, m] of memories.entries()) {
                    if (!m.content || (typeof m.content === 'string' && m.content.trim() === '')) {
                        throw new Error(`Memory at index ${i} has empty content`);
                    }
                    validateContentLength(m.content, `Memory at index ${i}`);
                }
                const results = await withConcurrency(memories.map((m) => () => {
                    const body = { content: m.content };
                    if (m.importance !== undefined)
                        body.importance = m.importance;
                    if (m.tags)
                        body.tags = m.tags;
                    if (m.namespace)
                        body.namespace = m.namespace;
                    if (m.memory_type)
                        body.memory_type = m.memory_type;
                    if (m.pinned !== undefined)
                        body.pinned = m.pinned;
                    if (session_id)
                        body.session_id = session_id;
                    if (agent_id)
                        body.agent_id = agent_id;
                    return makeRequest('POST', '/v1/store', body);
                }), 10);
                const succeeded = results.filter(r => r.status === 'fulfilled').length;
                const failed = results.filter(r => r.status === 'rejected').length;
                const errors = results
                    .map((r, i) => r.status === 'rejected' ? `index ${i}: ${r.reason?.message || 'unknown error'}` : null)
                    .filter(Boolean);
                let text = `📥 Import: ${succeeded} stored, ${failed} failed`;
                if (errors.length > 0)
                    text += `\n\nErrors:\n${errors.join('\n')}`;
                return { content: [{ type: 'text', text }] };
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
                    validateContentLength(m.content, `Memory at index ${i}`);
                }
                const STORE_FIELDS = ['content', 'importance', 'tags', 'namespace', 'memory_type', 'pinned', 'expires_at'];
                const results = await withConcurrency(memories.map((m) => () => {
                    const body = {};
                    for (const key of STORE_FIELDS) {
                        if (m[key] !== undefined)
                            body[key] = m[key];
                    }
                    if (session_id)
                        body.session_id = session_id;
                    if (agent_id)
                        body.agent_id = agent_id;
                    return makeRequest('POST', '/v1/store', body);
                }), 10);
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
                if (namespace)
                    params.set('namespace', namespace);
                if (tags && Array.isArray(tags) && tags.length > 0)
                    params.set('tags', tags.join(','));
                if (agent_id)
                    params.set('agent_id', agent_id);
                if (memory_type)
                    params.set('memory_type', memory_type);
                let total = 'unknown';
                try {
                    // Try dedicated count endpoint first
                    const countResult = await makeRequest('GET', `/v1/memories/count?${params}`);
                    total = countResult.count ?? countResult.total ?? 'unknown';
                }
                catch {
                    // Fall back to list endpoint - paginate to get accurate count
                    // First try with limit=1 to check if API returns total in response
                    params.set('limit', '1');
                    params.set('offset', '0');
                    const result = await makeRequest('GET', `/v1/memories?${params}`);
                    if (typeof result.total === 'number') {
                        total = result.total;
                    }
                    else {
                        // No total field - paginate to count all memories
                        const memories = result.memories || result.data || [];
                        if (memories.length === 0) {
                            total = 0;
                        }
                        else {
                            // Paginate with larger pages to count
                            let counted = 0;
                            let offset = 0;
                            const pageSize = 100;
                            const maxItems = 100000; // Safety limit
                            while (offset < maxItems) {
                                const pageParams = new URLSearchParams(params);
                                pageParams.set('limit', String(pageSize));
                                pageParams.set('offset', String(offset));
                                const page = await makeRequest('GET', `/v1/memories?${pageParams}`);
                                const items = page.memories || page.data || [];
                                counted += items.length;
                                if (typeof page.total === 'number') {
                                    total = page.total;
                                    break;
                                }
                                if (items.length < pageSize) {
                                    total = counted;
                                    break;
                                }
                                offset += pageSize;
                            }
                            if (typeof total === 'undefined')
                                total = `${counted}+`;
                        }
                    }
                }
                const filters = [namespace && `namespace=${namespace}`, memory_type && `type=${memory_type}`, agent_id && `agent=${agent_id}`, tags?.length && `tags=${tags.join(',')}`].filter(Boolean);
                const filterStr = filters.length > 0 ? ` (${filters.join(', ')})` : '';
                return { content: [{ type: 'text', text: `📊 Total memories${filterStr}: ${total}` }] };
            }
            case 'memoclaw_delete_namespace': {
                const { namespace, agent_id } = args;
                if (!namespace)
                    throw new Error('namespace is required');
                // Paginate through all memories in namespace and delete them
                const deletedIds = [];
                const errors = [];
                const failedIds = new Set();
                let pages = 0;
                const pageSize = 100;
                const maxPages = 200; // Safety valve: 200 pages × 100 = 20k max
                while (pages < maxPages) {
                    pages++;
                    const params = new URLSearchParams();
                    params.set('limit', String(pageSize));
                    // Offset past memories we already tried and failed to delete
                    params.set('offset', String(failedIds.size));
                    params.set('namespace', namespace);
                    if (agent_id)
                        params.set('agent_id', agent_id);
                    const result = await makeRequest('GET', `/v1/memories?${params}`);
                    const memories = result.memories || result.data || [];
                    if (memories.length === 0)
                        break;
                    // Filter out memories we already failed to delete (in case offset doesn't skip them exactly)
                    const toDelete = memories.filter((m) => !failedIds.has(m.id));
                    if (toDelete.length === 0)
                        break;
                    const deleteResults = await withConcurrency(toDelete.map((m) => () => makeRequest('DELETE', `/v1/memories/${m.id}`)), 10);
                    let pageSuccesses = 0;
                    for (let i = 0; i < deleteResults.length; i++) {
                        if (deleteResults[i].status === 'fulfilled') {
                            deletedIds.push(toDelete[i].id);
                            pageSuccesses++;
                        }
                        else {
                            failedIds.add(toDelete[i].id);
                            errors.push(`${toDelete[i].id}: ${deleteResults[i].reason?.message || 'unknown'}`);
                        }
                    }
                    // If we got fewer than pageSize, we're done
                    if (memories.length < pageSize)
                        break;
                    // If nothing was deleted on this page, all remaining are errors — stop
                    if (pageSuccesses === 0)
                        break;
                }
                let text = `🗑️ Namespace "${namespace}": ${deletedIds.length} memories deleted`;
                if (errors.length > 0)
                    text += `, ${errors.length} failed\n\nErrors:\n${errors.slice(0, 10).join('\n')}`;
                return { content: [{ type: 'text', text }] };
            }
            case 'memoclaw_graph': {
                const { memory_id, depth: rawDepth, relation_type } = args;
                if (!memory_id)
                    throw new Error('memory_id is required');
                const depth = Math.min(Math.max(rawDepth || 1, 1), 3);
                // BFS traversal
                const visited = new Set();
                const nodes = [];
                const edges = [];
                let frontier = [memory_id];
                for (let d = 0; d <= depth && frontier.length > 0; d++) {
                    const nextFrontier = [];
                    for (const mid of frontier) {
                        if (visited.has(mid))
                            continue;
                        visited.add(mid);
                        // Fetch memory
                        try {
                            const mem = await makeRequest('GET', `/v1/memories/${mid}`);
                            nodes.push(mem.memory || mem);
                        }
                        catch {
                            nodes.push({ id: mid, content: '(could not fetch)' });
                        }
                        // Fetch relations (skip on last depth level)
                        if (d < depth) {
                            try {
                                const relResult = await makeRequest('GET', `/v1/memories/${mid}/relations`);
                                const relations = relResult.relations || [];
                                for (const r of relations) {
                                    if (relation_type && r.relation_type !== relation_type)
                                        continue;
                                    edges.push(r);
                                    const neighbor = r.target_id === mid ? r.source_id : r.target_id;
                                    if (neighbor && !visited.has(neighbor)) {
                                        nextFrontier.push(neighbor);
                                    }
                                }
                            }
                            catch {
                                // No relations or error - continue
                            }
                        }
                    }
                    frontier = nextFrontier;
                }
                const nodesFmt = nodes.map((n) => formatMemory(n)).join('\n\n');
                const edgesFmt = edges.map((r) => `  ${r.source_id} —[${r.relation_type}]→ ${r.target_id}`).join('\n');
                return { content: [{ type: 'text', text: `🕸️ Graph from ${memory_id} (depth ${depth}):\n\n${nodes.length} nodes:\n${nodesFmt}\n\n${edges.length} edges:\n${edgesFmt || '  (none)'}` }] };
            }
            case 'memoclaw_init': {
                const checks = [];
                let healthy = true;
                // 1. Private key
                checks.push(`✅ Private key loaded (source: ${CONFIG_SOURCE})`);
                checks.push(`📍 API URL: ${API_URL}`);
                checks.push(`👛 Wallet: ${account.address}`);
                // 2. Test API connectivity + free tier
                try {
                    const data = await makeRequest('GET', '/v1/free-tier/status');
                    const remaining = data.free_tier_remaining ?? 'unknown';
                    const total = data.free_tier_total ?? 100;
                    checks.push(`✅ API reachable`);
                    checks.push(`📊 Free tier: ${remaining}/${total} calls remaining`);
                    if (typeof remaining === 'number' && remaining <= 0) {
                        checks.push(`⚠️ Free tier exhausted — x402 payments will be used`);
                    }
                }
                catch (err) {
                    healthy = false;
                    checks.push(`❌ API unreachable: ${err.message}`);
                    checks.push(`\n💡 Setup instructions:`);
                    checks.push(`   1. Run \`memoclaw init\` (easiest — creates ~/.memoclaw/config.json)`);
                    checks.push(`   2. Or set MEMOCLAW_PRIVATE_KEY env var to an EVM private key (0x...)`);
                    checks.push(`   3. Optionally set MEMOCLAW_URL (default: https://api.memoclaw.com)`);
                    checks.push(`   4. Restart the MCP server`);
                }
                const status = healthy ? '🟢 MemoClaw is ready!' : '🔴 MemoClaw needs configuration';
                return { content: [{ type: 'text', text: `${status}\n\n${checks.join('\n')}` }] };
            }
            case 'memoclaw_migrate': {
                const { path: filePath, files, namespace, agent_id, deduplicate, dry_run } = args;
                if (!filePath && !files) {
                    throw new Error('Either "path" (file/directory path) or "files" (array of {filename, content}) is required');
                }
                // Collect file contents
                let fileList = [];
                if (files && Array.isArray(files)) {
                    fileList = files.map((f, i) => ({
                        filename: f.filename || `file-${i}.md`,
                        content: f.content,
                    }));
                }
                else if (filePath) {
                    // Read from filesystem
                    const EXTENSIONS = new Set(['.md', '.txt']);
                    async function collectFiles(p) {
                        const s = await stat(p);
                        if (s.isFile() && EXTENSIONS.has(extname(p).toLowerCase())) {
                            const content = await readFile(p, 'utf-8');
                            return [{ filename: basename(p), content }];
                        }
                        else if (s.isDirectory()) {
                            const entries = await readdir(p);
                            const results = [];
                            for (const entry of entries) {
                                if (entry.startsWith('.'))
                                    continue;
                                results.push(...await collectFiles(join(p, entry)));
                            }
                            return results;
                        }
                        return [];
                    }
                    fileList = await collectFiles(filePath);
                }
                if (fileList.length === 0) {
                    return { content: [{ type: 'text', text: '⚠️ No .md or .txt files found at the given path.' }] };
                }
                // Call the migrate endpoint
                const body = {
                    files: fileList,
                    namespace: namespace || 'migrated',
                    deduplicate: deduplicate !== false,
                };
                if (agent_id)
                    body.agent_id = agent_id;
                if (dry_run)
                    body.dry_run = true;
                try {
                    const result = await makeRequest('POST', '/v1/migrate', body);
                    const prefix = dry_run ? '🔍 Migration preview (dry run)' : '✅ Migration complete';
                    const created = result.memories_created ?? result.count ?? '?';
                    const skipped = result.duplicates_skipped ?? 0;
                    return {
                        content: [{
                                type: 'text',
                                text: `${prefix}\n\n📁 Files processed: ${fileList.length}\n📝 Memories created: ${created}\n🔄 Duplicates skipped: ${skipped}\n\n${JSON.stringify(result, null, 2)}`
                            }]
                    };
                }
                catch (err) {
                    // If /v1/migrate doesn't exist yet, fall back to ingest per file
                    if (err.message?.includes('404') || err.message?.includes('Not Found')) {
                        if (dry_run) {
                            return {
                                content: [{
                                        type: 'text',
                                        text: `🔍 Migration preview (dry run — /v1/migrate not available, would use ingest fallback)\n\n📁 ${fileList.length} files would be ingested:\n${fileList.map(f => `  • ${f.filename} (${f.content.length} chars)`).join('\n')}`
                                    }]
                            };
                        }
                        // Fallback: ingest each file via /v1/ingest
                        let totalCreated = 0;
                        const errors = [];
                        for (const file of fileList) {
                            try {
                                const r = await makeRequest('POST', '/v1/ingest', {
                                    text: file.content,
                                    namespace: namespace || 'migrated',
                                    agent_id,
                                });
                                totalCreated += r.memories_created ?? r.count ?? 0;
                            }
                            catch (e) {
                                errors.push(`${file.filename}: ${e.message}`);
                            }
                        }
                        let text = `✅ Migration complete (via ingest fallback)\n\n📁 Files processed: ${fileList.length}\n📝 Memories created: ${totalCreated}`;
                        if (errors.length > 0)
                            text += `\n\n❌ Errors:\n${errors.join('\n')}`;
                        return { content: [{ type: 'text', text }] };
                    }
                    throw err;
                }
            }
            case 'memoclaw_pin': {
                const { id } = args;
                if (!id)
                    throw new Error('id is required');
                const result = await makeRequest('PATCH', `/v1/memories/${id}`, { pinned: true });
                return { content: [{ type: 'text', text: `📌 Memory ${id} pinned\n${formatMemory(result.memory || result)}` }] };
            }
            case 'memoclaw_unpin': {
                const { id } = args;
                if (!id)
                    throw new Error('id is required');
                const result = await makeRequest('PATCH', `/v1/memories/${id}`, { pinned: false });
                return { content: [{ type: 'text', text: `📌 Memory ${id} unpinned\n${formatMemory(result.memory || result)}` }] };
            }
            case 'memoclaw_tags': {
                const { namespace, agent_id } = args;
                // Try dedicated /v1/tags endpoint first (fast, server-side aggregation)
                try {
                    const params = new URLSearchParams();
                    if (namespace)
                        params.set('namespace', namespace);
                    if (agent_id)
                        params.set('agent_id', agent_id);
                    const qs = params.toString();
                    const result = await makeRequest('GET', `/v1/tags${qs ? '?' + qs : ''}`);
                    if (result.tags) {
                        const tags = result.tags;
                        if (tags.length === 0) {
                            return { content: [{ type: 'text', text: 'No tags found across memories.' }] };
                        }
                        const lines = tags.map((t) => typeof t === 'string' ? `  • ${t}` : `  • ${t.tag || t.name}: ${t.count} memories`);
                        return { content: [{ type: 'text', text: `🏷️ ${tags.length} tags:\n\n${lines.join('\n')}` }] };
                    }
                }
                catch {
                    // Endpoint not available — fall back to client-side aggregation
                }
                const tagCounts = new Map();
                let offset = 0;
                const pageSize = 100;
                const maxPages = 200;
                for (let page = 0; page < maxPages; page++) {
                    const params = new URLSearchParams();
                    params.set('limit', String(pageSize));
                    params.set('offset', String(offset));
                    if (namespace)
                        params.set('namespace', namespace);
                    if (agent_id)
                        params.set('agent_id', agent_id);
                    const result = await makeRequest('GET', `/v1/memories?${params}`);
                    const memories = result.memories || result.data || [];
                    if (memories.length === 0)
                        break;
                    for (const m of memories) {
                        const tags = m.tags || m.metadata?.tags || [];
                        for (const tag of tags) {
                            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
                        }
                    }
                    if (memories.length < pageSize)
                        break;
                    offset += pageSize;
                }
                if (tagCounts.size === 0) {
                    return { content: [{ type: 'text', text: 'No tags found across memories.' }] };
                }
                const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
                const lines = sorted.map(([tag, count]) => `  • ${tag}: ${count} memories`);
                return { content: [{ type: 'text', text: `🏷️ ${sorted.length} tags:\n\n${lines.join('\n')}` }] };
            }
            case 'memoclaw_history': {
                const { id } = args;
                if (!id)
                    throw new Error('id is required');
                const result = await makeRequest('GET', `/v1/memories/${id}/history`);
                const history = result.history || result.versions || result.data || [];
                if (history.length === 0) {
                    return { content: [{ type: 'text', text: `No edit history found for memory ${id}.` }] };
                }
                const formatted = history.map((entry, i) => {
                    const parts = [`Version ${i + 1}`];
                    if (entry.content)
                        parts.push(`  content: ${entry.content.substring(0, 200)}${entry.content.length > 200 ? '...' : ''}`);
                    if (entry.importance !== undefined)
                        parts.push(`  importance: ${entry.importance}`);
                    if (entry.tags?.length)
                        parts.push(`  tags: ${entry.tags.join(', ')}`);
                    if (entry.memory_type)
                        parts.push(`  type: ${entry.memory_type}`);
                    if (entry.namespace)
                        parts.push(`  namespace: ${entry.namespace}`);
                    if (entry.pinned !== undefined)
                        parts.push(`  pinned: ${entry.pinned}`);
                    if (entry.changed_at || entry.updated_at || entry.created_at) {
                        parts.push(`  date: ${entry.changed_at || entry.updated_at || entry.created_at}`);
                    }
                    if (entry.changed_fields)
                        parts.push(`  changed: ${Array.isArray(entry.changed_fields) ? entry.changed_fields.join(', ') : entry.changed_fields}`);
                    return parts.join('\n');
                }).join('\n\n');
                return { content: [{ type: 'text', text: `📜 History for memory ${id} (${history.length} versions):\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_context': {
                const { query, limit, namespace, session_id, agent_id } = args;
                if (!query || (typeof query === 'string' && query.trim() === '')) {
                    throw new Error('query is required and cannot be empty');
                }
                const body = { query };
                if (limit !== undefined)
                    body.limit = limit;
                if (namespace)
                    body.namespace = namespace;
                if (session_id)
                    body.session_id = session_id;
                if (agent_id)
                    body.agent_id = agent_id;
                const result = await makeRequest('POST', '/v1/context', body);
                const memories = result.memories || result.context || [];
                if (memories.length === 0) {
                    return { content: [{ type: 'text', text: `No relevant context found for: "${query}"` }] };
                }
                const formatted = memories.map((m) => formatMemory(m)).join('\n\n');
                return { content: [{ type: 'text', text: `🧠 Context for "${query}" (${memories.length} memories):\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_namespaces': {
                const { agent_id } = args;
                // Try dedicated /v1/namespaces endpoint first (fast, server-side aggregation)
                try {
                    const params = new URLSearchParams();
                    if (agent_id)
                        params.set('agent_id', agent_id);
                    const qs = params.toString();
                    const result = await makeRequest('GET', `/v1/namespaces${qs ? '?' + qs : ''}`);
                    if (result.namespaces) {
                        const namespaces = result.namespaces;
                        if (namespaces.length === 0) {
                            return { content: [{ type: 'text', text: 'No memories found — no namespaces to list.' }] };
                        }
                        const lines = namespaces.map((n) => typeof n === 'string' ? `  • ${n}` : `  • ${n.namespace || n.name || '(default)'}: ${n.count} memories`);
                        return { content: [{ type: 'text', text: `📁 ${namespaces.length} namespaces:\n\n${lines.join('\n')}` }] };
                    }
                }
                catch {
                    // Endpoint not available — fall back to client-side aggregation
                }
                const nsCounts = new Map();
                let offset = 0;
                const pageSize = 100;
                const maxPages = 200;
                for (let page = 0; page < maxPages; page++) {
                    const params = new URLSearchParams();
                    params.set('limit', String(pageSize));
                    params.set('offset', String(offset));
                    if (agent_id)
                        params.set('agent_id', agent_id);
                    const result = await makeRequest('GET', `/v1/memories?${params}`);
                    const memories = result.memories || result.data || [];
                    if (memories.length === 0)
                        break;
                    for (const m of memories) {
                        const ns = m.namespace || '(default)';
                        nsCounts.set(ns, (nsCounts.get(ns) || 0) + 1);
                    }
                    if (memories.length < pageSize)
                        break;
                    offset += pageSize;
                }
                if (nsCounts.size === 0) {
                    return { content: [{ type: 'text', text: 'No memories found — no namespaces to list.' }] };
                }
                const sorted = [...nsCounts.entries()].sort((a, b) => b[1] - a[1]);
                const lines = sorted.map(([ns, count]) => `  • ${ns}: ${count} memories`);
                return { content: [{ type: 'text', text: `📁 ${sorted.length} namespaces:\n\n${lines.join('\n')}` }] };
            }
            case 'memoclaw_batch_update': {
                const { updates } = args;
                if (!updates || !Array.isArray(updates) || updates.length === 0) {
                    throw new Error('updates is required and must be a non-empty array');
                }
                if (updates.length > 50) {
                    throw new Error('Maximum 50 updates per batch update call');
                }
                for (const [i, u] of updates.entries()) {
                    if (!u.id)
                        throw new Error(`Update at index ${i} is missing "id"`);
                }
                // Try dedicated batch endpoint first, fall back to individual PATCH calls
                try {
                    const result = await makeRequest('POST', '/v1/memories/batch-update', { updates });
                    const updated = result.updated ?? result.memories?.length ?? '?';
                    const memories = result.memories || [];
                    let text = `✅ Batch update: ${updated} memories updated`;
                    if (memories.length > 0)
                        text += `\n\n${memories.map((m) => formatMemory(m)).join('\n\n')}`;
                    return { content: [{ type: 'text', text: `${text}\n\n${JSON.stringify(result, null, 2)}` }] };
                }
                catch (err) {
                    if (err.message?.includes('404') || err.message?.includes('Not Found')) {
                        // Fallback: individual PATCH calls
                        const results = await withConcurrency(updates.map((u) => () => {
                            const { id, ...fields } = u;
                            const updateFields = {};
                            for (const [key, value] of Object.entries(fields)) {
                                if (UPDATE_FIELDS.has(key) && value !== undefined) {
                                    updateFields[key] = value;
                                }
                            }
                            return makeRequest('PATCH', `/v1/memories/${id}`, updateFields);
                        }), 10);
                        const succeeded = results.filter(r => r.status === 'fulfilled');
                        const failed = results.filter(r => r.status === 'rejected');
                        const memories = succeeded.map(r => r.value?.memory || r.value);
                        const errors = failed.map((r) => {
                            const idx = results.indexOf(r);
                            return `${updates[idx]?.id}: ${r.reason?.message || 'unknown error'}`;
                        });
                        let text = `✅ Batch update: ${succeeded.length} updated, ${failed.length} failed`;
                        if (memories.length > 0)
                            text += `\n\n${memories.map((m) => formatMemory(m)).join('\n\n')}`;
                        if (errors.length > 0)
                            text += `\n\nErrors:\n${errors.join('\n')}`;
                        return { content: [{ type: 'text', text }] };
                    }
                    throw err;
                }
            }
            case 'memoclaw_core_memories': {
                const { limit, namespace, agent_id } = args;
                const params = new URLSearchParams();
                if (limit !== undefined)
                    params.set('limit', String(limit));
                if (namespace)
                    params.set('namespace', namespace);
                if (agent_id)
                    params.set('agent_id', agent_id);
                const qs = params.toString();
                const result = await makeRequest('GET', `/v1/core-memories${qs ? '?' + qs : ''}`);
                const memories = result.memories || result.core_memories || result.data || [];
                if (memories.length === 0) {
                    return { content: [{ type: 'text', text: 'No core memories found. Store important memories with high importance scores or pin them.' }] };
                }
                const formatted = memories.map((m) => formatMemory(m)).join('\n\n');
                return { content: [{ type: 'text', text: `⭐ ${memories.length} core memories:\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
            }
            case 'memoclaw_stats': {
                const result = await makeRequest('GET', '/v1/stats');
                const lines = [];
                if (result.total_memories !== undefined)
                    lines.push(`Total memories: ${result.total_memories}`);
                if (result.pinned_count !== undefined)
                    lines.push(`Pinned: ${result.pinned_count}`);
                if (result.never_accessed !== undefined)
                    lines.push(`Never accessed: ${result.never_accessed}`);
                if (result.total_accesses !== undefined)
                    lines.push(`Total accesses: ${result.total_accesses}`);
                if (result.avg_importance !== undefined)
                    lines.push(`Avg importance: ${typeof result.avg_importance === 'number' ? result.avg_importance.toFixed(2) : result.avg_importance}`);
                if (result.oldest_memory)
                    lines.push(`Oldest: ${result.oldest_memory}`);
                if (result.newest_memory)
                    lines.push(`Newest: ${result.newest_memory}`);
                if (result.by_type?.length) {
                    lines.push('\nBy type:');
                    for (const t of result.by_type)
                        lines.push(`  • ${t.memory_type || t.type}: ${t.count}`);
                }
                if (result.by_namespace?.length) {
                    lines.push('\nBy namespace:');
                    for (const n of result.by_namespace)
                        lines.push(`  • ${n.namespace || '(default)'}: ${n.count}`);
                }
                return { content: [{ type: 'text', text: `📊 Memory Stats\n\n${lines.join('\n')}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
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
