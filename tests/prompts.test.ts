/**
 * Tests for MCP Prompts capability.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.MEMOCLAW_PRIVATE_KEY =
  '0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb';
process.env.MEMOCLAW_URL = 'https://test.memoclaw.com';
process.env.MEMOCLAW_TIMEOUT = '5000';
process.env.MEMOCLAW_MAX_RETRIES = '0';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { PROMPTS, createPromptHandler } from '../src/prompts.js';
import { loadConfig } from '../src/config.js';
import { createApiClient } from '../src/api.js';

describe('Prompts', () => {
  let handleGetPrompt: ReturnType<typeof createPromptHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    const config = loadConfig();
    const api = createApiClient(config);
    handleGetPrompt = createPromptHandler(api, config);
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

  describe('PROMPTS list', () => {
    it('exports 4 prompts', () => {
      expect(PROMPTS).toHaveLength(4);
    });

    it('each prompt has name and description', () => {
      for (const p of PROMPTS) {
        expect(p.name).toBeTruthy();
        expect(p.description).toBeTruthy();
      }
    });

    it('has expected prompt names', () => {
      const names = PROMPTS.map((p) => p.name);
      expect(names).toContain('review-memories');
      expect(names).toContain('load-context');
      expect(names).toContain('memory-report');
      expect(names).toContain('migrate-files');
    });
  });

  describe('review-memories', () => {
    it('fetches memories and returns review prompt', async () => {
      mockApiResponse({
        memories: [
          { id: '1', content: 'Test memory', importance: 0.5, tags: [], created_at: '2025-01-01T00:00:00Z' },
        ],
      });

      const result = await handleGetPrompt('review-memories', {});

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content.text).toContain('1 memories');
      expect(result.messages[0].content.text).toContain('Duplicates');
    });

    it('supports namespace argument', async () => {
      mockApiResponse({ memories: [] });

      const result = await handleGetPrompt('review-memories', { namespace: 'project-x' });

      expect(result.description).toContain('project-x');
      const url = new URL(mockFetch.mock.calls[0][0]);
      expect(url.searchParams.get('namespace')).toBe('project-x');
    });
  });

  describe('load-context', () => {
    it('performs recall and returns context prompt', async () => {
      mockApiResponse({
        memories: [
          { id: '1', content: 'Relevant info', importance: 0.8, tags: ['dev'], created_at: '2025-01-01T00:00:00Z' },
        ],
      });

      const result = await handleGetPrompt('load-context', { task: 'Build auth system' });

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content.text).toContain('Build auth system');
      expect(result.messages[0].content.text).toContain('1 most relevant');
    });

    it('throws if task is missing', async () => {
      await expect(handleGetPrompt('load-context', {})).rejects.toThrow('task argument is required');
    });
  });

  describe('memory-report', () => {
    it('fetches stats, namespaces, and old memories', async () => {
      // Stats
      mockApiResponse({ total: 42, pinned: 3, avg_importance: 0.6 });
      // Namespaces
      mockApiResponse({ namespaces: [{ namespace: 'default', count: 42 }] });
      // Old memories
      mockApiResponse({ memories: [] });

      const result = await handleGetPrompt('memory-report', {});

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content.text).toContain('health report');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('migrate-files', () => {
    it('returns migration guide with commands', async () => {
      const result = await handleGetPrompt('migrate-files', {
        file_path: '/home/user/MEMORY.md',
        namespace: 'personal',
      });

      expect(result.messages).toHaveLength(1);
      const text = result.messages[0].content.text;
      expect(text).toContain('MEMORY.md');
      expect(text).toContain('--namespace personal');
      expect(text).toContain('--dry-run');
    });

    it('throws if file_path is missing', async () => {
      await expect(handleGetPrompt('migrate-files', {})).rejects.toThrow('file_path argument is required');
    });
  });

  describe('unknown prompt', () => {
    it('throws for unknown prompt name', async () => {
      await expect(handleGetPrompt('nonexistent', {})).rejects.toThrow('Unknown prompt');
    });
  });
});
