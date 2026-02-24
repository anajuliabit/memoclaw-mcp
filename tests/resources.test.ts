/**
 * Tests for MCP Resources capability.
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

import { RESOURCES, createResourceHandler } from '../src/resources.js';
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

  describe('unknown resource', () => {
    it('should throw for unknown URI', async () => {
      await expect(handleReadResource('memoclaw://unknown')).rejects.toThrow(
        'Unknown resource'
      );
    });
  });
});
