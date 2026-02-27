/**
 * Tests for MemoClaw MCP server tool definitions and handler dispatch.
 * Mock fetch globally to avoid real API calls.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';

process.env.MEMOCLAW_PRIVATE_KEY =
  '0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb';
process.env.MEMOCLAW_URL = 'https://test.memoclaw.com';
process.env.MEMOCLAW_TIMEOUT = '5000';
process.env.MEMOCLAW_MAX_RETRIES = '0';

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
  ListResourcesRequestSchema: 'ListResourcesRequestSchema',
  ListResourceTemplatesRequestSchema: 'ListResourceTemplatesRequestSchema',
  ReadResourceRequestSchema: 'ReadResourceRequestSchema',
  ListPromptsRequestSchema: 'ListPromptsRequestSchema',
  GetPromptRequestSchema: 'GetPromptRequestSchema',
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

// ─── Tool Definitions ────────────────────────────────────────────────────────

describe('Tool Definitions', () => {
  it('registers both handlers', () => {
    expect(mockSetRequestHandler).toHaveBeenCalledTimes(7);
  });

  it('exposes all expected tools', async () => {
    const result = await listToolsHandler();
    const names = result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'memoclaw_store', 'memoclaw_recall', 'memoclaw_search', 'memoclaw_get', 'memoclaw_list',
      'memoclaw_delete', 'memoclaw_bulk_delete', 'memoclaw_update',
      'memoclaw_status', 'memoclaw_ingest', 'memoclaw_extract',
      'memoclaw_consolidate', 'memoclaw_suggested',
      'memoclaw_create_relation', 'memoclaw_list_relations', 'memoclaw_delete_relation',
      'memoclaw_export', 'memoclaw_import', 'memoclaw_bulk_store', 'memoclaw_count',
      'memoclaw_delete_namespace', 'memoclaw_graph', 'memoclaw_pin', 'memoclaw_unpin',
      'memoclaw_namespaces',
      'memoclaw_tags',
      'memoclaw_history',
      'memoclaw_context',
      'memoclaw_batch_update',
      'memoclaw_core_memories',
      'memoclaw_stats',
    ]));
  });

  it('has 33 tools total', async () => {
    const result = await listToolsHandler();
    expect(result.tools).toHaveLength(33);
  });

  it('every tool has annotations with all required hints', async () => {
    const result = await listToolsHandler();
    for (const tool of result.tools) {
      expect(tool.annotations, `${tool.name} missing annotations`).toBeDefined();
      expect(typeof tool.annotations.title).toBe('string');
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations.destructiveHint).toBe('boolean');
      expect(typeof tool.annotations.idempotentHint).toBe('boolean');
      expect(typeof tool.annotations.openWorldHint).toBe('boolean');
    }
  });

  it('read-only tools are marked readOnlyHint=true', async () => {
    const result = await listToolsHandler();
    const readOnlyTools = ['memoclaw_recall', 'memoclaw_search', 'memoclaw_get', 'memoclaw_list',
      'memoclaw_status', 'memoclaw_suggested', 'memoclaw_list_relations', 'memoclaw_export',
      'memoclaw_count', 'memoclaw_init', 'memoclaw_graph', 'memoclaw_tags', 'memoclaw_history',
      'memoclaw_namespaces', 'memoclaw_context', 'memoclaw_core_memories', 'memoclaw_stats'];
    for (const name of readOnlyTools) {
      const tool = result.tools.find((t: any) => t.name === name);
      expect(tool?.annotations?.readOnlyHint, `${name} should be readOnly`).toBe(true);
    }
  });

  it('destructive tools are marked destructiveHint=true', async () => {
    const result = await listToolsHandler();
    const destructiveTools = ['memoclaw_delete', 'memoclaw_bulk_delete',
      'memoclaw_delete_relation', 'memoclaw_delete_namespace', 'memoclaw_consolidate'];
    for (const name of destructiveTools) {
      const tool = result.tools.find((t: any) => t.name === name);
      expect(tool?.annotations?.destructiveHint, `${name} should be destructive`).toBe(true);
    }
  });

  it('delete_namespace requires namespace', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_delete_namespace');
    expect(tool).toBeDefined();
    expect(tool.inputSchema.required).toContain('namespace');
  });

  it('store requires content', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_store');
    expect(tool.inputSchema.required).toContain('content');
  });

  it('store tool has immutable property', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_store');
    expect(tool.inputSchema.properties.immutable).toBeDefined();
    expect(tool.inputSchema.properties.immutable.type).toBe('boolean');
  });

  it('recall requires query', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_recall');
    expect(tool.inputSchema.required).toContain('query');
  });

  it('search requires query', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_search');
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

  it('import requires memories', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_import');
    expect(tool.inputSchema.required).toContain('memories');
  });

  it('graph requires memory_id', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_graph');
    expect(tool.inputSchema.required).toContain('memory_id');
  });

  it('context requires query', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_context');
    expect(tool).toBeDefined();
    expect(tool.inputSchema.required).toContain('query');
  });

  it('search has after filter', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_search');
    expect(tool.inputSchema.properties.after).toBeDefined();
  });

  it('list has after filter', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_list');
    expect(tool.inputSchema.properties.after).toBeDefined();
  });

  it('list has memory_type filter', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_list');
    expect(tool.inputSchema.properties.memory_type).toBeDefined();
    expect(tool.inputSchema.properties.memory_type.enum).toBeDefined();
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

// ─── Tool Handlers ───────────────────────────────────────────────────────────

describe('Tool Handlers', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // --- Error handling ---

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

  it('store with whitespace-only content returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: '   ' } },
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

  it('handles HTTP errors gracefully', async () => {
    globalThis.fetch = mockFetchError(500, 'Internal Server Error');
    const result = await callToolHandler({
      params: { name: 'memoclaw_status', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('500');
  });

  // --- Store ---

  it('store sends correct request', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '123', content: 'test' } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test memory', importance: 0.8, tags: ['a'] } },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Memory stored');
    const call = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.content).toBe('test memory');
    expect(body.importance).toBe(0.8);
    expect(body.tags).toEqual(['a']);
  });

  it('store sends importance=0 correctly (not dropped as falsy)', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test', importance: 0 } });
    await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test', importance: 0 } },
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.importance).toBe(0);
  });

  it('store rejects content exceeding 8192 chars', async () => {
    const longContent = 'x'.repeat(8193);
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: longContent } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('8192 character limit');
    expect(result.content[0].text).toContain('8193');
  });

  it('store accepts content at exactly 8192 chars', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'ok' } });
    const exactContent = 'x'.repeat(8192);
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: exactContent } },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Memory stored');
  });

  it('store rejects importance > 1', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test', importance: 1.5 } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('between 0.0 and 1.0');
  });

  it('store rejects importance < 0', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test', importance: -0.1 } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('between 0.0 and 1.0');
  });

  it('store accepts importance=0 (boundary)', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test', importance: 0 } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test', importance: 0 } },
    });
    expect(result.isError).toBeUndefined();
  });

  it('store accepts importance=1 (boundary)', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test', importance: 1 } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test', importance: 1 } },
    });
    expect(result.isError).toBeUndefined();
  });

  it('store sends pinned=false correctly', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test' } });
    await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test', pinned: false } },
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.pinned).toBe(false);
  });

  it('store sends immutable=true correctly', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test', immutable: true } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test', immutable: true } },
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.immutable).toBe(true);
    expect(result.content[0].text).toContain('🔒 immutable');
  });

  it('store does not send immutable when not provided', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test' } });
    await callToolHandler({
      params: { name: 'memoclaw_store', arguments: { content: 'test' } },
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.immutable).toBeUndefined();
  });

  // --- Recall ---

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

  it('recall handles non-numeric similarity gracefully', async () => {
    globalThis.fetch = mockFetchOk({
      memories: [{ id: '1', content: 'test', similarity: 'high' }],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_recall', arguments: { query: 'test' } },
    });
    expect(result.content[0].text).toContain('similarity: high');
    expect(result.isError).toBeUndefined();
  });

  it('recall passes filters correctly', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    await callToolHandler({
      params: { name: 'memoclaw_recall', arguments: { query: 'test', tags: ['a'], memory_type: 'decision', after: '2025-01-01T00:00:00Z', namespace: 'work' } },
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.filters.tags).toEqual(['a']);
    expect(body.filters.memory_type).toBe('decision');
    expect(body.filters.after).toBe('2025-01-01T00:00:00Z');
    expect(body.namespace).toBe('work');
  });

  // --- Search (keyword) ---

  it('search requires query', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_search', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('query is required');
  });

  it('search with empty query returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_search', arguments: { query: '' } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('query is required');
  });

  it('search returns formatted results', async () => {
    globalThis.fetch = mockFetchOk({
      memories: [
        { id: '1', content: 'Python is great', tags: ['tech'] },
        { id: '2', content: 'Python tutorial', tags: ['learning'] },
      ],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_search', arguments: { query: 'python' } },
    });
    expect(result.content[0].text).toContain('Found 2 memories containing "python"');
    expect(result.content[0].text).toContain('Python is great');
    expect(result.content[0].text).toContain('Python tutorial');
  });

  it('search with no results', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_search', arguments: { query: 'nonexistent' } },
    });
    expect(result.content[0].text).toContain('No memories found containing');
  });

  it('search builds correct query params', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    await callToolHandler({
      params: { name: 'memoclaw_search', arguments: { query: 'test', limit: 10, namespace: 'work', tags: ['a', 'b'], memory_type: 'decision' } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('q=test');
    expect(url).toContain('limit=10');
    expect(url).toContain('namespace=work');
    expect(url).toContain('tags=a%2Cb');
    expect(url).toContain('memory_type=decision');
  });

  it('search passes after filter', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    await callToolHandler({
      params: { name: 'memoclaw_search', arguments: { query: 'test', after: '2025-06-01T00:00:00Z' } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('after=2025-06-01');
  });

  // --- Get ---

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

  // --- List ---

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

  it('list passes after filter', async () => {
    globalThis.fetch = mockFetchOk({ memories: [], total: 0 });
    await callToolHandler({
      params: { name: 'memoclaw_list', arguments: { after: '2025-06-01T00:00:00Z' } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('after=2025-06-01');
  });

  it('list passes memory_type filter', async () => {
    globalThis.fetch = mockFetchOk({ memories: [], total: 0 });
    await callToolHandler({
      params: { name: 'memoclaw_list', arguments: { memory_type: 'decision' } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('memory_type=decision');
  });

  it('list formats memories in output', async () => {
    globalThis.fetch = mockFetchOk({ memories: [{ id: '1', content: 'hello', tags: ['x'] }], total: 1 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_list', arguments: {} },
    });
    expect(result.content[0].text).toContain('Showing 1 of 1');
    expect(result.content[0].text).toContain('📝 hello');
  });

  // --- Delete ---

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

  it('delete without id returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_delete', arguments: {} },
    });
    expect(result.isError).toBe(true);
  });

  // --- Bulk Delete ---

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

  it('bulk_delete succeeds via bulk endpoint', async () => {
    globalThis.fetch = mockFetchOk({ deleted: 3 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_delete', arguments: { ids: ['a', 'b', 'c'] } },
    });
    expect(result.content[0].text).toContain('3 succeeded');
  });

  it('bulk_delete reports partial failures from bulk endpoint', async () => {
    globalThis.fetch = mockFetchOk({
      deleted: 2,
      failed: [{ id: 'b', error: 'not found' }],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_delete', arguments: { ids: ['a', 'b', 'c'] } },
    });
    expect(result.content[0].text).toContain('2 succeeded');
    expect(result.content[0].text).toContain('1 failed');
  });

  it('bulk_delete falls back to one-by-one on endpoint error', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      // First call is bulk endpoint — fail it
      if (callCount === 1) {
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
      params: { name: 'memoclaw_bulk_delete', arguments: { ids: ['a', 'b'] } },
    });
    expect(result.content[0].text).toContain('2 succeeded');
  });

  // --- Status ---

  it('status formats output correctly', async () => {
    globalThis.fetch = mockFetchOk({ wallet: '0xabc', free_tier_remaining: 750, free_tier_total: 1000 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_status', arguments: {} },
    });
    expect(result.content[0].text).toContain('750/1000');
    expect(result.content[0].text).toContain('75%');
  });

  it('status handles missing fields', async () => {
    globalThis.fetch = mockFetchOk({});
    const result = await callToolHandler({
      params: { name: 'memoclaw_status', arguments: {} },
    });
    expect(result.content[0].text).toContain('unknown');
  });

  // --- Ingest ---

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

  // --- Extract ---

  it('extract requires non-empty messages', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_extract', arguments: { messages: [] } },
    });
    expect(result.isError).toBe(true);
  });

  // --- Consolidate ---

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

  // --- Update ---

  it('update sends PATCH with only allowed fields', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '123', content: 'updated' } });
    await callToolHandler({
      params: { name: 'memoclaw_update', arguments: { id: '123', content: 'updated', importance: 0.9 } },
    });
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[1].method).toBe('PATCH');
    const body = JSON.parse(call[1].body);
    expect(body.content).toBe('updated');
    expect(body.importance).toBe(0.9);
    expect(body.id).toBeUndefined();
  });

  it('update rejects content exceeding 8192 chars', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_update', arguments: { id: '123', content: 'z'.repeat(8193) } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('8192 character limit');
  });

  it('update rejects importance > 1', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_update', arguments: { id: '123', importance: 2.0 } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('between 0.0 and 1.0');
  });

  it('update rejects unknown fields', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_update', arguments: { id: '123', unknown_field: 'bad' } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No valid update fields');
  });

  it('update sends immutable field', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '123', content: 'locked', immutable: true } });
    await callToolHandler({
      params: { name: 'memoclaw_update', arguments: { id: '123', immutable: true } },
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.immutable).toBe(true);
  });

  it('update without id returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_update', arguments: { content: 'new' } },
    });
    expect(result.isError).toBe(true);
  });

  it('update formats response with memory details', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '123', content: 'updated', tags: ['a'] } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_update', arguments: { id: '123', content: 'updated' } },
    });
    expect(result.content[0].text).toContain('📝 updated');
  });

  // --- Relations ---

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

  it('list_relations returns formatted relations', async () => {
    globalThis.fetch = mockFetchOk({ relations: [
      { id: 'r1', source_id: 'a', target_id: 'b', relation_type: 'supersedes' },
    ]});
    const result = await callToolHandler({
      params: { name: 'memoclaw_list_relations', arguments: { memory_id: 'a' } },
    });
    expect(result.content[0].text).toContain('supersedes');
    expect(result.content[0].text).toContain('r1');
  });

  it('list_relations with no relations', async () => {
    globalThis.fetch = mockFetchOk({ relations: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_list_relations', arguments: { memory_id: 'a' } },
    });
    expect(result.content[0].text).toContain('No relations found');
  });

  it('list_relations validates memory_id', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_list_relations', arguments: {} },
    });
    expect(result.isError).toBe(true);
  });

  it('delete_relation succeeds', async () => {
    globalThis.fetch = mockFetchOk({ deleted: true });
    const result = await callToolHandler({
      params: { name: 'memoclaw_delete_relation', arguments: { memory_id: 'a', relation_id: 'r1' } },
    });
    expect(result.content[0].text).toContain('deleted');
  });

  it('delete_relation validates required fields', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_delete_relation', arguments: { memory_id: 'a' } },
    });
    expect(result.isError).toBe(true);
  });

  // --- Suggested ---

  it('suggested builds query params correctly', async () => {
    globalThis.fetch = mockFetchOk({ suggestions: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_suggested', arguments: { category: 'stale', limit: 5 } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('category=stale');
    expect(url).toContain('limit=5');
    expect(result.content[0].text).toContain('No suggestions found');
  });

  it('suggested formats results with category', async () => {
    globalThis.fetch = mockFetchOk({ suggestions: [{ id: '1', content: 'old memory' }] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_suggested', arguments: { category: 'stale' } },
    });
    expect(result.content[0].text).toContain('1 suggestions');
    expect(result.content[0].text).toContain('stale');
    expect(result.content[0].text).toContain('old memory');
  });

  // --- Export ---

  it('export uses /v1/export endpoint', async () => {
    const memories = Array.from({ length: 150 }, (_, i) => ({ id: `m${i}`, content: `memory ${i}` }));
    globalThis.fetch = mockFetchOk({ memories });
    const result = await callToolHandler({
      params: { name: 'memoclaw_export', arguments: {} },
    });
    expect(result.content[0].text).toContain('Exported 150 memories');
    const url = (globalThis.fetch as any).mock.calls[0][0];
    expect(url).toContain('/v1/export');
  });

  it('export falls back to pagination when /v1/export fails', async () => {
    let callNum = 0;
    globalThis.fetch = vi.fn().mockImplementation((_url: string) => {
      callNum++;
      if (callNum === 1) {
        // /v1/export fails
        return Promise.resolve({
          ok: false, status: 404,
          json: () => Promise.resolve({ error: 'not found' }),
          text: () => Promise.resolve('not found'),
          headers: new Headers(),
        });
      }
      // Fallback pagination calls
      const count = callNum === 2 ? 100 : 50;
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

  // --- Import ---

  it('import with empty array returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories: [] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('non-empty array');
  });

  it('import with >100 memories returns error', async () => {
    const memories = Array.from({ length: 101 }, (_, i) => ({ content: `m${i}` }));
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Maximum 100');
  });

  it('import rejects memory exceeding 8192 chars', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories: [{ content: 'a'.repeat(8193) }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('8192 character limit');
  });

  it('import rejects importance out of range', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories: [{ content: 'ok', importance: -1 }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('between 0.0 and 1.0');
  });

  it('import validates each memory has content', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories: [{ content: 'ok' }, { content: '' }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('index 1');
  });

  it('import succeeds', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test' } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories: [{ content: 'a' }, { content: 'b' }] } },
    });
    expect(result.content[0].text).toContain('2 stored');
    expect(result.content[0].text).toContain('0 failed');
  });

  it('import passes session_id and agent_id to each memory', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test' } });
    await callToolHandler({
      params: { name: 'memoclaw_import', arguments: { memories: [{ content: 'a' }], session_id: 's1', agent_id: 'ag1' } },
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.session_id).toBe('s1');
    expect(body.agent_id).toBe('ag1');
  });

  // --- Bulk Store ---

  it('bulk_store with empty array returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: { memories: [] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('non-empty array');
  });

  it('bulk_store with >50 memories returns error', async () => {
    const memories = Array.from({ length: 51 }, (_, i) => ({ content: `m${i}` }));
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: { memories } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Maximum 50');
  });

  it('bulk_store rejects memory exceeding 8192 chars', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: { memories: [{ content: 'ok' }, { content: 'y'.repeat(8193) }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('index 1');
    expect(result.content[0].text).toContain('8192 character limit');
  });

  it('bulk_store rejects importance out of range', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: { memories: [{ content: 'ok', importance: 1.5 }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('between 0.0 and 1.0');
  });

  it('bulk_store validates each memory has content', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: { memories: [{ content: 'ok' }, { content: '' }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('index 1');
  });

  it('bulk_store succeeds', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test' } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: { memories: [{ content: 'a' }, { content: 'b' }] } },
    });
    expect(result.content[0].text).toContain('2 stored');
    expect(result.content[0].text).toContain('0 failed');
  });

  // --- Count ---

  it('count returns total', async () => {
    globalThis.fetch = mockFetchOk({ memories: [{ id: '1' }], total: 42 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_count', arguments: {} },
    });
    expect(result.content[0].text).toContain('42');
  });

  it('count with namespace filter', async () => {
    globalThis.fetch = mockFetchOk({ memories: [], total: 10 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_count', arguments: { namespace: 'work' } },
    });
    expect(result.content[0].text).toContain('namespace=work');
    expect(result.content[0].text).toContain('10');
  });

  it('count with memory_type filter', async () => {
    globalThis.fetch = mockFetchOk({ memories: [], total: 5 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_count', arguments: { memory_type: 'decision' } },
    });
    expect(result.content[0].text).toContain('type=decision');
    expect(result.content[0].text).toContain('5');
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('memory_type=decision');
  });

  // --- Graph ---

  it('graph requires memory_id', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_graph', arguments: {} },
    });
    expect(result.isError).toBe(true);
  });

  it('graph traverses single level', async () => {
    let callNum = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callNum++;
      if (url.includes('/relations')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ relations: [
            { id: 'r1', source_id: 'start', target_id: 'neighbor', relation_type: 'related_to' },
          ]}),
          text: () => Promise.resolve(''),
          headers: new Headers(),
        });
      }
      // Memory fetch
      const id = url.match(/\/memories\/([^/?]+)/)?.[1] || 'unknown';
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memory: { id, content: `content of ${id}` } }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });

    const result = await callToolHandler({
      params: { name: 'memoclaw_graph', arguments: { memory_id: 'start', depth: 1 } },
    });
    expect(result.content[0].text).toContain('Graph from start');
    expect(result.content[0].text).toContain('content of start');
    expect(result.content[0].text).toContain('related_to');
    expect(result.content[0].text).toContain('neighbor');
  });

  it('graph clamps depth to max 3', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/relations')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ relations: [] }),
          text: () => Promise.resolve(''),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memory: { id: 'x', content: 'x' } }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });

    const result = await callToolHandler({
      params: { name: 'memoclaw_graph', arguments: { memory_id: 'x', depth: 10 } },
    });
    expect(result.content[0].text).toContain('depth 3');
  });

  it('graph filters by relation_type', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/relations')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ relations: [
            { id: 'r1', source_id: 'a', target_id: 'b', relation_type: 'supersedes' },
            { id: 'r2', source_id: 'a', target_id: 'c', relation_type: 'related_to' },
          ]}),
          text: () => Promise.resolve(''),
          headers: new Headers(),
        });
      }
      const id = url.match(/\/memories\/([^/?]+)/)?.[1] || 'unknown';
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memory: { id, content: `content ${id}` } }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });

    const result = await callToolHandler({
      params: { name: 'memoclaw_graph', arguments: { memory_id: 'a', depth: 1, relation_type: 'supersedes' } },
    });
    // Should only include supersedes edge, not related_to
    expect(result.content[0].text).toContain('supersedes');
    expect(result.content[0].text).not.toContain('related_to');
  });

  // --- Delete Namespace ---

  it('delete_namespace requires namespace', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_delete_namespace', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('namespace is required');
  });

  it('delete_namespace deletes all memories in namespace', async () => {
    let callNum = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string, opts: any) => {
      callNum++;
      if (opts?.method === 'DELETE') {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ deleted: true }),
          text: () => Promise.resolve(''),
          headers: new Headers(),
        });
      }
      // First list returns 2 memories, second returns empty
      if (callNum <= 1) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ memories: [{ id: 'a' }, { id: 'b' }] }),
          text: () => Promise.resolve(''),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memories: [] }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });

    const result = await callToolHandler({
      params: { name: 'memoclaw_delete_namespace', arguments: { namespace: 'test-ns' } },
    });
    expect(result.content[0].text).toContain('2 memories deleted');
    expect(result.content[0].text).toContain('test-ns');
  });

  it('delete_namespace with empty namespace has no deletions', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_delete_namespace', arguments: { namespace: 'empty-ns' } },
    });
    expect(result.content[0].text).toContain('0 memories deleted');
  });

  // --- Bulk Store field whitelisting ---

  it('bulk_store does not leak extra fields to API', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: '1', content: 'test' } });
    await callToolHandler({
      params: { name: 'memoclaw_bulk_store', arguments: { memories: [{ content: 'ok', extra_bad_field: 'should not appear' }] } },
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.content).toBe('ok');
    expect(body.extra_bad_field).toBeUndefined();
  });

  // --- Init tool ---

  it('init returns healthy status when API is reachable', async () => {
    globalThis.fetch = mockFetchOk({ free_tier_remaining: 500, free_tier_total: 1000 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_init', arguments: {} },
    });
    expect(result.content[0].text).toContain('MemoClaw is ready');
    expect(result.content[0].text).toContain('500/1000');
    expect(result.content[0].text).toContain('Private key loaded');
  });

  it('init returns error status when API is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('connect refused'));
    const result = await callToolHandler({
      params: { name: 'memoclaw_init', arguments: {} },
    });
    expect(result.content[0].text).toContain('needs configuration');
  });

  // --- Migrate tool ---

  it('migrate with files array calls /v1/migrate', async () => {
    globalThis.fetch = mockFetchOk({ memories_created: 5, duplicates_skipped: 1 });
    const result = await callToolHandler({
      params: { name: 'memoclaw_migrate', arguments: {
        files: [
          { filename: 'day1.md', content: '# Day 1\nSome notes' },
          { filename: 'day2.md', content: '# Day 2\nMore notes' },
        ],
        namespace: 'archive',
      }},
    });
    expect(result.content[0].text).toContain('Migration complete');
    expect(result.content[0].text).toContain('Memories created: 5');
    expect(result.content[0].text).toContain('Duplicates skipped: 1');
  });

  it('migrate requires path or files', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_migrate', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Either "path"');
  });

  it('migrate dry_run with files returns preview', async () => {
    globalThis.fetch = mockFetchOk({ memories_created: 0, duplicates_skipped: 0, dry_run: true });
    const result = await callToolHandler({
      params: { name: 'memoclaw_migrate', arguments: {
        files: [{ filename: 'notes.md', content: 'test content' }],
        dry_run: true,
      }},
    });
    expect(result.content[0].text).toContain('dry run');
  });

  it('graph handles fetch errors gracefully', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/relations')) {
        return Promise.resolve({
          ok: false, status: 404,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('not found'),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: false, status: 404,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve('not found'),
        headers: new Headers(),
      });
    });

    const result = await callToolHandler({
      params: { name: 'memoclaw_graph', arguments: { memory_id: 'missing' } },
    });
    // Should still return a result (with fallback content), not crash
    expect(result.content[0].text).toContain('Graph from missing');
    expect(result.content[0].text).toContain('could not fetch');
  });

  // --- Namespaces ---

  it('namespaces returns unique namespaces with counts', async () => {
    globalThis.fetch = mockFetchOk({
      memories: [
        { id: '1', content: 'a', namespace: 'work' },
        { id: '2', content: 'b', namespace: 'work' },
        { id: '3', content: 'c', namespace: 'personal' },
        { id: '4', content: 'd' },
      ],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_namespaces', arguments: {} },
    });
    expect(result.content[0].text).toContain('3 namespaces');
    expect(result.content[0].text).toContain('work: 2 memories');
    expect(result.content[0].text).toContain('personal: 1 memories');
    expect(result.content[0].text).toContain('(default): 1 memories');
  });

  // ─── memoclaw_pin / memoclaw_unpin ─────────────────────────────────

  it('pin requires id', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_pin', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('id is required');
  });

  it('pin sets pinned=true via PATCH', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: 'm1', content: 'test', pinned: true } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_pin', arguments: { id: 'm1' } },
    });
    expect(result.content[0].text).toContain('pinned');
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain('/v1/memories/m1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ pinned: true });
  });

  it('unpin requires id', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_unpin', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('id is required');
  });

  it('unpin sets pinned=false via PATCH', async () => {
    globalThis.fetch = mockFetchOk({ memory: { id: 'm1', content: 'test', pinned: false } });
    const result = await callToolHandler({
      params: { name: 'memoclaw_unpin', arguments: { id: 'm1' } },
    });
    expect(result.content[0].text).toContain('unpinned');
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain('/v1/memories/m1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ pinned: false });
  });

  // ─── memoclaw_tags ──────────────────────────────────────────────────

  it('tags lists unique tags with counts', async () => {
    globalThis.fetch = mockFetchOk({
      memories: [
        { id: '1', content: 'a', tags: ['frontend', 'react'] },
        { id: '2', content: 'b', tags: ['frontend', 'vue'] },
        { id: '3', content: 'c', tags: ['backend'] },
        { id: '4', content: 'd' },
      ],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_tags', arguments: {} },
    });
    expect(result.content[0].text).toContain('4 tags');
    expect(result.content[0].text).toContain('frontend: 2 memories');
    expect(result.content[0].text).toContain('react: 1 memories');
    expect(result.content[0].text).toContain('vue: 1 memories');
    expect(result.content[0].text).toContain('backend: 1 memories');
  });

  it('tags uses /v1/tags endpoint when available', async () => {
    globalThis.fetch = mockFetchOk({
      tags: [{ tag: 'frontend', count: 5 }, { tag: 'backend', count: 3 }],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_tags', arguments: {} },
    });
    expect(result.content[0].text).toContain('2 tags');
    expect(result.content[0].text).toContain('frontend: 5 memories');
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/v1/tags');
  });

  it('tags falls back to client-side when /v1/tags returns error', async () => {
    let callNum = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        // /v1/tags endpoint fails
        return Promise.resolve({
          ok: false, status: 404,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve('Not Found'),
          headers: new Headers(),
        });
      }
      // Fallback: /v1/memories pagination
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ memories: [{ id: '1', content: 'a', tags: ['fallback-tag'] }] }),
        text: () => Promise.resolve(''),
        headers: new Headers(),
      });
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_tags', arguments: {} },
    });
    expect(result.content[0].text).toContain('fallback-tag');
  });

  it('tags with no memories', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_tags', arguments: {} },
    });
    expect(result.content[0].text).toContain('No tags found');
  });

  it('tags passes namespace and agent_id filters', async () => {
    globalThis.fetch = mockFetchOk({ memories: [{ id: '1', content: 'a', tags: ['t1'] }] });
    await callToolHandler({
      params: { name: 'memoclaw_tags', arguments: { namespace: 'work', agent_id: 'ag1' } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('namespace=work');
    expect(url).toContain('agent_id=ag1');
  });

  it('tags reads from metadata.tags fallback', async () => {
    globalThis.fetch = mockFetchOk({
      memories: [
        { id: '1', content: 'a', metadata: { tags: ['meta-tag'] } },
      ],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_tags', arguments: {} },
    });
    expect(result.content[0].text).toContain('meta-tag: 1 memories');
  });

  it('namespaces uses /v1/namespaces endpoint when available', async () => {
    globalThis.fetch = mockFetchOk({
      namespaces: [{ namespace: 'work', count: 10 }, { namespace: 'personal', count: 5 }],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_namespaces', arguments: {} },
    });
    expect(result.content[0].text).toContain('2 namespaces');
    expect(result.content[0].text).toContain('work: 10 memories');
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/v1/namespaces');
  });

  it('namespaces with no memories', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_namespaces', arguments: {} },
    });
    expect(result.content[0].text).toContain('No memories found');
  });

  it('namespaces passes agent_id filter', async () => {
    globalThis.fetch = mockFetchOk({ memories: [{ id: '1', content: 'a', namespace: 'ns1' }] });
    await callToolHandler({
      params: { name: 'memoclaw_namespaces', arguments: { agent_id: 'ag1' } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('agent_id=ag1');
  });

  // ─── memoclaw_context ──────────────────────────────────────────────

  it('context requires query', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_context', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('query is required');
  });

  it('context with empty query returns error', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_context', arguments: { query: '' } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('query is required');
  });

  it('context returns formatted results', async () => {
    globalThis.fetch = mockFetchOk({
      memories: [
        { id: '1', content: 'Bob prefers morning meetings', importance: 0.8, tags: ['meetings'] },
        { id: '2', content: 'Bob is the frontend lead', importance: 0.6 },
      ],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_context', arguments: { query: 'prepare for meeting with Bob' } },
    });
    expect(result.content[0].text).toContain('Context for');
    expect(result.content[0].text).toContain('2 memories');
    expect(result.content[0].text).toContain('Bob prefers morning meetings');
  });

  it('context with no results', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_context', arguments: { query: 'something obscure' } },
    });
    expect(result.content[0].text).toContain('No relevant context found');
  });

  it('context passes all params correctly', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    await callToolHandler({
      params: { name: 'memoclaw_context', arguments: { query: 'test', limit: 5, namespace: 'work', session_id: 's1', agent_id: 'ag1' } },
    });
    const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
    expect(body.query).toBe('test');
    expect(body.limit).toBe(5);
    expect(body.namespace).toBe('work');
    expect(body.session_id).toBe('s1');
    expect(body.agent_id).toBe('ag1');
  });

  it('context calls POST /v1/context', async () => {
    globalThis.fetch = mockFetchOk({ context: [{ id: '1', content: 'test' }] });
    await callToolHandler({
      params: { name: 'memoclaw_context', arguments: { query: 'test' } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/v1/context');
    const opts = (globalThis.fetch as any).mock.calls[0][1];
    expect(opts.method).toBe('POST');
  });

  it('context handles "context" response key', async () => {
    globalThis.fetch = mockFetchOk({ context: [{ id: '1', content: 'from context key' }] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_context', arguments: { query: 'test' } },
    });
    expect(result.content[0].text).toContain('from context key');
  });

  // ─── memoclaw_history ────────────────────────────────────────────────

  it('history requires id', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_history', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('id is required');
  });

  it('history returns formatted versions', async () => {
    globalThis.fetch = mockFetchOk({
      history: [
        { content: 'original text', importance: 0.5, created_at: '2025-01-01T00:00:00Z' },
        { content: 'updated text', importance: 0.8, changed_fields: ['content', 'importance'], updated_at: '2025-01-02T00:00:00Z' },
      ],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_history', arguments: { id: 'm1' } },
    });
    expect(result.content[0].text).toContain('2 versions');
    expect(result.content[0].text).toContain('original text');
    expect(result.content[0].text).toContain('updated text');
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/v1/memories/m1/history');
  });

  it('history handles empty result', async () => {
    globalThis.fetch = mockFetchOk({ history: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_history', arguments: { id: 'm1' } },
    });
    expect(result.content[0].text).toContain('No edit history found');
  });
});

// ─── Batch Update ──────────────────────────────────────────────────────────

describe('memoclaw_batch_update', () => {
  it('definition exists with required updates field', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_batch_update');
    expect(tool).toBeDefined();
    expect(tool.inputSchema.required).toContain('updates');
  });

  it('calls batch-update endpoint', async () => {
    globalThis.fetch = mockFetchOk({ updated: 2, memories: [{ id: 'm1', content: 'a' }, { id: 'm2', content: 'b' }] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_batch_update', arguments: { updates: [{ id: 'm1', importance: 0.9 }, { id: 'm2', tags: ['x'] }] } },
    });
    expect(result.content[0].text).toContain('Batch update');
    expect(result.content[0].text).toContain('2');
  });

  it('falls back to individual PATCH on 404', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, opts: any) => {
      callCount++;
      if (callCount === 1) {
        // First call is batch endpoint - return 404
        return { ok: false, status: 404, text: () => Promise.resolve('Not Found'), headers: new Headers() };
      }
      // Subsequent calls are individual PATCHes
      return { ok: true, status: 200, json: () => Promise.resolve({ memory: { id: 'mx', content: 'updated' } }), text: () => Promise.resolve('{}'), headers: new Headers() };
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_batch_update', arguments: { updates: [{ id: 'm1', importance: 0.8 }] } },
    });
    expect(result.content[0].text).toContain('1 updated');
  });

  it('rejects empty updates array', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_batch_update', arguments: { updates: [] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('non-empty');
  });

  it('rejects updates without id', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_batch_update', arguments: { updates: [{ importance: 0.5 }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('missing "id"');
  });

  it('rejects importance out of range in updates', async () => {
    const result = await callToolHandler({
      params: { name: 'memoclaw_batch_update', arguments: { updates: [{ id: 'm1', importance: 5 }] } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('between 0.0 and 1.0');
  });

  it('rejects more than 50 updates', async () => {
    const updates = Array.from({ length: 51 }, (_, i) => ({ id: `m${i}`, importance: 0.5 }));
    const result = await callToolHandler({
      params: { name: 'memoclaw_batch_update', arguments: { updates } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('50');
  });
});

// ─── Core Memories ─────────────────────────────────────────────────────────

describe('memoclaw_core_memories', () => {
  it('definition exists', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_core_memories');
    expect(tool).toBeDefined();
  });

  it('returns core memories', async () => {
    globalThis.fetch = mockFetchOk({ memories: [{ id: 'c1', content: 'core fact', importance: 0.95, pinned: true }] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_core_memories', arguments: {} },
    });
    expect(result.content[0].text).toContain('1 core memories');
    expect(result.content[0].text).toContain('core fact');
  });

  it('passes filters as query params', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    await callToolHandler({
      params: { name: 'memoclaw_core_memories', arguments: { limit: 5, namespace: 'work', agent_id: 'a1' } },
    });
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('limit=5');
    expect(url).toContain('namespace=work');
    expect(url).toContain('agent_id=a1');
  });

  it('handles empty response', async () => {
    globalThis.fetch = mockFetchOk({ memories: [] });
    const result = await callToolHandler({
      params: { name: 'memoclaw_core_memories', arguments: {} },
    });
    expect(result.content[0].text).toContain('No core memories found');
  });
});

// ─── Stats ─────────────────────────────────────────────────────────────────

describe('memoclaw_stats', () => {
  it('definition exists', async () => {
    const result = await listToolsHandler();
    const tool = result.tools.find((t: any) => t.name === 'memoclaw_stats');
    expect(tool).toBeDefined();
  });

  it('returns formatted stats', async () => {
    globalThis.fetch = mockFetchOk({
      total_memories: 142,
      pinned_count: 8,
      never_accessed: 23,
      total_accesses: 891,
      avg_importance: 0.64,
      oldest_memory: '2025-06-01T08:00:00Z',
      newest_memory: '2026-02-13T10:30:00Z',
      by_type: [{ memory_type: 'general', count: 100 }, { memory_type: 'correction', count: 42 }],
      by_namespace: [{ namespace: 'default', count: 120 }, { namespace: 'work', count: 22 }],
    });
    const result = await callToolHandler({
      params: { name: 'memoclaw_stats', arguments: {} },
    });
    const text = result.content[0].text;
    expect(text).toContain('Memory Stats');
    expect(text).toContain('142');
    expect(text).toContain('Pinned: 8');
    expect(text).toContain('0.64');
    expect(text).toContain('general: 100');
    expect(text).toContain('work: 22');
    const url = (globalThis.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/v1/stats');
  });

  it('handles API error', async () => {
    globalThis.fetch = mockFetchError(500, 'Internal Server Error');
    const result = await callToolHandler({
      params: { name: 'memoclaw_stats', arguments: {} },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('500');
  });
});
