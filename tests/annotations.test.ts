import { describe, it, expect, beforeEach } from 'vitest';
import { handleMemory } from '../src/handlers/memory.js';
import { handleRecall } from '../src/handlers/recall.js';
import { handleAdmin } from '../src/handlers/admin.js';
import { handleRelations } from '../src/handlers/relations.js';
import type { HandlerContext } from '../src/handlers/types.js';

/**
 * Tests for MCP 2025-06-18 content annotations.
 * Verifies that tool results include proper audience and priority hints.
 */

function createMockContext(mockResponse: any = {}): HandlerContext {
  return {
    api: {} as any,
    config: {
      apiUrl: 'https://api.memoclaw.com',
      privateKey: '0x1234',
      configSource: 'env',
      timeout: 30000,
      maxRetries: 3,
      allowedOrigins: 'any',
    } as any,
    makeRequest: async () => mockResponse,
    account: { address: '0xTestWallet' } as any,
  };
}

describe('Content Annotations', () => {
  describe('Memory handlers', () => {
    it('memoclaw_store returns annotated content with separated JSON and resource_link', async () => {
      const ctx = createMockContext({ memory: { id: '1', content: 'test' } });
      const result = await handleMemory(ctx, 'memoclaw_store', { content: 'test' });
      expect(result).not.toBeNull();
      expect(result!.content.length).toBe(3);

      // Formatted text: user + assistant audience
      const formatted = result!.content[0];
      expect(formatted.annotations?.audience).toContain('user');
      expect(formatted.annotations?.audience).toContain('assistant');
      expect(formatted.annotations?.priority).toBe(0.8);

      // Raw JSON: assistant only
      const raw = result!.content[1];
      expect(raw.annotations?.audience).toEqual(['assistant']);
      expect(raw.annotations?.priority).toBe(0.3);
      expect(raw.text).toContain('{');

      // Resource link to stored memory
      const link = result!.content[2];
      expect(link.type).toBe('resource_link');
      expect((link as any).uri).toBe('memoclaw://memories/1');

      // structuredContent
      expect(result!.structuredContent).toBeDefined();
      expect((result!.structuredContent as any).memory.id).toBe('1');
    });

    it('memoclaw_get returns annotated content', async () => {
      const ctx = createMockContext({ memory: { id: '1', content: 'hello' } });
      const result = await handleMemory(ctx, 'memoclaw_get', { id: '1' });
      expect(result!.content.length).toBe(2);
      expect(result!.content[0].annotations?.audience).toContain('user');
      expect(result!.content[1].annotations?.audience).toEqual(['assistant']);
    });

    it('memoclaw_delete returns user+assistant annotation', async () => {
      const ctx = createMockContext({ deleted: true });
      const result = await handleMemory(ctx, 'memoclaw_delete', { id: '1' });
      expect(result!.content[0].annotations?.audience).toContain('user');
      expect(result!.content[0].annotations?.audience).toContain('assistant');
    });

    it('memoclaw_count returns user-only annotation', async () => {
      const ctx = createMockContext({ count: 42 });
      const result = await handleMemory(ctx, 'memoclaw_count', {});
      expect(result!.content.length).toBe(1);
      expect(result!.content[0].annotations?.audience).toEqual(['user']);
      expect(result!.content[0].annotations?.priority).toBe(0.5);
    });

    it('memoclaw_pin returns user+assistant annotation', async () => {
      const ctx = createMockContext({ memory: { id: '1', content: 'pinned', pinned: true } });
      const result = await handleMemory(ctx, 'memoclaw_pin', { id: '1' });
      expect(result!.content[0].annotations?.audience).toContain('user');
      expect(result!.content[0].annotations?.audience).toContain('assistant');
    });
  });

  describe('Recall handlers', () => {
    it('memoclaw_recall returns annotated results with separated JSON', async () => {
      const ctx = createMockContext({ memories: [{ id: '1', content: 'test', similarity: 0.9 }] });
      const result = await handleRecall(ctx, 'memoclaw_recall', { query: 'test' });
      expect(result!.content.length).toBe(2);
      expect(result!.content[0].annotations?.audience).toContain('user');
      expect(result!.content[0].annotations?.audience).toContain('assistant');
      expect(result!.content[0].annotations?.priority).toBe(0.8);
      expect(result!.content[1].annotations?.audience).toEqual(['assistant']);
    });

    it('memoclaw_recall empty results returns user-only low priority', async () => {
      const ctx = createMockContext({ memories: [] });
      const result = await handleRecall(ctx, 'memoclaw_recall', { query: 'nothing' });
      expect(result!.content.length).toBe(1);
      expect(result!.content[0].annotations?.audience).toEqual(['user']);
      expect(result!.content[0].annotations?.priority).toBe(0.3);
    });

    it('memoclaw_search empty results returns user-only low priority', async () => {
      const ctx = createMockContext({ memories: [] });
      const result = await handleRecall(ctx, 'memoclaw_search', { query: 'nothing' });
      expect(result!.content[0].annotations?.audience).toEqual(['user']);
      expect(result!.content[0].annotations?.priority).toBe(0.3);
    });
  });

  describe('Admin handlers', () => {
    it('memoclaw_status returns user-only annotation', async () => {
      const ctx = createMockContext({ free_tier_remaining: 50, free_tier_total: 100, wallet: '0xTest' });
      const result = await handleAdmin(ctx, 'memoclaw_status', {});
      expect(result!.content[0].annotations?.audience).toEqual(['user']);
      expect(result!.content[0].annotations?.priority).toBe(0.5);
    });

    it('memoclaw_stats returns user text + assistant JSON', async () => {
      const ctx = createMockContext({ total_memories: 100 });
      const result = await handleAdmin(ctx, 'memoclaw_stats', {});
      expect(result!.content.length).toBe(2);
      expect(result!.content[0].annotations?.audience).toEqual(['user']);
      expect(result!.content[0].annotations?.priority).toBe(0.5);
      expect(result!.content[1].annotations?.audience).toEqual(['assistant']);
    });

    it('memoclaw_extract returns assistant-only JSON', async () => {
      const ctx = createMockContext({ memories: [] });
      const result = await handleAdmin(ctx, 'memoclaw_extract', { messages: [{ role: 'user', content: 'hi' }] });
      expect(result!.content[0].annotations?.audience).toEqual(['assistant']);
    });

    it('memoclaw_tags empty returns user-only low priority', async () => {
      const ctx = createMockContext({ tags: [] });
      const result = await handleAdmin(ctx, 'memoclaw_tags', {});
      expect(result!.content[0].annotations?.audience).toEqual(['user']);
      expect(result!.content[0].annotations?.priority).toBe(0.3);
    });

    it('memoclaw_namespaces with data returns user-only', async () => {
      const ctx = createMockContext({ namespaces: [{ namespace: 'default', count: 10 }] });
      const result = await handleAdmin(ctx, 'memoclaw_namespaces', {});
      expect(result!.content[0].annotations?.audience).toEqual(['user']);
      expect(result!.content[0].annotations?.priority).toBe(0.5);
    });
  });

  describe('Relations handlers', () => {
    it('memoclaw_create_relation returns annotated content', async () => {
      const ctx = createMockContext({ id: 'r1' });
      const result = await handleRelations(ctx, 'memoclaw_create_relation', {
        memory_id: 'm1',
        target_id: 'm2',
        relation_type: 'related_to',
      });
      expect(result!.content.length).toBe(2);
      expect(result!.content[0].annotations?.audience).toContain('user');
      expect(result!.content[1].annotations?.audience).toEqual(['assistant']);
    });

    it('memoclaw_list_relations empty returns user-only low priority', async () => {
      const ctx = createMockContext({ relations: [] });
      const result = await handleRelations(ctx, 'memoclaw_list_relations', { memory_id: 'm1' });
      expect(result!.content[0].annotations?.audience).toEqual(['user']);
      expect(result!.content[0].annotations?.priority).toBe(0.3);
    });
  });
});
