/**
 * Format a memory object for human-readable display.
 * Handles missing/malformed fields gracefully.
 */
export function formatMemory(m: any): string {
  if (!m) return '(empty memory)';
  const parts = [`📝 ${m.content || '(no content)'}`];
  if (m.id) parts.push(`  id: ${m.id}`);
  if (m.similarity !== undefined && m.similarity !== null) {
    parts.push(`  similarity: ${typeof m.similarity === 'number' ? m.similarity.toFixed(3) : String(m.similarity)}`);
  }
  if (m.importance !== undefined && m.importance !== null) parts.push(`  importance: ${m.importance}`);
  if (m.memory_type) parts.push(`  type: ${m.memory_type}`);
  if (m.namespace) parts.push(`  namespace: ${m.namespace}`);
  const tags = m.tags || m.metadata?.tags;
  if (tags?.length) parts.push(`  tags: ${tags.join(', ')}`);
  if (m.pinned) parts.push(`  📌 pinned`);
  if (m.expires_at) parts.push(`  expires: ${m.expires_at}`);
  if (m.created_at) parts.push(`  created: ${m.created_at}`);
  if (m.updated_at && m.updated_at !== m.created_at) parts.push(`  updated: ${m.updated_at}`);
  return parts.join('\n');
}

/**
 * Run promises with concurrency limit.
 */
export async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (reason: any) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Maximum content length per memory (server enforces 8192 chars) */
export const MAX_CONTENT_LENGTH = 8192;

export function validateContentLength(content: string, label = 'content'): void {
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(
      `${label} exceeds the ${MAX_CONTENT_LENGTH} character limit (got ${content.length} chars). ` +
      `Split the content into smaller memories or summarize it.`
    );
  }
}

/** Allowed fields for the update endpoint */
export const UPDATE_FIELDS = new Set([
  'content', 'importance', 'memory_type', 'namespace',
  'metadata', 'expires_at', 'pinned', 'tags',
]);
