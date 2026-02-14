/**
 * Tests for MemoClaw MCP server tool definitions and handler dispatch.
 * Mock fetch globally to avoid real API calls.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

process.env.MEMOCLAW_PRIVATE_KEY =
  '0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb';
process.env.MEMOCLAW_URL = 'https://test.memoclaw.com';

// Mock MCP SDK
const mockSetRequestHandler = vi.fn();
const mockConnect = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class MockServer {
    setRequestHandler = mockSetRequestHandler;
    connect = mockConnect;
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  CallToolRequestSchema: 'CallToolRequestSchema',
}));

vi.mock('@x402/core/client', () => ({
  x402Client: vi.fn().mockImplementation(() => ({ register: vi.fn().mockReturnThis() })),
}));
vi.mock('@x402/core/http', () => ({ x402HTTPClient: vi.fn() }));
vi.mock('@x402/evm/exact/client', () => ({ ExactEvmScheme: vi.fn() }));
vi.mock('@x402/evm', () => ({ toClientEvmSigner: vi.fn() }));
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    address: '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23',
    signMessage: vi.fn().mockResolvedValue('0xmocksig'),
  }),
}));

await import('../src/index.js');

// Extract handlers
let listToolsHandler: () => Promise<any>;
let callToolHandler: (req: any) => Promise<any>;

beforeAll(() => {
  for (const call of mockSetRequestHandler.mock.calls) {
    if (call[0] === 'ListToolsRequestSchema') listToolsHandler = call[1];
    if (call[0] === 'CallToolRequestSchema') callToolHandler = call[1];
  }
});

// Helper to create a mock fetch response
function mockFetchOk(data: any) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers(),
  });
}

function mockFetchError(status: number, text: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ error: text }),
    text: () => Promise.resolve(text),
    headers: new Headers(),
  });
}

describe('Tool Definitions', () => {
  it('registers both handlers', () => {
    expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
  });

  it('exposes all expected tools', async () => {
    const result = await listToolsHandler();
    const names = result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'memoclaw_store', 'memoclaw_recall', 'memoclaw_get', 'memoclaw_list',
      'memoclaw_delete', 'memoclaw_bulk_delete', 'memoclaw_update',
      'memoclaw_status', 'memoclaw_ingest', 'memoclaw_extract',
      'memoclaw_consolidate', 'memoclaw_suggested',
      'memoclaw_create_relation', 'memoclaw_list_relations', 'memoclaw_delete_relation',
      'memoclaw_export', 'memoclaw_namespaces', 'memoclaw_tags',
      'memoclaw_bulk_store', 'memoclaw_stats', 'memoclaw_import', 'memoclaw_graph',
      'memoclaw_batch_recall',
    ]));
  });

  it('has 23 tools total (22 original + batch_recall)', async () => {
    const result = await listToolsHandler();
    expect(result.tools).toHaveLength(23);
  });

  it('store requires content', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_store');
    expect(tool.inputSchema.required).toContain('content');
  });

  it('recall requires query', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_recall');
    expect(tool.inputSchema.required).toContain('query');
  });

  it('get requires id', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_get');
    expect(tool.inputSchema.required).toContain('id');
  });

  it('delete requires id', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_delete');
    expect(tool.inputSchema.required).toContain('id');
  });

  it('bulk_delete requires ids', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_bulk_delete');
    expect(tool.inputSchema.required).toContain('ids');
  });

  it('update requires id', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_update');
    expect(tool.inputSchema.required).toContain('id');
  });

  it('create_relation requires memory_id, target_id, relation_type', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_create_relation');
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(['memory_id', 'target_id', 'relation_type'])
    );
  });

  it('all tools have descriptions', async () => {
    const result = await listToolsHandler();
    for (const tool of result.tools) {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('all tool descriptions mention what the tool does', async () => {
    const result = await listToolsHandler();
    for (const tool of result.tools) {
      // Each description should be substantial
      expect(tool.description.split(' ').length).toBeGreaterThan(5);
    }
  });

  it('all properties have descriptions', async () => {
    const result = await listToolsHandler();
    for (const tool of result.tools) {
      const props = tool.inputSchema.properties || {};
      for (const [key, prop] of Object.entries(props) as [string, any][]) {
        expect(prop.description, `${tool.name}.${key} missing description`).toBeTruthy();
      }
    }
  });
});

describe('Tool Handlers', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('unknown tool returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_nonexistent', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
  });

  it('store with empty content returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: '' } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('content is required');
  });

  it('recall with empty query returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_recall', arguments: { query: '' } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('query is required');
  });

  it('store sends correct request', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '123', content: 'test' } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test memory', importance: 0.8, tags: ['a'] } },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Memory stored');
    // Verify fetch was called with correct body
    const call = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.content).toBe('test memory');
    expect(body.importance).toBe(0.8);
    expect(body.tags).toEqual(['a']);
  });

  it('recall returns formatted results', async () => {
    globalThis.fetch = mockFetchOk({
      memories: [
        { id: '1', content: 'hello world', similarity: 0.95, tags: ['test'] },
        { id: '2', content: 'goodbye', similarity: 0.7 },
      ],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_recall', arguments: { query: 'hello' } },
    });
    expect(result.content[0].text).toContain('Found 2 memories');
    expect(result.content[0].text).toContain('hello world');
    expect(result.content[0].text).toContain('0.950');
  });

  it('recall with no results', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_recall', arguments: { query: 'nonexistent' } },
    });
    expect(result.content[0].text).toContain('No memories found');
  });

  it('get fetches single memory', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: 'abc', content: 'test' } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_get', arguments: { id: 'abc' } },
    });
    expect(result.content[0].text).toContain('test');
    const url = (globalThis.fetch as any).mock.calls[0][0];
    expect(url).toContain('/v1/memories/abc');
  });

  it('get without id returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_get', arguments: {} },
    });
    expect(result.isError).toBe(true);
  });

  it('list builds correct query params', async () => {
    globalThis.fetch = mockFetchOk({ memories: [], total: 0 });
    await callToolHandler({
      params: { name: 'memoclaw_list', arguments: { limit: 10, offset: 5, namespace: 'work', tags: ['a', 'b'] } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('limit=10');
    expect(url).toContain('offset=5');
    expect(url).toContain('namespace=work');
    expect(url).toContain('tags=a%2Cb');
  });

  it('delete sends DELETE request', async () => {
    globalThis.fetch = mockFetchOk({ deleted: true });
    const result = await callToolHandler({
      params: { name: 'memoclaw_delete', arguments: { id: 'xyz' } },
    });
    expect(result.content[0].text).toContain('deleted');
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe('DELETE');
    expect(call[0]).toContain('/v1/memories/xyz');
  });

  it('bulk_delete with empty ids returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_delete', arguments: { ids: [] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('non-empty array');
  });

  it('bulk_delete with >100 ids returns error', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_delete', arguments: { ids } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Maximum 100');
  });

  it('bulk_delete succeeds', async () => {
    globalThis.fetch = mockFetchOk({ deleted: true });
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_delete', arguments: { ids: ['a', 'b', 'c'] } },
    });
    expect(result.content[0].text).toContain('3 succeeded');
  });

  it('bulk_delete reports partial failures', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve({
          ok: false, status: 404,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('not found'),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ deleted: true }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_delete', arguments: { ids: ['a', 'b', 'c'] } },
    });
    expect(result.content[0].text).toContain('2 succeeded');
    expect(result.content[0].text).toContain('1 failed');
  });

  it('status formats output correctly', async () => {
    globalThis.fetch = mockFetchOk({ wallet: '0xabc', free_tier_remaining: 750, free_tier_total: 1000 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_status', arguments: {} },
    });
    expect(result.content[0].text).toContain('750/1000');
    expect(result.content[0].text).toContain('75%');
  });

  it('ingest requires messages or text', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_ingest', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Either messages or text');
  });

  it('ingest with text succeeds', async () => {
    globalThis.fetch = mockFetchOk({ memories_created: 3 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_ingest', arguments: { text: 'some notes to ingest' } },
    });
    expect(result.content[0].text).toContain('3 memories created');
  });

  it('extract requires non-empty messages', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_extract', arguments: { messages: [] } },
    });
    expect(result.isError).toBe(true);
  });

  it('consolidate with dry_run shows preview label', async () => {
    globalThis.fetch = mockFetchOk({ clusters: 2, merged: 0 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_consolidate', arguments: { dry_run: true } },
    });
    expect(result.content[0].text).toContain('dry run');
  });

  it('consolidate without dry_run shows complete label', async () => {
    globalThis.fetch = mockFetchOk({ clusters: 2, merged: 5 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_consolidate', arguments: {} },
    });
    expect(result.content[0].text).toContain('Consolidation complete');
  });

  it('update sends PATCH with only provided fields', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '123', content: 'updated' } });
    await callToolHandler({
      params: { name: 'memoclaw_update', arguments: { id: '123', content: 'updated', importance: 0.9 } },
    });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe('PATCH');
    const body = JSON.parse(call[1].body);
    expect(body.content).toBe('updated');
    expect(body.importance).toBe(0.9);
    expect(body.id).toBeUndefined(); // id should not be in body
  });

  it('create_relation validates required fields', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_create_relation', arguments: { memory_id: 'a' } },
    });
    expect(result.isError).toBe(true);
  });

  it('create_relation sends correct request', async () => {
    globalThis.fetch = mockFetchOk({ relation: { id: 'r1' } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_create_relation', arguments: { memory_id: 'a', target_id: 'b', relation_type: 'supersedes' } },
    });
    expect(result.content[0].text).toContain('supersedes');
    expect(result.content[0].text).toContain('a');
  });

  it('export paginates and returns all memories', async () => {
    let callNum = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callNum++;
      // First call returns 100 items, second returns 50 (end)
      const count = callNum === 1 ? 100 : 50;
      const memories = Array.from({ length: count }, (_, i) => ({ id: `m${i}`, content: `memory ${i}` }));
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memories }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_export', arguments: {} },
    });
    expect(result.content[0].text).toContain('Exported 150 memories');
  });

  it('export with jsonl format', async () => {
    globalThis.fetch = mockFetchOk({ memories: [{ id: '1', content: 'a' }, { id: '2', content: 'b' }] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_export', arguments: { format: 'jsonl' } },
    });
    const lines = result.content[0].text.split('\n').filter((l: string) => l.startsWith('{'));
    expect(lines.length).toBe(2);
  });

  it('handles HTTP errors gracefully', async () => {
    globalThis.fetch = mockFetchError(500, 'Internal Server Error');
    const result = await callToolHandler({
      params: { name: 'memoclaw_status', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('500');
  });

  it('suggested builds query params correctly', async () => {
    globalThis.fetch = mockFetchOk({ suggestions: [] });
    await callToolHandler({
      params: { name: 'memoclaw_suggested', arguments: { category: 'stale', limit: 5 } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('category=stale');
    expect(url).toContain('limit=5');
  });

  it('delete_relation validates required fields', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_delete_relation', arguments: { memory_id: 'a' } },
    });
    expect(result.isError).toBe(true);
  });

  it('list_relations validates memory_id', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_list_relations', arguments: {} },
    });
    expect(result.isError).toBe(true);
  });

  it('namespaces returns formatted list', async () => {
    globalThis.fetch = mockFetchOk({ 
      memories: [
        { id: '1', namespace: 'work' },
        { id: '2', namespace: 'work' },
        { id: '3', namespace: 'personal' },
      ] 
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_namespaces', arguments: {} },
    });
    expect(result.content[0].text).toContain('2 namespaces');
    expect(result.content[0].text).toContain('work');
    expect(result.content[0].text).toContain('personal');
  });

  it('namespaces with no namespaces returns default message', async () => {
    globalThis.fetch = mockFetchOk({ memories: [{ id: '1' }, { id: '2' }] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_namespaces', arguments: {} },
    });
    expect(result.content[0].text).toContain('default');
  });

  it('tags returns formatted list with counts', async () => {
    globalThis.fetch = mockFetchOk({ 
      memories: [
        { id: '1', tags: ['important', 'work'] },
        { id: '2', tags: ['important'] },
        { id: '3', tags: ['work'] },
      ] 
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_tags', arguments: {} },
    });
    expect(result.content[0].text).toContain('2 unique tags');
    expect(result.content[0].text).toContain('important (2)');
    expect(result.content[0].text).toContain('work (2)');
  });

  it('tags with no tags returns empty message', async () => {
    globalThis.fetch = mockFetchOk({ memories: [{ id: '1' }] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_tags', arguments: {} },
    });
    expect(result.content[0].text).toContain('No tags found');
  });

  it('bulk_store validates memories array', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('non-empty array');
  });

  it('bulk_store validates max 50 items', async () => {
    const memories = Array.from({ length: 51 }, (_, i) => ({ content: `memory ${i}` }));
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: { memories } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Maximum 50');
  });

  it('bulk_store validates each memory has content', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: { memories: [{ content: '' }, { content: 'valid' }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('content is required');
  });

  it('bulk_store succeeds with valid memories', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memory: { id: `m${callCount}`, content: `memory ${callCount}` } }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });
    const result = await callToolHandler({
      params: { 
        name: 'memoclaw_bulk_store', 
        arguments: { 
          memories: [
            { content: 'memory 1', importance: 0.8 },
            { content: 'memory 2', tags: ['test'] }
          ] 
        } 
      },
    });
    expect(result.content[0].text).toContain('2 of 2 memories created');
    expect(callCount).toBe(2);
  });

  it('bulk_store reports partial failures', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 2) {
        return Promise.resolve({
          ok: false, status: 500,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('server error'),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memory: { id: `m${callCount}`, content: `memory ${callCount}` } }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });
    const result = await callToolHandler({
      params: { 
        name: 'memoclaw_bulk_store', 
        arguments: { memories: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] } 
      },
    });
    expect(result.content[0].text).toContain('2 of 3 memories created');
  });

  it('stats returns formatted statistics', async () => {
    globalThis.fetch = mockFetchOk({ 
      memories: [
        { id: '1', importance: 0.9, memory_type: 'decision', namespace: 'work', pinned: true },
        { id: '2', importance: 0.3, memory_type: 'observation', namespace: 'work' },
        { id: '3', importance: 0.7, memory_type: 'preference', namespace: 'personal' },
      ] 
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_stats', arguments: {} },
    });
    expect(result.content[0].text).toContain('Total memories: 3');
    expect(result.content[0].text).toContain('Pinned: 1');
    expect(result.content[0].text).toContain('decision: 1');
    expect(result.content[0].text).toContain('work: 2');
  });

  it('stats with namespace filter shows namespace in output', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_stats', arguments: { namespace: 'work' } },
    });
    expect(result.content[0].text).toContain('(work)');
  });

  // Tests for new import tool
  it('import requires memories array', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('non-empty array');
  });

  it('import validates max 200 items', async () => {
    const memories = Array.from({ length: 201 }, (_, i) => ({ content: `memory ${i}` }));
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Maximum 200');
  });

  it('import validates each memory has content', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories: [{ content: '' }, { content: 'valid' }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('content is required');
  });

  it('import succeeds with valid memories', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memory: { id: `m${callCount}`, content: `memory ${callCount}` } }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });
    const result = await callToolHandler({
      params: { 
        name: 'memoclaw_import', 
        arguments: { 
          memories: [
            { content: 'memory 1', importance: 0.8 },
            { content: 'memory 2', tags: ['test'] }
          ] 
        } 
      },
    });
    expect(result.content[0].text).toContain('2 of 2 memories imported');
    expect(callCount).toBe(2);
  });

  it('import with namespace override applies to all memories', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: 'm1', content: 'test' } });
    await callToolHandler({
      params: { 
        name: 'memoclaw_import', 
        arguments: { 
          memories: [{ content: 'test' }],
          namespace: 'work'
        } 
      },
    });
    const call = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.namespace).toBe('work');
  });

  // Tests for new graph tool
  it('graph requires memory_id', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_graph', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('memory_id is required');
  });

  it('graph fetches related memories', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      // First call: get relations for starting memory
      if (callCount === 1) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ relations: [{ source_id: 'm1', target_id: 'm2', relation_type: 'supersedes' }] }),
          text: () => Promise.resolve(''),
          headers: new Headers(),
        });
      } else if (callCount === 2) {
        // Second call: get related memory m2
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ memory: { id: 'm2', content: 'new version' } }),
          text: () => Promise.resolve(''),
          headers: new Headers(),
        });
      } else if (callCount === 3) {
        // Third call: get relations for m2 (depth 2)
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ relations: [] }),
          text: () => Promise.resolve(''),
          headers: new Headers(),
        });
      } else {
        // Any additional calls
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ relations: [] }),
          text: () => Promise.resolve(''),
          headers: new Headers(),
        });
      }
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_graph', arguments: { memory_id: 'm1', depth: 2 } },
    });
    expect(result.content[0].text).toContain('related memories');
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it('graph with no related memories returns appropriate message', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memory: { id: 'm1', content: 'solo' }, relations: [] }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_graph', arguments: { memory_id: 'm1' } },
    });
    expect(result.content[0].text).toContain('No related memories found');
  });

  // Additional edge case tests

  it('import validates memories array', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('non-empty array');
  });

  it('import validates max 200 items', async () => {
    const memories = Array.from({ length: 201 }, (_, i) => ({ content: `memory ${i}` }));
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Maximum 200');
  });

  it('import validates each memory has content', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories: [{ content: '' }, { content: 'valid' }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('content is required');
  });

  it('import passes skip_duplicates to API', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test' } });
    await callToolHandler({
      params: { 
        name: 'memoclaw_import', 
        arguments: { 
          memories: [{ content: 'test memory' }],
          skip_duplicates: true 
        } 
      },
    });
    const call = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.skip_duplicates).toBe(true);
  });

  it('import uses provided namespace for all memories when no override', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test' } });
    await callToolHandler({
      params: { 
        name: 'memoclaw_import', 
        arguments: { 
          memories: [{ content: 'test1' }, { content: 'test2' }],
          namespace: 'imported'
        } 
      },
    });
    const calls = (globalThis.fetch as any).mock.calls;
    const body1 = JSON.parse(calls[0][1].body);
    const body2 = JSON.parse(calls[1][1].body);
    // Both should use the import-level namespace
    expect(body1.namespace).toBe('imported');
    expect(body2.namespace).toBe('imported');
  });

  it('consolidate passes dry_run parameter', async () => {
    globalThis.fetch = mockFetchOk({ merged: [] });
    await callToolHandler({
      params: { name: 'memoclaw_consolidate', arguments: { dry_run: true, min_similarity: 0.9 } },
    });
    const call = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.dry_run).toBe(true);
    expect(body.min_similarity).toBe(0.9);
  });

  it('create_relation validates all required fields', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_create_relation', arguments: { memory_id: 'a', target_id: 'b' } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('relation_type');
  });

  it('update requires id field', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_update', arguments: { content: 'new content' } },
    });
    expect(result.isError).toBe(true);
  });

  it('list validates tags is array', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    await callToolHandler({
      params: { name: 'memoclaw_list', arguments: { tags: 'not-an-array' } },
    });
    // Should handle gracefully - tags should be array but we don't error
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    // If tags is not array, it won't be added to params
    expect(url).not.toContain('tags=');
  });

  // Tests for batch_recall tool
  it('batch_recall requires queries array', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_batch_recall', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('queries is required');
  });

  it('batch_recall validates max 10 queries', async () => {
    const queries = Array.from({ length: 11 }, (_, i) => ({ query: `query ${i}` }));
    const result = await callToolHandler({
      params: { name: 'memoclaw_batch_recall', arguments: { queries } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Maximum 10');
  });

  it('batch_recall validates each query has content', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_batch_recall', arguments: { queries: [{ query: '' }, { query: 'valid' }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('query is required');
  });

  it('batch_recall executes multiple queries in parallel', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memories: [{ id: `m${callCount}`, content: `result for query ${callCount}`, similarity: 0.9 }] }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });
    const result = await callToolHandler({
      params: { 
        name: 'memoclaw_batch_recall', 
        arguments: { 
          queries: [
            { query: 'user preferences' },
            { query: 'recent decisions' },
            { query: 'project notes' }
          ]
        } 
      },
    });
    expect(result.content[0].text).toContain('Batch recall');
    expect(result.content[0].text).toContain('3 queries');
    expect(callCount).toBe(3);
  });

  it('batch_recall respects per-query limit and min_similarity', async () => {
    globalThis.fetch = mockFetchOk({ memories: [{ id: '1', content: 'test' }] });
    await callToolHandler({
      params: { 
        name: 'memoclaw_batch_recall', 
        arguments: { 
          queries: [{ query: 'test', limit: 5, min_similarity: 0.7 }],
          namespace: 'work'
        } 
      },
    });
    const call = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.query).toBe('test');
    expect(body.limit).toBe(5);
    expect(body.min_similarity).toBe(0.7);
    expect(body.namespace).toBe('work');
  });
});

// Import afterEach for cleanup
import { afterEach } from 'vitest';
