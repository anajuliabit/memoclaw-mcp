/**
 * MCP Resource definitions and handler for MemoClaw.
 *
 * Static resources (resources/list):
 * - memoclaw://stats        — Memory usage statistics
 * - memoclaw://namespaces   — List of namespaces with counts
 * - memoclaw://core-memories — Most important/pinned/frequently accessed memories
 *
 * Resource templates (resources/templates/list):
 * - memoclaw://memories/{id}           — Read a single memory by ID
 * - memoclaw://namespaces/{namespace}  — List memories in a namespace
 * - memoclaw://tags/{tag}              — List memories with a specific tag
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

/** Resource templates returned by resources/templates/list */
export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'memoclaw://memories/{id}',
    name: 'Memory by ID',
    description:
      'Read a single memory by its ID. Returns the full memory object including content, tags, importance, and metadata. FREE.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'memoclaw://namespaces/{namespace}',
    name: 'Namespace Memories',
    description:
      'List all memories in a specific namespace. Returns up to 50 memories sorted by creation date (newest first). FREE.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'memoclaw://tags/{tag}',
    name: 'Memories by Tag',
    description:
      'List all memories with a specific tag. Returns up to 50 memories sorted by creation date (newest first). FREE.',
    mimeType: 'application/json',
  },
];

/**
 * Parse a memoclaw:// URI and extract template parameters.
 * Returns null if the URI doesn't match any template.
 */
function parseTemplateUri(uri: string): { template: string; params: Record<string, string> } | null {
  // memoclaw://memories/{id}
  const memoryMatch = uri.match(/^memoclaw:\/\/memories\/(.+)$/);
  if (memoryMatch) {
    return { template: 'memories', params: { id: decodeURIComponent(memoryMatch[1]) } };
  }

  // memoclaw://namespaces/{namespace} (but not the bare memoclaw://namespaces)
  const nsMatch = uri.match(/^memoclaw:\/\/namespaces\/(.+)$/);
  if (nsMatch) {
    return { template: 'namespaces', params: { namespace: decodeURIComponent(nsMatch[1]) } };
  }

  // memoclaw://tags/{tag}
  const tagMatch = uri.match(/^memoclaw:\/\/tags\/(.+)$/);
  if (tagMatch) {
    return { template: 'tags', params: { tag: decodeURIComponent(tagMatch[1]) } };
  }

  return null;
}

export function createResourceHandler(api: ApiClient, _config: Config) {
  const { makeRequest } = api;

  return async function handleReadResource(uri: string) {
    // Check static resources first
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
    }

    // Check resource templates
    const parsed = parseTemplateUri(uri);
    if (parsed) {
      switch (parsed.template) {
        case 'memories': {
          const result = await makeRequest('GET', `/v1/memories/${encodeURIComponent(parsed.params.id)}`);
          const memory = result.memory || result;
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(memory, null, 2),
              },
            ],
          };
        }

        case 'namespaces': {
          const params = new URLSearchParams();
          params.set('namespace', parsed.params.namespace);
          params.set('limit', '50');
          const result = await makeRequest('GET', `/v1/memories?${params}`);
          const memories = result.memories || result.data || [];
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ namespace: parsed.params.namespace, memories, count: memories.length }, null, 2),
              },
            ],
          };
        }

        case 'tags': {
          const result = await makeRequest('GET', `/v1/memories?tags=${encodeURIComponent(parsed.params.tag)}&limit=50`);
          const memories = result.memories || result.data || [];
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ tag: parsed.params.tag, memories, count: memories.length }, null, 2),
              },
            ],
          };
        }
      }
    }

    throw new Error(`Unknown resource: ${uri}`);
  };
}
