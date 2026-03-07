import { formatMemory, userAndAssistantText, assistantText, userText } from '../format.js';
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
      return { content: [
        userAndAssistantText(`🔗 Relation created: ${memory_id} —[${relation_type}]→ ${target_id}`),
        assistantText(JSON.stringify(result, null, 2)),
      ] };
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
      return { content: [
        userAndAssistantText(`Relations for ${memory_id}:\n${formatted}`),
        assistantText(JSON.stringify(result, null, 2)),
      ] };
    }

    case 'memoclaw_delete_relation': {
      const { memory_id, relation_id } = args as DeleteRelationArgs;
      if (!memory_id || !relation_id) throw new Error('memory_id and relation_id are required');
      const result = await makeRequest('DELETE', `/v1/memories/${memory_id}/relations/${relation_id}`);
      return { content: [
        userAndAssistantText(`🗑️ Relation ${relation_id} deleted`),
        assistantText(JSON.stringify(result, null, 2)),
      ] };
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
      return { content: [userAndAssistantText(`🕸️ Graph from ${memory_id} (depth ${depth}):\n\n${nodes.length} nodes:\n${nodesFmt}\n\n${edges.length} edges:\n${edgesFmt || '  (none)'}`)] };
    }

    default:
      return null;
  }
}
