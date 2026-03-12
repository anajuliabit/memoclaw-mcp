import { vi } from 'vitest';
import type { Config } from '../../src/config.js';
import type { ApiClient } from '../../src/api.js';
import type { ToolResult, ResourceLinkContentItem } from '../../src/handlers/types.js';

/** Route handler: returns data or calls a function with (path, body) */
export type RouteValue = unknown | ((path: string, body?: Record<string, unknown>) => unknown);

/**
 * Typed mock API client for tests.
 * Cast to ApiClient so callers don't need `as any` when passing to createContext/createHandler.
 */
export type MockApiClient = ApiClient;

/** Create a mock API client with configurable route responses */
export function mockApi(routes: Record<string, RouteValue> = {}): MockApiClient {
  const makeRequest = vi.fn().mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    const key = `${method} ${path}`;
    // Exact match first
    if (routes[key] !== undefined) {
      return typeof routes[key] === 'function' ? (routes[key] as Function)(path, body) : routes[key];
    }
    // Prefix match
    for (const [pattern, value] of Object.entries(routes)) {
      const [pMethod, pPath] = pattern.split(' ');
      if (method === pMethod && pPath && path.startsWith(pPath)) {
        return typeof value === 'function' ? (value as Function)(path, body) : value;
      }
    }
    return {};
  });
  return { makeRequest, account: { address: '0xTestWallet' } } as MockApiClient;
}

/** Create a mock API that throws on specific routes */
export function mockApiWithErrors(
  routes: Record<string, RouteValue> = {},
  errorRoutes: Record<string, Error> = {},
): MockApiClient {
  const makeRequest = vi.fn().mockImplementation(async (method: string, path: string, body?: Record<string, unknown>) => {
    const key = `${method} ${path}`;
    // Check error routes first
    for (const [pattern, error] of Object.entries(errorRoutes)) {
      const [pMethod, pPath] = pattern.split(' ');
      if (method === pMethod && pPath && (path === pPath || path.startsWith(pPath))) {
        throw error;
      }
    }
    // Normal routes
    if (routes[key] !== undefined) {
      return typeof routes[key] === 'function' ? (routes[key] as Function)(path, body) : routes[key];
    }
    for (const [pattern, value] of Object.entries(routes)) {
      const [pMethod, pPath] = pattern.split(' ');
      if (method === pMethod && pPath && path.startsWith(pPath)) {
        return typeof value === 'function' ? (value as Function)(path, body) : value;
      }
    }
    return {};
  });
  return { makeRequest, account: { address: '0xTestWallet' } } as MockApiClient;
}

export const testConfig: Config = {
  privateKey: '0x' + '1'.repeat(64),
  apiUrl: 'https://test.memoclaw.com',
  configSource: 'test',
  timeout: 5000,
  maxRetries: 0,
  concurrency: 10,
};

/**
 * Type-safe accessor for structuredContent on ToolResult.
 * Replaces `(result.structuredContent as any).field` patterns.
 */
export function structured(result: ToolResult | null | undefined): Record<string, unknown> {
  return (result?.structuredContent ?? {}) as Record<string, unknown>;
}

/**
 * Type-safe accessor for resource_link items in ToolResult content.
 */
export function resourceLinks(result: ToolResult | null | undefined): ResourceLinkContentItem[] {
  return (result?.content ?? []).filter(
    (item): item is ResourceLinkContentItem => item.type === 'resource_link',
  );
}
