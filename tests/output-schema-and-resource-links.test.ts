/**
 * Tests for MCP 2025-06-18 features:
 * - outputSchema on tool definitions (#91)
 * - resource_link content items in mutation results (#92)
 * - structuredContent in tool results
 */
import { describe, it, expect } from 'vitest';
import { TOOLS } from '../src/tools.js';
import { handleMemory } from '../src/handlers/memory.js';
import { handleRecall } from '../src/handlers/recall.js';
import { handleAdmin } from '../src/handlers/admin.js';
import type { HandlerContext, ResourceLinkContentItem } from '../src/handlers/types.js';
import type { Config } from '../src/config.js';
import type { ApiClient } from '../src/api.js';

/** Typed access to structuredContent fields */
type SC = Record<string, unknown>;

/** Tool definition with optional outputSchema */
interface ToolDef {
  name: string;
  outputSchema?: {
    type: string;
    properties: Record<string, { type?: string; items?: Record<string, unknown>; [k: string]: unknown }>;
    required?: string[];
  };
}

function createMockContext(mockResponse: unknown = {}): HandlerContext {
  return {
    api: {} as unknown as ApiClient,
    config: {
      apiUrl: 'https://api.memoclaw.com',
      privateKey: '0x1234',
      configSource: 'env',
      timeout: 30000,
      maxRetries: 3,
      concurrency: 10,
    } satisfies Config,
    makeRequest: async () => mockResponse,
    account: { address: '0xTestWallet' } as ApiClient['account'],
    progress: async () => {},
    signal: new AbortController().signal,
  };
}

// ── outputSchema on tool definitions (#91) ───────────────────────────────────

describe('outputSchema on tool definitions (#91)', () => {
  const toolMap = new Map(TOOLS.map((t) => [t.name, t as ToolDef]));

  it('memoclaw_store has outputSchema with memory object', () => {
    const tool = toolMap.get('memoclaw_store')!;
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema!.type).toBe('object');
    expect(tool.outputSchema!.properties.memory).toBeDefined();
    expect(tool.outputSchema!.required).toContain('memory');
  });

  it('memoclaw_get has outputSchema with memory object', () => {
    const tool = toolMap.get('memoclaw_get')!;
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema!.properties.memory).toBeDefined();
    expect(tool.outputSchema!.required).toContain('memory');
  });

  it('memoclaw_recall has outputSchema with memories array', () => {
    const tool = toolMap.get('memoclaw_recall')!;
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema!.properties.memories).toBeDefined();
    const memoriesProp = tool.outputSchema!.properties.memories;
    const itemSchema = memoriesProp.items as Record<string, unknown> & { properties: Record<string, { type: string }> };
    expect(itemSchema.properties.similarity).toBeDefined();
    expect(itemSchema.properties.similarity.type).toBe('number');
  });

  it('memoclaw_search has outputSchema with memories array', () => {
    const tool = toolMap.get('memoclaw_search')!;
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema!.properties.memories).toBeDefined();
    expect(tool.outputSchema!.required).toContain('memories');
  });

  it('memoclaw_list has outputSchema with memories array and total', () => {
    const tool = toolMap.get('memoclaw_list')!;
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema!.properties.memories).toBeDefined();
    expect(tool.outputSchema!.properties.total).toBeDefined();
    expect(tool.outputSchema!.required).toEqual(expect.arrayContaining(['memories', 'total']));
  });

  it('memoclaw_update has outputSchema with memory object', () => {
    const tool = toolMap.get('memoclaw_update')!;
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema!.properties.memory).toBeDefined();
  });

  it('memoclaw_count has outputSchema with count number', () => {
    const tool = toolMap.get('memoclaw_count')!;
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema!.properties.count).toBeDefined();
    expect(tool.outputSchema!.properties.count.type).toBe('number');
    expect(tool.outputSchema!.required).toContain('count');
  });

  it('memoclaw_stats has outputSchema with stats fields', () => {
    const tool = toolMap.get('memoclaw_stats')!;
    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema!.properties.total_memories).toBeDefined();
    expect(tool.outputSchema!.properties.by_type).toBeDefined();
    expect(tool.outputSchema!.properties.by_namespace).toBeDefined();
  });

  it('outputSchema.type is always "object" per MCP spec', () => {
    for (const tool of TOOLS) {
      const t = tool as ToolDef;
      if (t.outputSchema) {
        expect(t.outputSchema.type, `${tool.name} outputSchema.type`).toBe('object');
      }
    }
  });

  it('memory object schema has required id and content', () => {
    const tool = toolMap.get('memoclaw_store')!;
    const memSchema = tool.outputSchema!.properties.memory as { required?: string[] };
    expect(memSchema.required).toContain('id');
    expect(memSchema.required).toContain('content');
  });

  it('all tools have outputSchema for MCP 2025-06-18 compliance', () => {
    for (const tool of TOOLS) {
      const t = tool as ToolDef;
      expect(t.outputSchema, `${tool.name} should have outputSchema`).toBeDefined();
      expect(t.outputSchema!.type, `${tool.name} outputSchema.type`).toBe('object');
    }
  });
});

