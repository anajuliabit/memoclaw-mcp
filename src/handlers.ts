import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import type { ApiClient } from './api.js';
import type { Config } from './config.js';
import { formatMemory, withConcurrency, validateContentLength, UPDATE_FIELDS } from './format.js';

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

export function createHandler(api: ApiClient, config: Config) {
  const { makeRequest, account } = api;

  return async function handleToolCall(name: string, args: any): Promise<ToolResult> {
    switch (name) {
      case 'memoclaw_store': {
        const { content, importance, tags, namespace, memory_type, session_id, agent_id, expires_at, pinned, immutable } = args;
        if (!content || (typeof content === 'string' && content.trim() === '')) {
          throw new Error('content is required and cannot be empty');
        }
        validateContentLength(content);
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
        return { content: [{ type: 'text', text: `✅ Memory stored\n${formatMemory(result.memory || result)}\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_recall': {
        const { query, limit, min_similarity, tags, namespace, memory_type, session_id, agent_id, include_relations, after } = args;
        if (!query || (typeof query === 'string' && query.trim() === '')) {
          throw new Error('query is required and cannot be empty');
        }
        const filters: Record<string, any> = {};
        if (tags) filters.tags = tags;
        if (memory_type) filters.memory_type = memory_type;
        if (after) filters.after = after;
        const result = await makeRequest('POST', '/v1/recall', {
          query, limit, min_similarity,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
          namespace, session_id, agent_id, include_relations,
        });
        const memories = result.memories || [];
        if (memories.length === 0) {
          return { content: [{ type: 'text', text: `No memories found for query: "${query}"` }] };
        }
        const formatted = memories.map((m: any) => formatMemory(m)).join('\n\n');
        return { content: [{ type: 'text', text: `Found ${memories.length} memories:\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_search': {
        const { query, limit, namespace, tags, memory_type, session_id, agent_id, after } = args;
        if (!query || (typeof query === 'string' && query.trim() === '')) {
          throw new Error('query is required and cannot be empty');
        }
        const params = new URLSearchParams();
        params.set('q', query);
        if (limit !== undefined) params.set('limit', String(limit));
        if (namespace) params.set('namespace', namespace);
        if (tags && Array.isArray(tags) && tags.length > 0) params.set('tags', tags.join(','));
        if (memory_type) params.set('memory_type', memory_type);
        if (session_id) params.set('session_id', session_id);
        if (agent_id) params.set('agent_id', agent_id);
        if (after) params.set('after', after);
        const result = await makeRequest('GET', `/v1/memories/search?${params}`);
        const memories = result.memories || result.data || [];
        if (memories.length === 0) {
          return { content: [{ type: 'text', text: `No memories found containing: "${query}"` }] };
        }
        const formatted = memories.map((m: any) => formatMemory(m)).join('\n\n');
        return { content: [{ type: 'text', text: `Found ${memories.length} memories containing "${query}":\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_get': {
        const { id } = args;
        if (!id) throw new Error('id is required');
        const result = await makeRequest('GET', `/v1/memories/${id}`);
        return { content: [{ type: 'text', text: `${formatMemory(result.memory || result)}\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_list': {
        const { limit, offset, tags, namespace, memory_type, session_id, agent_id, after } = args;
        const params = new URLSearchParams();
        if (limit !== undefined) params.set('limit', String(limit));
        if (offset !== undefined) params.set('offset', String(offset));
        if (namespace) params.set('namespace', namespace);
        if (memory_type) params.set('memory_type', memory_type);
        if (tags && Array.isArray(tags) && tags.length > 0) params.set('tags', tags.join(','));
        if (session_id) params.set('session_id', session_id);
        if (agent_id) params.set('agent_id', agent_id);
        if (after) params.set('after', after);
        const result = await makeRequest('GET', `/v1/memories?${params}`);
        const memories = result.memories || result.data || [];
        const total = result.total ?? memories.length;
        const formatted = memories.length > 0
          ? '\n\n' + memories.map((m: any) => formatMemory(m)).join('\n\n')
          : '';
        return { content: [{ type: 'text', text: `Showing ${memories.length} of ${total} memories${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_delete': {
        const { id } = args;
        if (!id) throw new Error('id is required');
        const result = await makeRequest('DELETE', `/v1/memories/${id}`);
        return { content: [{ type: 'text', text: `🗑️ Memory ${id} deleted\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_bulk_delete': {
        const { ids } = args;
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
          const results = await withConcurrency(
            ids.map((id: string) => () => makeRequest('DELETE', `/v1/memories/${id}`)),
            10
          );
          succeeded = results.filter(r => r.status === 'fulfilled').length;
          failed = results.filter(r => r.status === 'rejected').length;
          errors = results
            .map((r, i) => r.status === 'rejected' ? `${ids[i]}: ${(r as PromiseRejectedResult).reason?.message || 'unknown error'}` : null)
            .filter(Boolean) as string[];
        }

        let text = `🗑️ Bulk delete: ${succeeded} succeeded, ${failed} failed`;
        if (errors.length > 0) text += `\n\nErrors:\n${errors.join('\n')}`;
        return { content: [{ type: 'text', text }] };
      }

      case 'memoclaw_status': {
        const data = await makeRequest('GET', '/v1/free-tier/status');
        const remaining = data.free_tier_remaining ?? 'unknown';
        const total = data.free_tier_total ?? 100;
        const pct = typeof remaining === 'number' ? Math.round((remaining / total) * 100) : '?';
        return { content: [{ type: 'text', text: `Wallet: ${data.wallet || account.address}\nFree tier: ${remaining}/${total} calls remaining (${pct}%)` }] };
      }

      case 'memoclaw_ingest': {
        const { messages, text, namespace, session_id, agent_id, auto_relate } = args;
        if (!messages && !text) throw new Error('Either messages or text is required');
        const result = await makeRequest('POST', '/v1/ingest', {
          messages, text, namespace, session_id, agent_id, auto_relate: auto_relate !== false,
        });
        const count = result.memories_created ?? result.count ?? '?';
        return { content: [{ type: 'text', text: `📥 Ingested: ${count} memories created\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_extract': {
        const { messages, namespace, session_id, agent_id } = args;
        if (!messages || !Array.isArray(messages) || messages.length === 0) {
          throw new Error('messages is required and must be a non-empty array');
        }
        const result = await makeRequest('POST', '/v1/memories/extract', { messages, namespace, session_id, agent_id });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      case 'memoclaw_consolidate': {
        const { namespace, min_similarity, mode, dry_run } = args;
        const body: any = {};
        if (namespace) body.namespace = namespace;
        if (min_similarity !== undefined) body.min_similarity = min_similarity;
        if (mode) body.mode = mode;
        if (dry_run !== undefined) body.dry_run = dry_run;
        const result = await makeRequest('POST', '/v1/memories/consolidate', body);
        const prefix = dry_run ? '🔍 Consolidation preview (dry run)' : '✅ Consolidation complete';
        return { content: [{ type: 'text', text: `${prefix}\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_suggested': {
        const { limit, namespace, session_id, agent_id, category } = args;
        const params = new URLSearchParams();
        if (limit !== undefined) params.set('limit', String(limit));
        if (namespace) params.set('namespace', namespace);
        if (session_id) params.set('session_id', session_id);
        if (agent_id) params.set('agent_id', agent_id);
        if (category) params.set('category', category);
        const qs = params.toString();
        const result = await makeRequest('GET', `/v1/suggested${qs ? '?' + qs : ''}`);
        const suggestions = result.suggestions || result.memories || [];
        if (suggestions.length === 0) {
          return { content: [{ type: 'text', text: `No suggestions found${category ? ` for category "${category}"` : ''}.` }] };
        }
        const formatted = suggestions.map((m: any) => formatMemory(m)).join('\n\n');
        return { content: [{ type: 'text', text: `💡 ${suggestions.length} suggestions${category ? ` (${category})` : ''}:\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_update': {
        const { id, ...allFields } = args;
        if (!id) throw new Error('id is required');
        const updateFields: Record<string, any> = {};
        for (const [key, value] of Object.entries(allFields)) {
          if (UPDATE_FIELDS.has(key) && value !== undefined) updateFields[key] = value;
        }
        if (Object.keys(updateFields).length === 0) {
          throw new Error('No valid update fields provided. Allowed: ' + [...UPDATE_FIELDS].join(', '));
        }
        if (typeof updateFields.content === 'string') validateContentLength(updateFields.content);
        const result = await makeRequest('PATCH', `/v1/memories/${id}`, updateFields);
        return { content: [{ type: 'text', text: `✅ Memory ${id} updated\n${formatMemory(result.memory || result)}\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_create_relation': {
        const { memory_id, target_id, relation_type, metadata } = args;
        if (!memory_id || !target_id || !relation_type) {
          throw new Error('memory_id, target_id, and relation_type are all required');
        }
        const body: any = { target_id, relation_type };
        if (metadata) body.metadata = metadata;
        const result = await makeRequest('POST', `/v1/memories/${memory_id}/relations`, body);
        return { content: [{ type: 'text', text: `🔗 Relation created: ${memory_id} —[${relation_type}]→ ${target_id}\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_list_relations': {
        const { memory_id } = args;
        if (!memory_id) throw new Error('memory_id is required');
        const result = await makeRequest('GET', `/v1/memories/${memory_id}/relations`);
        const relations = result.relations || [];
        if (relations.length === 0) {
          return { content: [{ type: 'text', text: `No relations found for memory ${memory_id}.` }] };
        }
        const formatted = relations.map((r: any) =>
          `🔗 ${r.id || '?'}: ${r.source_id || memory_id} —[${r.relation_type}]→ ${r.target_id}`
        ).join('\n');
        return { content: [{ type: 'text', text: `Relations for ${memory_id}:\n${formatted}\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_delete_relation': {
        const { memory_id, relation_id } = args;
        if (!memory_id || !relation_id) throw new Error('memory_id and relation_id are required');
        const result = await makeRequest('DELETE', `/v1/memories/${memory_id}/relations/${relation_id}`);
        return { content: [{ type: 'text', text: `🗑️ Relation ${relation_id} deleted\n\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_export': {
        const { namespace, agent_id, format: fmt } = args;
        const allMemories: any[] = [];
        let offset = 0;
        const pageSize = 100;
        while (true) {
          const params = new URLSearchParams();
          params.set('limit', String(pageSize));
          params.set('offset', String(offset));
          if (namespace) params.set('namespace', namespace);
          if (agent_id) params.set('agent_id', agent_id);
          const result = await makeRequest('GET', `/v1/memories?${params}`);
          const memories = result.memories || result.data || [];
          allMemories.push(...memories);
          if (memories.length < pageSize) break;
          offset += pageSize;
        }
        const output = fmt === 'jsonl'
          ? allMemories.map(m => JSON.stringify(m)).join('\n')
          : JSON.stringify(allMemories, null, 2);
        return { content: [{ type: 'text', text: `📦 Exported ${allMemories.length} memories\n\n${output}` }] };
      }

      case 'memoclaw_import': {
        const { memories, session_id, agent_id } = args;
        if (!memories || !Array.isArray(memories) || memories.length === 0) {
          throw new Error('memories is required and must be a non-empty array');
        }
        if (memories.length > 100) throw new Error('Maximum 100 memories per import call');
        for (const [i, m] of memories.entries()) {
          if (!m.content || (typeof m.content === 'string' && m.content.trim() === '')) {
            throw new Error(`Memory at index ${i} has empty content`);
          }
          validateContentLength(m.content, `Memory at index ${i}`);
        }
        const results = await withConcurrency(
          memories.map((m: any) => () => {
            const body: any = { content: m.content };
            if (m.importance !== undefined) body.importance = m.importance;
            if (m.tags) body.tags = m.tags;
            if (m.namespace) body.namespace = m.namespace;
            if (m.memory_type) body.memory_type = m.memory_type;
            if (m.pinned !== undefined) body.pinned = m.pinned;
            if (m.immutable !== undefined) body.immutable = m.immutable;
            if (session_id) body.session_id = session_id;
            if (agent_id) body.agent_id = agent_id;
            return makeRequest('POST', '/v1/store', body);
          }),
          10
        );
        const succeeded = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        const errors = results
          .map((r, i) => r.status === 'rejected' ? `index ${i}: ${(r as PromiseRejectedResult).reason?.message || 'unknown error'}` : null)
          .filter(Boolean);
        let text = `📥 Import: ${succeeded} stored, ${failed} failed`;
        if (errors.length > 0) text += `\n\nErrors:\n${errors.join('\n')}`;
        return { content: [{ type: 'text', text }] };
      }

      case 'memoclaw_bulk_store': {
        const { memories, session_id, agent_id } = args;
        if (!memories || !Array.isArray(memories) || memories.length === 0) {
          throw new Error('memories is required and must be a non-empty array');
        }
        if (memories.length > 50) throw new Error('Maximum 50 memories per bulk store call');
        for (const [i, m] of memories.entries()) {
          if (!m.content || (typeof m.content === 'string' && m.content.trim() === '')) {
            throw new Error(`Memory at index ${i} has empty content`);
          }
          validateContentLength(m.content, `Memory at index ${i}`);
        }
        const STORE_FIELDS = ['content', 'importance', 'tags', 'namespace', 'memory_type', 'pinned', 'expires_at', 'immutable'];
        const results = await withConcurrency(
          memories.map((m: any) => () => {
            const body: any = {};
            for (const key of STORE_FIELDS) {
              if (m[key] !== undefined) body[key] = m[key];
            }
            if (session_id) body.session_id = session_id;
            if (agent_id) body.agent_id = agent_id;
            return makeRequest('POST', '/v1/store', body);
          }),
          10
        );
        const succeeded = results.filter(r => r.status === 'fulfilled');
        const failed = results.filter(r => r.status === 'rejected');
        const stored = succeeded.map(r => (r as PromiseFulfilledResult<any>).value?.memory || (r as PromiseFulfilledResult<any>).value);
        const errors = failed.map((r) => {
          const idx = results.indexOf(r);
          return `index ${idx}: ${(r as PromiseRejectedResult).reason?.message || 'unknown error'}`;
        });
        let text = `✅ Bulk store: ${succeeded.length} stored, ${failed.length} failed`;
        if (stored.length > 0) text += `\n\n${stored.map((m: any) => formatMemory(m)).join('\n\n')}`;
        if (errors.length > 0) text += `\n\nErrors:\n${errors.join('\n')}`;
        return { content: [{ type: 'text', text }] };
      }

      case 'memoclaw_count': {
        const { namespace, tags, agent_id, memory_type } = args;
        const params = new URLSearchParams();
        if (namespace) params.set('namespace', namespace);
        if (tags && Array.isArray(tags) && tags.length > 0) params.set('tags', tags.join(','));
        if (agent_id) params.set('agent_id', agent_id);
        if (memory_type) params.set('memory_type', memory_type);

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
              while (offset < 100000) {
                const pageParams = new URLSearchParams(params);
                pageParams.set('limit', String(pageSize));
                pageParams.set('offset', String(offset));
                const page = await makeRequest('GET', `/v1/memories?${pageParams}`);
                const items = page.memories || page.data || [];
                counted += items.length;
                if (typeof page.total === 'number') { total = page.total; break; }
                if (items.length < pageSize) { total = counted; break; }
                offset += pageSize;
              }
              if (typeof total === 'undefined') total = `${counted}+`;
            }
          }
        }

        const filters = [namespace && `namespace=${namespace}`, memory_type && `type=${memory_type}`, agent_id && `agent=${agent_id}`, tags?.length && `tags=${tags.join(',')}`].filter(Boolean);
        const filterStr = filters.length > 0 ? ` (${filters.join(', ')})` : '';
        return { content: [{ type: 'text', text: `📊 Total memories${filterStr}: ${total}` }] };
      }

      case 'memoclaw_delete_namespace': {
        const { namespace, agent_id } = args;
        if (!namespace) throw new Error('namespace is required');
        const deletedIds: string[] = [];
        const errors: string[] = [];
        const failedIds = new Set<string>();
        let pages = 0;
        const pageSize = 100;

        while (pages < 200) {
          pages++;
          const params = new URLSearchParams();
          params.set('limit', String(pageSize));
          params.set('offset', String(failedIds.size));
          params.set('namespace', namespace);
          if (agent_id) params.set('agent_id', agent_id);
          const result = await makeRequest('GET', `/v1/memories?${params}`);
          const memories = result.memories || result.data || [];
          if (memories.length === 0) break;
          const toDelete = memories.filter((m: any) => !failedIds.has(m.id));
          if (toDelete.length === 0) break;
          const deleteResults = await withConcurrency(
            toDelete.map((m: any) => () => makeRequest('DELETE', `/v1/memories/${m.id}`)),
            10
          );
          let pageSuccesses = 0;
          for (let i = 0; i < deleteResults.length; i++) {
            if (deleteResults[i].status === 'fulfilled') {
              deletedIds.push(toDelete[i].id);
              pageSuccesses++;
            } else {
              failedIds.add(toDelete[i].id);
              errors.push(`${toDelete[i].id}: ${(deleteResults[i] as PromiseRejectedResult).reason?.message || 'unknown'}`);
            }
          }
          if (memories.length < pageSize) break;
          if (pageSuccesses === 0) break;
        }

        let text = `🗑️ Namespace "${namespace}": ${deletedIds.length} memories deleted`;
        if (errors.length > 0) text += `, ${errors.length} failed\n\nErrors:\n${errors.slice(0, 10).join('\n')}`;
        return { content: [{ type: 'text', text }] };
      }

      case 'memoclaw_graph': {
        const { memory_id, depth: rawDepth, relation_type } = args;
        if (!memory_id) throw new Error('memory_id is required');
        const depth = Math.min(Math.max(rawDepth || 1, 1), 3);
        const visited = new Set<string>();
        const nodes: any[] = [];
        const edges: any[] = [];
        let frontier = [memory_id];

        for (let d = 0; d <= depth && frontier.length > 0; d++) {
          const nextFrontier: string[] = [];
          for (const mid of frontier) {
            if (visited.has(mid)) continue;
            visited.add(mid);
            try {
              const mem = await makeRequest('GET', `/v1/memories/${mid}`);
              nodes.push(mem.memory || mem);
            } catch {
              nodes.push({ id: mid, content: '(could not fetch)' });
            }
            if (d < depth) {
              try {
                const relResult = await makeRequest('GET', `/v1/memories/${mid}/relations`);
                const relations = relResult.relations || [];
                for (const r of relations) {
                  if (relation_type && r.relation_type !== relation_type) continue;
                  edges.push(r);
                  const neighbor = r.target_id === mid ? r.source_id : r.target_id;
                  if (neighbor && !visited.has(neighbor)) nextFrontier.push(neighbor);
                }
              } catch { /* no relations */ }
            }
          }
          frontier = nextFrontier;
        }

        const nodesFmt = nodes.map((n: any) => formatMemory(n)).join('\n\n');
        const edgesFmt = edges.map((r: any) => `  ${r.source_id} —[${r.relation_type}]→ ${r.target_id}`).join('\n');
        return { content: [{ type: 'text', text: `🕸️ Graph from ${memory_id} (depth ${depth}):\n\n${nodes.length} nodes:\n${nodesFmt}\n\n${edges.length} edges:\n${edgesFmt || '  (none)'}` }] };
      }

      case 'memoclaw_init': {
        const checks: string[] = [];
        let healthy = true;
        checks.push(`✅ Private key loaded (source: ${config.configSource})`);
        checks.push(`📍 API URL: ${config.apiUrl}`);
        checks.push(`👛 Wallet: ${account.address}`);
        try {
          const data = await makeRequest('GET', '/v1/free-tier/status');
          const remaining = data.free_tier_remaining ?? 'unknown';
          const total = data.free_tier_total ?? 100;
          checks.push(`✅ API reachable`);
          checks.push(`📊 Free tier: ${remaining}/${total} calls remaining`);
          if (typeof remaining === 'number' && remaining <= 0) {
            checks.push(`⚠️ Free tier exhausted — x402 payments will be used`);
          }
        } catch (err: any) {
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

        let fileList: Array<{ filename: string; content: string }> = [];

        if (files && Array.isArray(files)) {
          fileList = files.map((f: any, i: number) => ({
            filename: f.filename || `file-${i}.md`,
            content: f.content,
          }));
        } else if (filePath) {
          const EXTENSIONS = new Set(['.md', '.txt']);
          async function collectFiles(p: string): Promise<Array<{ filename: string; content: string }>> {
            const s = await stat(p);
            if (s.isFile() && EXTENSIONS.has(extname(p).toLowerCase())) {
              const content = await readFile(p, 'utf-8');
              return [{ filename: basename(p), content }];
            } else if (s.isDirectory()) {
              const entries = await readdir(p);
              const results: Array<{ filename: string; content: string }> = [];
              for (const entry of entries) {
                if (entry.startsWith('.')) continue;
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

        const body: any = {
          files: fileList,
          namespace: namespace || 'migrated',
          deduplicate: deduplicate !== false,
        };
        if (agent_id) body.agent_id = agent_id;
        if (dry_run) body.dry_run = true;

        try {
          const result = await makeRequest('POST', '/v1/migrate', body);
          const prefix = dry_run ? '🔍 Migration preview (dry run)' : '✅ Migration complete';
          const created = result.memories_created ?? result.count ?? '?';
          const skipped = result.duplicates_skipped ?? 0;
          return { content: [{ type: 'text', text: `${prefix}\n\n📁 Files processed: ${fileList.length}\n📝 Memories created: ${created}\n🔄 Duplicates skipped: ${skipped}\n\n${JSON.stringify(result, null, 2)}` }] };
        } catch (err: any) {
          if (err.message?.includes('404') || err.message?.includes('Not Found')) {
            if (dry_run) {
              return { content: [{ type: 'text', text: `🔍 Migration preview (dry run — /v1/migrate not available, would use ingest fallback)\n\n📁 ${fileList.length} files would be ingested:\n${fileList.map(f => `  • ${f.filename} (${f.content.length} chars)`).join('\n')}` }] };
            }
            let totalCreated = 0;
            const errors: string[] = [];
            for (const file of fileList) {
              try {
                const r = await makeRequest('POST', '/v1/ingest', {
                  text: file.content,
                  namespace: namespace || 'migrated',
                  agent_id,
                });
                totalCreated += r.memories_created ?? r.count ?? 0;
              } catch (e: any) {
                errors.push(`${file.filename}: ${e.message}`);
              }
            }
            let text = `✅ Migration complete (via ingest fallback)\n\n📁 Files processed: ${fileList.length}\n📝 Memories created: ${totalCreated}`;
            if (errors.length > 0) text += `\n\n❌ Errors:\n${errors.join('\n')}`;
            return { content: [{ type: 'text', text }] };
          }
          throw err;
        }
      }

      case 'memoclaw_pin': {
        const { id } = args;
        if (!id) throw new Error('id is required');
        const result = await makeRequest('PATCH', `/v1/memories/${id}`, { pinned: true });
        return { content: [{ type: 'text', text: `📌 Memory ${id} pinned\n${formatMemory(result.memory || result)}` }] };
      }

      case 'memoclaw_unpin': {
        const { id } = args;
        if (!id) throw new Error('id is required');
        const result = await makeRequest('PATCH', `/v1/memories/${id}`, { pinned: false });
        return { content: [{ type: 'text', text: `📌 Memory ${id} unpinned\n${formatMemory(result.memory || result)}` }] };
      }

      case 'memoclaw_tags': {
        const { namespace, agent_id } = args;
        try {
          const params = new URLSearchParams();
          if (namespace) params.set('namespace', namespace);
          if (agent_id) params.set('agent_id', agent_id);
          const qs = params.toString();
          const result = await makeRequest('GET', `/v1/tags${qs ? '?' + qs : ''}`);
          if (result.tags) {
            const tags = result.tags;
            if (tags.length === 0) return { content: [{ type: 'text', text: 'No tags found across memories.' }] };
            const lines = tags.map((t: any) =>
              typeof t === 'string' ? `  • ${t}` : `  • ${t.tag || t.name}: ${t.count} memories`
            );
            return { content: [{ type: 'text', text: `🏷️ ${tags.length} tags:\n\n${lines.join('\n')}` }] };
          }
        } catch { /* fall through to client-side */ }

        const tagCounts = new Map<string, number>();
        let offset = 0;
        const pageSize = 100;
        for (let page = 0; page < 200; page++) {
          const params = new URLSearchParams();
          params.set('limit', String(pageSize));
          params.set('offset', String(offset));
          if (namespace) params.set('namespace', namespace);
          if (agent_id) params.set('agent_id', agent_id);
          const result = await makeRequest('GET', `/v1/memories?${params}`);
          const memories = result.memories || result.data || [];
          if (memories.length === 0) break;
          for (const m of memories) {
            const tags = m.tags || m.metadata?.tags || [];
            for (const tag of tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
          }
          if (memories.length < pageSize) break;
          offset += pageSize;
        }
        if (tagCounts.size === 0) return { content: [{ type: 'text', text: 'No tags found across memories.' }] };
        const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
        const lines = sorted.map(([tag, count]) => `  • ${tag}: ${count} memories`);
        return { content: [{ type: 'text', text: `🏷️ ${sorted.length} tags:\n\n${lines.join('\n')}` }] };
      }

      case 'memoclaw_history': {
        const { id } = args;
        if (!id) throw new Error('id is required');
        const result = await makeRequest('GET', `/v1/memories/${id}/history`);
        const history = result.history || result.versions || result.data || [];
        if (history.length === 0) {
          return { content: [{ type: 'text', text: `No edit history found for memory ${id}.` }] };
        }
        const formatted = history.map((entry: any, i: number) => {
          const parts = [`Version ${i + 1}`];
          if (entry.content) parts.push(`  content: ${entry.content.substring(0, 200)}${entry.content.length > 200 ? '...' : ''}`);
          if (entry.importance !== undefined) parts.push(`  importance: ${entry.importance}`);
          if (entry.tags?.length) parts.push(`  tags: ${entry.tags.join(', ')}`);
          if (entry.memory_type) parts.push(`  type: ${entry.memory_type}`);
          if (entry.namespace) parts.push(`  namespace: ${entry.namespace}`);
          if (entry.pinned !== undefined) parts.push(`  pinned: ${entry.pinned}`);
          if (entry.changed_at || entry.updated_at || entry.created_at) {
            parts.push(`  date: ${entry.changed_at || entry.updated_at || entry.created_at}`);
          }
          if (entry.changed_fields) parts.push(`  changed: ${Array.isArray(entry.changed_fields) ? entry.changed_fields.join(', ') : entry.changed_fields}`);
          return parts.join('\n');
        }).join('\n\n');
        return { content: [{ type: 'text', text: `📜 History for memory ${id} (${history.length} versions):\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_context': {
        const { query, limit, namespace, session_id, agent_id } = args;
        if (!query || (typeof query === 'string' && query.trim() === '')) {
          throw new Error('query is required and cannot be empty');
        }
        const body: any = { query };
        if (limit !== undefined) body.limit = limit;
        if (namespace) body.namespace = namespace;
        if (session_id) body.session_id = session_id;
        if (agent_id) body.agent_id = agent_id;
        const result = await makeRequest('POST', '/v1/context', body);
        const memories = result.memories || result.context || [];
        if (memories.length === 0) {
          return { content: [{ type: 'text', text: `No relevant context found for: "${query}"` }] };
        }
        const formatted = memories.map((m: any) => formatMemory(m)).join('\n\n');
        return { content: [{ type: 'text', text: `🧠 Context for "${query}" (${memories.length} memories):\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_namespaces': {
        const { agent_id } = args;
        try {
          const params = new URLSearchParams();
          if (agent_id) params.set('agent_id', agent_id);
          const qs = params.toString();
          const result = await makeRequest('GET', `/v1/namespaces${qs ? '?' + qs : ''}`);
          if (result.namespaces) {
            const namespaces = result.namespaces;
            if (namespaces.length === 0) return { content: [{ type: 'text', text: 'No memories found — no namespaces to list.' }] };
            const lines = namespaces.map((n: any) =>
              typeof n === 'string' ? `  • ${n}` : `  • ${n.namespace || n.name || '(default)'}: ${n.count} memories`
            );
            return { content: [{ type: 'text', text: `📁 ${namespaces.length} namespaces:\n\n${lines.join('\n')}` }] };
          }
        } catch { /* fall through */ }

        const nsCounts = new Map<string, number>();
        let offset = 0;
        const pageSize = 100;
        for (let page = 0; page < 200; page++) {
          const params = new URLSearchParams();
          params.set('limit', String(pageSize));
          params.set('offset', String(offset));
          if (agent_id) params.set('agent_id', agent_id);
          const result = await makeRequest('GET', `/v1/memories?${params}`);
          const memories = result.memories || result.data || [];
          if (memories.length === 0) break;
          for (const m of memories) {
            const ns = m.namespace || '(default)';
            nsCounts.set(ns, (nsCounts.get(ns) || 0) + 1);
          }
          if (memories.length < pageSize) break;
          offset += pageSize;
        }
        if (nsCounts.size === 0) return { content: [{ type: 'text', text: 'No memories found — no namespaces to list.' }] };
        const sorted = [...nsCounts.entries()].sort((a, b) => b[1] - a[1]);
        const lines = sorted.map(([ns, count]) => `  • ${ns}: ${count} memories`);
        return { content: [{ type: 'text', text: `📁 ${sorted.length} namespaces:\n\n${lines.join('\n')}` }] };
      }

      case 'memoclaw_batch_update': {
        const { updates } = args;
        if (!updates || !Array.isArray(updates) || updates.length === 0) {
          throw new Error('updates is required and must be a non-empty array');
        }
        if (updates.length > 50) throw new Error('Maximum 50 updates per batch update call');
        for (const [i, u] of updates.entries()) {
          if (!u.id) throw new Error(`Update at index ${i} is missing "id"`);
        }
        try {
          const result = await makeRequest('POST', '/v1/memories/batch-update', { updates });
          const updated = result.updated ?? result.memories?.length ?? '?';
          const memories = result.memories || [];
          let text = `✅ Batch update: ${updated} memories updated`;
          if (memories.length > 0) text += `\n\n${memories.map((m: any) => formatMemory(m)).join('\n\n')}`;
          return { content: [{ type: 'text', text: `${text}\n\n${JSON.stringify(result, null, 2)}` }] };
        } catch (err: any) {
          if (err.message?.includes('404') || err.message?.includes('Not Found')) {
            const results = await withConcurrency(
              updates.map((u: any) => () => {
                const { id, ...fields } = u;
                const updateFields: Record<string, any> = {};
                for (const [key, value] of Object.entries(fields)) {
                  if (UPDATE_FIELDS.has(key) && value !== undefined) updateFields[key] = value;
                }
                return makeRequest('PATCH', `/v1/memories/${id}`, updateFields);
              }),
              10
            );
            const succeeded = results.filter(r => r.status === 'fulfilled');
            const failed = results.filter(r => r.status === 'rejected');
            const memories = succeeded.map(r => (r as PromiseFulfilledResult<any>).value?.memory || (r as PromiseFulfilledResult<any>).value);
            const errors = failed.map((r) => {
              const idx = results.indexOf(r);
              return `${updates[idx]?.id}: ${(r as PromiseRejectedResult).reason?.message || 'unknown error'}`;
            });
            let text = `✅ Batch update: ${succeeded.length} updated, ${failed.length} failed`;
            if (memories.length > 0) text += `\n\n${memories.map((m: any) => formatMemory(m)).join('\n\n')}`;
            if (errors.length > 0) text += `\n\nErrors:\n${errors.join('\n')}`;
            return { content: [{ type: 'text', text }] };
          }
          throw err;
        }
      }

      case 'memoclaw_core_memories': {
        const { limit, namespace, agent_id } = args;
        const params = new URLSearchParams();
        if (limit !== undefined) params.set('limit', String(limit));
        if (namespace) params.set('namespace', namespace);
        if (agent_id) params.set('agent_id', agent_id);
        const qs = params.toString();
        const result = await makeRequest('GET', `/v1/core-memories${qs ? '?' + qs : ''}`);
        const memories = result.memories || result.core_memories || result.data || [];
        if (memories.length === 0) {
          return { content: [{ type: 'text', text: 'No core memories found. Store important memories with high importance scores or pin them.' }] };
        }
        const formatted = memories.map((m: any) => formatMemory(m)).join('\n\n');
        return { content: [{ type: 'text', text: `⭐ ${memories.length} core memories:\n\n${formatted}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
      }

      case 'memoclaw_stats': {
        const result = await makeRequest('GET', '/v1/stats');
        const lines: string[] = [];
        if (result.total_memories !== undefined) lines.push(`Total memories: ${result.total_memories}`);
        if (result.pinned_count !== undefined) lines.push(`Pinned: ${result.pinned_count}`);
        if (result.never_accessed !== undefined) lines.push(`Never accessed: ${result.never_accessed}`);
        if (result.total_accesses !== undefined) lines.push(`Total accesses: ${result.total_accesses}`);
        if (result.avg_importance !== undefined) lines.push(`Avg importance: ${typeof result.avg_importance === 'number' ? result.avg_importance.toFixed(2) : result.avg_importance}`);
        if (result.oldest_memory) lines.push(`Oldest: ${result.oldest_memory}`);
        if (result.newest_memory) lines.push(`Newest: ${result.newest_memory}`);
        if (result.by_type?.length) {
          lines.push('\nBy type:');
          for (const t of result.by_type) lines.push(`  • ${t.memory_type || t.type}: ${t.count}`);
        }
        if (result.by_namespace?.length) {
          lines.push('\nBy namespace:');
          for (const n of result.by_namespace) lines.push(`  • ${n.namespace || '(default)'}: ${n.count}`);
        }
        return { content: [{ type: 'text', text: `📊 Memory Stats\n\n${lines.join('\n')}\n\n---\n${JSON.stringify(result, null, 2)}` }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  };
}
