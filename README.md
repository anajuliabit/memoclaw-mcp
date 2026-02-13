# MemoClaw MCP Server

[![CI](https://github.com/anajuliabit/memoclaw-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/anajuliabit/memoclaw-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/memoclaw-mcp)](https://www.npmjs.com/package/memoclaw-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
| `memoclaw_status` | Check free tier remaining calls |
| `memoclaw_ingest` | Zero-effort ingestion: dump conversations/text, auto-extract facts with dedup & relations |
| `memoclaw_extract` | Extract structured facts from conversation via LLM |
| `memoclaw_consolidate` | Merge similar memories by clustering |
| `memoclaw_suggested` | Get proactive memory suggestions |
| `memoclaw_update` | Update a memory by ID |
| `memoclaw_create_relation` | Create a relationship between memories |
| `memoclaw_list_relations` | List all relationships for a memory |

## Example Usage

Once configured, Claude can use commands like:

- "Remember that the meeting is at 3pm tomorrow"
- "What did I say about the project deadline?"
- "List my recent memories"

## Pricing

**Free Tier:** Every wallet gets **1000 free API calls** — no payment required.

After the free tier:
- Store: $0.001 per memory
- Recall: $0.001 per query
- List: $0.0005
- Delete: $0.0001

Paid with USDC on Base via x402 protocol. The server handles payment automatically.

## Links

- [MemoClaw Website](https://memoclaw.com)
- [MemoClaw Docs](https://memoclaw.com/docs)
- [MCP Specification](https://modelcontextprotocol.io)

## License

MIT
