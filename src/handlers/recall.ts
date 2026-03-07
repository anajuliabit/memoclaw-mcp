import { formatMemory, userAndAssistantText, assistantText, userText } from '../format.js';
import type { HandlerContext, ToolResult } from './types.js';
import type { RecallArgs, SearchArgs, ContextArgs, SuggestedArgs, CheckDuplicatesArgs } from '../types.js';

export async function handleRecall(ctx: HandlerContext, name: string, args: any): Promise<ToolResult | null> {
  const { makeRequest } = ctx;

  switch (name) {
    case 'memoclaw_recall': {
      const { query, limit, min_similarity, tags, namespace, memory_type, session_id, agent_id, include_relations, after, before } = args as RecallArgs;
      if (!query || (typeof query === 'string' && query.trim() === '')) {
        throw new Error('query is required and cannot be empty');
      }
      const filters: Record<string, any> = {};
      if (tags) filters.tags = tags;
      if (memory_type) filters.memory_type = memory_type;
      if (after) filters.after = after;
      if (before) filters.before = before;
      const result = await makeRequest('POST', '/v1/recall', {
        query, limit, min_similarity,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
        namespace, session_id, agent_id, include_relations,
      });
      const memories = result.memories || [];
      if (memories.length === 0) {
        return { content: [userText(`No memories found for query: "${query}"`, 0.3)] };
      }
      const formatted = memories.map((m: any) => formatMemory(m)).join('\n\n');
      return {
        content: [
          userAndAssistantText(`Found ${memories.length} memories:\n\n${formatted}`),
          assistantText(JSON.stringify(result, null, 2)),
        ],
        structuredContent: { memories },
      };
    }

    case 'memoclaw_search': {
      const { query, limit, namespace, tags, memory_type, session_id, agent_id, after, before } = args as SearchArgs;
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
      if (before) params.set('before', before);
      const result = await makeRequest('GET', `/v1/memories/search?${params}`);
      const memories = result.memories || result.data || [];
      if (memories.length === 0) {
        return { content: [userText(`No memories found containing: "${query}"`, 0.3)] };
      }
      const formatted = memories.map((m: any) => formatMemory(m)).join('\n\n');
      return {
        content: [
          userAndAssistantText(`Found ${memories.length} memories containing "${query}":\n\n${formatted}`),
          assistantText(JSON.stringify(result, null, 2)),
        ],
        structuredContent: { memories },
      };
    }

    case 'memoclaw_context': {
      const { query, limit, namespace, session_id, agent_id } = args as ContextArgs;
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
        return { content: [userText(`No relevant context found for: "${query}"`, 0.3)] };
      }
      const formatted = memories.map((m: any) => formatMemory(m)).join('\n\n');
      return {
        content: [
          userAndAssistantText(`🧠 Context for "${query}" (${memories.length} memories):\n\n${formatted}`),
          assistantText(JSON.stringify(result, null, 2)),
        ],
        structuredContent: { memories },
      };
    }

    case 'memoclaw_suggested': {
      const { limit, namespace, session_id, agent_id, category } = args as SuggestedArgs;
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
        return { content: [userText(`No suggestions found${category ? ` for category "${category}"` : ''}.`, 0.3)] };
      }
      const formatted = suggestions.map((m: any) => formatMemory(m)).join('\n\n');
      return {
        content: [
          userAndAssistantText(`💡 ${suggestions.length} suggestions${category ? ` (${category})` : ''}:\n\n${formatted}`),
          assistantText(JSON.stringify(result, null, 2)),
        ],
        structuredContent: { suggestions },
      };
    }

    case 'memoclaw_check_duplicates': {
      const { content, min_similarity, namespace, limit } = args as CheckDuplicatesArgs;
      if (!content || (typeof content === 'string' && content.trim() === '')) {
        throw new Error('content is required and cannot be empty');
      }
      const threshold = min_similarity ?? 0.7;
      const maxResults = limit ?? 5;
      const body: any = { query: content, limit: maxResults, min_similarity: threshold };
      if (namespace) body.namespace = namespace;
      const result = await makeRequest('POST', '/v1/recall', body);
      const duplicates = result.memories || [];
      const hasDuplicates = duplicates.length > 0;

      let suggestion: string;
      if (!hasDuplicates) {
        suggestion = 'No similar memories found. Safe to store.';
      } else {
        const topSim = duplicates[0]?.similarity;
        if (typeof topSim === 'number' && topSim >= 0.9) {
          suggestion = `Very similar memory exists (${(topSim * 100).toFixed(0)}% match). Consider updating memory ${duplicates[0].id} instead of creating a new one.`;
        } else if (typeof topSim === 'number' && topSim >= 0.7) {
          suggestion = `Similar memory found (${(topSim * 100).toFixed(0)}% match). Review before storing to avoid duplication.`;
        } else {
          suggestion = `Weakly similar memories found. Probably safe to store as new.`;
        }
      }

      let text: string;
      if (!hasDuplicates) {
        text = `✅ No duplicates found (threshold: ${threshold}). Safe to store.`;
      } else {
        const formatted = duplicates.map((m: any) => formatMemory(m)).join('\n\n');
        text = `⚠️ Found ${duplicates.length} potential duplicate(s) (threshold: ${threshold}):\n\n${formatted}\n\n💡 ${suggestion}`;
      }

      return {
        content: [userAndAssistantText(text)],
        structuredContent: { has_duplicates: hasDuplicates, duplicates, suggestion },
      };
    }

    default:
      return null;
  }
}
