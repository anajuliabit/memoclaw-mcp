import { describe, it, expect, vi } from 'vitest';
import { createContext, CancellationError, throwIfCancelled } from '../src/handlers/types.js';
import { handleAdmin } from '../src/handlers/admin.js';
import { handleMemory } from '../src/handlers/memory.js';
import { withConcurrency } from '../src/format.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testConfig = {
  privateKey: '0x0000000000000000000000000000000000000000000000000000000000000001',
  apiUrl: 'http://localhost:9999',
  configSource: 'test' as const,
};

function mockApi(routeResponses: Record<string, any>) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  return {
    makeRequest: vi.fn(async (method: string, path: string, body?: any) => {
      calls.push({ method, path, body });
      const key = `${method} ${path.split('?')[0]}`;
      if (key in routeResponses) {
        const resp = routeResponses[key];
        if (resp instanceof Error) throw resp;
        return typeof resp === 'function' ? resp(method, path, body) : resp;
      }
      return {};
    }),
    account: { address: '0xTEST', privateKey: testConfig.privateKey },
    calls,
  };
}

function makeCtx(routes: Record<string, any> = {}, signal?: AbortSignal) {
  const api = mockApi(routes);
  return { ctx: createContext(api as any, testConfig, undefined, signal), api };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CancellationError & throwIfCancelled', () => {
  it('throwIfCancelled is a no-op when signal is not aborted', () => {
    const ac = new AbortController();
    expect(() => throwIfCancelled(ac.signal)).not.toThrow();
  });

  it('throwIfCancelled throws CancellationError when aborted', () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => throwIfCancelled(ac.signal)).toThrow(CancellationError);
  });
});

describe('withConcurrency respects AbortSignal', () => {
  it('stops processing remaining tasks when signal is aborted', async () => {
    const ac = new AbortController();
    let executed = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      executed++;
      if (i === 2) ac.abort(); // abort after 3rd task
      return i;
    });
    const results = await withConcurrency(tasks, 1, ac.signal);
    // With concurrency=1, tasks run sequentially.
    // Task 2 aborts, so task 3+ should be skipped.
    expect(executed).toBeLessThanOrEqual(4); // at most task 0,1,2 + possibly 3
    expect(results.length).toBeLessThan(10);
  });

  it('completes all tasks when signal is never aborted', async () => {
    const ac = new AbortController();
    const tasks = Array.from({ length: 5 }, (_, i) => async () => i);
    const results = await withConcurrency(tasks, 2, ac.signal);
    expect(results.length).toBe(5);
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  });
});

describe('handler cancellation - delete_namespace', () => {
  it('returns partial results when cancelled mid-operation', async () => {
    const ac = new AbortController();
    let listCallCount = 0;
    const routes: Record<string, any> = {
      'GET /v1/memories': () => {
        listCallCount++;
        // Return a full page to trigger another loop iteration
        return {
          memories: Array.from({ length: 100 }, (_, i) => ({
            id: `mem-${listCallCount}-${i}`,
          })),
        };
      },
    };
    // Mock all possible delete routes — abort after some deletions
    let deleteCount = 0;
    for (let page = 1; page <= 3; page++) {
      for (let i = 0; i < 100; i++) {
        routes[`DELETE /v1/memories/mem-${page}-${i}`] = () => {
          deleteCount++;
          if (deleteCount >= 50) ac.abort(); // abort mid-way through deletes
          return { deleted: true };
        };
      }
    }
    const { ctx } = makeCtx(routes, ac.signal);
    const result = await handleAdmin(ctx, 'memoclaw_delete_namespace', { namespace: 'test-ns' });
    expect(result).not.toBeNull();
    expect(result!.content[0].text).toContain('Cancelled');
    expect(result!.structuredContent?.cancelled).toBe(true);
    // Should have deleted some but not all
    expect(result!.structuredContent?.deleted).toBeGreaterThan(0);
  });
});

describe('handler cancellation - export fallback', () => {
  it('returns partial results when cancelled mid-pagination', async () => {
    const ac = new AbortController();
    let pageCount = 0;
    const routes: Record<string, any> = {
      'GET /v1/export': new Error('404 Not Found'),
      'GET /v1/memories': () => {
        pageCount++;
        if (pageCount === 2) ac.abort();
        return {
          memories: Array.from({ length: 100 }, (_, i) => ({
            id: `mem-${pageCount}-${i}`,
            content: `content ${i}`,
          })),
        };
      },
    };
    const { ctx } = makeCtx(routes, ac.signal);
    const result = await handleAdmin(ctx, 'memoclaw_export', {});
    expect(result).not.toBeNull();
    expect(result!.content[0].text).toContain('cancelled');
    expect(result!.structuredContent?.cancelled).toBe(true);
  });
});

describe('handler cancellation - bulk_delete fallback', () => {
  it('returns partial results when cancelled', async () => {
    const ac = new AbortController();
    let deleteCount = 0;
    const routes: Record<string, any> = {
      'POST /v1/memories/bulk-delete': new Error('Server error'),
    };
    // Add individual delete routes
    for (let i = 0; i < 5; i++) {
      routes[`DELETE /v1/memories/id-${i}`] = () => {
        deleteCount++;
        if (deleteCount >= 2) ac.abort();
        return { deleted: true };
      };
    }
    const { ctx } = makeCtx(routes, ac.signal);
    const result = await handleMemory(ctx, 'memoclaw_bulk_delete', {
      ids: ['id-0', 'id-1', 'id-2', 'id-3', 'id-4'],
    });
    expect(result).not.toBeNull();
    // Should have partial results
    expect(result!.structuredContent?.succeeded).toBeGreaterThanOrEqual(1);
  });
});

describe('signal defaults to non-aborted when not provided', () => {
  it('createContext provides a usable default signal', () => {
    const api = mockApi({});
    const ctx = createContext(api as any, testConfig);
    expect(ctx.signal).toBeDefined();
    expect(ctx.signal.aborted).toBe(false);
  });
});
