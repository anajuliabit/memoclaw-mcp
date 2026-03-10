# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.17.1] - 2026-03-10

### Fixed
- `memoclaw_recall` now passes the `pinned` filter to the API — previously the parameter was advertised in the tool schema (via COMMON_FILTERS) but silently ignored by the handler
- Added `pinned` field to `RecallArgs` type definition

### Added
- Autocomplete completions for `format` argument (memoclaw_export: json, jsonl) and `strategy` argument (memoclaw_merge: keep_target, keep_source, combine)
- 7 new tests covering recall pinned filter and new completions

## [1.17.0] - 2026-03-08

### Added
- Server `instructions` field in MCP InitializeResult (Fixes #115)
  - Provides LLMs with a concise description of MemoClaw capabilities and constraints
  - Improves tool discovery for MCP clients that surface instructions in system prompts
- Input validation module (`src/validate.ts`) with helpers for identifiers, IDs, tags, and queries (Fixes #117)
  - `validateIdentifier()` — enforces length limits (256 chars) and safe character set for namespace, session_id, agent_id, memory_type, relation_type
  - `validateId()` — ensures IDs are non-empty strings within length limits
  - `validateTags()` — validates tag arrays (max 50 tags, 128 chars each, no empty strings)
  - `validateQuery()` — ensures query strings are non-empty
- 16 new tests for the validation module

### Changed
- All handlers now validate string parameters client-side before making API calls
  - Faster feedback for invalid input (no network roundtrip needed)
  - Clear, descriptive error messages for each parameter

## [1.16.0] - 2026-03-08

### Added
- MCP progress notifications for long-running operations (Fixes #110)
  - Handlers report progress via `notifications/progress` when client provides `_meta.progressToken`
  - Supported tools: `bulk_store`, `bulk_delete`, `batch_update`, `delete_namespace`, `export` (fallback), `migrate` (fallback), and `import` (fallback)
- Tests for progress notification callbacks and empty-result structuredContent

### Fixed
- Missing `structuredContent` on empty results for `memoclaw_recall`, `memoclaw_search`, `memoclaw_context`, `memoclaw_suggested`, and `memoclaw_list_relations` — clients parsing structured output now always get a predictable shape
- Added `minimum`/`maximum` constraints to `depth` parameter in `memoclaw_graph` input schema (handler already clamped to 1-3)

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
