import { describe, it, expect } from 'vitest';
import { handleAdmin } from '../../src/handlers/admin.js';
import { createContext } from '../../src/handlers/types.js';
import { mockApi, mockApiWithErrors, testConfig } from './helpers.js';

function makeCtx(routes: Record<string, any> = {}) {
  const api = mockApi(routes);
  return { ctx: createContext(api as any, testConfig), api };
}

describe('handleAdmin', () => {
  // ── status ───────────────────────────────────────────────────────────────
  describe('memoclaw_status', () => {
    it('returns wallet and free tier info', async () => {
      const { ctx } = makeCtx({
        'GET /v1/free-tier/status': { wallet: '0xABC', free_tier_remaining: 50, free_tier_total: 100 },
      });
      const result = await handleAdmin(ctx, 'memoclaw_status', {});
      expect(result!.content[0].text).toContain('0xABC');
      expect(result!.content[0].text).toContain('50/100');
    });
  });

  // ── init ─────────────────────────────────────────────────────────────────
  describe('memoclaw_init', () => {
    it('reports healthy when API reachable', async () => {
      const { ctx } = makeCtx({
        'GET /v1/free-tier/status': { free_tier_remaining: 80, free_tier_total: 100 },
      });
      const result = await handleAdmin(ctx, 'memoclaw_init', {});
      expect(result!.content[0].text).toContain('MemoClaw is ready');
      expect(result!.content[0].text).toContain('API reachable');
    });

    it('reports unhealthy when API unreachable', async () => {
      const api = mockApiWithErrors({}, {
        'GET /v1/free-tier/status': new Error('Connection refused'),
      });
      const ctx = createContext(api as any, testConfig);
      const result = await handleAdmin(ctx, 'memoclaw_init', {});
      expect(result!.content[0].text).toContain('needs configuration');
      expect(result!.content[0].text).toContain('unreachable');
    });

    it('warns when free tier exhausted', async () => {
      const { ctx } = makeCtx({
        'GET /v1/free-tier/status': { free_tier_remaining: 0, free_tier_total: 100 },
      });
      const result = await handleAdmin(ctx, 'memoclaw_init', {});
      expect(result!.content[0].text).toContain('exhausted');
    });
  });

  // ── ingest ───────────────────────────────────────────────────────────────
  describe('memoclaw_ingest', () => {
    it('ingests text', async () => {
      const { ctx } = makeCtx({
        'POST /v1/ingest': { memories_created: 3 },
      });
      const result = await handleAdmin(ctx, 'memoclaw_ingest', { text: 'some text' });
      expect(result!.content[0].text).toContain('3 memories created');
    });

    it('rejects missing messages and text', async () => {
      const { ctx } = makeCtx();
      await expect(handleAdmin(ctx, 'memoclaw_ingest', {}))
        .rejects.toThrow('Either messages or text');
    });
  });

  // ── extract ──────────────────────────────────────────────────────────────
  describe('memoclaw_extract', () => {
    it('extracts memories from messages', async () => {
      const { ctx } = makeCtx({
        'POST /v1/memories/extract': { extracted: 2 },
      });
      const result = await handleAdmin(ctx, 'memoclaw_extract', {
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(result!.content[0].text).toContain('extracted');
    });

    it('rejects empty messages', async () => {
      const { ctx } = makeCtx();
      await expect(handleAdmin(ctx, 'memoclaw_extract', { messages: [] }))
        .rejects.toThrow('non-empty array');
    });
  });

  // ── consolidate ──────────────────────────────────────────────────────────
  describe('memoclaw_consolidate', () => {
    it('consolidates memories', async () => {
      const { ctx } = makeCtx({
        'POST /v1/memories/consolidate': { merged: 5, removed: 3 },
      });
      const result = await handleAdmin(ctx, 'memoclaw_consolidate', {});
      expect(result!.content[0].text).toContain('Consolidation complete');
    });

    it('shows dry run prefix', async () => {
      const { ctx } = makeCtx({
        'POST /v1/memories/consolidate': { would_merge: 5 },
      });
      const result = await handleAdmin(ctx, 'memoclaw_consolidate', { dry_run: true });
      expect(result!.content[0].text).toContain('dry run');
    });
  });

  // ── export ───────────────────────────────────────────────────────────────
  describe('memoclaw_export', () => {
    it('exports memories', async () => {
      const { ctx } = makeCtx({
        'GET /v1/export': { memories: [{ id: '1', content: 'a' }, { id: '2', content: 'b' }] },
      });
      const result = await handleAdmin(ctx, 'memoclaw_export', {});
      expect(result!.content[0].text).toContain('Exported 2 memories');
    });

    it('falls back to pagination on 404', async () => {
      const api = mockApiWithErrors(
        { 'GET /v1/memories': { memories: [{ id: '1', content: 'a' }] } },
        { 'GET /v1/export': new Error('HTTP 404: Not Found') },
      );
      const ctx = createContext(api as any, testConfig);
      const result = await handleAdmin(ctx, 'memoclaw_export', {});
      expect(result!.content[0].text).toContain('Exported 1 memories');
    });
  });

  // ── delete_namespace ─────────────────────────────────────────────────────
  describe('memoclaw_delete_namespace', () => {
    it('deletes all memories in namespace', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories': { memories: [{ id: '1' }, { id: '2' }] },
        'DELETE /v1/memories/': { deleted: true },
      });
      const result = await handleAdmin(ctx, 'memoclaw_delete_namespace', { namespace: 'test' });
      expect(result!.content[0].text).toContain('2 memories deleted');
    });

    it('rejects missing namespace', async () => {
      const { ctx } = makeCtx();
      await expect(handleAdmin(ctx, 'memoclaw_delete_namespace', {}))
        .rejects.toThrow('namespace is required');
    });
  });

  // ── tags ─────────────────────────────────────────────────────────────────
  describe('memoclaw_tags', () => {
    it('returns tags from dedicated endpoint', async () => {
      const { ctx } = makeCtx({
        'GET /v1/tags': { tags: [{ tag: 'work', count: 5 }, { tag: 'personal', count: 3 }] },
      });
      const result = await handleAdmin(ctx, 'memoclaw_tags', {});
      expect(result!.content[0].text).toContain('2 tags');
      expect(result!.content[0].text).toContain('work');
    });

    it('handles empty tags', async () => {
      const { ctx } = makeCtx({
        'GET /v1/tags': { tags: [] },
      });
      const result = await handleAdmin(ctx, 'memoclaw_tags', {});
      expect(result!.content[0].text).toContain('No tags found');
    });
  });

  // ── history ──────────────────────────────────────────────────────────────
  describe('memoclaw_history', () => {
    it('returns version history', async () => {
      const { ctx } = makeCtx({
        'GET /v1/memories/': { history: [{ content: 'v1' }, { content: 'v2' }] },
      });
      const result = await handleAdmin(ctx, 'memoclaw_history', { id: '1' });
      expect(result!.content[0].text).toContain('2 versions');
    });

    it('rejects missing id', async () => {
      const { ctx } = makeCtx();
      await expect(handleAdmin(ctx, 'memoclaw_history', {}))
        .rejects.toThrow('id is required');
    });
  });

  // ── namespaces ───────────────────────────────────────────────────────────
  describe('memoclaw_namespaces', () => {
    it('returns namespaces from API', async () => {
      const { ctx } = makeCtx({
        'GET /v1/namespaces': { namespaces: [{ namespace: 'work', count: 10 }, { namespace: 'personal', count: 5 }] },
      });
      const result = await handleAdmin(ctx, 'memoclaw_namespaces', {});
      expect(result!.content[0].text).toContain('2 namespaces');
    });
  });

  // ── core_memories ────────────────────────────────────────────────────────
  describe('memoclaw_core_memories', () => {
    it('returns core memories', async () => {
      const { ctx } = makeCtx({
        'GET /v1/core-memories': { memories: [{ id: '1', content: 'important', importance: 1.0 }] },
      });
      const result = await handleAdmin(ctx, 'memoclaw_core_memories', {});
      expect(result!.content[0].text).toContain('1 core memories');
    });

    it('handles empty core memories', async () => {
      const { ctx } = makeCtx({
        'GET /v1/core-memories': { memories: [] },
      });
      const result = await handleAdmin(ctx, 'memoclaw_core_memories', {});
      expect(result!.content[0].text).toContain('No core memories found');
    });
  });

  // ── stats ────────────────────────────────────────────────────────────────
  describe('memoclaw_stats', () => {
    it('returns memory stats', async () => {
      const { ctx } = makeCtx({
        'GET /v1/stats': { total_memories: 100, pinned_count: 5, avg_importance: 0.73 },
      });
      const result = await handleAdmin(ctx, 'memoclaw_stats', {});
      expect(result!.content[0].text).toContain('100');
      expect(result!.content[0].text).toContain('0.73');
    });
  });

  // ── migrate ──────────────────────────────────────────────────────────────
  describe('memoclaw_migrate', () => {
    it('migrates files via API', async () => {
      const { ctx } = makeCtx({
        'POST /v1/migrate': { memories_created: 3, duplicates_skipped: 1 },
      });
      const result = await handleAdmin(ctx, 'memoclaw_migrate', {
        files: [{ filename: 'test.md', content: '# Hello' }],
      });
      expect(result!.content[0].text).toContain('Migration complete');
      expect(result!.content[0].text).toContain('3');
    });

    it('rejects missing path and files', async () => {
      const { ctx } = makeCtx();
      await expect(handleAdmin(ctx, 'memoclaw_migrate', {}))
        .rejects.toThrow('Either "path"');
    });

    it('handles dry run with ingest fallback', async () => {
      const api = mockApiWithErrors(
        {},
        { 'POST /v1/migrate': new Error('HTTP 404: Not Found') },
      );
      const ctx = createContext(api as any, testConfig);
      const result = await handleAdmin(ctx, 'memoclaw_migrate', {
        files: [{ filename: 'test.md', content: '# Hello' }],
        dry_run: true,
      });
      expect(result!.content[0].text).toContain('dry run');
      expect(result!.content[0].text).toContain('test.md');
    });
  });

  it('returns null for unknown tools', async () => {
    const { ctx } = makeCtx();
    expect(await handleAdmin(ctx, 'memoclaw_store', {})).toBeNull();
  });
});
