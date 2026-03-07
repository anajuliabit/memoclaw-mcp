# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.15.0] - 2026-03-07

### Added
- `memoclaw_check_duplicates` tool — pre-store semantic dedup check that finds similar existing memories before storing new ones (Fixes #111)

### Changed
- Updated `@types/node` from v22 to v25 (Fixes #112)

## [1.14.0] - 2026-03-07

### Added
- Output schemas (MCP 2025-06-18) for all tools with `structuredContent` in responses
- Resource links (`resource_link` content items) from mutation tools pointing to affected memories
- Content annotations (`audience`, `priority`) on all tool responses per MCP spec
- MCP Logging capability with syslog-level filtering via `logging/setLevel`
- MCP Completions for `namespace`, `tag`, and `memory_type` arguments with caching
- MCP Prompts: `review-memories`, `load-context`, `memory-report`, `migrate-files`
- MCP Resources: `memoclaw://stats`, `memoclaw://namespaces`, `memoclaw://core-memories`
- Resource templates: `memoclaw://memories/{id}`, `memoclaw://namespaces/{namespace}`, `memoclaw://tags/{tag}`
- Tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`)
- `memoclaw_graph` tool for traversing the memory knowledge graph
- `memoclaw_context` tool for GPT-4o-mini powered contextual recall
- `memoclaw_batch_update` tool for updating multiple memories at once
- `memoclaw_core_memories` tool for retrieving high-importance memories
- `memoclaw_stats` tool for memory usage statistics
- `memoclaw_tags` tool for listing unique tags with counts
- `memoclaw_namespaces` tool for listing namespaces with counts
- `memoclaw_history` tool for viewing memory edit history
- `memoclaw_pin` / `memoclaw_unpin` shortcut tools
- `memoclaw_count` tool with smart fallback pagination
- `memoclaw_migrate` tool with file/directory path support and ingest fallback
- `memoclaw_search` tool for keyword/exact text matching
- `memoclaw_suggested` tool for proactive memory suggestions
- Streamable HTTP transport (`--http` flag or `MEMOCLAW_TRANSPORT=http`)
- HTTP session management with configurable TTL (`MEMOCLAW_SESSION_TTL_MS`)
- Bearer token authentication for HTTP transport (`MEMOCLAW_HTTP_TOKEN`)
- Origin validation for HTTP transport to prevent DNS rebinding attacks
- Health check endpoint (`GET /health`)
- Configurable request timeout (`MEMOCLAW_TIMEOUT`) and retry count (`MEMOCLAW_MAX_RETRIES`)
- Exponential backoff with jitter for transient failure retries
- Client-side validation: content length (8192 chars), importance range (0-1)
- Immutable memory support (`immutable` flag)
- `--version` and `--help` CLI flags
- Comprehensive test suite (400+ tests)
- CI workflow for Node.js 18, 20, 22
- npm publish workflow on version tags
- CHANGELOG.md

### Changed
- Refactored monolithic handler into domain modules (`memory`, `recall`, `relations`, `admin`)
- Handler functions now use typed argument interfaces instead of `any`
- Version is read from package.json at startup (no hardcoded duplication)

### Fixed
- `memoclaw_count` fallback pagination capped at 10,000 memories (was 100,000)
- README: `memoclaw_bulk_store` max corrected from 50 to 100

## [1.0.0] - 2026-01-15

### Added
- Initial release
- `memoclaw_store`, `memoclaw_recall`, `memoclaw_list`, `memoclaw_get`, `memoclaw_delete`, `memoclaw_update` tools
- `memoclaw_bulk_store`, `memoclaw_bulk_delete`, `memoclaw_import`, `memoclaw_export` bulk tools
- `memoclaw_ingest`, `memoclaw_extract`, `memoclaw_consolidate` AI tools
- `memoclaw_create_relation`, `memoclaw_list_relations`, `memoclaw_delete_relation` graph tools
- `memoclaw_delete_namespace` admin tool
- `memoclaw_status`, `memoclaw_init` utility tools
- x402 payment support (automatic after free tier)
- Config loading from env vars and `~/.memoclaw/config.json`
- stdio transport
