# MemoClaw MCP Server

[![CI](https://github.com/anajuliabit/memoclaw-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/anajuliabit/memoclaw-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/memoclaw-mcp)](https://www.npmjs.com/package/memoclaw-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MCP (Model Context Protocol) server for [MemoClaw](https://memoclaw.com) — semantic memory for AI agents. Store, recall, and manage memories with vector search. 100 free API calls per wallet, no registration needed.

## Installation

```bash
npm install -g memoclaw-mcp
```

## Configuration

Set your private key via environment variable or config file:

```bash
# Option 1: env var
export MEMOCLAW_PRIVATE_KEY=0x...

# Option 2: config file (created by `memoclaw init`)
# ~/.memoclaw/config.json → { "privateKey": "0x...", "url": "https://api.memoclaw.com" }
```

Optionally set a custom API URL:
```bash
export MEMOCLAW_URL=https://api.memoclaw.com  # default
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

### Streamable HTTP Transport

By default, the server uses stdio transport. To run as an HTTP server (MCP spec 2025-03-26 Streamable HTTP):

```bash
# Via CLI flag
memoclaw-mcp --http

# Via environment variable
MEMOCLAW_TRANSPORT=http memoclaw-mcp

# Custom port (default: 3100)
MEMOCLAW_PORT=8080 memoclaw-mcp --http
```

The server exposes:
- `POST /mcp` — MCP Streamable HTTP endpoint
- `GET /health` — Health check returning `{ status: "ok", version: "..." }`

Configure your MCP client to connect to `http://localhost:3100/mcp`.

## Tools

### Core

| Tool | Description |
|------|-------------|
| `memoclaw_store` | Store a memory with semantic embeddings |
| `memoclaw_recall` | Semantic search — find memories by meaning |
| `memoclaw_search` | Keyword search — find memories by exact text |
| `memoclaw_get` | Get a single memory by ID |
| `memoclaw_list` | List memories chronologically |
| `memoclaw_delete` | Delete a memory by ID |
| `memoclaw_update` | Update a memory's fields |
| `memoclaw_context` | Get contextually relevant memories using GPT-4o-mini |

### Bulk operations

| Tool | Description |
|------|-------------|
| `memoclaw_bulk_store` | Store up to 50 memories in one call |
| `memoclaw_bulk_delete` | Delete up to 100 memories in one call |
| `memoclaw_batch_update` | Update up to 50 memories in one call |
| `memoclaw_import` | Import memories from a JSON array |
| `memoclaw_export` | Export all memories as JSON or JSONL |

### Ingestion and extraction

| Tool | Description |
|------|-------------|
| `memoclaw_ingest` | Dump conversations/text, auto-extract facts with dedup and relations |
| `memoclaw_extract` | Extract structured facts from conversation via LLM |
| `memoclaw_consolidate` | Merge similar/duplicate memories by clustering |
| `memoclaw_migrate` | Bulk-import .md/.txt files into MemoClaw |

### Organization

| Tool | Description |
|------|-------------|
| `memoclaw_pin` | Pin a memory to prevent decay |
| `memoclaw_unpin` | Unpin a memory |
| `memoclaw_tags` | List all unique tags with counts |
| `memoclaw_namespaces` | List all namespaces with counts |
| `memoclaw_count` | Count memories (with optional filters) |
| `memoclaw_delete_namespace` | Delete all memories in a namespace |

### Knowledge graph

| Tool | Description |
|------|-------------|
| `memoclaw_create_relation` | Create a relationship between two memories |
| `memoclaw_list_relations` | List relationships for a memory |
| `memoclaw_delete_relation` | Delete a relationship |
| `memoclaw_graph` | Traverse the memory graph from a starting memory |

### Insights and status

| Tool | Description |
|------|-------------|
| `memoclaw_suggested` | Get proactive suggestions (stale, fresh, hot, decaying) |
| `memoclaw_core_memories` | Get your most important/frequently accessed memories |
| `memoclaw_stats` | Memory usage statistics |
| `memoclaw_history` | View edit history for a memory |
| `memoclaw_status` | Check free tier remaining calls |
| `memoclaw_init` | Verify configuration and API connectivity |

## Example usage

Once configured, your AI agent can:

- "Remember that the meeting is at 3pm tomorrow"
- "What did I say about the project deadline?"
- "Show me my core memories"
- "Consolidate duplicate memories (dry run first)"

## Pricing

**Free Tier:** Every wallet gets **100 free API calls** — no payment required.

After the free tier, x402 micropayments kick in automatically:

**Paid (uses embeddings):**

| Operation | Price |
|-----------|-------|
| Store | $0.005 |
| Store batch (up to 100) | $0.04 |
| Recall (semantic search) | $0.005 |
| Update (content change) | $0.005 |
| Batch update | $0.005 |

**Paid (uses GPT-4o-mini + embeddings):**

| Operation | Price |
|-----------|-------|
| Extract / Ingest | $0.01 |
| Consolidate | $0.01 |
| Context | $0.01 |
| Migrate | $0.01 |

**Free (no OpenAI cost):**
List, Get, Delete, Bulk Delete, Search (text), Suggested, Core memories, Relations, History, Export, Namespaces, Stats, Tags, Pin/Unpin, Count, Status, Init.

## Links

- Website: https://memoclaw.com
- Docs: https://docs.memoclaw.com
- API: https://api.memoclaw.com
- CLI: `npm install -g memoclaw`

## License

MIT
