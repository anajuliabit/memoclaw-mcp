import { vi } from 'vitest';
import type { Config } from '../../src/config.js';

/** Create a mock API client with configurable route responses */
export function mockApi(routes: Record<string, any> = {}) {
  const makeRequest = vi.fn().mockImplementation(async (method: string, path: string, body?: any) => {
    const key = `${method} ${path}`;
    // Exact match first
    if (routes[key] !== undefined) {
      return typeof routes[key] === 'function' ? routes[key](path, body) : routes[key];
    }
    // Prefix match
    for (const [pattern, value] of Object.entries(routes)) {
      const [pMethod, pPath] = pattern.split(' ');
      if (method === pMethod && pPath && path.startsWith(pPath)) {
        return typeof value === 'function' ? value(path, body) : value;
      }
    }
    return {};
  });
  return { makeRequest, account: { address: '0xTestWallet' } };
}

/** Create a mock API that throws on specific routes */
export function mockApiWithErrors(routes: Record<string, any> = {}, errorRoutes: Record<string, Error> = {}) {
  const makeRequest = vi.fn().mockImplementation(async (method: string, path: string, body?: any) => {
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
      return typeof routes[key] === 'function' ? routes[key](path, body) : routes[key];
    }
    for (const [pattern, value] of Object.entries(routes)) {
      const [pMethod, pPath] = pattern.split(' ');
      if (method === pMethod && pPath && path.startsWith(pPath)) {
        return typeof value === 'function' ? value(path, body) : value;
      }
    }
    return {};
  });
  return { makeRequest, account: { address: '0xTestWallet' } };
}

export const testConfig: Config = {
  privateKey: '0x' + '1'.repeat(64),
  apiUrl: 'https://test.memoclaw.com',
  configSource: 'test',
  timeout: 5000,
  maxRetries: 0,
};
