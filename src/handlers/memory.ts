import {
  formatMemory,
  withConcurrency,
  validateContentLength,
  validateImportance,
  UPDATE_FIELDS,
  userAndAssistantText,
  assistantText,
  userText,
  memoryResourceLink,
} from '../format.js';
import { validateIdentifier, validateId, validateTags, validateISODate, validatePaginationParam } from '../validate.js';
import type { HandlerContext, ToolResult } from './types.js';
import type {
  StoreArgs,
  GetArgs,
  ListArgs,
  UpdateArgs,
  DeleteArgs,
  BulkDeleteArgs,
  BulkStoreArgs,
  ImportArgs,
  PinArgs,
  UnpinArgs,
  BatchUpdateArgs,
  CountArgs,
} from '../types.js';

/**
 * Shared helper for bulk store operations (memoclaw_bulk_store and memoclaw_import).
 * Tries the batch API endpoint first, then falls back to one-by-one with concurrency.
 */
async function bulkStoreWithFallback(
  ctx: HandlerContext,
  memories: any[],
  fields: string[],
  prefix: string,
  session_id?: string,
  agent_id?: string,
  resourceLinkName = 'Stored memory',
): Promise<ToolResult> {
  const { makeRequest, progress, signal } = ctx;

  // Try batch API endpoint first (single request)
  try {
    const batchBody: any = {
      memories: memories.map((m: any) => {
        const item: any = {};
        for (const key of fields) {
          if (m[key] !== undefined) item[key] = m[key];
        }
        if (session_id) item.session_id = session_id;
        if (agent_id) item.agent_id = agent_id;
        return item;
      }),
    };
    const result = await makeRequest('POST', '/v1/store/batch', batchBody);
    const stored = result.memories || result.data || [];
    const failedItems = result.failed || [];
    const errors: string[] = [];
    let text = `${prefix}: ${stored.length} stored, ${failedItems.length} failed`;
    if (stored.length > 0) text += `\n\n${stored.map((m: any) => formatMemory(m)).join('\n\n')}`;
    if (failedItems.length > 0) {
      for (const f of failedItems) errors.push(`index ${f.index ?? '?'}: ${f.error || 'unknown error'}`);
      text += `\n\nErrors:\n${errors.join('\n')}`;
    }
    const resourceLinks = stored.filter((m: any) => m.id).map((m: any) => memoryResourceLink(m.id, resourceLinkName));
    return {
      content: [userAndAssistantText(text), ...resourceLinks],
      structuredContent: { succeeded: stored.length, failed: failedItems.length, memories: stored, errors },
    };
  } catch (batchErr: any) {
    // Fall back to one-by-one if batch endpoint is unavailable (404)
    if (!batchErr.message?.includes('404') && !batchErr.message?.includes('Not Found')) {
      throw batchErr;
    }
  }

  // Fallback: store one-by-one with concurrency
  let storeProgress = 0;
  const results = await withConcurrency(
    memories.map((m: any) => async () => {
      const body: any = {};
      for (const key of fields) {
        if (m[key] !== undefined) body[key] = m[key];
      }
      if (session_id) body.session_id = session_id;
      if (agent_id) body.agent_id = agent_id;
      const result = await makeRequest('POST', '/v1/store', body);
      storeProgress++;
      await progress(storeProgress, memories.length);
      return result;
    }),
    10,
    signal,
  );
  const succeeded = results.filter((r) => r?.status === 'fulfilled');
  const failed = results.filter((r) => r?.status === 'rejected');
  const stored = succeeded.map(
    (r) => (r as PromiseFulfilledResult<any>).value?.memory || (r as PromiseFulfilledResult<any>).value,
  );
  const errors = failed.map((r) => {
    const idx = results.indexOf(r);
    return `index ${idx}: ${(r as PromiseRejectedResult).reason?.message || 'unknown error'}`;
  });
  const cancelled = signal.aborted && succeeded.length + failed.length < memories.length;
  let text = cancelled
    ? `⚠️ ${prefix} cancelled: ${succeeded.length} of ${memories.length} stored, ${failed.length} failed`
    : `${prefix}: ${succeeded.length} stored, ${failed.length} failed`;
  if (stored.length > 0) text += `\n\n${stored.map((m: any) => formatMemory(m)).join('\n\n')}`;
  if (errors.length > 0) text += `\n\nErrors:\n${errors.join('\n')}`;
  const resourceLinks = stored.filter((m: any) => m?.id).map((m: any) => memoryResourceLink(m.id, resourceLinkName));
  return {
    content: [userAndAssistantText(text), ...resourceLinks],
    structuredContent: { succeeded: succeeded.length, failed: failed.length, memories: stored, errors, cancelled },
  };
}

