import { describe, it, expect } from 'vitest';
import { handleRelations } from '../../src/handlers/relations.js';
import { createContext } from '../../src/handlers/types.js';
import { mockApi, testConfig } from './helpers.js';
import type { RouteValue } from './helpers.js';

function makeCtx(routes: Record<string, RouteValue> = {}) {
  const api = mockApi(routes);
  return { ctx: createContext(api, testConfig), api };
}

describe('handleRelations', () => {
  describe('memoclaw_create_relation', () => {
    it('creates a relation', async () => {
      const { ctx } = makeCtx({
        'POST /v1/memories/': { relation: { id: 'r1' } },
      });
      const result = await handleRelations(ctx, 'memoclaw_create_relation', {
        memory_id: 'm1',
        target_id: 'm2',
        relation_type: 'related_to',
      });
      expect(result!.content[0].text).toContain('Relation created');
      expect(result!.content[0].text).toContain('related_to');
    });

    it('rejects missing fields', async () => {
      const { ctx } = makeCtx();
      await expect(
        handleRelations(ctx, 'memoclaw_create_relation', {
          memory_id: 'm1',
          target_id: 'm2',
        }),
      ).rejects.toThrow('required');
    });
  });

  describe('memoclaw_list_relations', () => {
    it('lists relations', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories/': { relations: [{ id: 'r1', source_id: 'm1', relation_type: 'ref', target_id: 'm2' }] },
      });
      const result = await handleRelations(ctx, 'memoclaw_list_relations', { memory_id: 'm1' });
      expect(result!.content[0].text).toContain('Relations for m1');
    });

    it('handles no relations', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories/': { relations: [] },
      });
      const result = await handleRelations(ctx, 'memoclaw_list_relations', { memory_id: 'm1' });
      expect(result!.content[0].text).toContain('No relations found');
    });

    it('rejects missing memory_id', async () => {
      const { ctx } = makeCtx();
      await expect(handleRelations(ctx, 'memoclaw_list_relations', {})).rejects.toThrow('memory_id is required');
    });
  });

  describe('memoclaw_delete_relation', () => {
    it('deletes a relation', async () => {
      const { ctx } = makeCtx({
        'DELETE /v1/memories/': { deleted: true },
      });
      const result = await handleRelations(ctx, 'memoclaw_delete_relation', {
        memory_id: 'm1',
        relation_id: 'r1',
      });
      expect(result!.content[0].text).toContain('Relation r1 deleted');
    });

    it('rejects missing ids', async () => {
      const { ctx } = makeCtx();
      await expect(handleRelations(ctx, 'memoclaw_delete_relation', { memory_id: 'm1' })).rejects.toThrow('required');
    });
  });

  describe('memoclaw_graph', () => {
    it('builds a graph from a root memory', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories/': (path: string) => {
          if (path.includes('/relations')) {
            return { relations: [{ source_id: 'm1', target_id: 'm2', relation_type: 'ref' }] };
          }
          const id = path.split('/').pop();
          return { memory: { id, content: `content-${id}` } };
        },
      });
      const result = await handleRelations(ctx, 'memoclaw_graph', {
        memory_id: 'm1',
        depth: 1,
      });
      expect(result!.content[0].text).toContain('Graph from m1');
      expect(result!.content[0].text).toContain('2 nodes');
      expect(result!.content[0].text).toContain('1 edges');
    });

    it('rejects missing memory_id', async () => {
      const { ctx } = makeCtx();
      await expect(handleRelations(ctx, 'memoclaw_graph', {})).rejects.toThrow('memory_id is required');
    });

    it('rejects non-integer depth', async () => {
      const { ctx } = makeCtx();
      await expect(handleRelations(ctx, 'memoclaw_graph', { memory_id: 'm1', depth: 2.5 })).rejects.toThrow(
        'depth must be a positive integer',
      );
    });

    it('rejects zero depth', async () => {
      const { ctx } = makeCtx();
      await expect(handleRelations(ctx, 'memoclaw_graph', { memory_id: 'm1', depth: 0 })).rejects.toThrow(
        'depth must be a positive integer',
      );
    });

    it('rejects negative depth', async () => {
      const { ctx } = makeCtx();
      await expect(handleRelations(ctx, 'memoclaw_graph', { memory_id: 'm1', depth: -1 })).rejects.toThrow(
        'depth must be a positive integer',
      );
    });

    it('clamps depth to 1-3', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories/': (path: string) => {
          if (path.includes('/relations')) return { relations: [] };
          return { memory: { id: 'm1', content: 'test' } };
        },
      });
      const result = await handleRelations(ctx, 'memoclaw_graph', {
        memory_id: 'm1',
        depth: 10,
      });
      expect(result!.content[0].text).toContain('depth 3');
    });
  });

  it('returns null for unknown tools', async () => {
    const { ctx } = makeCtx();
    expect(await handleRelations(ctx, 'memoclaw_recall', {})).toBeNull();
  });
});
