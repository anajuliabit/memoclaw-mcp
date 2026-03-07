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

export type ToolResult = { content: TextContentItem[]; isError?: boolean };

export type ToolHandler = (name: string, args: any) => Promise<ToolResult>;

export interface HandlerContext {
  api: ApiClient;
  config: Config;
  makeRequest: ApiClient['makeRequest'];
  account: ApiClient['account'];
}

export function createContext(api: ApiClient, config: Config): HandlerContext {
  return {
    api,
    config,
    makeRequest: api.makeRequest,
    account: api.account,
  };
}
