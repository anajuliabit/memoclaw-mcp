/**
 * Tests for MCP progress notifications in long-running handlers.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHandler } from '../src/handlers/index.js';
import type { ProgressCallback } from '../src/handlers/types.js';

// Mock API client
function createMockApi(responses: Record<string, any> = {}) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  return {
    makeRequest: vi.fn(async (method: string, path: string, body?: any) => {
      calls.push({ method, path, body });
      // Route responses by path pattern
      if (path.includes('/v1/free-tier/status'))
        return { free_tier_remaining: 50, free_tier_total: 100, wallet: '0xtest' };
      if (path.includes('/v1/store/batch')) throw new Error('404 Not Found');
      if (path.includes('/v1/store')) return { memory: { id: `mem-${calls.length}`, content: 'test' } };
      if (path.includes('/v1/memories/bulk-delete')) throw new Error('404 Not Found');
      if (path.includes('/v1/memories/batch-update')) throw new Error('404 Not Found');
      if (path.match(/DELETE.*\/v1\/memories\//)) return { deleted: true };
      if (path.match(/PATCH.*\/v1\/memories\//) || (path.includes('/v1/memories/') && method === 'PATCH'))
        return { memory: { id: 'test', content: 'updated' } };
      if (path.includes('/v1/memories') && method === 'GET') {
        // For delete_namespace — return memories once, then empty
        if (responses._namespaceMemories) {
          const mems = responses._namespaceMemories;
          responses._namespaceMemories = null;
          return { memories: mems, total: mems.length };
        }
        return { memories: [], total: 0 };
      }
      return responses[path] || {};
    }),
    account: { address: '0xtest' },
    calls,
  };
}

const mockConfig = {
  privateKey: '0x' + 'a'.repeat(64),
  apiUrl: 'https://api.memoclaw.com',
  configSource: 'test',
  timeout: 5000,
  maxRetries: 0,
  concurrency: 10,
};

describe('progress notifications', () => {
  describe('bulk_store fallback (one-by-one)', () => {
    it('calls progress callback for each stored memory', async () => {
      const api = createMockApi();
      const handler = createHandler(api as any, mockConfig);
      const progressCalls: Array<[number, number]> = [];
      const progress: ProgressCallback = async (current, total) => {
        progressCalls.push([current, total]);
      };

      await handler(
        'memoclaw_bulk_store',
        {
          memories: [{ content: 'memory 1' }, { content: 'memory 2' }, { content: 'memory 3' }],
        },
        progress,
      );

      expect(progressCalls.length).toBe(3);
      expect(progressCalls[progressCalls.length - 1]).toEqual([3, 3]);
    });
  });

  describe('bulk_delete fallback (one-by-one)', () => {
    it('calls progress callback for each deleted memory', async () => {
      const api = createMockApi();
      const handler = createHandler(api as any, mockConfig);
      const progressCalls: Array<[number, number]> = [];
      const progress: ProgressCallback = async (current, total) => {
        progressCalls.push([current, total]);
      };

      await handler(
        'memoclaw_bulk_delete',
        {
          ids: ['id-1', 'id-2', 'id-3'],
        },
        progress,
      );

      expect(progressCalls.length).toBe(3);
      expect(progressCalls[progressCalls.length - 1]).toEqual([3, 3]);
    });
  });

  describe('batch_update fallback (one-by-one)', () => {
    it('calls progress callback for each updated memory', async () => {
      const api = createMockApi();
      const handler = createHandler(api as any, mockConfig);
      const progressCalls: Array<[number, number]> = [];
      const progress: ProgressCallback = async (current, total) => {
        progressCalls.push([current, total]);
      };

      await handler(
        'memoclaw_batch_update',
        {
          updates: [
            { id: 'id-1', importance: 0.9 },
            { id: 'id-2', importance: 0.8 },
          ],
        },
        progress,
      );

      expect(progressCalls.length).toBe(2);
      expect(progressCalls[progressCalls.length - 1]).toEqual([2, 2]);
    });
  });

  describe('delete_namespace', () => {
    it('calls progress callback during namespace deletion', async () => {
      const api = createMockApi({
        _namespaceMemories: [
          { id: 'ns-1', content: 'test1' },
          { id: 'ns-2', content: 'test2' },
        ],
      });
      const handler = createHandler(api as any, mockConfig);
      const progressCalls: Array<[number, number]> = [];
      const progress: ProgressCallback = async (current, total) => {
        progressCalls.push([current, total]);
      };

      await handler(
        'memoclaw_delete_namespace',
        {
          namespace: 'test-ns',
        },
        progress,
      );

      expect(progressCalls.length).toBeGreaterThan(0);
    });
  });

  describe('without progress callback', () => {
    it('works normally when no progress callback is provided', async () => {
      const api = createMockApi();
      const handler = createHandler(api as any, mockConfig);

      // Should not throw
      const result = await handler('memoclaw_bulk_store', {
        memories: [{ content: 'test' }],
      });

      expect(result.content.length).toBeGreaterThan(0);
    });
  });
});

describe('structuredContent on empty results', () => {
  function createEmptyApi() {
    return {
      makeRequest: vi.fn(async () => ({ memories: [], relations: [], suggestions: [] })),
      account: { address: '0xtest' },
    };
  }

  it('memoclaw_recall returns structuredContent on empty results', async () => {
    const api = createEmptyApi();
    const handler = createHandler(api as any, mockConfig);
    const result = await handler('memoclaw_recall', { query: 'test' });
    expect(result.structuredContent).toEqual({ memories: [] });
  });

  it('memoclaw_search returns structuredContent on empty results', async () => {
    const api = createEmptyApi();
    const handler = createHandler(api as any, mockConfig);
    const result = await handler('memoclaw_search', { query: 'test' });
    expect(result.structuredContent).toEqual({ memories: [] });
  });

  it('memoclaw_context returns structuredContent on empty results', async () => {
    const api = createEmptyApi();
    api.makeRequest = vi.fn(async () => ({ memories: [] }));
    const handler = createHandler(api as any, mockConfig);
    const result = await handler('memoclaw_context', { query: 'test' });
    expect(result.structuredContent).toEqual({ memories: [] });
  });

  it('memoclaw_suggested returns structuredContent on empty results', async () => {
    const api = createEmptyApi();
    const handler = createHandler(api as any, mockConfig);
    const result = await handler('memoclaw_suggested', {});
    expect(result.structuredContent).toEqual({ suggestions: [] });
  });

  it('memoclaw_list_relations returns structuredContent on empty results', async () => {
    const api = createEmptyApi();
    const handler = createHandler(api as any, mockConfig);
    const result = await handler('memoclaw_list_relations', { memory_id: 'test-id' });
    expect(result.structuredContent).toEqual({ relations: [] });
  });
});