export async function handleMemory(ctx: HandlerContext, name: string, args: any): Promise<ToolResult | null> {
  const { makeRequest, progress, signal } = ctx;

  switch (name) {
    case 'memoclaw_store': {
      const { content, importance, tags, namespace, memory_type, session_id, agent_id, expires_at, pinned, immutable } =
        args as StoreArgs;
      if (!content || (typeof content === 'string' && content.trim() === '')) {
        throw new Error('content is required and cannot be empty');
      }
      validateContentLength(content);
      validateImportance(importance);
      validateTags(tags);
      validateIdentifier(namespace, 'namespace');
      validateIdentifier(memory_type, 'memory_type');
      validateIdentifier(session_id, 'session_id');
      validateIdentifier(agent_id, 'agent_id');
      validateISODate(expires_at, 'expires_at');
      const body: any = { content };
      if (importance !== undefined) body.importance = importance;
      if (tags) body.tags = tags;
      if (namespace) body.namespace = namespace;
      if (memory_type) body.memory_type = memory_type;
      if (session_id) body.session_id = session_id;
      if (agent_id) body.agent_id = agent_id;
      if (expires_at) body.expires_at = expires_at;
      if (pinned !== undefined) body.pinned = pinned;
      if (immutable !== undefined) body.immutable = immutable;
      const result = await makeRequest('POST', '/v1/store', body);
      const memory = result.memory || result;
      return {
        content: [
          userAndAssistantText(`✅ Memory stored\n${formatMemory(memory)}`),
          assistantText(JSON.stringify(result, null, 2)),
          ...(memory.id ? [memoryResourceLink(memory.id, 'Stored memory')] : []),
        ],
        structuredContent: { memory },
      };
    }

    case 'memoclaw_get': {
      const { id } = args as GetArgs;
      validateId(id, 'id');
      const result = await makeRequest('GET', `/v1/memories/${id}`);
      const memory = result.memory || result;
      return {
        content: [userAndAssistantText(formatMemory(memory)), assistantText(JSON.stringify(result, null, 2))],
        structuredContent: { memory },
      };
    }

    case 'memoclaw_list': {
      const { limit, offset, tags, namespace, memory_type, session_id, agent_id, after, before, sort, order, pinned } =
        args as ListArgs;
      validatePaginationParam(limit, 'limit');
      validatePaginationParam(offset, 'offset');
      validateTags(tags);
      validateIdentifier(namespace, 'namespace');
      validateIdentifier(memory_type, 'memory_type');
      validateIdentifier(session_id, 'session_id');
      validateIdentifier(agent_id, 'agent_id');
      validateISODate(after, 'after');
      validateISODate(before, 'before');
      const params = new URLSearchParams();
      if (limit !== undefined) params.set('limit', String(limit));
      if (offset !== undefined) params.set('offset', String(offset));
      if (namespace) params.set('namespace', namespace);
      if (memory_type) params.set('memory_type', memory_type);
      if (tags && Array.isArray(tags) && tags.length > 0) params.set('tags', tags.join(','));
      if (session_id) params.set('session_id', session_id);
      if (agent_id) params.set('agent_id', agent_id);
      if (after) params.set('after', after);
      if (before) params.set('before', before);
      if (sort) params.set('sort', sort);
      if (order) params.set('order', order);
      if (pinned !== undefined) params.set('pinned', String(pinned));
      const result = await makeRequest('GET', `/v1/memories?${params}`);
      const memories = result.memories || result.data || [];
      const total = result.total ?? memories.length;
      const formatted = memories.length > 0 ? '\n\n' + memories.map((m: any) => formatMemory(m)).join('\n\n') : '';
      return {
        content: [
          userAndAssistantText(`Showing ${memories.length} of ${total} memories${formatted}`),
          assistantText(JSON.stringify(result, null, 2)),
        ],
        structuredContent: { memories, total },
      };
    }

    case 'memoclaw_update': {
      const { id, ...allFields } = args as UpdateArgs;
      validateId(id, 'id');
      const updateFields: Record<string, any> = {};
      for (const [key, value] of Object.entries(allFields)) {
        if (UPDATE_FIELDS.has(key) && value !== undefined) updateFields[key] = value;
      }
      if (Object.keys(updateFields).length === 0) {
        throw new Error('No valid update fields provided. Allowed: ' + [...UPDATE_FIELDS].join(', '));
      }
      if (typeof updateFields.content === 'string') validateContentLength(updateFields.content);
      validateImportance(updateFields.importance);
      validateIdentifier(updateFields.namespace, 'namespace');
      validateIdentifier(updateFields.memory_type, 'memory_type');
      validateIdentifier(updateFields.session_id, 'session_id');
      validateIdentifier(updateFields.agent_id, 'agent_id');
      validateTags(updateFields.tags);
      validateISODate(updateFields.expires_at, 'expires_at');
      const result = await makeRequest('PATCH', `/v1/memories/${id}`, updateFields);
      const memory = result.memory || result;
      return {
        content: [
          userAndAssistantText(`✅ Memory ${id} updated\n${formatMemory(memory)}`),
          assistantText(JSON.stringify(result, null, 2)),
          memoryResourceLink(id, 'Updated memory'),
        ],
        structuredContent: { memory },
      };
    }

    case 'memoclaw_delete': {
      const { id } = args as DeleteArgs;
      validateId(id, 'id');
      const result = await makeRequest('DELETE', `/v1/memories/${id}`);
      return {
        content: [userAndAssistantText(`🗑️ Memory ${id} deleted`), assistantText(JSON.stringify(result, null, 2))],
        structuredContent: { deleted: true, id },
      };
    }

    case 'memoclaw_bulk_delete': {
      const { ids } = args as BulkDeleteArgs;
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        throw new Error('ids is required and must be a non-empty array');
      }
      if (ids.length > 100) throw new Error('Maximum 100 IDs per bulk delete call');

      // Try dedicated bulk-delete endpoint first, fall back to one-by-one
      let succeeded = 0;
      let failed = 0;
      let errors: string[] = [];
      try {
        const result = await makeRequest('POST', '/v1/memories/bulk-delete', { ids });
        succeeded = result.deleted ?? ids.length;
        failed = (result.failed && result.failed.length) || 0;
        if (result.failed && result.failed.length > 0) {
          errors = result.failed.map((f: any) => `${f.id}: ${f.error || 'unknown error'}`);
        }
      } catch {
        // Fallback: delete one-by-one
        let deleteProgress = 0;
        const results = await withConcurrency(
          ids.map((id: string) => async () => {
            const result = await makeRequest('DELETE', `/v1/memories/${id}`);
            deleteProgress++;
            await progress(deleteProgress, ids.length);
            return result;
          }),
          10,
          signal,
        );
        succeeded = results.filter((r) => r?.status === 'fulfilled').length;
        failed = results.filter((r) => r?.status === 'rejected').length;
        errors = results
          .map((r, i) =>
            r?.status === 'rejected'
              ? `${ids[i]}: ${(r as PromiseRejectedResult).reason?.message || 'unknown error'}`
              : null,
          )
          .filter(Boolean) as string[];
      }

      const bulkDeleteCancelled = signal.aborted && succeeded + failed < ids.length;
      let text = bulkDeleteCancelled
        ? `⚠️ Bulk delete cancelled: ${succeeded} of ${ids.length} succeeded, ${failed} failed`
        : `🗑️ Bulk delete: ${succeeded} succeeded, ${failed} failed`;
      if (errors.length > 0) text += `\n\nErrors:\n${errors.join('\n')}`;
      return {
        content: [userAndAssistantText(text)],
        structuredContent: { succeeded, failed, errors, cancelled: bulkDeleteCancelled },
      };
    }

    case 'memoclaw_bulk_store': {
      const { memories, session_id, agent_id } = args as BulkStoreArgs;
      if (!memories || !Array.isArray(memories) || memories.length === 0) {
        throw new Error('memories is required and must be a non-empty array');
      }
      if (memories.length > 100) throw new Error('Maximum 100 memories per bulk store call');
      for (const [i, m] of memories.entries()) {
        if (!m.content || (typeof m.content === 'string' && m.content.trim() === '')) {
          throw new Error(`Memory at index ${i} has empty content`);
        }
        validateContentLength(m.content, `Memory at index ${i}`);
        validateImportance(m.importance, `Memory at index ${i} importance`);
      }
      return bulkStoreWithFallback(
        ctx,
        memories,
        ['content', 'importance', 'tags', 'namespace', 'memory_type', 'pinned', 'expires_at', 'immutable'],
        '✅ Bulk store',
        session_id,
        agent_id,
      );
    }

    case 'memoclaw_import': {
      const { memories, session_id, agent_id } = args as ImportArgs;
      if (!memories || !Array.isArray(memories) || memories.length === 0) {
        throw new Error('memories is required and must be a non-empty array');
      }
      if (memories.length > 100) throw new Error('Maximum 100 memories per import call');
      for (const [i, m] of memories.entries()) {
        if (!m.content || (typeof m.content === 'string' && m.content.trim() === '')) {
          throw new Error(`Memory at index ${i} has empty content`);
        }
        validateContentLength(m.content, `Memory at index ${i}`);
        validateImportance(m.importance, `Memory at index ${i} importance`);
      }
      return bulkStoreWithFallback(
        ctx,
        memories,
        ['content', 'importance', 'tags', 'namespace', 'memory_type', 'pinned', 'immutable'],
        '📥 Import',
        session_id,
        agent_id,
        'Imported memory',
      );
    }

    case 'memoclaw_pin': {
      const { id } = args as PinArgs;
      validateId(id, 'id');
      const result = await makeRequest('PATCH', `/v1/memories/${id}`, { pinned: true });
      const memory = result.memory || result;
      return {
        content: [
          userAndAssistantText(`📌 Memory ${id} pinned\n${formatMemory(memory)}`),
          memoryResourceLink(id, 'Pinned memory'),
        ],
        structuredContent: { memory },
      };
    }

    case 'memoclaw_unpin': {
      const { id } = args as UnpinArgs;
      validateId(id, 'id');
      const result = await makeRequest('PATCH', `/v1/memories/${id}`, { pinned: false });
      const memory = result.memory || result;
      return {
        content: [
          userAndAssistantText(`📌 Memory ${id} unpinned\n${formatMemory(memory)}`),
          memoryResourceLink(id, 'Unpinned memory'),
        ],
        structuredContent: { memory },
      };
    }

    case 'memoclaw_batch_update': {
      const { updates } = args as BatchUpdateArgs;
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        throw new Error('updates is required and must be a non-empty array');
      }
      if (updates.length > 50) throw new Error('Maximum 50 updates per batch update call');
      for (const [i, u] of updates.entries()) {
        if (!u.id) throw new Error(`Update at index ${i} is missing "id"`);
        validateImportance(u.importance, `Update at index ${i} importance`);
        validateTags(u.tags, `Update at index ${i} tags`);
      }
      try {
        const result = await makeRequest('POST', '/v1/memories/batch-update', { updates });
        const updated = result.updated ?? result.memories?.length ?? '?';
        const memories = result.memories || [];
        let text = `✅ Batch update: ${updated} memories updated`;
        if (memories.length > 0) text += `\n\n${memories.map((m: any) => formatMemory(m)).join('\n\n')}`;
        const batchResourceLinks = memories
          .filter((m: any) => m.id)
          .map((m: any) => memoryResourceLink(m.id, 'Updated memory'));
        return {
          content: [userAndAssistantText(text), assistantText(JSON.stringify(result, null, 2)), ...batchResourceLinks],
          structuredContent: {
            updated: typeof updated === 'number' ? updated : memories.length,
            failed: 0,
            memories,
            errors: [],
          },
        };
      } catch (err: any) {
        if (err.message?.includes('404') || err.message?.includes('Not Found')) {
          let updateProgress = 0;
          const results = await withConcurrency(
            updates.map((u: any) => async () => {
              const { id, ...fields } = u;
              const updateFields: Record<string, any> = {};
              for (const [key, value] of Object.entries(fields)) {
                if (UPDATE_FIELDS.has(key) && value !== undefined) updateFields[key] = value;
              }
              const result = await makeRequest('PATCH', `/v1/memories/${id}`, updateFields);
              updateProgress++;
              await progress(updateProgress, updates.length);
              return result;
            }),
            10,
            signal,
          );
          const succeeded = results.filter((r) => r?.status === 'fulfilled');
          const failed = results.filter((r) => r?.status === 'rejected');
          const memories = succeeded.map(
            (r) => (r as PromiseFulfilledResult<any>).value?.memory || (r as PromiseFulfilledResult<any>).value,
          );
          const errors = failed.map((r) => {
            const idx = results.indexOf(r);
            return `${updates[idx]?.id}: ${(r as PromiseRejectedResult).reason?.message || 'unknown error'}`;
          });
          const batchCancelled = signal.aborted && succeeded.length + failed.length < updates.length;
          let text = batchCancelled
            ? `⚠️ Batch update cancelled: ${succeeded.length} of ${updates.length} updated, ${failed.length} failed`
            : `✅ Batch update: ${succeeded.length} updated, ${failed.length} failed`;
          if (memories.length > 0) text += `\n\n${memories.map((m: any) => formatMemory(m)).join('\n\n')}`;
          if (errors.length > 0) text += `\n\nErrors:\n${errors.join('\n')}`;
          const fallbackResourceLinks = updates
            .filter((_u: any, i: number) => results[i]?.status === 'fulfilled')
            .map((u: any) => memoryResourceLink(u.id, 'Updated memory'));
          return {
            content: [userAndAssistantText(text), ...fallbackResourceLinks],
            structuredContent: {
              updated: succeeded.length,
              failed: failed.length,
              memories,
              errors,
              cancelled: batchCancelled,
            },
          };
        }
        throw err;
      }
    }

    case 'memoclaw_count': {
      const { namespace, tags, agent_id, memory_type, session_id, before, after, pinned } = args as CountArgs;
      validateISODate(after, 'after');
      validateISODate(before, 'before');
      const params = new URLSearchParams();
      if (namespace) params.set('namespace', namespace);
      if (tags && Array.isArray(tags) && tags.length > 0) params.set('tags', tags.join(','));
      if (agent_id) params.set('agent_id', agent_id);
      if (memory_type) params.set('memory_type', memory_type);
      if (session_id) params.set('session_id', session_id);
      if (before) params.set('before', before);
      if (after) params.set('after', after);
      if (pinned !== undefined) params.set('pinned', String(pinned));

      let total: number | string = 'unknown';
      try {
        const countResult = await makeRequest('GET', `/v1/memories/count?${params}`);
        total = countResult.count ?? countResult.total ?? 'unknown';
      } catch {
        params.set('limit', '1');
        params.set('offset', '0');
        const result = await makeRequest('GET', `/v1/memories?${params}`);
        if (typeof result.total === 'number') {
          total = result.total;
        } else {
          const memories = result.memories || result.data || [];
          if (memories.length === 0) {
            total = 0;
          } else {
            let counted = 0;
            let offset = 0;
            const pageSize = 100;
            while (offset < 10000) {
              if (signal.aborted) break;
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
            if (total === 'unknown') total = `${counted}+`;
          }
        }
      }

      const filters = [
        namespace && `namespace=${namespace}`,
        memory_type && `type=${memory_type}`,
        agent_id && `agent=${agent_id}`,
        session_id && `session=${session_id}`,
        tags?.length && `tags=${tags.join(',')}`,
        pinned !== undefined && `pinned=${pinned}`,
        after && `after=${after}`,
        before && `before=${before}`,
      ].filter(Boolean);
      const filterStr = filters.length > 0 ? ` (${filters.join(', ')})` : '';
      return {
        content: [userText(`📊 Total memories${filterStr}: ${total}`, 0.5)],
        structuredContent: { count: typeof total === 'number' ? total : undefined },
      };
    }

    default:
      return null;
  }
}
