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

export type ToolHandler = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

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
  /** AbortSignal from the MCP protocol — aborted when the client sends notifications/cancelled. */
  signal: AbortSignal;
}

/**
 * Check if the operation has been cancelled and throw if so.
 * Call this between iterations in long-running loops.
 */
export function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new CancellationError();
  }
}

/**
 * Error thrown when a request is cancelled via MCP notifications/cancelled.
 * Handlers should catch this to return partial results.
 */
export class CancellationError extends Error {
  constructor() {
    super('Operation cancelled by client');
    this.name = 'CancellationError';
  }
}

export function createContext(
  api: ApiClient,
  config: Config,
  progress?: ProgressCallback,
  signal?: AbortSignal,
): HandlerContext {
  const resolvedSignal = signal || new AbortController().signal;
  return {
    api,
    config,
    // Wrap makeRequest to automatically forward the MCP cancellation signal
    // to every API call, so in-flight fetch() requests abort immediately
    // when the client sends notifications/cancelled.
    makeRequest: (method: string, path: string, body?: Record<string, unknown>) =>
      api.makeRequest(method, path, body, resolvedSignal),
    account: api.account,
    progress: progress || (async () => {}),
    signal: resolvedSignal,
  };
}
