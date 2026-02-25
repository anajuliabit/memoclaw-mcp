/**
 * MCP tool definitions for MemoClaw.
 * Each tool maps to an API endpoint or composite operation.
 *
 * Annotations follow the MCP spec (2025-03-26+):
 *   readOnlyHint  — true if the tool does not modify server-side state
 *   destructiveHint — true if the tool may permanently delete data
 *   idempotentHint — true if calling multiple times with the same args has no extra effect
 *   openWorldHint — true if the tool interacts with external entities beyond MemoClaw
 */

const MEMORY_TYPE_ENUM = ['correction', 'preference', 'decision', 'project', 'observation', 'general'] as const;

const COMMON_FILTERS = {
  tags: { type: 'array' as const, items: { type: 'string' as const }, description: 'Filter by tags (memories must have ALL specified tags).' },
  namespace: { type: 'string' as const, description: 'Filter by namespace.' },
  memory_type: { type: 'string' as const, enum: MEMORY_TYPE_ENUM, description: 'Filter by memory type.' },
  session_id: { type: 'string' as const, description: 'Filter by session ID.' },
  agent_id: { type: 'string' as const, description: 'Filter by agent ID.' },
  after: { type: 'string' as const, description: 'Only return memories created after this ISO 8601 date, e.g. "2025-01-01T00:00:00Z".' },
};