// ── resource_link in mutation results (#92) ──────────────────────────────────

describe('resource_link in mutation tool results (#92)', () => {
  it('memoclaw_store returns resource_link to stored memory', async () => {
    const ctx = createMockContext({ memory: { id: 'abc-123', content: 'test' } });
    const result = await handleMemory(ctx, 'memoclaw_store', { content: 'test' });
    const links = result!.content.filter((c) => c.type === 'resource_link') as ResourceLinkContentItem[];
    expect(links).toHaveLength(1);
    expect(links[0].uri).toBe('memoclaw://memories/abc-123');
    expect(links[0].mimeType).toBe('application/json');
  });

  it('memoclaw_update returns resource_link to updated memory', async () => {
    const ctx = createMockContext({ memory: { id: 'xyz', content: 'updated' } });
    const result = await handleMemory(ctx, 'memoclaw_update', { id: 'xyz', content: 'updated' });
    const links = result!.content.filter((c) => c.type === 'resource_link') as ResourceLinkContentItem[];
    expect(links).toHaveLength(1);
    expect(links[0].uri).toBe('memoclaw://memories/xyz');
    expect(links[0].name).toBe('Updated memory');
  });

  it('memoclaw_pin returns resource_link', async () => {
    const ctx = createMockContext({ memory: { id: 'pin-1', content: 'pinned', pinned: true } });
    const result = await handleMemory(ctx, 'memoclaw_pin', { id: 'pin-1' });
    const links = result!.content.filter((c) => c.type === 'resource_link') as ResourceLinkContentItem[];
    expect(links).toHaveLength(1);
    expect(links[0].uri).toBe('memoclaw://memories/pin-1');
  });

  it('memoclaw_unpin returns resource_link', async () => {
    const ctx = createMockContext({ memory: { id: 'unpin-1', content: 'unpinned', pinned: false } });
    const result = await handleMemory(ctx, 'memoclaw_unpin', { id: 'unpin-1' });
    const links = result!.content.filter((c) => c.type === 'resource_link') as ResourceLinkContentItem[];
    expect(links).toHaveLength(1);
    expect(links[0].uri).toBe('memoclaw://memories/unpin-1');
  });

  it('memoclaw_bulk_store returns resource_links for stored memories', async () => {
    const ctx = createMockContext({
      memories: [
        { id: 'b1', content: 'a' },
        { id: 'b2', content: 'b' },
      ],
      failed: [],
    });
    const result = await handleMemory(ctx, 'memoclaw_bulk_store', {
      memories: [{ content: 'a' }, { content: 'b' }],
    });
    const links = result!.content.filter((c) => c.type === 'resource_link') as ResourceLinkContentItem[];
    expect(links).toHaveLength(2);
    expect(links[0].uri).toBe('memoclaw://memories/b1');
    expect(links[1].uri).toBe('memoclaw://memories/b2');
  });

  it('memoclaw_import returns resource_links for imported memories', async () => {
    const ctx = createMockContext({
      memories: [{ id: 'i1', content: 'imported' }],
      failed: [],
    });
    const result = await handleMemory(ctx, 'memoclaw_import', {
      memories: [{ content: 'imported' }],
    });
    const links = result!.content.filter((c) => c.type === 'resource_link') as ResourceLinkContentItem[];
    expect(links).toHaveLength(1);
    expect(links[0].uri).toBe('memoclaw://memories/i1');
    expect(links[0].name).toBe('Imported memory');
  });

  it('memoclaw_store skips resource_link when no id returned', async () => {
    const ctx = createMockContext({ memory: { content: 'no id' } });
    const result = await handleMemory(ctx, 'memoclaw_store', { content: 'no id' });
    const links = result!.content.filter((c) => c.type === 'resource_link');
    expect(links).toHaveLength(0);
  });

  it('read-only tools do NOT return resource_links', async () => {
    const ctx = createMockContext({ memories: [{ id: '1', content: 'test', similarity: 0.9 }] });
    const result = await handleRecall(ctx, 'memoclaw_recall', { query: 'test' });
    const links = result!.content.filter((c) => c.type === 'resource_link');
    expect(links).toHaveLength(0);
  });
});

