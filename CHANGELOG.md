# Changelog

All notable changes to memoclaw-mcp will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.5.0] - 2026-02-13

### Added
- `memoclaw_namespaces` tool — list all distinct namespaces in your memory store
- `memoclaw_tags` tool — list all distinct tags with frequency counts
- `memoclaw_bulk_store` tool — store up to 50 memories in a single API call
- `memoclaw_stats` tool — get memory statistics (total, by type/namespace/importance, pinned, expiring)

### Fixed
- Export now supports `jsonl` format in addition to `json`

### Changed
- Improved tool descriptions for clarity and completeness
- Added comprehensive tests for all tools (53 tests total)

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
