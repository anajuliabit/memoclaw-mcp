import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCompletionHandler } from '../src/completions.js';
import type { ApiClient } from '../src/api.js';
import type { Config } from '../src/config.js';

const mockConfig: Config = {
  privateKey: '0x1234',
  apiUrl: 'https://api.memoclaw.com',
  configSource: 'test',
  timeout: 5000,
  maxRetries: 0,
};

describe('Completions', () => {
  let mockMakeRequest: ReturnType<typeof vi.fn>;
  let handleComplete: ReturnType<typeof createCompletionHandler>;

  beforeEach(() => {
    mockMakeRequest = vi.fn();
    const mockApi = {
      makeRequest: mockMakeRequest,
      account: { address: '0xtest' },
    } as unknown as ApiClient;
    handleComplete = createCompletionHandler(mockApi, mockConfig);
  });

  it('returns namespace completions', async () => {
    mockMakeRequest.mockResolvedValueOnce({
      namespaces: [{ namespace: 'work', count: 5 }, { namespace: 'personal', count: 3 }],
    });

    const result = await handleComplete(
      { type: 'ref/prompt', name: 'review-memories' },
      { name: 'namespace', value: 'wo' }
    );

    expect(result.completion.values).toEqual(['work']);
    expect(mockMakeRequest).toHaveBeenCalledWith('GET', '/v1/namespaces');
  });

  it('returns all namespaces when value is empty', async () => {
    mockMakeRequest.mockResolvedValueOnce({
      namespaces: [{ namespace: 'work', count: 5 }, { namespace: 'personal', count: 3 }],
    });

    const result = await handleComplete(
      { type: 'ref/prompt', name: 'review-memories' },
      { name: 'namespace', value: '' }
    );

    expect(result.completion.values).toEqual(['work', 'personal']);
  });

  it('returns tag completions', async () => {
    mockMakeRequest.mockResolvedValueOnce({
      tags: ['frontend', 'backend', 'infra'],
    });

    const result = await handleComplete(
      { type: 'ref/resource', uri: 'memoclaw://tags/{tag}' },
      { name: 'tag', value: 'front' }
    );

    expect(result.completion.values).toEqual(['frontend']);
  });

  it('returns memory_type completions', async () => {
    const result = await handleComplete(
      { type: 'ref/prompt', name: 'load-context' },
      { name: 'memory_type', value: 'cor' }
    );

    expect(result.completion.values).toEqual(['correction']);
    expect(mockMakeRequest).not.toHaveBeenCalled();
  });

  it('returns empty for unknown arguments', async () => {
    const result = await handleComplete(
      { type: 'ref/prompt', name: 'load-context' },
      { name: 'unknown_arg', value: 'test' }
    );

    expect(result.completion.values).toEqual([]);
  });

  it('caches namespace results', async () => {
    mockMakeRequest.mockResolvedValue({
      namespaces: [{ namespace: 'work', count: 5 }],
    });

    await handleComplete(
      { type: 'ref/prompt' },
      { name: 'namespace', value: '' }
    );
    await handleComplete(
      { type: 'ref/prompt' },
      { name: 'namespace', value: 'w' }
    );

    expect(mockMakeRequest).toHaveBeenCalledTimes(1);
  });

  it('handles API errors gracefully', async () => {
    mockMakeRequest.mockRejectedValueOnce(new Error('Network error'));

    const result = await handleComplete(
      { type: 'ref/prompt' },
      { name: 'namespace', value: '' }
    );

    expect(result.completion.values).toEqual([]);
  });
});
