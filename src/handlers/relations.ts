import { formatMemory, withConcurrency, userAndAssistantText, assistantText, userText } from '../format.js';
import type { HandlerContext, ToolResult } from './types.js';
import type { CreateRelationArgs, ListRelationsArgs, DeleteRelationArgs, GraphArgs } from '../types.js';

export async function handleRelations(ctx: HandlerContext, name: string, args: any): Promise<ToolResult | null> {
  const { makeRequest } = ctx;

  switch (name) {
    case 'memoclaw_create_relation': {
      const { memory_id, target_id, relation_type, metadata } = args as CreateRelationArgs;
      if (!memory_id || !target_id || !relation_type) {
        throw new Error('memory_id, target_id, and relation_type are all required');
      }
      const body: any = { target_id, relation_type };
      if (metadata) body.metadata = metadata;
      const result = await makeRequest('POST', `/v1/memories/${memory_id}/relations`, body);
      const relation = result.relation || result;
      return {
        content: [
          userAndAssistantText(`🔗 Relation created: ${memory_id} —[${relation_type}]→ ${target_id}`),
          assistantText(JSON.stringify(result, null, 2)),
        ],
        structuredContent: { relation },
      };
    }

    case 'memoclaw_list_relations': {
      const { memory_id } = args as ListRelationsArgs;
      if (!memory_id) throw new Error('memory_id is required');
      const result = await makeRequest('GET', `/v1/memories/${memory_id}/relations`);
      const relations = result.relations || [];
      if (relations.length === 0) {
        return { content: [userText(`No relations found for memory ${memory_id}.`, 0.3)] };
      }
      const formatted = relations.map((r: any) =>
        `🔗 ${r.id || '?'}: ${r.source_id || memory_id} —[${r.relation_type}]→ ${r.target_id}`
      ).join('\n');
      return {
        content: [
          userAndAssistantText(`Relations for ${memory_id}:\n${formatted}`),
          assistantText(JSON.stringify(result, null, 2)),
        ],
        structuredContent: { relations },
      };
    }

    case 'memoclaw_delete_relation': {
      const { memory_id, relation_id } = args as DeleteRelationArgs;
      if (!memory_id || !relation_id) throw new Error('memory_id and relation_id are required');
      const result = await makeRequest('DELETE', `/v1/memories/${memory_id}/relations/${relation_id}`);
      return {
        content: [
          userAndAssistantText(`🗑️ Relation ${relation_id} deleted`),
          assistantText(JSON.stringify(result, null, 2)),
        ],
        structuredContent: { deleted: true, relation_id },
      };
    }

    case 'memoclaw_graph': {
      const { memory_id, depth: rawDepth, relation_type } = args as GraphArgs;
      if (!memory_id) throw new Error('memory_id is required');
      const depth = Math.min(Math.max(rawDepth || 1, 1), 3);
      const visited = new Set<string>();
      const nodes: any[] = [];
      const edges: any[] = [];
      let frontier = [memory_id];

      for (let d = 0; d <= depth && frontier.length > 0; d++) {
        const nextFrontier: string[] = [];
        const unvisited = frontier.filter(mid => !visited.has(mid));
        if (unvisited.length === 0) break;
        for (const mid of unvisited) visited.add(mid);

        // Fetch all memories at this depth level in parallel
        const memResults = await withConcurrency(
          unvisited.map(mid => () =>
            makeRequest('GET', `/v1/memories/${mid}`)
              .then(mem => ({ id: mid, data: mem.memory || mem }))
              .catch(() => ({ id: mid, data: { id: mid, content: '(could not fetch)' } }))
          ),
          10
        );
        for (const r of memResults) {
          if (r.status === 'fulfilled') nodes.push(r.value.data);
        }

        // Fetch all relations at this depth level in parallel
        if (d < depth) {
          const relResults = await withConcurrency(
            unvisited.map(mid => () =>
              makeRequest('GET', `/v1/memories/${mid}/relations`)
                .then(relResult => ({ id: mid, relations: relResult.relations || [] }))
                .catch(() => ({ id: mid, relations: [] as any[] }))
            ),
            10
          );
          for (const r of relResults) {
            if (r.status === 'fulfilled') {
              for (const rel of r.value.relations) {
                if (relation_type && rel.relation_type !== relation_type) continue;
                edges.push(rel);
                const neighbor = rel.target_id === r.value.id ? rel.source_id : rel.target_id;
                if (neighbor && !visited.has(neighbor)) nextFrontier.push(neighbor);
              }
            }
          }
        }
        frontier = nextFrontier;
      }

      const nodesFmt = nodes.map((n: any) => formatMemory(n)).join('\n\n');
      const edgesFmt = edges.map((r: any) => `  ${r.source_id} —[${r.relation_type}]→ ${r.target_id}`).join('\n');
      return {
        content: [userAndAssistantText(`🕸️ Graph from ${memory_id} (depth ${depth}):\n\n${nodes.length} nodes:\n${nodesFmt}\n\n${edges.length} edges:\n${edgesFmt || '  (none)'}`)],
        structuredContent: { nodes, edges },
      };
    }

    default:
      return null;
  }
}
