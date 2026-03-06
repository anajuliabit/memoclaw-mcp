import { formatMemory } from '../format.js';
import type { HandlerContext, ToolResult } from './types.js';

export async function handleRelations(ctx: HandlerContext, name: string, args: any): Promise<ToolResult | null> {
  const { makeRequest } = ctx;

  switch (name) {
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

    default:
      return null;
  }
}
