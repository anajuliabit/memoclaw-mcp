import type { ApiClient } from '../api.js';
import type { Config } from '../config.js';

export type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

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
