import type { ApiClient } from '../api.js';
import type { Config } from '../config.js';

/**
 * MCP content annotations per spec 2025-06-18.
 * - audience: who should see this content ('user', 'assistant', or both)
 * - priority: importance hint (0.0 = low, 1.0 = high)
 */
export interface ContentAnnotations {
  audience?: Array<'user' | 'assistant'>;
  priority?: number;
}

export interface TextContentItem {
  type: 'text';
  text: string;
  annotations?: ContentAnnotations;
}

/**
 * MCP resource_link content item (MCP 2025-06-18).
 * Returned by mutation tools to link to created/modified resources.
 */
export interface ResourceLinkContentItem {
  type: 'resource_link';
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export type ContentItem = TextContentItem | ResourceLinkContentItem;

export type ToolResult = { content: ContentItem[]; isError?: boolean; structuredContent?: Record<string, unknown> };

export type ToolHandler = (name: string, args: any) => Promise<ToolResult>;

/**
 * Progress callback for long-running operations.
 * Wraps server.sendProgress() — only emits if the client provided a progressToken.
 */
export type ProgressCallback = (current: number, total: number) => Promise<void>;

export interface HandlerContext {
  api: ApiClient;
  config: Config;
  makeRequest: ApiClient['makeRequest'];
  account: ApiClient['account'];
  /** Report progress for long-running operations. No-op if client didn't provide a progressToken. */
  progress: ProgressCallback;
}

export function createContext(api: ApiClient, config: Config, progress?: ProgressCallback): HandlerContext {
  return {
    api,
    config,
    makeRequest: api.makeRequest,
    account: api.account,
    progress: progress || (async () => {}),
  };
}
