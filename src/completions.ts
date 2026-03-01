/**
 * MCP Completion handler for MemoClaw.
 *
 * Provides autocomplete suggestions for prompt and resource template arguments.
 * Cached values are refreshed every 5 minutes to avoid excessive API calls.
 */

import type { ApiClient } from './api.js';
import type { Config } from './config.js';

const MEMORY_TYPES = ['correction', 'preference', 'decision', 'project', 'observation', 'general'];

/** Simple TTL cache for namespace and tag lists */
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function createCompletionHandler(api: ApiClient, _config: Config) {
  const { makeRequest } = api;

  let nsCache: CacheEntry<string[]> | null = null;
  let tagCache: CacheEntry<string[]> | null = null;

  async function getNamespaces(): Promise<string[]> {
    if (nsCache && Date.now() < nsCache.expiry) return nsCache.data;
    try {
      const result = await makeRequest('GET', '/v1/namespaces');
      const namespaces = (result.namespaces || []).map((ns: any) =>
        typeof ns === 'string' ? ns : ns.namespace || ns.name
      ).filter(Boolean);
      nsCache = { data: namespaces, expiry: Date.now() + CACHE_TTL };
      return namespaces;
    } catch {
      return nsCache?.data || [];
    }
  }

  async function getTags(): Promise<string[]> {
    if (tagCache && Date.now() < tagCache.expiry) return tagCache.data;
    try {
      const result = await makeRequest('GET', '/v1/tags');
      const tags = (result.tags || []).map((t: any) =>
        typeof t === 'string' ? t : t.tag || t.name
      ).filter(Boolean);
      tagCache = { data: tags, expiry: Date.now() + CACHE_TTL };
      return tags;
    } catch {
      return tagCache?.data || [];
    }
  }

  /** Filter and return matching completions for a partial value */
  function filterValues(values: string[], partial: string): { values: string[]; total: number; hasMore: boolean } {
    const lower = partial.toLowerCase();
    const matched = lower
      ? values.filter((v) => v.toLowerCase().includes(lower))
      : values;
    return {
      values: matched.slice(0, 100),
      total: matched.length,
      hasMore: matched.length > 100,
    };
  }

  return async function handleComplete(
    ref: { type: string; name?: string; uri?: string },
    argument: { name: string; value: string }
  ): Promise<{ completion: { values: string[]; total?: number; hasMore?: boolean } }> {
    const argName = argument.name;
    const partial = argument.value;

    // Provide completions for 'namespace' argument
    if (argName === 'namespace') {
      const namespaces = await getNamespaces();
      return { completion: filterValues(namespaces, partial) };
    }

    // Provide completions for 'tag' argument
    if (argName === 'tag') {
      const tags = await getTags();
      return { completion: filterValues(tags, partial) };
    }

    // Provide completions for 'memory_type' argument
    if (argName === 'memory_type') {
      return { completion: filterValues(MEMORY_TYPES, partial) };
    }

    // No completions available for this argument
    return { completion: { values: [] } };
  };
}