export const TOOLS = [
  {
    name: 'memoclaw_store',
    description:
      'Store a new memory. The content is embedded for semantic search. ' +
      'Use tags and namespace to organize memories. Set importance (0-1) to influence recall ranking. ' +
      'Use memory_type to control how the memory decays over time. Pin important memories to prevent decay. ' +
      'Returns the created memory object with its ID. Free tier: 100 calls/wallet.',
    annotations: {
      title: 'Store memory',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'The text content to remember. Be specific and self-contained — this is what gets embedded and searched.' },
        importance: { type: 'number', description: 'Importance score from 0.0 (trivial) to 1.0 (critical). Default: 0.5. Higher importance memories rank higher in recall.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization and filtering, e.g. ["project-x", "frontend"]' },
        namespace: { type: 'string', description: 'Namespace to isolate this memory, e.g. "work" or "personal". Memories in different namespaces are separate.' },
        memory_type: { type: 'string', enum: MEMORY_TYPE_ENUM, description: 'Memory type controls decay rate. "correction" and "preference" decay slowest; "observation" decays fastest. Default: "general".' },
        session_id: { type: 'string', description: 'Session ID to group memories from the same conversation.' },
        agent_id: { type: 'string', description: 'Agent ID to scope memories to a specific agent.' },
        pinned: { type: 'boolean', description: 'If true, this memory is exempt from decay and will persist indefinitely.' },
        expires_at: { type: 'string', description: 'ISO 8601 date when this memory auto-deletes, e.g. "2025-12-31T00:00:00Z".' },
        immutable: { type: 'boolean', description: 'If true, this memory cannot be updated or deleted after creation. This is a one-way operation and cannot be reversed.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memoclaw_recall',
    description:
      '🔍 SEMANTIC SEARCH: Find memories by meaning, not exact words. ' +
      'This tool finds memories that are similar in meaning to your query, even if they don\'t contain the exact same words. ' +
      'Returns results ranked by similarity score (0-1). Use min_similarity=0.3+ to filter low-quality matches. ' +
      'Set include_relations=true to also fetch related memories via the knowledge graph. ' +
      '💡 TIP: If you know the memory ID, use memoclaw_get (faster). For exact keyword matching, use memoclaw_search.',
    annotations: {
      title: 'Semantic recall',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Natural language search query. Describe what you\'re looking for in plain English.' },
        limit: { type: 'number', description: 'Maximum number of results to return. Default: 5. Max: 50.' },
        min_similarity: { type: 'number', description: 'Minimum similarity threshold (0.0-1.0). Default: 0. Recommended: 0.3+ for relevant results.' },
        ...COMMON_FILTERS,
        include_relations: { type: 'boolean', description: 'If true, include related memories (via relations) in the response.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memoclaw_search',
    description:
      '🔎 KEYWORD SEARCH: Find memories containing exact keywords or phrases. ' +
      'Unlike memoclaw_recall (semantic search), this does exact string matching. ' +
      'For finding similar meanings, use memoclaw_recall instead.',
    annotations: {
      title: 'Keyword search',
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
        ...COMMON_FILTERS,
      },
      required: ['query'],
    },
  },
  {
    name: 'memoclaw_get',
    description:
      'Retrieve a single memory by its exact ID. Use this when you already know the memory ID.',
    annotations: {
      title: 'Get memory',
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
  },
  {
    name: 'memoclaw_list',
    description:
      '📋 LIST: Browse all memories chronologically (newest first). ' +
      'Supports filtering by tags, namespace, memory_type, session_id, agent_id. ' +
      '💡 TIP: For semantic search, use memoclaw_recall. For keywords, use memoclaw_search.',
    annotations: {
      title: 'List memories',
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
        ...COMMON_FILTERS,
      },
    },
  },
  {
    name: 'memoclaw_delete',
    description: 'Permanently delete a single memory by its ID. This cannot be undone.',
    annotations: {
      title: 'Delete memory',
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
  },
  {
    name: 'memoclaw_bulk_delete',
    description: 'Delete multiple memories at once by their IDs. Max 100 IDs per call.',
    annotations: {
      title: 'Bulk delete memories',
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
  },
  {
    name: 'memoclaw_update',
    description:
      'Update an existing memory by its ID. Only provided fields are changed. ' +
      'If you update content, the semantic embedding is automatically regenerated.',
    annotations: {
      title: 'Update memory',
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
        immutable: { type: 'boolean', description: 'Set to true to make this memory immutable. WARNING: This is a one-way operation — once set, the memory cannot be updated or deleted.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memoclaw_status',
    description: 'Check your wallet\'s free tier usage. Shows remaining API calls out of 100.',
    annotations: {
      title: 'Free tier status',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'memoclaw_ingest',
    description:
      'Bulk-ingest a conversation or raw text. The server extracts facts, deduplicates, ' +
      'and optionally creates relations. Provide either messages OR text, not both.',
    annotations: {
      title: 'Ingest conversation',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } }, description: 'Conversation messages array.' },
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
    description:
      'Extract structured facts from a conversation via LLM, without auto-relating them. ' +
      'Use this when you want to review extracted facts before relating them.',
    annotations: {
      title: 'Extract facts',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
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
    description:
      'Merge similar/duplicate memories by clustering. Use dry_run=true first to preview.',
    annotations: {
      title: 'Consolidate memories',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: 'Only consolidate within this namespace.' },
        min_similarity: { type: 'number', description: 'Minimum similarity for duplicates (0.0-1.0).' },
        mode: { type: 'string', description: 'Consolidation strategy/mode.' },
        dry_run: { type: 'boolean', description: 'If true, returns what WOULD be merged without actually merging.' },
      },
    },
  },
  {
    name: 'memoclaw_suggested',
    description:
      'Get proactive memory suggestions: stale, fresh, hot, or decaying memories.',
    annotations: {
      title: 'Suggested memories',
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
  },
  {
    name: 'memoclaw_create_relation',
    description:
      'Create a directed relationship between two memories for the knowledge graph.',
    annotations: {
      title: 'Create relation',
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
        relation_type: { type: 'string', enum: ['related_to', 'derived_from', 'contradicts', 'supersedes', 'supports'], description: 'Type of relationship.' },
        metadata: { type: 'object', description: 'Optional metadata for the relation.' },
      },
      required: ['memory_id', 'target_id', 'relation_type'],
    },
  },
  {
    name: 'memoclaw_list_relations',
    description: 'List all relationships for a specific memory (incoming and outgoing).',
    annotations: {
      title: 'List relations',
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
  },
  {
    name: 'memoclaw_delete_relation',
    description: 'Delete a specific relationship between memories.',
    annotations: {
      title: 'Delete relation',
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
  },
  {
    name: 'memoclaw_export',
    description: 'Export all memories as JSON. Useful for backup, migration, or analysis.',
    annotations: {
      title: 'Export memories',
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
  },
  {
    name: 'memoclaw_import',
    description:
      'Import memories from a JSON array. Each object must have a "content" field. Max 100 per call.',
    annotations: {
      title: 'Import memories',
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
  },
  {
    name: 'memoclaw_bulk_store',
    description:
      'Store multiple memories in a single call. Max 50 per call. ' +
      'Each memory can have its own tags, namespace, importance, etc.',
    annotations: {
      title: 'Bulk store memories',
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
            },
            required: ['content'],
          },
          description: 'Array of memory objects. Max 50.',
        },
        session_id: { type: 'string', description: 'Session ID applied to all memories.' },
        agent_id: { type: 'string', description: 'Agent ID applied to all memories.' },
      },
      required: ['memories'],
    },
  },
  {
    name: 'memoclaw_count',
    description: 'Get a count of memories, optionally filtered. Faster than memoclaw_list when you only need the total.',
    annotations: {
      title: 'Count memories',
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
      },
    },
  },
  {
    name: 'memoclaw_delete_namespace',
    description:
      'Delete ALL memories in a namespace. Destructive and cannot be undone. ' +
      'Use memoclaw_count first to check how many will be affected.',
    annotations: {
      title: 'Delete namespace',
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
  },
  {
    name: 'memoclaw_init',
    description:
      'Check if MemoClaw is properly configured. Returns config status, wallet address, and free tier remaining. ' +
      'Call this FIRST to verify the connection works.',
    annotations: {
      title: 'Check configuration',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'memoclaw_migrate',
    description:
      'Migrate local markdown memory files into MemoClaw. ' +
      'Accepts EITHER a directory/file path OR an array of file objects. ' +
      'Supports .md and .txt files. Recursively scans directories.',
    annotations: {
      title: 'Migrate files',
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
  },
  {
    name: 'memoclaw_graph',
    description:
      'Traverse the memory graph from a starting memory up to a specified depth.',
    annotations: {
      title: 'Traverse graph',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: {
        memory_id: { type: 'string', description: 'Starting memory ID.' },
        depth: { type: 'number', description: 'Hops to traverse. Default: 1. Max: 3.' },
        relation_type: { type: 'string', enum: ['related_to', 'derived_from', 'contradicts', 'supersedes', 'supports'], description: 'Only follow this relation type.' },
      },
      required: ['memory_id'],
    },
  },
  {
    name: 'memoclaw_pin',
    description: '📌 Pin a memory to prevent decay. Shortcut for memoclaw_update with pinned=true.',
    annotations: {
      title: 'Pin memory',
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
  },
  {
    name: 'memoclaw_unpin',
    description: '📌 Unpin a memory, re-enabling decay. Shortcut for memoclaw_update with pinned=false.',
    annotations: {
      title: 'Unpin memory',
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
  },
  {
    name: 'memoclaw_tags',
    description: '🏷️ List all unique tags with counts. Sorted by usage (most used first).',
    annotations: {
      title: 'List tags',
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
  },
  {
    name: 'memoclaw_history',
    description: '📜 View the edit history of a specific memory.',
    annotations: {
      title: 'Memory history',
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
  },
  {
    name: 'memoclaw_namespaces',
    description: 'List all namespaces that contain memories with counts.',
    annotations: {
      title: 'List namespaces',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object' as const,
      properties: { agent_id: { type: 'string', description: 'Only list namespaces for this agent.' } },
    },
  },
  {
    name: 'memoclaw_context',
    description:
      '🧠 CONTEXT: Get contextually relevant memories using GPT-4o-mini analysis. ' +
      'Costs $0.01 per call.',
    annotations: {
      title: 'Get context',
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
  },
  {
    name: 'memoclaw_batch_update',
    description: 'Update multiple memories in a single call. Max 50 updates. Costs $0.005 per call.',
    annotations: {
      title: 'Batch update memories',
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
  },
  {
    name: 'memoclaw_core_memories',
    description: '⭐ Get your most important memories — high importance, frequently accessed, or pinned. FREE.',
    annotations: {
      title: 'Core memories',
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
  },
  {
    name: 'memoclaw_stats',
    description: '📊 Get memory usage statistics. FREE.',
    annotations: {
      title: 'Memory statistics',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: { type: 'object' as const, properties: {} },
  },
];