// ── structuredContent in results ─────────────────────────────────────────────

describe('structuredContent in tool results', () => {
  it('memoclaw_store includes structuredContent with memory', async () => {
    const ctx = createMockContext({ memory: { id: '1', content: 'test' } });
    const result = await handleMemory(ctx, 'memoclaw_store', { content: 'test' });
    expect(result!.structuredContent).toBeDefined();
    expect((result!.structuredContent as SC & { memory: { id: string } }).memory.id).toBe('1');
  });

  it('memoclaw_get includes structuredContent with memory', async () => {
    const ctx = createMockContext({ memory: { id: '1', content: 'hello' } });
    const result = await handleMemory(ctx, 'memoclaw_get', { id: '1' });
    expect(result!.structuredContent).toBeDefined();
    expect((result!.structuredContent as SC & { memory: { content: string } }).memory.content).toBe('hello');
  });

  it('memoclaw_list includes structuredContent with memories and total', async () => {
    const ctx = createMockContext({ memories: [{ id: '1', content: 'a' }], total: 1 });
    const result = await handleMemory(ctx, 'memoclaw_list', {});
    expect(result!.structuredContent).toBeDefined();
    const sc = result!.structuredContent as SC & { memories: unknown[]; total: number };
    expect(sc.memories).toHaveLength(1);
    expect(sc.total).toBe(1);
  });

  it('memoclaw_recall includes structuredContent with memories', async () => {
    const ctx = createMockContext({ memories: [{ id: '1', content: 'test', similarity: 0.95 }] });
    const result = await handleRecall(ctx, 'memoclaw_recall', { query: 'test' });
    expect(result!.structuredContent).toBeDefined();
    const sc = result!.structuredContent as SC & { memories: Array<{ similarity: number }> };
    expect(sc.memories[0].similarity).toBe(0.95);
  });

  it('memoclaw_update includes structuredContent with memory', async () => {
    const ctx = createMockContext({ memory: { id: '1', content: 'updated' } });
    const result = await handleMemory(ctx, 'memoclaw_update', { id: '1', content: 'updated' });
    expect(result!.structuredContent).toBeDefined();
    expect((result!.structuredContent as SC & { memory: { content: string } }).memory.content).toBe('updated');
  });

  it('memoclaw_count includes structuredContent with count', async () => {
    const ctx = createMockContext({ count: 42 });
    const result = await handleMemory(ctx, 'memoclaw_count', {});
    expect(result!.structuredContent).toBeDefined();
    expect((result!.structuredContent as SC & { count: number }).count).toBe(42);
  });

  it('memoclaw_stats includes structuredContent', async () => {
    const ctx = createMockContext({ total_memories: 100, pinned_count: 5 });
    const result = await handleAdmin(ctx, 'memoclaw_stats', {});
    expect(result!.structuredContent).toBeDefined();
    expect((result!.structuredContent as SC & { total_memories: number }).total_memories).toBe(100);
  });
});
