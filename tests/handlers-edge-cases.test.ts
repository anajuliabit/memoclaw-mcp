/**
 * Edge case tests for handler logic.
 * Tests validation, error messages, and boundary conditions
 * that the main tools.test.ts might not cover in depth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHandler } from '../src/handlers.js';
import { formatMemory, validateContentLength, validateImportance, MAX_CONTENT_LENGTH } from '../src/format.js';
import type { Config } from '../src/config.js';

// Mock API client
function mockApi(overrides: Record<string, any> = {}) {
  const makeRequest = vi.fn().mockImplementation(async (method: string, path: string, body?: any) => {
    if (overrides[`${method} ${path}`]) return overrides[`${method} ${path}`];
    // Match patterns
    for (const [pattern, value] of Object.entries(overrides)) {
      if (path.startsWith(pattern.split(' ')[1] || '') && method === pattern.split(' ')[0]) {
        return typeof value === 'function' ? value(path, body) : value;
      }
    }
    return {};
  });
  return {
    makeRequest,
    account: { address: '0xtest' },
  };
}

const testConfig: Config = {
  privateKey: '0x' + '1'.repeat(64),
  apiUrl: 'https://test.memoclaw.com',
  configSource: 'test',
  timeout: 5000,
  maxRetries: 0,
};

describe('formatMemory', () => {
  it('handles null/undefined input', () => {
    expect(formatMemory(null)).toBe('(empty memory)');
    expect(formatMemory(undefined)).toBe('(empty memory)');
  });

  it('handles empty object', () => {
    expect(formatMemory({})).toBe('📝 (no content)');
  });

  it('shows all fields when present', () => {
    const result = formatMemory({
      id: 'abc123',
      content: 'test content',
      similarity: 0.95,
      importance: 0.8,
      memory_type: 'correction',
      namespace: 'work',
      tags: ['tag1', 'tag2'],
      pinned: true,
      immutable: true,
      expires_at: '2025-12-31',
      created_at: '2025-01-01',
      updated_at: '2025-06-01',
    });
    expect(result).toContain('test content');
    expect(result).toContain('abc123');
    expect(result).toContain('0.950');
    expect(result).toContain('0.8');
    expect(result).toContain('correction');
    expect(result).toContain('work');
    expect(result).toContain('tag1, tag2');
    expect(result).toContain('📌 pinned');
    expect(result).toContain('🔒 immutable');
    expect(result).toContain('2025-12-31');
  });

  it('skips updated_at when same as created_at', () => {
    const result = formatMemory({
      content: 'test',
      created_at: '2025-01-01',
      updated_at: '2025-01-01',
    });
    expect(result).toContain('created: 2025-01-01');
    expect(result).not.toContain('updated:');
  });

  it('handles tags in metadata.tags fallback', () => {
    const result = formatMemory({
      content: 'test',
      metadata: { tags: ['from-metadata'] },
    });
    expect(result).toContain('from-metadata');
  });
});

describe('validateContentLength', () => {
  it('accepts content within limit', () => {
    expect(() => validateContentLength('hello')).not.toThrow();
  });

  it('rejects content exceeding limit', () => {
    const longContent = 'x'.repeat(MAX_CONTENT_LENGTH + 1);
    expect(() => validateContentLength(longContent)).toThrow(/character limit/);
  });

  it('accepts content at exact limit', () => {
    const exactContent = 'x'.repeat(MAX_CONTENT_LENGTH);
    expect(() => validateContentLength(exactContent)).not.toThrow();
  });

  it('includes custom label in error', () => {
    const longContent = 'x'.repeat(MAX_CONTENT_LENGTH + 1);
    expect(() => validateContentLength(longContent, 'Memory at index 3')).toThrow(/Memory at index 3/);
  });
});

describe('validateImportance', () => {
  it('accepts undefined and null', () => {
    expect(() => validateImportance(undefined)).not.toThrow();
    expect(() => validateImportance(null)).not.toThrow();
  });

  it('accepts valid range', () => {
    expect(() => validateImportance(0)).not.toThrow();
    expect(() => validateImportance(0.5)).not.toThrow();
    expect(() => validateImportance(1)).not.toThrow();
  });

  it('rejects out of range', () => {
    expect(() => validateImportance(-0.1)).toThrow(/between 0.0 and 1.0/);
    expect(() => validateImportance(1.1)).toThrow(/between 0.0 and 1.0/);
  });

  it('rejects non-number', () => {
    expect(() => validateImportance('high' as any)).toThrow(/must be a number/);
    expect(() => validateImportance(NaN)).toThrow(/must be a number/);
  });

  it('includes custom label', () => {
    expect(() => validateImportance(2, 'item importance')).toThrow(/item importance/);
  });
});

describe('Handler edge cases', () => {
  let api: ReturnType<typeof mockApi>;
  let handler: ReturnType<typeof createHandler>;

  beforeEach(() => {
    api = mockApi({
      'POST /v1/store': { memory: { id: 'new-1', content: 'stored' } },
      'POST /v1/recall': { memories: [] },
      'GET /v1/free-tier/status': { free_tier_remaining: 50, free_tier_total: 100, wallet: '0xtest' },
      'GET /v1/stats': { total_memories: 0 },
      'POST /v1/store/batch': (_path: string, body: any) => ({
        memories: body.memories.map((m: any, i: number) => ({ id: `batch-${i}`, ...m })),
        failed: [],
      }),
    });
    handler = createHandler(api as any, testConfig);
  });

  describe('memoclaw_store', () => {
    it('rejects empty string content', async () => {
      await expect(handler('memoclaw_store', { content: '' })).rejects.toThrow(/content is required/);
    });

    it('rejects whitespace-only content', async () => {
      await expect(handler('memoclaw_store', { content: '   ' })).rejects.toThrow(/content is required/);
    });

    it('rejects content exceeding max length', async () => {
      await expect(handler('memoclaw_store', { content: 'x'.repeat(8193) })).rejects.toThrow(/character limit/);
    });

    it('rejects invalid importance', async () => {
      await expect(handler('memoclaw_store', { content: 'test', importance: 2 })).rejects.toThrow(
        /between 0.0 and 1.0/,
      );
    });

    it('passes all optional fields to API', async () => {
      await handler('memoclaw_store', {
        content: 'test',
        importance: 0.9,
        tags: ['a'],
        namespace: 'ns',
        memory_type: 'correction',
        session_id: 'sess-1',
        agent_id: 'agent-1',
        expires_at: '2026-01-01',
        pinned: true,
        immutable: true,
      });
      const call = api.makeRequest.mock.calls[0];
      expect(call[0]).toBe('POST');
      expect(call[1]).toBe('/v1/store');
      expect(call[2]).toMatchObject({
        content: 'test',
        importance: 0.9,
        tags: ['a'],
        namespace: 'ns',
        memory_type: 'correction',
        session_id: 'sess-1',
        agent_id: 'agent-1',
        pinned: true,
        immutable: true,
      });
    });
  });

  describe('memoclaw_recall', () => {
    it('rejects empty query', async () => {
      await expect(handler('memoclaw_recall', { query: '' })).rejects.toThrow(/query is required/);
    });

    it('rejects whitespace-only query', async () => {
      await expect(handler('memoclaw_recall', { query: '   ' })).rejects.toThrow(/query is required/);
    });

    it('returns no-results message when empty', async () => {
      const result = await handler('memoclaw_recall', { query: 'something' });
      expect(result.content[0].text).toContain('No memories found');
    });
  });

  describe('memoclaw_get', () => {
    it('rejects missing id', async () => {
      await expect(handler('memoclaw_get', {})).rejects.toThrow(/id is required/);
    });
  });

  describe('memoclaw_delete', () => {
    it('rejects missing id', async () => {
      await expect(handler('memoclaw_delete', {})).rejects.toThrow(/id is required/);
    });
  });

  describe('memoclaw_bulk_delete', () => {
    it('rejects empty array', async () => {
      await expect(handler('memoclaw_bulk_delete', { ids: [] })).rejects.toThrow(/non-empty array/);
    });

    it('rejects more than 100 IDs', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
      await expect(handler('memoclaw_bulk_delete', { ids })).rejects.toThrow(/Maximum 100/);
    });
  });

  describe('memoclaw_update', () => {
    it('rejects missing id', async () => {
      await expect(handler('memoclaw_update', { content: 'new' })).rejects.toThrow(/id is required/);
    });

    it('rejects when no valid update fields provided', async () => {
      await expect(handler('memoclaw_update', { id: 'abc', unknown_field: 'val' })).rejects.toThrow(
        /No valid update fields/,
      );
    });
  });

  describe('memoclaw_bulk_store', () => {
    it('rejects empty array', async () => {
      await expect(handler('memoclaw_bulk_store', { memories: [] })).rejects.toThrow(/non-empty array/);
    });

    it('rejects more than 100 memories', async () => {
      const memories = Array.from({ length: 101 }, () => ({ content: 'x' }));
      await expect(handler('memoclaw_bulk_store', { memories })).rejects.toThrow(/Maximum 100/);
    });

    it('rejects memory with empty content', async () => {
      await expect(
        handler('memoclaw_bulk_store', {
          memories: [{ content: 'ok' }, { content: '' }],
        }),
      ).rejects.toThrow(/index 1.*empty content/);
    });

    it('tries batch endpoint first', async () => {
      await handler('memoclaw_bulk_store', {
        memories: [{ content: 'hello' }, { content: 'world' }],
      });
      // First call should be to batch endpoint
      expect(api.makeRequest.mock.calls[0][1]).toBe('/v1/store/batch');
    });

    it('falls back to one-by-one on 404', async () => {
      api.makeRequest.mockImplementation(async (method: string, path: string, body?: any) => {
        if (path === '/v1/store/batch') throw new Error('HTTP 404: Not Found');
        return { memory: { id: 'new', content: body?.content } };
      });

      const result = await handler('memoclaw_bulk_store', {
        memories: [{ content: 'hello' }],
      });
      expect(result.content[0].text).toContain('1 stored');
    });
  });

  describe('memoclaw_import', () => {
    it('rejects empty memories array', async () => {
      await expect(handler('memoclaw_import', { memories: [] })).rejects.toThrow(/non-empty array/);
    });

    it('rejects memory with empty content at specific index', async () => {
      await expect(
        handler('memoclaw_import', {
          memories: [{ content: 'ok' }, { content: '   ' }],
        }),
      ).rejects.toThrow(/index 1.*empty content/);
    });
  });

  describe('memoclaw_create_relation', () => {
    it('rejects missing required fields', async () => {
      await expect(handler('memoclaw_create_relation', { memory_id: 'a' })).rejects.toThrow(/required/);
      await expect(handler('memoclaw_create_relation', { memory_id: 'a', target_id: 'b' })).rejects.toThrow(/required/);
    });
  });

  describe('memoclaw_delete_relation', () => {
    it('rejects missing fields', async () => {
      await expect(handler('memoclaw_delete_relation', { memory_id: 'a' })).rejects.toThrow(/required/);
    });
  });

  describe('memoclaw_status', () => {
    it('returns formatted status', async () => {
      const result = await handler('memoclaw_status', {});
      expect(result.content[0].text).toContain('Wallet: 0xtest');
      expect(result.content[0].text).toContain('50/100');
      expect(result.content[0].text).toContain('50%');
    });
  });

  describe('memoclaw_batch_update', () => {
    it('rejects empty updates', async () => {
      await expect(handler('memoclaw_batch_update', { updates: [] })).rejects.toThrow(/non-empty array/);
    });

    it('rejects more than 50 updates', async () => {
      const updates = Array.from({ length: 51 }, (_, i) => ({ id: `id-${i}` }));
      await expect(handler('memoclaw_batch_update', { updates })).rejects.toThrow(/Maximum 50/);
    });

    it('rejects update missing id', async () => {
      await expect(
        handler('memoclaw_batch_update', {
          updates: [{ content: 'new' }],
        }),
      ).rejects.toThrow(/missing "id"/);
    });
  });

  describe('memoclaw_delete_namespace', () => {
    it('rejects missing namespace', async () => {
      await expect(handler('memoclaw_delete_namespace', {})).rejects.toThrow(/namespace is required/);
    });
  });

  describe('memoclaw_graph', () => {
    it('rejects missing memory_id', async () => {
      await expect(handler('memoclaw_graph', {})).rejects.toThrow(/memory_id is required/);
    });
  });

  describe('memoclaw_history', () => {
    it('rejects missing id', async () => {
      await expect(handler('memoclaw_history', {})).rejects.toThrow(/id is required/);
    });
  });

  describe('memoclaw_context', () => {
    it('rejects empty query', async () => {
      await expect(handler('memoclaw_context', { query: '' })).rejects.toThrow(/query is required/);
    });
  });

  describe('memoclaw_search', () => {
    it('rejects empty query', async () => {
      await expect(handler('memoclaw_search', { query: '' })).rejects.toThrow(/query is required/);
    });
  });

  describe('memoclaw_migrate', () => {
    it('rejects when neither path nor files provided', async () => {
      await expect(handler('memoclaw_migrate', {})).rejects.toThrow(/Either "path".*or "files"/);
    });
  });

  describe('memoclaw_extract', () => {
    it('rejects empty messages', async () => {
      await expect(handler('memoclaw_extract', { messages: [] })).rejects.toThrow(/non-empty array/);
    });
  });

  describe('unknown tool', () => {
    it('throws for unknown tool name', async () => {
      await expect(handler('memoclaw_nonexistent', {})).rejects.toThrow(/Unknown tool/);
    });
  });
});
