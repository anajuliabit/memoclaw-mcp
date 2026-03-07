import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { formatMemory, withConcurrency, validateContentLength, validateImportance, userAndAssistantText, assistantText, userText, memoryResourceLink } from '../format.js';
import type { HandlerContext, ToolResult } from './types.js';
import type {
  StatusArgs, InitArgs, IngestArgs, ExtractArgs, ConsolidateArgs,
  ExportArgs, MigrateArgs, DeleteNamespaceArgs, TagsArgs, HistoryArgs,
  NamespacesArgs, CoreMemoriesArgs, StatsArgs,
} from '../types.js';

export async function handleAdmin(ctx: HandlerContext, name: string, args: any): Promise<ToolResult | null> {
  const { makeRequest, account, config } = ctx;

  switch (name) {
    case 'memoclaw_status': {
      const data = await makeRequest('GET', '/v1/free-tier/status');
      const remaining = data.free_tier_remaining ?? 'unknown';
      const total = data.free_tier_total ?? 100;
      const pct = typeof remaining === 'number' ? Math.round((remaining / total) * 100) : '?';
      return { content: [userText(`Wallet: ${data.wallet || account.address}\nFree tier: ${remaining}/${total} calls remaining (${pct}%)`, 0.5)] };
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
      return { content: [userText(`${status}\n\n${checks.join('\n')}`, healthy ? 0.5 : 1.0)] };
    }

    case 'memoclaw_ingest': {
      const { messages, text, namespace, session_id, agent_id, auto_relate } = args as IngestArgs;
      if (!messages && !text) throw new Error('Either messages or text is required');
      const result = await makeRequest('POST', '/v1/ingest', {
        messages, text, namespace, session_id, agent_id, auto_relate: auto_relate !== false,
      });
      const count = result.memories_created ?? result.count ?? '?';
      const memories = result.memories || result.data || [];
      const resourceLinks = memories
        .filter((m: any) => m.id)
        .map((m: any) => memoryResourceLink(m.id, 'Ingested memory'));
      return { content: [
        userAndAssistantText(`📥 Ingested: ${count} memories created`),
        assistantText(JSON.stringify(result, null, 2)),
        ...resourceLinks,
      ] };
    }

    case 'memoclaw_extract': {
      const { messages, namespace, session_id, agent_id } = args as ExtractArgs;
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        throw new Error('messages is required and must be a non-empty array');
      }
      const result = await makeRequest('POST', '/v1/memories/extract', { messages, namespace, session_id, agent_id });
      return { content: [assistantText(JSON.stringify(result, null, 2))] };
    }

    case 'memoclaw_consolidate': {
      const { namespace, min_similarity, mode, dry_run, agent_id } = args as ConsolidateArgs;
      const body: any = {};
      if (namespace) body.namespace = namespace;
      if (agent_id) body.agent_id = agent_id;
      if (min_similarity !== undefined) body.min_similarity = min_similarity;
      if (mode) body.mode = mode;
      if (dry_run !== undefined) body.dry_run = dry_run;
      const result = await makeRequest('POST', '/v1/memories/consolidate', body);
      const prefix = dry_run ? '🔍 Consolidation preview (dry run)' : '✅ Consolidation complete';
      return { content: [
        userAndAssistantText(prefix),
        assistantText(JSON.stringify(result, null, 2)),
      ] };
    }

    case 'memoclaw_export': {
      const { namespace, agent_id, format: fmt } = args as ExportArgs;
      const params = new URLSearchParams();
      if (namespace) params.set('namespace', namespace);
      if (agent_id) params.set('agent_id', agent_id);
      if (fmt) params.set('format', fmt);
      const query = params.toString();
      try {
        const result = await makeRequest('GET', `/v1/export${query ? `?${query}` : ''}`);
        const memories = result.memories || result.data || result;
        const list = Array.isArray(memories) ? memories : [];
        const output = fmt === 'jsonl'
          ? list.map((m: any) => JSON.stringify(m)).join('\n')
          : JSON.stringify(list, null, 2);
        return { content: [
          userAndAssistantText(`📦 Exported ${list.length} memories`),
          assistantText(output),
        ] };
      } catch (exportErr: any) {
        // Only fall back to pagination if /v1/export is not found (404)
        if (!exportErr.message?.includes('404') && !exportErr.message?.includes('Not Found')) {
          throw exportErr;
        }
        // Fallback: paginate through /v1/memories if /v1/export is unavailable
        const allMemories: any[] = [];
        let offset = 0;
        const pageSize = 100;
        while (true) {
          const fallbackParams = new URLSearchParams();
          fallbackParams.set('limit', String(pageSize));
          fallbackParams.set('offset', String(offset));
          if (namespace) fallbackParams.set('namespace', namespace);
          if (agent_id) fallbackParams.set('agent_id', agent_id);
          const result = await makeRequest('GET', `/v1/memories?${fallbackParams}`);
          const memories = result.memories || result.data || [];
          allMemories.push(...memories);
          if (memories.length < pageSize) break;
          offset += pageSize;
        }
        const output = fmt === 'jsonl'
          ? allMemories.map((m: any) => JSON.stringify(m)).join('\n')
          : JSON.stringify(allMemories, null, 2);
        return { content: [
          userAndAssistantText(`📦 Exported ${allMemories.length} memories`),
          assistantText(output),
        ] };
      }
    }

    case 'memoclaw_migrate': {
      const { path: filePath, files, namespace, agent_id, deduplicate, dry_run } = args as MigrateArgs;
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
        return { content: [userText('⚠️ No .md or .txt files found at the given path.', 0.7)] };
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
        const migratedMemories = result.memories || result.data || [];
        const resourceLinks = migratedMemories
          .filter((m: any) => m.id)
          .map((m: any) => memoryResourceLink(m.id, 'Migrated memory'));
        return { content: [
          userAndAssistantText(`${prefix}\n\n📁 Files processed: ${fileList.length}\n📝 Memories created: ${created}\n🔄 Duplicates skipped: ${skipped}`),
          assistantText(JSON.stringify(result, null, 2)),
          ...resourceLinks,
        ] };
      } catch (err: any) {
        if (err.message?.includes('404') || err.message?.includes('Not Found')) {
          if (dry_run) {
            return { content: [userAndAssistantText(`🔍 Migration preview (dry run — /v1/migrate not available, would use ingest fallback)\n\n📁 ${fileList.length} files would be ingested:\n${fileList.map(f => `  • ${f.filename} (${f.content.length} chars)`).join('\n')}`)] };
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
          return { content: [userAndAssistantText(text)] };
        }
        throw err;
      }
    }

    case 'memoclaw_delete_namespace': {
      const { namespace, agent_id } = args as DeleteNamespaceArgs;
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
      return { content: [userAndAssistantText(text)] };
    }

    case 'memoclaw_tags': {
      const { namespace, agent_id } = args as TagsArgs;
      try {
        const params = new URLSearchParams();
        if (namespace) params.set('namespace', namespace);
        if (agent_id) params.set('agent_id', agent_id);
        const qs = params.toString();
        const result = await makeRequest('GET', `/v1/tags${qs ? '?' + qs : ''}`);
        if (result.tags) {
          const tags = result.tags;
          if (tags.length === 0) return { content: [userText('No tags found across memories.', 0.3)] };
          const lines = tags.map((t: any) =>
            typeof t === 'string' ? `  • ${t}` : `  • ${t.tag || t.name}: ${t.count} memories`
          );
          return { content: [userText(`🏷️ ${tags.length} tags:\n\n${lines.join('\n')}`, 0.5)] };
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
      if (tagCounts.size === 0) return { content: [userText('No tags found across memories.', 0.3)] };
      const sorted = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);
      const lines = sorted.map(([tag, count]) => `  • ${tag}: ${count} memories`);
      return { content: [userText(`🏷️ ${sorted.length} tags:\n\n${lines.join('\n')}`, 0.5)] };
    }

    case 'memoclaw_history': {
      const { id } = args as HistoryArgs;
      if (!id) throw new Error('id is required');
      const result = await makeRequest('GET', `/v1/memories/${id}/history`);
      const history = result.history || result.versions || result.data || [];
      if (history.length === 0) {
        return { content: [userText(`No edit history found for memory ${id}.`, 0.3)] };
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
      return { content: [
        userAndAssistantText(`📜 History for memory ${id} (${history.length} versions):\n\n${formatted}`),
        assistantText(JSON.stringify(result, null, 2)),
      ] };
    }

    case 'memoclaw_namespaces': {
      const { agent_id } = args as NamespacesArgs;
      try {
        const params = new URLSearchParams();
        if (agent_id) params.set('agent_id', agent_id);
        const qs = params.toString();
        const result = await makeRequest('GET', `/v1/namespaces${qs ? '?' + qs : ''}`);
        if (result.namespaces) {
          const namespaces = result.namespaces;
          if (namespaces.length === 0) return { content: [userText('No memories found — no namespaces to list.', 0.3)] };
          const lines = namespaces.map((n: any) =>
            typeof n === 'string' ? `  • ${n}` : `  • ${n.namespace || n.name || '(default)'}: ${n.count} memories`
          );
          return { content: [userText(`📁 ${namespaces.length} namespaces:\n\n${lines.join('\n')}`, 0.5)] };
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
      if (nsCounts.size === 0) return { content: [userText('No memories found — no namespaces to list.', 0.3)] };
      const sorted = [...nsCounts.entries()].sort((a, b) => b[1] - a[1]);
      const lines = sorted.map(([ns, count]) => `  • ${ns}: ${count} memories`);
      return { content: [userText(`📁 ${sorted.length} namespaces:\n\n${lines.join('\n')}`, 0.5)] };
    }

    case 'memoclaw_core_memories': {
      const { limit, namespace, agent_id } = args as CoreMemoriesArgs;
      const params = new URLSearchParams();
      if (limit !== undefined) params.set('limit', String(limit));
      if (namespace) params.set('namespace', namespace);
      if (agent_id) params.set('agent_id', agent_id);
      const qs = params.toString();
      const result = await makeRequest('GET', `/v1/core-memories${qs ? '?' + qs : ''}`);
      const memories = result.memories || result.core_memories || result.data || [];
      if (memories.length === 0) {
        return { content: [userText('No core memories found. Store important memories with high importance scores or pin them.', 0.3)] };
      }
      const formatted = memories.map((m: any) => formatMemory(m)).join('\n\n');
      return { content: [
        userAndAssistantText(`⭐ ${memories.length} core memories:\n\n${formatted}`),
        assistantText(JSON.stringify(result, null, 2)),
      ] };
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
      return {
        content: [
          userText(`📊 Memory Stats\n\n${lines.join('\n')}`, 0.5),
          assistantText(JSON.stringify(result, null, 2)),
        ],
        structuredContent: result,
      };
    }

    default:
      return null;
  }
}
