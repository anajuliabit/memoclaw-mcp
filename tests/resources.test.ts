/**
 * Tests for MCP Resources capability (static resources + resource templates).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.MEMOCLAW_PRIVATE_KEY =
  '0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb';
process.env.MEMOCLAW_URL = 'https://test.memoclaw.com';
process.env.MEMOCLAW_TIMEOUT = '5000';
process.env.MEMOCLAW_MAX_RETRIES = '0';

// Must mock fetch before importing modules
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { RESOURCES, RESOURCE_TEMPLATES, createResourceHandler } from '../src/resources.js';
import { loadConfig } from '../src/config.js';
import { createApiClient } from '../src/api.js';

describe('Resources', () => {
  let handleReadResource: ReturnType<typeof createResourceHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    const config = loadConfig();
    const api = createApiClient(config);
    handleReadResource = createResourceHandler(api, config);
  });

  function mockApiResponse(data: any, status = 200) {
    mockFetch.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
      text: async () => JSON.stringify(data),
      headers: new Headers(),
    });
  }

  describe('RESOURCES list', () => {
    it('should define three resources', () => {
      expect(RESOURCES).toHaveLength(3);
      const uris = RESOURCES.map((r) => r.uri);
      expect(uris).toContain('memoclaw://stats');
      expect(uris).toContain('memoclaw://namespaces');
      expect(uris).toContain('memoclaw://core-memories');
    });

    it('all resources have required fields', () => {
      for (const r of RESOURCES) {
        expect(r.uri).toBeTruthy();
        expect(r.name).toBeTruthy();
        expect(r.description).toBeTruthy();
        expect(r.mimeType).toBe('application/json');
      }
    });
  });

  describe('RESOURCE_TEMPLATES list', () => {
    it('should define three resource templates', () => {
      expect(RESOURCE_TEMPLATES).toHaveLength(3);
      const uris = RESOURCE_TEMPLATES.map((r) => r.uriTemplate);
      expect(uris).toContain('memoclaw://memories/{id}');
      expect(uris).toContain('memoclaw://namespaces/{namespace}');
      expect(uris).toContain('memoclaw://tags/{tag}');
    });

    it('all templates have required fields', () => {
      for (const t of RESOURCE_TEMPLATES) {
        expect(t.uriTemplate).toBeTruthy();
        expect(t.name).toBeTruthy();
        expect(t.description).toBeTruthy();
        expect(t.mimeType).toBe('application/json');
      }
    });
  });

  describe('memoclaw://stats', () => {
    it('should return stats as JSON', async () => {
      const statsData = {
        total_memories: 42,
        pinned_count: 5,
        avg_importance: 0.65,
      };
      mockApiResponse(statsData);

      const result = await handleReadResource('memoclaw://stats');
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('memoclaw://stats');
      expect(result.contents[0].mimeType).toBe('application/json');
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.total_memories).toBe(42);
    });
  });

  describe('memoclaw://namespaces', () => {
    it('should return namespaces from API', async () => {
      const nsData = {
        namespaces: [
          { namespace: 'work', count: 10 },
          { namespace: 'personal', count: 5 },
        ],
      };
      mockApiResponse(nsData);

      const result = await handleReadResource('memoclaw://namespaces');
      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.namespaces).toHaveLength(2);
    });
  });

  describe('memoclaw://core-memories', () => {
    it('should return core memories', async () => {
      const coreData = {
        memories: [
          { id: '1', content: 'Important thing', importance: 1.0, pinned: true },
        ],
      };
      mockApiResponse(coreData);

      const result = await handleReadResource('memoclaw://core-memories');
      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.memories).toHaveLength(1);
      expect(parsed.count).toBe(1);
    });
  });

  describe('memoclaw://memories/{id} (template)', () => {
    it('should return a single memory by ID', async () => {
      const memoryData = {
        memory: { id: 'abc-123', content: 'Test memory', importance: 0.8 },
      };
      mockApiResponse(memoryData);

      const result = await handleReadResource('memoclaw://memories/abc-123');
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe('memoclaw://memories/abc-123');
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.id).toBe('abc-123');
      expect(parsed.content).toBe('Test memory');
    });

    it('should URL-decode the memory ID', async () => {
      const memoryData = { memory: { id: 'id with spaces', content: 'test' } };
      mockApiResponse(memoryData);

      const result = await handleReadResource('memoclaw://memories/id%20with%20spaces');
      expect(result.contents).toHaveLength(1);
      // Verify the API was called with the decoded ID
      const callUrl = mockFetch.mock.calls[0][0];
      expect(callUrl).toContain('/v1/memories/id%20with%20spaces');
    });
  });

  describe('memoclaw://namespaces/{namespace} (template)', () => {
    it('should return memories in a namespace', async () => {
      const data = {
        memories: [
          { id: '1', content: 'Work memory', namespace: 'work' },
          { id: '2', content: 'Another work memory', namespace: 'work' },
        ],
      };
      mockApiResponse(data);

      const result = await handleReadResource('memoclaw://namespaces/work');
      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.namespace).toBe('work');
      expect(parsed.memories).toHaveLength(2);
      expect(parsed.count).toBe(2);
    });

    it('should not conflict with bare memoclaw://namespaces', async () => {
      const nsData = { namespaces: [{ namespace: 'work', count: 10 }] };
      mockApiResponse(nsData);

      const result = await handleReadResource('memoclaw://namespaces');
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.namespaces).toBeDefined();
      // Should NOT have a .namespace field (that's the template response)
      expect(parsed.namespace).toBeUndefined();
    });
  });

  describe('memoclaw://tags/{tag} (template)', () => {
    it('should return memories with a specific tag', async () => {
      const data = {
        memories: [
          { id: '1', content: 'Tagged memory', tags: ['frontend'] },
        ],
      };
      mockApiResponse(data);

      const result = await handleReadResource('memoclaw://tags/frontend');
      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.tag).toBe('frontend');
      expect(parsed.memories).toHaveLength(1);
      expect(parsed.count).toBe(1);
    });
  });

  describe('unknown resource', () => {
    it('should throw for unknown URI', async () => {
      await expect(handleReadResource('memoclaw://unknown')).rejects.toThrow(
        'Unknown resource'
      );
    });
  });
});
