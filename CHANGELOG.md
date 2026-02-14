# Changelog

## 1.7.0

### Features
- **Config file auto-loading**: MCP server now auto-detects `~/.memoclaw/config.json` (created by `memoclaw init`). Resolution order: env var → config file → default. No more mandatory env vars after `memoclaw init`.
- **`after` filter for `list` and `search`**: Both tools now support an `after` parameter to filter memories by creation date, matching `recall`'s existing capability.
- **Better `memoclaw_init` output**: Shows config resolution source (env vs config file) and updated setup instructions mentioning `memoclaw init`.

### Tests
- Added 4 new tests: `search after filter`, `list after filter`, `list has after filter`, `search has after filter`, init config source display. Total: 98 tests.

All notable changes to memoclaw-mcp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.5.0] - 2026-02-13

### Added
- `memoclaw_import` tool — restore memories from JSON backup (max 100 per call)
- `memoclaw_graph` tool — BFS traversal of memory relation graph (depth 1-3)
- `memoclaw_bulk_store` tool — store multiple memories in one call (max 50)
- `memoclaw_count` tool — count memories with filters
- `memoclaw_export` tool — export all memories as JSON/JSONL
- `memoclaw_delete_namespace` tool — delete all memories in a namespace
- 78 tests with comprehensive edge case coverage

### Fixed
- `formatMemory` crash on non-numeric similarity values
- `formatMemory` null/missing memory safety
- `memoclaw_update` leaked arbitrary fields to API; now whitelists allowed fields
- `memoclaw_update` no-op detection (errors when no valid fields provided)
- `memoclaw_list` missing `memory_type` filter
- `memoclaw_suggested` raw JSON output; now formatted
- `memoclaw_bulk_store` field leaking (now whitelists allowed fields per memory)

### Improved
- All tool descriptions rewritten for clarity
- `formatMemory` shows `expires_at` and `updated_at`
- Update response includes formatted memory details

## [1.2.0] - 2026-02-13

### Added
- `memoclaw_ingest` tool — zero-effort conversation ingestion
- `memoclaw_extract` tool — LLM fact extraction
- `memoclaw_consolidate` tool — merge similar memories
- `memoclaw_suggested` tool — proactive memory suggestions
- `memoclaw_update` tool — update memories by ID
- `memoclaw_create_relation` / `memoclaw_list_relations` tools
- `memoclaw_status` tool — check free tier remaining calls
- Free tier wallet auth (try free tier before x402 payment)

## [1.0.0] - 2026-02-09

### Added
- Initial release with store, recall, list, delete tools
- x402 payment support (USDC on Base)
