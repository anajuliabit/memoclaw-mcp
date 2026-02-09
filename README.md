# MemoClaw MCP Server

MCP (Model Context Protocol) server for MemoClaw semantic memory API.

## Installation

```bash
npm install -g memoclaw-mcp
```

## Configuration

Set your private key:
```bash
export MEMOCLAW_PRIVATE_KEY=0x...
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memoclaw": {
      "command": "memoclaw-mcp",
      "env": {
        "MEMOCLAW_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

### Cursor

Add to MCP settings in Cursor preferences.

## Tools

| Tool | Description |
|------|-------------|
| `memoclaw_store` | Store a memory with semantic embeddings |
| `memoclaw_recall` | Recall memories via semantic search |
| `memoclaw_list` | List stored memories |
| `memoclaw_delete` | Delete a memory by ID |

## Example Usage

Once configured, Claude can use commands like:

- "Remember that the meeting is at 3pm tomorrow"
- "What did I say about the project deadline?"
- "List my recent memories"

## Pricing

- Store: $0.001 per memory
- Recall: $0.001 per query
- List: $0.0005
- Delete: $0.0001

Paid with USDC on Base via x402 protocol.

## Links

- [MemoClaw Website](https://memoclaw.dev)
- [MemoClaw Docs](https://memoclaw.dev/docs)
- [MCP Specification](https://modelcontextprotocol.io)

## License

MIT
