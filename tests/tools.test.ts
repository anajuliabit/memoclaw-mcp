/**
 * Tests for MemoClaw MCP server tool definitions.
 *
 * These tests validate tool schemas and the handler dispatch logic
 * without making real API calls (we mock fetch globally).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the tool definitions by importing the built output.
// Since the source does process.exit if MEMOCLAW_PRIVATE_KEY is missing,
// we set the env var before importing.
process.env.MEMOCLAW_PRIVATE_KEY =
  '0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb';
process.env.MEMOCLAW_URL = 'https://test.memoclaw.com';

// Mock the MCP SDK to capture handlers
const mockSetRequestHandler = vi.fn();
const mockConnect = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  return {
    Server: class MockServer {
      setRequestHandler = mockSetRequestHandler;
      connect = mockConnect;
    },
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  CallToolRequestSchema: 'CallToolRequestSchema',
}));

// Mock x402 + viem to avoid real crypto
vi.mock('@x402/core/client', () => ({
  x402Client: vi.fn().mockImplementation(() => ({
    register: vi.fn().mockReturnThis(),
  })),
}));
vi.mock('@x402/core/http', () => ({
  x402HTTPClient: vi.fn(),
}));
vi.mock('@x402/evm/exact/client', () => ({
  ExactEvmScheme: vi.fn(),
}));
vi.mock('@x402/evm', () => ({
  toClientEvmSigner: vi.fn(),
}));
vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn().mockReturnValue({
    address: '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23',
    signMessage: vi.fn().mockResolvedValue('0xmocksig'),
  }),
}));

// Now import — this triggers the module-level code
await import('../src/index.js');

describe('MCP Server Tool Definitions', () => {
  let listToolsHandler: () => Promise<any>;
  let callToolHandler: (req: any) => Promise<any>;

  beforeEach(() => {
    // Extract handlers registered via setRequestHandler
    for (const call of mockSetRequestHandler.mock.calls) {
      if (call[0] === 'ListToolsRequestSchema') listToolsHandler = call[1];
      if (call[0] === 'CallToolRequestSchema') callToolHandler = call[1];
    }
  });

  it('should register ListTools and CallTool handlers', () => {
    expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
  });

  it('should expose all expected tools', async () => {
    const result = await listToolsHandler();
    const toolNames = result.tools.map((t: any) => t.name);
    
    expect(toolNames).toContain('memoclaw_store');
    expect(toolNames).toContain('memoclaw_recall');
    expect(toolNames).toContain('memoclaw_list');
    expect(toolNames).toContain('memoclaw_delete');
    expect(toolNames).toContain('memoclaw_status');
    expect(toolNames).toContain('memoclaw_ingest');
    expect(toolNames).toContain('memoclaw_extract');
    expect(toolNames).toContain('memoclaw_consolidate');
    expect(toolNames).toContain('memoclaw_suggested');
    expect(toolNames).toContain('memoclaw_update');
    expect(toolNames).toContain('memoclaw_create_relation');
    expect(toolNames).toContain('memoclaw_list_relations');
  });

  it('should have 12 tools total', async () => {
    const result = await listToolsHandler();
    expect(result.tools).toHaveLength(12);
  });

  it('store tool requires content', async () => {
    const result = await listToolsHandler();
    const store = result.tools.find((t: any) => t.name === 'memoclaw_store');
    expect(store.inputSchema.required).toContain('content');
  });

  it('recall tool requires query', async () => {
    const result = await listToolsHandler();
    const recall = result.tools.find((t: any) => t.name === 'memoclaw_recall');
    expect(recall.inputSchema.required).toContain('query');
  });

  it('update tool requires id', async () => {
    const result = await listToolsHandler();
    const update = result.tools.find((t: any) => t.name === 'memoclaw_update');
    expect(update.inputSchema.required).toContain('id');
  });

  it('create_relation tool requires memory_id, target_id, relation_type', async () => {
    const result = await listToolsHandler();
    const rel = result.tools.find((t: any) => t.name === 'memoclaw_create_relation');
    expect(rel.inputSchema.required).toEqual(
      expect.arrayContaining(['memory_id', 'target_id', 'relation_type'])
    );
  });

  it('should return error for unknown tool', async () => {
    // Mock fetch for this call
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();
    
    const result = await callToolHandler({
      params: { name: 'memoclaw_nonexistent', arguments: {} },
    });
    
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unknown tool');
    
    globalThis.fetch = originalFetch;
  });
});
