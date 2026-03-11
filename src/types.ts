/**
 * Typed argument interfaces for MCP tool handlers.
 *
 * These mirror the JSON schemas defined in tools.ts and replace `args: any`
 * in handler functions to catch typos and type mismatches at compile time.
 */

// ── Memory CRUD ──────────────────────────────────────────────────────────────

export interface StoreArgs {
  content: string;
  importance?: number;
  tags?: string[];
  namespace?: string;
  memory_type?: string;
  session_id?: string;
  agent_id?: string;
  expires_at?: string;
  pinned?: boolean;
  immutable?: boolean;
  metadata?: Record<string, unknown>;
}

export interface RecallArgs {
  query: string;
  limit?: number;
  min_similarity?: number;
  tags?: string[];
  namespace?: string;
  memory_type?: string;
  session_id?: string;
  agent_id?: string;
  include_relations?: boolean;
  after?: string;
  before?: string;
  pinned?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SearchArgs {
  query: string;
  limit?: number;
  namespace?: string;
  tags?: string[];
  memory_type?: string;
  session_id?: string;
  agent_id?: string;
  after?: string;
  before?: string;
  sort?: string;
  order?: string;
  pinned?: boolean;
  metadata?: Record<string, unknown>;
}

export interface GetArgs {
  id: string;
}

export interface ListArgs {
  limit?: number;
  offset?: number;
  tags?: string[];
  namespace?: string;
  memory_type?: string;
  session_id?: string;
  agent_id?: string;
  after?: string;
  before?: string;
  sort?: string;
  order?: string;
  pinned?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DeleteArgs {
  id: string;
}

export interface BulkDeleteArgs {
  ids: string[];
}

export interface UpdateArgs {
  id: string;
  content?: string;
  importance?: number;
  tags?: string[];
  namespace?: string;
  memory_type?: string;
  metadata?: Record<string, unknown>;
  pinned?: boolean;
  immutable?: boolean;
  expires_at?: string;
  session_id?: string;
  agent_id?: string;
  [key: string]: unknown;
}

export interface BatchUpdateEntry {
  id: string;
  content?: string;
  importance?: number;
  tags?: string[];
  namespace?: string;
  memory_type?: string;
  metadata?: Record<string, unknown>;
  pinned?: boolean;
  immutable?: boolean;
  expires_at?: string;
  [key: string]: unknown;
}

export interface BatchUpdateArgs {
  updates: BatchUpdateEntry[];
}

// ── Bulk / Import / Export ────────────────────────────────────────────────────

export interface BulkStoreMemory {
  content: string;
  importance?: number;
  tags?: string[];
  namespace?: string;
  memory_type?: string;
  pinned?: boolean;
  expires_at?: string;
  immutable?: boolean;
  metadata?: Record<string, unknown>;
}

export interface BulkStoreArgs {
  memories: BulkStoreMemory[];
  session_id?: string;
  agent_id?: string;
}

export interface ImportMemory {
  content: string;
  importance?: number;
  tags?: string[];
  namespace?: string;
  memory_type?: string;
  pinned?: boolean;
  immutable?: boolean;
  expires_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ImportArgs {
  memories: ImportMemory[];
  session_id?: string;
  agent_id?: string;
}

export interface ExportArgs {
  namespace?: string;
  agent_id?: string;
  format?: 'json' | 'jsonl';
}

// ── Intelligence / AI ────────────────────────────────────────────────────────

export interface IngestArgs {
  messages?: Array<{ role: string; content: string }>;
  text?: string;
  namespace?: string;
  session_id?: string;
  agent_id?: string;
  auto_relate?: boolean;
}

export interface ExtractArgs {
  messages: Array<{ role: string; content: string }>;
  namespace?: string;
  session_id?: string;
  agent_id?: string;
}

export interface ConsolidateArgs {
  namespace?: string;
  min_similarity?: number;
  mode?: string;
  dry_run?: boolean;
  agent_id?: string;
}

export interface SuggestedArgs {
  limit?: number;
  namespace?: string;
  session_id?: string;
  agent_id?: string;
  category?: string;
}

export interface ContextArgs {
  query: string;
  limit?: number;
  namespace?: string;
  session_id?: string;
  agent_id?: string;
}

// ── Relations ────────────────────────────────────────────────────────────────

export interface CreateRelationArgs {
  memory_id: string;
  target_id: string;
  relation_type: string;
  metadata?: Record<string, unknown>;
}

export interface ListRelationsArgs {
  memory_id: string;
}

export interface DeleteRelationArgs {
  memory_id: string;
  relation_id: string;
}

export interface GraphArgs {
  memory_id: string;
  depth?: number;
  relation_type?: string;
}

// ── Admin / Utility ──────────────────────────────────────────────────────────

export interface StatusArgs {
  // No arguments required
}

export interface InitArgs {
  // No arguments required
}

export interface CountArgs {
  namespace?: string;
  tags?: string[];
  agent_id?: string;
  memory_type?: string;
  session_id?: string;
  before?: string;
  after?: string;
  pinned?: boolean;
  metadata?: Record<string, unknown>;
}

export interface DeleteNamespaceArgs {
  namespace: string;
  agent_id?: string;
}

export interface PinArgs {
  id: string;
}

export interface UnpinArgs {
  id: string;
}

export interface TagsArgs {
  namespace?: string;
  agent_id?: string;
}

export interface HistoryArgs {
  id: string;
}

export interface NamespacesArgs {
  agent_id?: string;
}

export interface CoreMemoriesArgs {
  limit?: number;
  namespace?: string;
  agent_id?: string;
}

export interface StatsArgs {
  // No arguments required
}

export interface MigrateFile {
  filename: string;
  content: string;
}

export interface CheckDuplicatesArgs {
  content: string;
  min_similarity?: number;
  namespace?: string;
  limit?: number;
}

export interface MergeArgs {
  source_id: string;
  target_id: string;
  strategy?: 'keep_target' | 'keep_source' | 'combine';
}

export interface MigrateArgs {
  path?: string;
  files?: MigrateFile[];
  namespace?: string;
  agent_id?: string;
  deduplicate?: boolean;
  dry_run?: boolean;
}

// ── API response shapes ──────────────────────────────────────────────────────
// These type the JSON objects returned by the MemoClaw REST API so that handler
// code can stop using `any` for API results.

/** A memory object as returned by the API. */
export interface Memory {
  id: string;
  content: string;
  importance?: number;
  similarity?: number;
  memory_type?: string;
  namespace?: string;
  tags?: string[];
  pinned?: boolean;
  immutable?: boolean;
  expires_at?: string;
  metadata?: Record<string, unknown>;
  access_count?: number;
  last_accessed?: string;
  created_at?: string;
  updated_at?: string;
  session_id?: string;
  agent_id?: string;
  [key: string]: unknown;
}

/** A relation between two memories. */
export interface Relation {
  id?: string;
  source_id?: string;
  target_id: string;
  relation_type: string;
  metadata?: Record<string, unknown>;
}

/** Namespace entry with optional count. */
export interface NamespaceInfo {
  namespace: string;
  name?: string;
  count?: number;
}

/** Tag entry with optional count. */
export interface TagInfo {
  tag: string;
  name?: string;
  count?: number;
}

/** A single version in memory edit history. */
export interface HistoryEntry {
  content?: string;
  importance?: number;
  tags?: string[];
  memory_type?: string;
  namespace?: string;
  pinned?: boolean;
  immutable?: boolean;
  changed_at?: string;
  updated_at?: string;
  created_at?: string;
  changed_fields?: string[] | string;
  [key: string]: unknown;
}

/** Item in a batch failure list. */
export interface FailedItem {
  id?: string;
  index?: number;
  error?: string;
}

/** File entry for migration. */
export interface FileEntry {
  filename: string;
  content: string;
}

// ── Union type for dispatch ──────────────────────────────────────────────────

export type ToolArgs =
  | { name: 'memoclaw_store'; args: StoreArgs }
  | { name: 'memoclaw_recall'; args: RecallArgs }
  | { name: 'memoclaw_search'; args: SearchArgs }
  | { name: 'memoclaw_get'; args: GetArgs }
  | { name: 'memoclaw_list'; args: ListArgs }
  | { name: 'memoclaw_delete'; args: DeleteArgs }
  | { name: 'memoclaw_bulk_delete'; args: BulkDeleteArgs }
  | { name: 'memoclaw_update'; args: UpdateArgs }
  | { name: 'memoclaw_batch_update'; args: BatchUpdateArgs }
  | { name: 'memoclaw_bulk_store'; args: BulkStoreArgs }
  | { name: 'memoclaw_import'; args: ImportArgs }
  | { name: 'memoclaw_export'; args: ExportArgs }
  | { name: 'memoclaw_ingest'; args: IngestArgs }
  | { name: 'memoclaw_extract'; args: ExtractArgs }
  | { name: 'memoclaw_consolidate'; args: ConsolidateArgs }
  | { name: 'memoclaw_suggested'; args: SuggestedArgs }
  | { name: 'memoclaw_context'; args: ContextArgs }
  | { name: 'memoclaw_create_relation'; args: CreateRelationArgs }
  | { name: 'memoclaw_list_relations'; args: ListRelationsArgs }
  | { name: 'memoclaw_delete_relation'; args: DeleteRelationArgs }
  | { name: 'memoclaw_graph'; args: GraphArgs }
  | { name: 'memoclaw_status'; args: StatusArgs }
  | { name: 'memoclaw_init'; args: InitArgs }
  | { name: 'memoclaw_count'; args: CountArgs }
  | { name: 'memoclaw_delete_namespace'; args: DeleteNamespaceArgs }
  | { name: 'memoclaw_pin'; args: PinArgs }
  | { name: 'memoclaw_unpin'; args: UnpinArgs }
  | { name: 'memoclaw_tags'; args: TagsArgs }
  | { name: 'memoclaw_history'; args: HistoryArgs }
  | { name: 'memoclaw_namespaces'; args: NamespacesArgs }
  | { name: 'memoclaw_core_memories'; args: CoreMemoriesArgs }
  | { name: 'memoclaw_stats'; args: StatsArgs }
  | { name: 'memoclaw_migrate'; args: MigrateArgs }
  | { name: 'memoclaw_check_duplicates'; args: CheckDuplicatesArgs }
  | { name: 'memoclaw_merge'; args: MergeArgs };

/** Map from tool name to its args type */
export type ToolArgsMap = {
  [T in ToolArgs as T['name']]: T['args'];
};
