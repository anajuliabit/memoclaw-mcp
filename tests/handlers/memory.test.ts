import { describe, it, expect } from 'vitest';
import { handleMemory } from '../../src/handlers/memory.js';
import { createContext } from '../../src/handlers/types.js';
import { mockApi, mockApiWithErrors, testConfig } from './helpers.js';

function makeCtx(routes: Record<string, any> = {}) {
  const api = mockApi(routes);
  return { ctx: createContext(api as any, testConfig), api };
}

describe('handleMemory', () => {
  // ── store ────────────────────────────────────────────────────────────────
  describe('memoclaw_store', () => {
    it('stores a memory successfully', async () => {
      const { ctx } = makeCtx({
        'POST /v1/store': { memory: { id: '1', content: 'hello' } },
      });
      const result = await handleMemory(ctx, 'memoclaw_store', { content: 'hello' });
      expect(result).not.toBeNull();
      expect(result!.content[0].text).toContain('Memory stored');
    });

    it('rejects empty content', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_store', { content: '' })).rejects.toThrow('content is required');
    });

    it('rejects whitespace-only content', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_store', { content: '   ' })).rejects.toThrow('content is required');
    });

    it('validates importance range', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_store', { content: 'hi', importance: 2 })).rejects.toThrow();
    });

    it('passes all optional fields', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/store': { memory: { id: '1', content: 'test' } },
      });
      await handleMemory(ctx, 'memoclaw_store', {
        content: 'test',
        importance: 0.8,
        tags: ['a'],
        namespace: 'ns',
        memory_type: 'fact',
        session_id: 's1',
        agent_id: 'a1',
        expires_at: '2026-12-31',
        pinned: true,
        immutable: true,
      });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.importance).toBe(0.8);
      expect(body.tags).toEqual(['a']);
      expect(body.pinned).toBe(true);
      expect(body.immutable).toBe(true);
    });

    it('passes metadata to the API', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/store': { memory: { id: '1', content: 'test', metadata: { source: 'slack' } } },
      });
      const result = await handleMemory(ctx, 'memoclaw_store', {
        content: 'test',
        metadata: { source: 'slack', channel: '#general' },
      });
      expect(result).not.toBeNull();
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.metadata).toEqual({ source: 'slack', channel: '#general' });
    });

    it('omits metadata when not provided', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/store': { memory: { id: '1', content: 'test' } },
      });
      await handleMemory(ctx, 'memoclaw_store', { content: 'test' });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.metadata).toBeUndefined();
    });
  });

  // ── get ──────────────────────────────────────────────────────────────────
  describe('memoclaw_get', () => {
    it('returns a formatted memory', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories/': { memory: { id: '1', content: 'hello' } },
      });
      const result = await handleMemory(ctx, 'memoclaw_get', { id: '1' });
      expect(result!.content[0].text).toContain('hello');
    });

    it('rejects missing id', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_get', {})).rejects.toThrow('id is required');
    });
  });

  // ── list ─────────────────────────────────────────────────────────────────
  describe('memoclaw_list', () => {
    it('lists memories with total count', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories': { memories: [{ id: '1', content: 'a' }], total: 5 },
      });
      const result = await handleMemory(ctx, 'memoclaw_list', {});
      expect(result!.content[0].text).toContain('1 of 5');
    });

    it('handles empty list', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories': { memories: [], total: 0 },
      });
      const result = await handleMemory(ctx, 'memoclaw_list', {});
      expect(result!.content[0].text).toContain('0 of 0');
    });

    it('passes before filter as query param', async () => {
      const { ctx, api } = makeCtx({
        'GET /v1/memories': { memories: [], total: 0 },
      });
      await handleMemory(ctx, 'memoclaw_list', { before: '2025-06-01T00:00:00Z' });
      const path = api.makeRequest.mock.calls[0][1];
      expect(path).toContain('before=2025-06-01T00%3A00%3A00Z');
    });

    it('validates namespace identifier', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_list', { namespace: 'bad namespace!' })).rejects.toThrow(
        'namespace contains invalid characters',
      );
    });

    it('validates tags array', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_list', { tags: ['valid', ''] })).rejects.toThrow(
        'tags[1] must be a non-empty string',
      );
    });

    it('passes sort and order as query params', async () => {
      const { ctx, api } = makeCtx({
        'GET /v1/memories': { memories: [], total: 0 },
      });
      await handleMemory(ctx, 'memoclaw_list', { sort: 'importance', order: 'asc' });
      const path = api.makeRequest.mock.calls[0][1];
      expect(path).toContain('sort=importance');
      expect(path).toContain('order=asc');
    });

    it('passes pinned filter as query param', async () => {
      const { ctx, api } = makeCtx({
        'GET /v1/memories': { memories: [{ id: '1', content: 'a', pinned: true }], total: 1 },
      });
      await handleMemory(ctx, 'memoclaw_list', { pinned: true });
      const path = api.makeRequest.mock.calls[0][1];
      expect(path).toContain('pinned=true');
    });

    it('passes pinned=false filter as query param', async () => {
      const { ctx, api } = makeCtx({
        'GET /v1/memories': { memories: [], total: 0 },
      });
      await handleMemory(ctx, 'memoclaw_list', { pinned: false });
      const path = api.makeRequest.mock.calls[0][1];
      expect(path).toContain('pinned=false');
    });
  });

  // ── update ───────────────────────────────────────────────────────────────
  describe('memoclaw_update', () => {
    it('updates content', async () => {
      const { ctx } = makeCtx({
        'PATCH /v1/memories/': { memory: { id: '1', content: 'updated' } },
      });
      const result = await handleMemory(ctx, 'memoclaw_update', { id: '1', content: 'updated' });
      expect(result!.content[0].text).toContain('updated');
    });

    it('rejects missing id', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_update', { content: 'x' })).rejects.toThrow('id is required');
    });

    it('rejects no valid update fields', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_update', { id: '1', bad_field: 'x' })).rejects.toThrow(
        'No valid update fields',
      );
    });

    it('passes metadata field to API', async () => {
      const { ctx, api } = makeCtx({
        'PATCH /v1/memories/': { memory: { id: '1', content: 'test' } },
      });
      await handleMemory(ctx, 'memoclaw_update', { id: '1', metadata: { key: 'val' } });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.metadata).toEqual({ key: 'val' });
    });

    it('rejects invalid namespace characters in update', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_update', { id: '1', namespace: 'bad namespace!' })).rejects.toThrow(
        'namespace contains invalid characters',
      );
    });

    it('rejects invalid memory_type characters in update', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_update', { id: '1', memory_type: 'type with spaces' })).rejects.toThrow(
        'memory_type contains invalid characters',
      );
    });

    it('passes session_id and agent_id to API', async () => {
      const { ctx, api } = makeCtx({
        'PATCH /v1/memories/': { memory: { id: '1', content: 'test' } },
      });
      await handleMemory(ctx, 'memoclaw_update', { id: '1', session_id: 'sess1', agent_id: 'agent1' });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.session_id).toBe('sess1');
      expect(body.agent_id).toBe('agent1');
    });

    it('validates tags in update', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_update', { id: '1', tags: [123 as any] })).rejects.toThrow(
        'tags[0] must be a non-empty string',
      );
    });
  });

  // ── delete ───────────────────────────────────────────────────────────────
  describe('memoclaw_delete', () => {
    it('deletes a memory', async () => {
      const { ctx } = makeCtx({
        'DELETE /v1/memories/': { deleted: true },
      });
      const result = await handleMemory(ctx, 'memoclaw_delete', { id: '1' });
      expect(result!.content[0].text).toContain('deleted');
    });
  });

  // ── bulk_delete ──────────────────────────────────────────────────────────
  describe('memoclaw_bulk_delete', () => {
    it('deletes via batch endpoint', async () => {
      const { ctx } = makeCtx({
        'POST /v1/memories/bulk-delete': { deleted: 3 },
      });
      const result = await handleMemory(ctx, 'memoclaw_bulk_delete', { ids: ['1', '2', '3'] });
      expect(result!.content[0].text).toContain('3 succeeded');
    });

    it('rejects empty ids array', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_bulk_delete', { ids: [] })).rejects.toThrow('non-empty array');
    });

    it('rejects >100 ids', async () => {
      const { ctx } = makeCtx();
      const ids = Array.from({ length: 101 }, (_, i) => String(i));
      await expect(handleMemory(ctx, 'memoclaw_bulk_delete', { ids })).rejects.toThrow('Maximum 100');
    });

    it('falls back to one-by-one on error', async () => {
      const api = mockApiWithErrors(
        { 'DELETE /v1/memories/': { deleted: true } },
        { 'POST /v1/memories/bulk-delete': new Error('server error') },
      );
      const ctx = createContext(api as any, testConfig);
      const result = await handleMemory(ctx, 'memoclaw_bulk_delete', { ids: ['1', '2'] });
      expect(result!.content[0].text).toContain('2 succeeded');
    });
  });

  // ── bulk_store ───────────────────────────────────────────────────────────
  describe('memoclaw_bulk_store', () => {
    it('stores via batch endpoint', async () => {
      const { ctx } = makeCtx({
        'POST /v1/store/batch': {
          memories: [
            { id: '1', content: 'a' },
            { id: '2', content: 'b' },
          ],
          failed: [],
        },
      });
      const result = await handleMemory(ctx, 'memoclaw_bulk_store', {
        memories: [{ content: 'a' }, { content: 'b' }],
      });
      expect(result!.content[0].text).toContain('2 stored');
      expect(result!.content[0].text).toContain('0 failed');
    });

    it('rejects empty memories', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_bulk_store', { memories: [] })).rejects.toThrow('non-empty array');
    });

    it('validates individual memory content', async () => {
      const { ctx } = makeCtx();
      await expect(
        handleMemory(ctx, 'memoclaw_bulk_store', {
          memories: [{ content: 'ok' }, { content: '' }],
        }),
      ).rejects.toThrow('index 1');
    });

    it('falls back to one-by-one on 404', async () => {
      const api = mockApiWithErrors(
        { 'POST /v1/store': { memory: { id: '1', content: 'ok' } } },
        { 'POST /v1/store/batch': new Error('HTTP 404: Not Found') },
      );
      const ctx = createContext(api as any, testConfig);
      const result = await handleMemory(ctx, 'memoclaw_bulk_store', {
        memories: [{ content: 'a' }, { content: 'b' }],
      });
      expect(result!.content[0].text).toContain('2 stored');
    });

    it('does not leak extra fields to API', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/store/batch': { memories: [{ id: '1', content: 'ok' }], failed: [] },
      });
      await handleMemory(ctx, 'memoclaw_bulk_store', {
        memories: [{ content: 'ok', extra_bad_field: 'should not appear' }],
      });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.memories[0].content).toBe('ok');
      expect(body.memories[0].extra_bad_field).toBeUndefined();
    });
  });

  // ── import ───────────────────────────────────────────────────────────────
  describe('memoclaw_import', () => {
    it('imports via batch endpoint', async () => {
      const { ctx } = makeCtx({
        'POST /v1/store/batch': { memories: [{ id: '1', content: 'a' }], failed: [] },
      });
      const result = await handleMemory(ctx, 'memoclaw_import', {
        memories: [{ content: 'a' }],
      });
      expect(result!.content[0].text).toContain('1 stored');
    });

    it('rejects empty memories', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_import', { memories: [] })).rejects.toThrow('non-empty array');
    });

    it('passes metadata and expires_at fields to API', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/store/batch': (_path: string, body: any) => ({
          memories: body.memories.map((m: any, i: number) => ({ id: String(i), ...m })),
          failed: [],
        }),
      });
      await handleMemory(ctx, 'memoclaw_import', {
        memories: [
          {
            content: 'test memory',
            metadata: { source: 'migration' },
            expires_at: '2026-12-31T23:59:59Z',
          },
        ],
      });
      const callBody = api.makeRequest.mock.calls[0][2];
      expect(callBody.memories[0].metadata).toEqual({ source: 'migration' });
      expect(callBody.memories[0].expires_at).toBe('2026-12-31T23:59:59Z');
    });
  });

  // ── pin / unpin ──────────────────────────────────────────────────────────
  describe('memoclaw_pin / memoclaw_unpin', () => {
    it('pins a memory', async () => {
      const { ctx } = makeCtx({
        'PATCH /v1/memories/': { memory: { id: '1', content: 'x', pinned: true } },
      });
      const result = await handleMemory(ctx, 'memoclaw_pin', { id: '1' });
      expect(result!.content[0].text).toContain('pinned');
    });

    it('unpins a memory', async () => {
      const { ctx } = makeCtx({
        'PATCH /v1/memories/': { memory: { id: '1', content: 'x', pinned: false } },
      });
      const result = await handleMemory(ctx, 'memoclaw_unpin', { id: '1' });
      expect(result!.content[0].text).toContain('unpinned');
    });
  });

  // ── batch_update ─────────────────────────────────────────────────────────
  describe('memoclaw_batch_update', () => {
    it('updates via batch endpoint', async () => {
      const { ctx } = makeCtx({
        'POST /v1/memories/batch-update': { updated: 2, memories: [{ id: '1' }, { id: '2' }] },
      });
      const result = await handleMemory(ctx, 'memoclaw_batch_update', {
        updates: [
          { id: '1', content: 'new1' },
          { id: '2', content: 'new2' },
        ],
      });
      expect(result!.content[0].text).toContain('2 memories updated');
    });

    it('falls back to one-by-one on 404', async () => {
      const api = mockApiWithErrors(
        { 'PATCH /v1/memories/': { memory: { id: '1', content: 'updated' } } },
        { 'POST /v1/memories/batch-update': new Error('HTTP 404: Not Found') },
      );
      const ctx = createContext(api as any, testConfig);
      const result = await handleMemory(ctx, 'memoclaw_batch_update', {
        updates: [{ id: '1', content: 'new' }],
      });
      expect(result!.content[0].text).toContain('1 updated');
    });

    it('rejects empty updates', async () => {
      const { ctx } = makeCtx();
      await expect(handleMemory(ctx, 'memoclaw_batch_update', { updates: [] })).rejects.toThrow('non-empty array');
    });

    it('rejects update missing id', async () => {
      const { ctx } = makeCtx();
      await expect(
        handleMemory(ctx, 'memoclaw_batch_update', {
          updates: [{ content: 'no id' }],
        }),
      ).rejects.toThrow('missing "id"');
    });

    it('validates content length in fallback path', async () => {
      const longContent = 'x'.repeat(9000);
      const api = mockApiWithErrors(
        { 'PATCH /v1/memories/': { memory: { id: '1', content: 'ok' } } },
        { 'POST /v1/memories/batch-update': new Error('HTTP 404: Not Found') },
      );
      const ctx = createContext(api as any, testConfig);
      await expect(
        handleMemory(ctx, 'memoclaw_batch_update', {
          updates: [{ id: '1', content: longContent }],
        }),
      ).rejects.toThrow('exceeds');
    });

    it('validates namespace in fallback path', async () => {
      const api = mockApiWithErrors(
        { 'PATCH /v1/memories/': { memory: { id: '1', content: 'ok' } } },
        { 'POST /v1/memories/batch-update': new Error('HTTP 404: Not Found') },
      );
      const ctx = createContext(api as any, testConfig);
      await expect(
        handleMemory(ctx, 'memoclaw_batch_update', {
          updates: [{ id: '1', namespace: 'invalid namespace!' }],
        }),
      ).rejects.toThrow('invalid characters');
    });

    it('validates tags in individual updates', async () => {
      const { ctx } = makeCtx();
      await expect(
        handleMemory(ctx, 'memoclaw_batch_update', {
          updates: [{ id: '1', tags: ['valid', ''] }],
        }),
      ).rejects.toThrow('tags[1] must be a non-empty string');
    });
  });

  // ── count ────────────────────────────────────────────────────────────────
  describe('memoclaw_count', () => {
    it('returns count from dedicated endpoint', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories/count': { count: 42 },
      });
      const result = await handleMemory(ctx, 'memoclaw_count', {});
      expect(result!.content[0].text).toContain('42');
    });

    it('falls back to list total on 404', async () => {
      const api = mockApiWithErrors(
        { 'GET /v1/memories': { memories: [], total: 15 } },
        { 'GET /v1/memories/count': new Error('Not found') },
      );
      const ctx = createContext(api as any, testConfig);
      const result = await handleMemory(ctx, 'memoclaw_count', {});
      expect(result!.content[0].text).toContain('15');
    });

    it('passes session_id, before, and after filters', async () => {
      const { ctx, api } = makeCtx({
        'GET /v1/memories/count': { count: 7 },
      });
      const result = await handleMemory(ctx, 'memoclaw_count', {
        namespace: 'ns1',
        session_id: 'sess-123',
        after: '2025-01-01T00:00:00Z',
        before: '2025-12-31T23:59:59Z',
      });
      expect(result!.content[0].text).toContain('7');
      expect(result!.content[0].text).toContain('session=sess-123');
      expect(result!.content[0].text).toContain('after=2025-01-01T00:00:00Z');
      expect(result!.content[0].text).toContain('before=2025-12-31T23:59:59Z');
      // Verify params were passed to API
      const callUrl = api.makeRequest.mock.calls[0][1];
      expect(callUrl).toContain('session_id=sess-123');
      expect(callUrl).toContain('after=2025-01-01T00%3A00%3A00Z');
      expect(callUrl).toContain('before=2025-12-31T23%3A59%3A59Z');
    });

    it('passes pinned filter', async () => {
      const { ctx, api } = makeCtx({
        'GET /v1/memories/count': { count: 3 },
      });
      const result = await handleMemory(ctx, 'memoclaw_count', { pinned: true });
      expect(result!.content[0].text).toContain('3');
      expect(result!.content[0].text).toContain('pinned=true');
      const callUrl = api.makeRequest.mock.calls[0][1];
      expect(callUrl).toContain('pinned=true');
    });
  });

  // ── unknown tool returns null ────────────────────────────────────────────
  it('returns null for unknown tools', async () => {
    const { ctx } = makeCtx();
    const result = await handleMemory(ctx, 'memoclaw_unknown_tool', {});
    expect(result).toBeNull();
  });

  // ── cancellation ─────────────────────────────────────────────────────────
  describe('cancellation support', () => {
    it('stops bulk_delete when signal is pre-aborted', async () => {
      const ac = new AbortController();
      ac.abort(); // pre-abort
      const api = mockApiWithErrors(
        { 'DELETE /v1/memories/': { deleted: true } },
        { 'POST /v1/memories/bulk-delete': new Error('HTTP 404: Not Found') },
      );
      const ctx = createContext(api as any, testConfig, undefined, ac.signal);
      const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);
      const result = await handleMemory(ctx, 'memoclaw_bulk_delete', { ids });
      expect((result as any).structuredContent.cancelled).toBe(true);
      expect((result as any).structuredContent.succeeded).toBe(0);
    });

    it('stops bulk_store when signal is pre-aborted', async () => {
      const ac = new AbortController();
      ac.abort(); // pre-abort
      const api = mockApiWithErrors(
        { 'POST /v1/store': () => ({ memory: { id: 'm1', content: 'x' } }) },
        { 'POST /v1/store/batch': new Error('HTTP 404: Not Found') },
      );
      const ctx = createContext(api as any, testConfig, undefined, ac.signal);
      const memories = Array.from({ length: 20 }, (_, i) => ({ content: `memory ${i}` }));
      const result = await handleMemory(ctx, 'memoclaw_bulk_store', { memories });
      expect((result as any).structuredContent.cancelled).toBe(true);
      expect((result as any).structuredContent.succeeded).toBe(0);
    });
  });
});
