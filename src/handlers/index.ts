import type { ApiClient } from '../api.js';
import type { Config } from '../config.js';
import { createContext } from './types.js';
import type { ToolResult, ProgressCallback } from './types.js';
import { handleMemory } from './memory.js';
import { handleRecall } from './recall.js';
import { handleRelations } from './relations.js';
import { handleAdmin } from './admin.js';

export type { ToolResult };

export function createHandler(api: ApiClient, config: Config) {
  return async function handleToolCall(name: string, args: any, progress?: ProgressCallback, signal?: AbortSignal): Promise<ToolResult> {
    const ctx = createContext(api, config, progress, signal);

    // Try each domain handler in turn; first non-null result wins
    const result =
      await handleMemory(ctx, name, args) ??
      await handleRecall(ctx, name, args) ??
      await handleRelations(ctx, name, args) ??
      await handleAdmin(ctx, name, args);

    if (result !== null) return result;

    throw new Error(`Unknown tool: ${name}`);
  };
}
