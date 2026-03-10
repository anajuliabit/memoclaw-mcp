import { describe, it, expect } from 'vitest';
import { handleRecall } from '../../src/handlers/recall.js';
import { createContext } from '../../src/handlers/types.js';
import { mockApi, testConfig } from './helpers.js';

function makeCtx(routes: Record<string, any> = {}) {
  const api = mockApi(routes);
  return { ctx: createContext(api as any, testConfig), api };
}

describe('handleRecall', () => {
  describe('memoclaw_recall', () => {
    it('returns formatted memories', async () => {
      const { ctx } = makeCtx({
        'POST /v1/recall': { memories: [{ id: '1', content: 'match', similarity: 0.95 }] },
      });
      const result = await handleRecall(ctx, 'memoclaw_recall', { query: 'test' });
      expect(result!.content[0].text).toContain('Found 1 memories');
      expect(result!.content[0].text).toContain('match');
    });

    it('returns message when no memories found', async () => {
      const { ctx } = makeCtx({
        'POST /v1/recall': { memories: [] },
      });
      const result = await handleRecall(ctx, 'memoclaw_recall', { query: 'nothing' });
      expect(result!.content[0].text).toContain('No memories found');
    });

    it('rejects empty query', async () => {
      const { ctx } = makeCtx();
      await expect(handleRecall(ctx, 'memoclaw_recall', { query: '' })).rejects.toThrow('query is required');
    });

    it('passes filters to API', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/recall': { memories: [] },
      });
      await handleRecall(ctx, 'memoclaw_recall', {
        query: 'test',
        tags: ['a'],
        memory_type: 'fact',
        namespace: 'ns',
        limit: 5,
        min_similarity: 0.8,
      });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.filters.tags).toEqual(['a']);
      expect(body.filters.memory_type).toBe('fact');
      expect(body.namespace).toBe('ns');
      expect(body.limit).toBe(5);
    });

    it('passes before filter to API', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/recall': { memories: [] },
      });
      await handleRecall(ctx, 'memoclaw_recall', {
        query: 'test',
        before: '2025-06-01T00:00:00Z',
      });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.filters.before).toBe('2025-06-01T00:00:00Z');
    });

    it('passes both after and before filters to API', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/recall': { memories: [] },
      });
      await handleRecall(ctx, 'memoclaw_recall', {
        query: 'test',
        after: '2025-01-01T00:00:00Z',
        before: '2025-06-01T00:00:00Z',
      });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.filters.after).toBe('2025-01-01T00:00:00Z');
      expect(body.filters.before).toBe('2025-06-01T00:00:00Z');
    });
  });

  describe('memoclaw_search', () => {
    it('returns text search results', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories/search': { memories: [{ id: '1', content: 'found' }] },
      });
      const result = await handleRecall(ctx, 'memoclaw_search', { query: 'found' });
      expect(result!.content[0].text).toContain('Found 1 memories');
    });

    it('rejects empty query', async () => {
      const { ctx } = makeCtx();
      await expect(handleRecall(ctx, 'memoclaw_search', { query: '  ' })).rejects.toThrow('query is required');
    });

    it('passes before filter as query param', async () => {
      const { ctx, api } = makeCtx({
        'GET /v1/memories/search': { memories: [] },
      });
      await handleRecall(ctx, 'memoclaw_search', { query: 'test', before: '2025-12-31T00:00:00Z' });
      const path = api.makeRequest.mock.calls[0][1];
      expect(path).toContain('before=2025-12-31T00%3A00%3A00Z');
    });

    it('passes sort and order as query params', async () => {
      const { ctx, api } = makeCtx({
        'GET /v1/memories/search': { memories: [] },
      });
      await handleRecall(ctx, 'memoclaw_search', { query: 'test', sort: 'importance', order: 'desc' });
      const path = api.makeRequest.mock.calls[0][1];
      expect(path).toContain('sort=importance');
      expect(path).toContain('order=desc');
    });

    it('passes pinned filter as query param', async () => {
      const { ctx, api } = makeCtx({
        'GET /v1/memories/search': { memories: [{ id: '1', content: 'pinned result', pinned: true }] },
      });
      await handleRecall(ctx, 'memoclaw_search', { query: 'test', pinned: true });
      const path = api.makeRequest.mock.calls[0][1];
      expect(path).toContain('pinned=true');
    });
  });

  describe('memoclaw_context', () => {
    it('returns context memories', async () => {
      const { ctx } = makeCtx({
        'POST /v1/context': { memories: [{ id: '1', content: 'ctx' }] },
      });
      const result = await handleRecall(ctx, 'memoclaw_context', { query: 'topic' });
      expect(result!.content[0].text).toContain('Context for "topic"');
    });

    it('handles empty context', async () => {
      const { ctx } = makeCtx({
        'POST /v1/context': { memories: [] },
      });
      const result = await handleRecall(ctx, 'memoclaw_context', { query: 'nothing' });
      expect(result!.content[0].text).toContain('No relevant context');
    });
  });

  describe('memoclaw_suggested', () => {
    it('returns suggestions', async () => {
      const { ctx } = makeCtx({
        'GET /v1/suggested': { suggestions: [{ id: '1', content: 'suggestion' }] },
      });
      const result = await handleRecall(ctx, 'memoclaw_suggested', {});
      expect(result!.content[0].text).toContain('1 suggestions');
    });

    it('handles empty suggestions', async () => {
      const { ctx } = makeCtx({
        'GET /v1/suggested': { suggestions: [] },
      });
      const result = await handleRecall(ctx, 'memoclaw_suggested', {});
      expect(result!.content[0].text).toContain('No suggestions found');
    });

    it('includes category in output', async () => {
      const { ctx } = makeCtx({
        'GET /v1/suggested': { suggestions: [{ id: '1', content: 'x' }] },
      });
      const result = await handleRecall(ctx, 'memoclaw_suggested', { category: 'personal' });
      expect(result!.content[0].text).toContain('(personal)');
    });

    it('validates namespace identifier', async () => {
      const { ctx } = makeCtx();
      await expect(handleRecall(ctx, 'memoclaw_suggested', { namespace: 'bad namespace!' })).rejects.toThrow(
        'namespace contains invalid characters',
      );
    });

    it('validates category identifier', async () => {
      const { ctx } = makeCtx();
      await expect(handleRecall(ctx, 'memoclaw_suggested', { category: 'bad cat!' })).rejects.toThrow(
        'category contains invalid characters',
      );
    });
  });

  describe('memoclaw_check_duplicates', () => {
    it('reports no duplicates when recall returns empty', async () => {
      const { ctx } = makeCtx({
        'POST /v1/recall': { memories: [] },
      });
      const result = await handleRecall(ctx, 'memoclaw_check_duplicates', { content: 'unique content' });
      expect(result!.content[0].text).toContain('No duplicates found');
      expect(result!.structuredContent!.has_duplicates).toBe(false);
      expect(result!.structuredContent!.duplicates).toEqual([]);
    });

    it('reports duplicates when similar memories exist', async () => {
      const { ctx } = makeCtx({
        'POST /v1/recall': { memories: [{ id: '1', content: 'similar content', similarity: 0.92 }] },
      });
      const result = await handleRecall(ctx, 'memoclaw_check_duplicates', { content: 'similar content' });
      expect(result!.content[0].text).toContain('potential duplicate');
      expect(result!.structuredContent!.has_duplicates).toBe(true);
      expect((result!.structuredContent!.duplicates as any[]).length).toBe(1);
    });

    it('suggests updating for very high similarity (>= 0.9)', async () => {
      const { ctx } = makeCtx({
        'POST /v1/recall': { memories: [{ id: 'abc', content: 'near-exact', similarity: 0.95 }] },
      });
      const result = await handleRecall(ctx, 'memoclaw_check_duplicates', { content: 'near-exact' });
      expect(result!.structuredContent!.suggestion).toContain('updating memory abc');
    });

    it('suggests review for moderate similarity (0.7-0.9)', async () => {
      const { ctx } = makeCtx({
        'POST /v1/recall': { memories: [{ id: '1', content: 'related', similarity: 0.78 }] },
      });
      const result = await handleRecall(ctx, 'memoclaw_check_duplicates', { content: 'related' });
      expect(result!.structuredContent!.suggestion).toContain('Review before storing');
    });

    it('uses default min_similarity of 0.7', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/recall': { memories: [] },
      });
      await handleRecall(ctx, 'memoclaw_check_duplicates', { content: 'test' });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.min_similarity).toBe(0.7);
    });

    it('respects custom min_similarity and namespace', async () => {
      const { ctx, api } = makeCtx({
        'POST /v1/recall': { memories: [] },
      });
      await handleRecall(ctx, 'memoclaw_check_duplicates', {
        content: 'test',
        min_similarity: 0.5,
        namespace: 'work',
      });
      const body = api.makeRequest.mock.calls[0][2];
      expect(body.min_similarity).toBe(0.5);
      expect(body.namespace).toBe('work');
    });

    it('rejects empty content', async () => {
      const { ctx } = makeCtx();
      await expect(handleRecall(ctx, 'memoclaw_check_duplicates', { content: '' })).rejects.toThrow(
        'content is required',
      );
    });
  });

  it('returns null for unknown tools', async () => {
    const { ctx } = makeCtx();
    expect(await handleRecall(ctx, 'memoclaw_store', {})).toBeNull();
  });
});
