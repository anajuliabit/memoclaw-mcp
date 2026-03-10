/**
 * MCP tool definitions for MemoClaw.
 * Each tool maps to an API endpoint or composite operation.
 *
 * Per MCP spec 2025-06-18:
 *   title — human-readable display name (top-level tool property)
 *
 * Annotations (tool behavior hints):
 *   readOnlyHint  — true if the tool does not modify server-side state
 *   destructiveHint — true if the tool may permanently delete data
 *   idempotentHint — true if calling multiple times with the same args has no extra effect
 *   openWorldHint — true if the tool interacts with external entities beyond MemoClaw
 */

const MEMORY_TYPE_ENUM = ['correction', 'preference', 'decision', 'project', 'observation', 'general'] as const;

// ── Output schemas (MCP 2025-06-18) ─────────────────────────────────────────
// When outputSchema is present, tool results include structured JSON content
// alongside human-readable text. Clients can parse the structured block directly.

const MEMORY_OBJECT_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    content: { type: 'string' as const },
    importance: { type: 'number' as const },
    memory_type: { type: 'string' as const },
    namespace: { type: 'string' as const },
    tags: { type: 'array' as const, items: { type: 'string' as const } },
    pinned: { type: 'boolean' as const },
    immutable: { type: 'boolean' as const },
    expires_at: { type: 'string' as const },
    created_at: { type: 'string' as const },
    updated_at: { type: 'string' as const },
    session_id: { type: 'string' as const },
    agent_id: { type: 'string' as const },
  },
  required: ['id', 'content'] as string[],
};

const RECALL_RESULT_SCHEMA = {
  type: 'object' as const,
  properties: {
    ...MEMORY_OBJECT_SCHEMA.properties,
    similarity: { type: 'number' as const },
  },
  required: ['id', 'content'] as string[],
};

const RELATION_OBJECT_SCHEMA = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    source_id: { type: 'string' as const },
    target_id: { type: 'string' as const },
    relation_type: { type: 'string' as const },
    metadata: { type: 'object' as const },
  },
  required: ['source_id', 'target_id', 'relation_type'] as string[],
};

const TAG_OBJECT_SCHEMA = {
  type: 'object' as const,
  properties: {
    tag: { type: 'string' as const },
    count: { type: 'number' as const },
  },
  required: ['tag', 'count'] as string[],
};

const NAMESPACE_OBJECT_SCHEMA = {
  type: 'object' as const,
  properties: {
    namespace: { type: 'string' as const },
    count: { type: 'number' as const },
  },
  required: ['namespace', 'count'] as string[],
};

const COMMON_FILTERS = {
  tags: {
    type: 'array' as const,
    items: { type: 'string' as const },
    description: 'Filter by tags (memories must have ALL specified tags).',
  },
  namespace: { type: 'string' as const, description: 'Filter by namespace.' },
  memory_type: { type: 'string' as const, enum: MEMORY_TYPE_ENUM, description: 'Filter by memory type.' },
  session_id: { type: 'string' as const, description: 'Filter by session ID.' },
  agent_id: { type: 'string' as const, description: 'Filter by agent ID.' },
  pinned: {
    type: 'boolean' as const,
    description: 'Filter by pinned status. true = only pinned, false = only unpinned.',
  },
  after: {
    type: 'string' as const,
    description: 'Only return memories created after this ISO 8601 date, e.g. "2025-01-01T00:00:00Z".',
  },
  before: {
    type: 'string' as const,
    description: 'Only return memories created before this ISO 8601 date, e.g. "2025-12-31T23:59:59Z".',
  },
  metadata: {
    type: 'object' as const,
    description:
      'Filter by metadata key-value pairs. Only memories whose metadata contains ALL specified key-value pairs are returned. ' +
      'Example: {"source": "slack", "channel": "#general"}',
  },
};

