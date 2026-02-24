/**
 * MCP Resource definitions and handler for MemoClaw.
 *
 * Exposes read-only data as MCP Resources:
 * - memoclaw://stats        — Memory usage statistics
 * - memoclaw://namespaces   — List of namespaces with counts
 * - memoclaw://core-memories — Most important/pinned/frequently accessed memories
 */

import type { ApiClient } from './api.js';
import type { Config } from './config.js';
import { formatMemory } from './format.js';

/** Static resource list returned by resources/list */
export const RESOURCES = [
  {
    uri: 'memoclaw://stats',
    name: 'Memory Statistics',
    description:
      'Usage statistics: total memories, pinned count, average importance, breakdowns by type and namespace. FREE — no API credits used.',
    mimeType: 'application/json',
  },
  {
    uri: 'memoclaw://namespaces',
    name: 'Namespaces',
    description:
      'All namespaces that contain memories, with per-namespace counts. FREE — no API credits used.',
    mimeType: 'application/json',
  },
  {
    uri: 'memoclaw://core-memories',
    name: 'Core Memories',
    description:
      'Your most important memories — high importance, frequently accessed, or pinned. Up to 20 returned. FREE — no API credits used.',
    mimeType: 'application/json',
  },
];

export function createResourceHandler(api: ApiClient, _config: Config) {
  const { makeRequest } = api;

  return async function handleReadResource(uri: string) {
    switch (uri) {
      case 'memoclaw://stats': {
        const result = await makeRequest('GET', '/v1/stats');
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'memoclaw://namespaces': {
        let namespaces: any[];
        try {
          const result = await makeRequest('GET', '/v1/namespaces');
          namespaces = result.namespaces || [];
        } catch {
          // Fallback: scan memories client-side
          const nsCounts = new Map<string, number>();
          let offset = 0;
          const pageSize = 100;
          for (let page = 0; page < 200; page++) {
            const params = new URLSearchParams();
            params.set('limit', String(pageSize));
            params.set('offset', String(offset));
            const result = await makeRequest('GET', `/v1/memories?${params}`);
            const memories = result.memories || result.data || [];
            if (memories.length === 0) break;
            for (const m of memories) {
              const ns = m.namespace || '(default)';
              nsCounts.set(ns, (nsCounts.get(ns) || 0) + 1);
            }
            if (memories.length < pageSize) break;
            offset += pageSize;
          }
          namespaces = [...nsCounts.entries()].map(([namespace, count]) => ({
            namespace,
            count,
          }));
        }
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ namespaces }, null, 2),
            },
          ],
        };
      }

      case 'memoclaw://core-memories': {
        const result = await makeRequest('GET', '/v1/core-memories?limit=20');
        const memories = result.memories || result.core_memories || result.data || [];
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ memories, count: memories.length }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown resource: ${uri}`);
    }
  };
}