export const TOOLS = [
  {
    name: 'memoclaw_store',
    description:
      'Store a new memory. The content is embedded for semantic search. ' +
      'Use tags and namespace to organize memories. Set importance (0-1) to influence recall ranking. ' +
      'Use memory_type to control how the memory decays over time. Pin important memories to prevent decay. ' +
      'Returns the created memory object with its ID. Free tier: 100 calls/wallet.',
    title: 'Store memory',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description:
            'The text content to remember. Be specific and self-contained — this is what gets embedded and searched.',
        },
        importance: {
          type: 'number',
          description:
            'Importance score from 0.0 (trivial) to 1.0 (critical). Default: 0.5. Higher importance memories rank higher in recall.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization and filtering, e.g. ["project-x", "frontend"]',
        },
        namespace: {
          type: 'string',
          description:
            'Namespace to isolate this memory, e.g. "work" or "personal". Memories in different namespaces are separate.',
        },
        memory_type: {
          type: 'string',
          enum: MEMORY_TYPE_ENUM,
          description:
            'Memory type controls decay rate. "correction" and "preference" decay slowest; "observation" decays fastest. Default: "general".',
        },
        session_id: { type: 'string', description: 'Session ID to group memories from the same conversation.' },
        agent_id: { type: 'string', description: 'Agent ID to scope memories to a specific agent.' },
        pinned: {
          type: 'boolean',
          description: 'If true, this memory is exempt from decay and will persist indefinitely.',
        },
        expires_at: {
          type: 'string',
          description: 'ISO 8601 date when this memory auto-deletes, e.g. "2025-12-31T00:00:00Z".',
        },
        immutable: {
          type: 'boolean',
          description:
            'If true, this memory cannot be updated or deleted after creation. This is a one-way operation and cannot be reversed.',
        },
        metadata: {
          type: 'object',
          description:
            'Arbitrary key-value metadata to attach to this memory. Useful for storing structured data alongside the content, e.g. {"source": "slack", "channel": "#general"}.',
        },
      },
      required: ['content'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memory: MEMORY_OBJECT_SCHEMA,
      },
      required: ['memory'] as string[],
    },
  },
  {
    name: 'memoclaw_recall',
    description:
      '🔍 SEMANTIC SEARCH: Find memories by meaning, not exact words. ' +
      "This tool finds memories that are similar in meaning to your query, even if they don't contain the exact same words. " +
      'Returns results ranked by similarity score (0-1). Use min_similarity=0.3+ to filter low-quality matches. ' +
      'Set include_relations=true to also fetch related memories via the knowledge graph. ' +
      '💡 TIP: If you know the memory ID, use memoclaw_get (faster). For exact keyword matching, use memoclaw_search.',
    title: 'Semantic recall',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: "Natural language search query. Describe what you're looking for in plain English.",
        },
        limit: { type: 'number', description: 'Maximum number of results to return. Default: 5. Max: 50.' },
        min_similarity: {
          type: 'number',
          description: 'Minimum similarity threshold (0.0-1.0). Default: 0. Recommended: 0.3+ for relevant results.',
        },
        ...COMMON_FILTERS,
        include_relations: {
          type: 'boolean',
          description: 'If true, include related memories (via relations) in the response.',
        },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memories: { type: 'array' as const, items: RECALL_RESULT_SCHEMA },
      },
      required: ['memories'] as string[],
    },
  },
  {
    name: 'memoclaw_search',
    description:
      '🔎 KEYWORD SEARCH: Find memories containing exact keywords or phrases. ' +
      'Unlike memoclaw_recall (semantic search), this does exact string matching. ' +
      'For finding similar meanings, use memoclaw_recall instead.',
    title: 'Keyword search',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Keyword or phrase to search for (case-insensitive).' },
        limit: { type: 'number', description: 'Maximum number of results. Default: 20. Max: 100.' },
        sort: {
          type: 'string',
          enum: ['created_at', 'updated_at', 'importance'],
          description: 'Sort field. Default: "created_at".',
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order. Default: "desc" (newest first).',
        },
        ...COMMON_FILTERS,
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
      },
      required: ['memories'] as string[],
    },
  },
  {
    name: 'memoclaw_get',
    description: 'Retrieve a single memory by its exact ID. Use this when you already know the memory ID.',
    title: 'Get memory',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The memory ID to retrieve.' },
      },
      required: ['id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memory: MEMORY_OBJECT_SCHEMA,
      },
      required: ['memory'] as string[],
    },
  },
  {
    name: 'memoclaw_list',
    description:
      '📋 LIST: Browse all memories chronologically (newest first). ' +
      'Supports filtering by tags, namespace, memory_type, session_id, agent_id. ' +
      '💡 TIP: For semantic search, use memoclaw_recall. For keywords, use memoclaw_search.',
    title: 'List memories',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results per page. Default: 20. Max: 100.' },
        offset: { type: 'number', description: 'Pagination offset. Default: 0.' },
        sort: {
          type: 'string',
          enum: ['created_at', 'updated_at', 'importance'],
          description: 'Sort field. Default: "created_at".',
        },
        order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort order. Default: "desc" (newest first).',
        },
        ...COMMON_FILTERS,
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
        total: { type: 'number' as const },
      },
      required: ['memories', 'total'] as string[],
    },
  },
  {
    name: 'memoclaw_delete',
    description: 'Permanently delete a single memory by its ID. This cannot be undone.',
    title: 'Delete memory',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The memory ID to delete.' },
      },
      required: ['id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        deleted: { type: 'boolean' as const },
        id: { type: 'string' as const },
      },
      required: ['deleted', 'id'] as string[],
    },
  },
  {
    name: 'memoclaw_bulk_delete',
    description: 'Delete multiple memories at once by their IDs. Max 100 IDs per call.',
    title: 'Bulk delete memories',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Array of memory IDs to delete. Max 100.' },
      },
      required: ['ids'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        succeeded: { type: 'number' as const },
        failed: { type: 'number' as const },
        errors: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['succeeded', 'failed'] as string[],
    },
  },
  {
    name: 'memoclaw_update',
    description:
      'Update an existing memory by its ID. Only provided fields are changed. ' +
      'If you update content, the semantic embedding is automatically regenerated.',
    title: 'Update memory',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The memory ID to update.' },
        content: { type: 'string', description: 'New content (re-embeds automatically).' },
        importance: { type: 'number', description: 'New importance score (0.0-1.0).' },
        memory_type: { type: 'string', enum: MEMORY_TYPE_ENUM, description: 'New memory type.' },
        namespace: { type: 'string', description: 'Move memory to a different namespace.' },
        metadata: { type: 'object', description: 'Replace metadata object.' },
        expires_at: { type: 'string', description: 'New expiry date (ISO 8601) or null to remove.' },
        pinned: { type: 'boolean', description: 'Pin or unpin the memory.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags array.' },
        immutable: {
          type: 'boolean',
          description:
            'Set to true to make this memory immutable. WARNING: This is a one-way operation — once set, the memory cannot be updated or deleted.',
        },
        session_id: { type: 'string', description: 'Update the session ID associated with this memory.' },
        agent_id: { type: 'string', description: 'Update the agent ID associated with this memory.' },
      },
      required: ['id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memory: MEMORY_OBJECT_SCHEMA,
      },
      required: ['memory'] as string[],
    },
  },
  {
    name: 'memoclaw_status',
    description: "Check your wallet's free tier usage. Shows remaining API calls out of 100.",
    title: 'Free tier status',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        wallet: { type: 'string' as const },
        free_tier_remaining: { type: 'number' as const },
        free_tier_total: { type: 'number' as const },
      },
      required: ['wallet', 'free_tier_remaining', 'free_tier_total'] as string[],
    },
  },
  {
    name: 'memoclaw_ingest',
    description:
      'Bulk-ingest a conversation or raw text. The server extracts facts, deduplicates, ' +
      'and optionally creates relations. Provide either messages OR text, not both.',
    title: 'Ingest conversation',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        messages: {
          type: 'array',
          items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } },
          description: 'Conversation messages array.',
        },
        text: { type: 'string', description: 'Raw text to extract facts from (alternative to messages).' },
        namespace: { type: 'string', description: 'Namespace for all extracted memories.' },
        session_id: { type: 'string', description: 'Session ID for all extracted memories.' },
        agent_id: { type: 'string', description: 'Agent ID for all extracted memories.' },
        auto_relate: { type: 'boolean', description: 'Auto-create relations between extracted facts. Default: true.' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memories_created: { type: 'number' as const },
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
      },
      required: ['memories_created'] as string[],
    },
  },
  {
    name: 'memoclaw_extract',
    description:
      'Extract structured facts from a conversation via LLM, without auto-relating them. ' +
      'Use this when you want to review extracted facts before relating them.',
    title: 'Extract facts',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        messages: {
          type: 'array',
          items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } },
          description: 'Conversation messages to extract facts from.',
        },
        namespace: { type: 'string', description: 'Namespace for extracted memories.' },
        session_id: { type: 'string', description: 'Session ID.' },
        agent_id: { type: 'string', description: 'Agent ID.' },
      },
      required: ['messages'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
        facts: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              content: { type: 'string' as const },
              importance: { type: 'number' as const },
              memory_type: { type: 'string' as const },
            },
          },
        },
      },
    },
  },
  {
    name: 'memoclaw_consolidate',
    description: 'Merge similar/duplicate memories by clustering. Use dry_run=true first to preview.',
    title: 'Consolidate memories',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Only consolidate within this namespace.' },
        agent_id: { type: 'string', description: 'Only consolidate memories for this agent.' },
        min_similarity: { type: 'number', description: 'Minimum similarity for duplicates (0.0-1.0).' },
        mode: { type: 'string', description: 'Consolidation strategy/mode.' },
        dry_run: { type: 'boolean', description: 'If true, returns what WOULD be merged without actually merging.' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        merged: { type: 'number' as const },
        deleted: { type: 'number' as const },
        clusters: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              kept: { type: 'string' as const },
              merged_ids: { type: 'array' as const, items: { type: 'string' as const } },
            },
          },
        },
      },
    },
  },
  {
    name: 'memoclaw_suggested',
    description: 'Get proactive memory suggestions: stale, fresh, hot, or decaying memories.',
    title: 'Suggested memories',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results. Default: 10.' },
        namespace: { type: 'string', description: 'Filter by namespace.' },
        session_id: { type: 'string', description: 'Filter by session.' },
        agent_id: { type: 'string', description: 'Filter by agent.' },
        category: { type: 'string', enum: ['stale', 'fresh', 'hot', 'decaying'], description: 'Filter by category.' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        suggestions: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
      },
      required: ['suggestions'] as string[],
    },
  },
  {
    name: 'memoclaw_create_relation',
    description: 'Create a directed relationship between two memories for the knowledge graph.',
    title: 'Create relation',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        memory_id: { type: 'string', description: 'Source memory ID.' },
        target_id: { type: 'string', description: 'Target memory ID.' },
        relation_type: {
          type: 'string',
          enum: ['related_to', 'derived_from', 'contradicts', 'supersedes', 'supports'],
          description: 'Type of relationship.',
        },
        metadata: { type: 'object', description: 'Optional metadata for the relation.' },
      },
      required: ['memory_id', 'target_id', 'relation_type'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        relation: RELATION_OBJECT_SCHEMA,
      },
      required: ['relation'] as string[],
    },
  },
  {
    name: 'memoclaw_list_relations',
    description: 'List all relationships for a specific memory (incoming and outgoing).',
    title: 'List relations',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        memory_id: { type: 'string', description: 'Memory ID to list relations for.' },
      },
      required: ['memory_id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        relations: { type: 'array' as const, items: RELATION_OBJECT_SCHEMA },
      },
      required: ['relations'] as string[],
    },
  },
  {
    name: 'memoclaw_delete_relation',
    description: 'Delete a specific relationship between memories.',
    title: 'Delete relation',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        memory_id: { type: 'string', description: 'Source memory ID.' },
        relation_id: { type: 'string', description: 'The relation ID to delete.' },
      },
      required: ['memory_id', 'relation_id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        deleted: { type: 'boolean' as const },
        relation_id: { type: 'string' as const },
      },
      required: ['deleted', 'relation_id'] as string[],
    },
  },
  {
    name: 'memoclaw_export',
    description: 'Export all memories as JSON. Useful for backup, migration, or analysis.',
    title: 'Export memories',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Only export memories from this namespace.' },
        agent_id: { type: 'string', description: 'Only export memories from this agent.' },
        format: { type: 'string', enum: ['json', 'jsonl'], description: 'Export format. Default: "json".' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
        count: { type: 'number' as const },
      },
      required: ['memories', 'count'] as string[],
    },
  },
  {
    name: 'memoclaw_import',
    description: 'Import memories from a JSON array. Each object must have a "content" field. Max 100 per call.',
    title: 'Import memories',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
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
              immutable: { type: 'boolean', description: 'Make this memory immutable.' },
              expires_at: {
                type: 'string',
                description: 'Expiration date in ISO 8601 format, e.g. "2025-12-31T23:59:59Z".',
              },
              metadata: { type: 'object', description: 'Arbitrary key-value metadata.' },
            },
            required: ['content'],
          },
          description: 'Array of memory objects to import. Max 100.',
        },
        session_id: { type: 'string', description: 'Session ID applied to all imported memories.' },
        agent_id: { type: 'string', description: 'Agent ID applied to all imported memories.' },
      },
      required: ['memories'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        succeeded: { type: 'number' as const },
        failed: { type: 'number' as const },
        errors: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['succeeded', 'failed'] as string[],
    },
  },
  {
    name: 'memoclaw_bulk_store',
    description:
      'Store multiple memories in a single call. Max 100 per call. ' +
      'Each memory can have its own tags, namespace, importance, etc.',
    title: 'Bulk store memories',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
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
              memory_type: { type: 'string', enum: MEMORY_TYPE_ENUM, description: 'Memory type.' },
              pinned: { type: 'boolean', description: 'Pin to prevent decay.' },
              immutable: { type: 'boolean', description: 'Make this memory immutable (one-way, cannot be reversed).' },
              metadata: { type: 'object', description: 'Arbitrary key-value metadata.' },
            },
            required: ['content'],
          },
          description: 'Array of memory objects. Max 100.',
        },
        session_id: { type: 'string', description: 'Session ID applied to all memories.' },
        agent_id: { type: 'string', description: 'Agent ID applied to all memories.' },
      },
      required: ['memories'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        succeeded: { type: 'number' as const },
        failed: { type: 'number' as const },
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
        errors: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['succeeded', 'failed'] as string[],
    },
  },
  {
    name: 'memoclaw_count',
    description:
      'Get a count of memories, optionally filtered. Faster than memoclaw_list when you only need the total.',
    title: 'Count memories',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Count only memories in this namespace.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Count only memories with ALL of these tags.' },
        agent_id: { type: 'string', description: 'Count only memories from this agent.' },
        memory_type: { type: 'string', enum: MEMORY_TYPE_ENUM, description: 'Count only memories of this type.' },
        session_id: { type: 'string', description: 'Count only memories from this session.' },
        pinned: { type: 'boolean', description: 'Count only pinned (true) or unpinned (false) memories.' },
        after: {
          type: 'string',
          description: 'Count only memories created after this ISO 8601 date, e.g. "2025-01-01T00:00:00Z".',
        },
        before: {
          type: 'string',
          description: 'Count only memories created before this ISO 8601 date, e.g. "2025-12-31T23:59:59Z".',
        },
        metadata: {
          type: 'object',
          description:
            'Count only memories whose metadata contains ALL specified key-value pairs. ' +
            'Example: {"source": "slack"}',
        },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        count: { type: 'number' as const },
      },
      required: ['count'] as string[],
    },
  },
  {
    name: 'memoclaw_delete_namespace',
    description:
      'Delete ALL memories in a namespace. Destructive and cannot be undone. ' +
      'Use memoclaw_count first to check how many will be affected.',
    title: 'Delete namespace',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'The namespace whose memories will be deleted.' },
        agent_id: { type: 'string', description: 'Only delete memories from this agent within the namespace.' },
      },
      required: ['namespace'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        deleted: { type: 'number' as const },
        failed: { type: 'number' as const },
        namespace: { type: 'string' as const },
        errors: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['deleted', 'namespace'] as string[],
    },
  },
  {
    name: 'memoclaw_init',
    description:
      'Check if MemoClaw is properly configured. Returns config status, wallet address, and free tier remaining. ' +
      'Call this FIRST to verify the connection works.',
    title: 'Check configuration',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        healthy: { type: 'boolean' as const },
        wallet: { type: 'string' as const },
        api_url: { type: 'string' as const },
        config_source: { type: 'string' as const },
        free_tier_remaining: { type: 'number' as const },
        free_tier_total: { type: 'number' as const },
      },
      required: ['healthy', 'wallet'] as string[],
    },
  },
  {
    name: 'memoclaw_migrate',
    description:
      'Migrate local markdown memory files into MemoClaw. ' +
      'Accepts EITHER a directory/file path OR an array of file objects. ' +
      'Supports .md and .txt files. Recursively scans directories.',
    title: 'Migrate files',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to a markdown file or directory.' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'Original filename.' },
              content: { type: 'string', description: 'File text content.' },
            },
            required: ['content'],
          },
          description: 'Array of file objects to migrate.',
        },
        namespace: { type: 'string', description: 'Namespace for migrated memories. Default: "migrated".' },
        agent_id: { type: 'string', description: 'Agent ID for migrated memories.' },
        deduplicate: { type: 'boolean', description: 'Deduplicate against existing memories. Default: true.' },
        dry_run: { type: 'boolean', description: 'Preview without storing.' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        files_processed: { type: 'number' as const },
        memories_created: { type: 'number' as const },
        duplicates_skipped: { type: 'number' as const },
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
      },
      required: ['files_processed', 'memories_created'] as string[],
    },
  },
  {
    name: 'memoclaw_graph',
    description: 'Traverse the memory graph from a starting memory up to a specified depth.',
    title: 'Traverse graph',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        memory_id: { type: 'string', description: 'Starting memory ID.' },
        depth: { type: 'number', minimum: 1, maximum: 3, description: 'Hops to traverse. Default: 1. Max: 3.' },
        relation_type: {
          type: 'string',
          enum: ['related_to', 'derived_from', 'contradicts', 'supersedes', 'supports'],
          description: 'Only follow this relation type.',
        },
      },
      required: ['memory_id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        nodes: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
        edges: { type: 'array' as const, items: RELATION_OBJECT_SCHEMA },
      },
      required: ['nodes', 'edges'] as string[],
    },
  },
  {
    name: 'memoclaw_pin',
    description: '📌 Pin a memory to prevent decay. Shortcut for memoclaw_update with pinned=true.',
    title: 'Pin memory',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'The memory ID to pin.' } },
      required: ['id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memory: MEMORY_OBJECT_SCHEMA,
      },
      required: ['memory'] as string[],
    },
  },
  {
    name: 'memoclaw_unpin',
    description: '📌 Unpin a memory, re-enabling decay. Shortcut for memoclaw_update with pinned=false.',
    title: 'Unpin memory',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'The memory ID to unpin.' } },
      required: ['id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memory: MEMORY_OBJECT_SCHEMA,
      },
      required: ['memory'] as string[],
    },
  },
  {
    name: 'memoclaw_tags',
    description: '🏷️ List all unique tags with counts. Sorted by usage (most used first).',
    title: 'List tags',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Only list tags from this namespace.' },
        agent_id: { type: 'string', description: 'Only list tags for this agent.' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        tags: { type: 'array' as const, items: TAG_OBJECT_SCHEMA },
      },
      required: ['tags'] as string[],
    },
  },
  {
    name: 'memoclaw_history',
    description: '📜 View the edit history of a specific memory.',
    title: 'Memory history',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string', description: 'The memory ID to view history for.' } },
      required: ['id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        history: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              content: { type: 'string' as const },
              importance: { type: 'number' as const },
              memory_type: { type: 'string' as const },
              namespace: { type: 'string' as const },
              tags: { type: 'array' as const, items: { type: 'string' as const } },
              pinned: { type: 'boolean' as const },
              changed_at: { type: 'string' as const },
              changed_fields: { type: 'array' as const, items: { type: 'string' as const } },
            },
          },
        },
      },
      required: ['history'] as string[],
    },
  },
  {
    name: 'memoclaw_namespaces',
    description: 'List all namespaces that contain memories with counts.',
    title: 'List namespaces',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: { agent_id: { type: 'string', description: 'Only list namespaces for this agent.' } },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        namespaces: { type: 'array' as const, items: NAMESPACE_OBJECT_SCHEMA },
      },
      required: ['namespaces'] as string[],
    },
  },
  {
    name: 'memoclaw_context',
    description:
      '🧠 CONTEXT: Get contextually relevant memories using GPT-4o-mini analysis. ' + 'Costs $0.01 per call.',
    title: 'Get context',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Describe your current situation or what you need context for.' },
        limit: { type: 'number', description: 'Max memories. Default: 10. Max: 50.' },
        namespace: { type: 'string', description: 'Filter by namespace.' },
        session_id: { type: 'string', description: 'Prioritize memories from this session.' },
        agent_id: { type: 'string', description: 'Filter by agent.' },
      },
      required: ['query'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
      },
      required: ['memories'] as string[],
    },
  },
  {
    name: 'memoclaw_batch_update',
    description: 'Update multiple memories in a single call. Max 50 updates. Costs $0.005 per call.',
    title: 'Batch update memories',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'The memory ID to update.' },
              content: { type: 'string', description: 'New content.' },
              importance: { type: 'number', description: 'New importance (0.0-1.0).' },
              memory_type: { type: 'string', enum: MEMORY_TYPE_ENUM, description: 'New memory type.' },
              namespace: { type: 'string', description: 'Move to namespace.' },
              metadata: { type: 'object', description: 'Replace metadata.' },
              expires_at: { type: 'string', description: 'New expiry (ISO 8601) or null.' },
              pinned: { type: 'boolean', description: 'Pin or unpin.' },
              tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags.' },
              immutable: { type: 'boolean', description: 'Make immutable (one-way, cannot be reversed).' },
            },
            required: ['id'],
          },
          description: 'Array of updates. Max 50.',
        },
      },
      required: ['updates'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        updated: { type: 'number' as const },
        failed: { type: 'number' as const },
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
        errors: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['updated'] as string[],
    },
  },
  {
    name: 'memoclaw_core_memories',
    description: '⭐ Get your most important memories — high importance, frequently accessed, or pinned. FREE.',
    title: 'Core memories',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Max results. Default: 10. Max: 50.' },
        namespace: { type: 'string', description: 'Filter by namespace.' },
        agent_id: { type: 'string', description: 'Filter by agent.' },
      },
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memories: { type: 'array' as const, items: MEMORY_OBJECT_SCHEMA },
      },
      required: ['memories'] as string[],
    },
  },
  {
    name: 'memoclaw_stats',
    description: '📊 Get memory usage statistics. FREE.',
    title: 'Memory statistics',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: { type: 'object' as const, properties: {} },
    outputSchema: {
      type: 'object' as const,
      properties: {
        total_memories: { type: 'number' as const },
        pinned_count: { type: 'number' as const },
        never_accessed: { type: 'number' as const },
        total_accesses: { type: 'number' as const },
        avg_importance: { type: 'number' as const },
        oldest_memory: { type: 'string' as const },
        newest_memory: { type: 'string' as const },
        by_type: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: { memory_type: { type: 'string' as const }, count: { type: 'number' as const } },
          },
        },
        by_namespace: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: { namespace: { type: 'string' as const }, count: { type: 'number' as const } },
          },
        },
      },
    },
  },
  {
    name: 'memoclaw_check_duplicates',
    description:
      '🔍 PRE-STORE DEDUP: Check if similar content already exists before storing a new memory. ' +
      'Returns potential duplicates above the similarity threshold. ' +
      'Use this to avoid storing redundant memories and save API credits. ' +
      'Internally uses semantic recall, so the cost is one recall call ($0.005).',
    title: 'Check for duplicates',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The content you plan to store. This will be compared semantically against existing memories.',
        },
        min_similarity: {
          type: 'number',
          description: 'Minimum similarity threshold (0.0-1.0). Default: 0.7. Higher values = stricter matching.',
        },
        namespace: { type: 'string', description: 'Only check within this namespace.' },
        limit: { type: 'number', description: 'Maximum number of potential duplicates to return. Default: 5.' },
      },
      required: ['content'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        has_duplicates: { type: 'boolean' as const },
        duplicates: { type: 'array' as const, items: RECALL_RESULT_SCHEMA },
        suggestion: { type: 'string' as const },
      },
      required: ['has_duplicates', 'duplicates'] as string[],
    },
  },
  {
    name: 'memoclaw_merge',
    description:
      '🔀 MERGE DUPLICATES: Combine two memories into one. The source memory is merged into the target, then deleted. ' +
      'Tags are combined (union), the higher importance score is kept, and pinned/immutable flags are preserved from either. ' +
      'Strategies: keep_target (default) keeps target content; keep_source uses source content; combine concatenates both. ' +
      'Use after memoclaw_check_duplicates to clean up duplicates. Cost: one update + one delete (free).',
    title: 'Merge memories',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        source_id: {
          type: 'string',
          description: 'ID of the memory to merge FROM (will be deleted after merge).',
        },
        target_id: {
          type: 'string',
          description: 'ID of the memory to merge INTO (will be updated with merged data).',
        },
        strategy: {
          type: 'string',
          enum: ['keep_target', 'keep_source', 'combine'],
          description:
            'Merge strategy. keep_target (default): keep target content. ' +
            'keep_source: use source content. combine: concatenate both contents.',
        },
      },
      required: ['source_id', 'target_id'],
    },
    outputSchema: {
      type: 'object' as const,
      properties: {
        memory: MEMORY_OBJECT_SCHEMA,
        deleted_id: { type: 'string' as const },
        strategy: { type: 'string' as const },
      },
      required: ['memory', 'deleted_id', 'strategy'] as string[],
    },
  },
];
