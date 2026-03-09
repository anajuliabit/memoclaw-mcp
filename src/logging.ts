/**
 * MCP Logging capability for MemoClaw.
 *
 * Provides structured logging that MCP clients can subscribe to.
 * Supports syslog-level filtering via the logging/setLevel request.
 *
 * Levels (in order of severity):
 *   debug < info < notice < warning < error < critical < alert < emergency
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

export type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';

/** Syslog severity order (lower index = less severe) */
const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'];

function levelIndex(level: LogLevel): number {
  const idx = LEVEL_ORDER.indexOf(level);
  return idx >= 0 ? idx : 0;
}

/**
 * Logger that sends notifications to MCP clients via server.sendLoggingMessage.
 * Respects the minimum level set by the client via logging/setLevel.
 */
export class McpLogger {
  private minLevel: LogLevel = 'warning';
  private server: Server | null = null;

  /** Attach to a server instance. Call after server is created. */
  attach(server: Server): void {
    this.server = server;
  }

  /** Set the minimum log level. Messages below this level are suppressed. */
  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  /** Get current minimum level */
  getLevel(): LogLevel {
    return this.minLevel;
  }

  /** Send a log message if it meets the minimum level threshold. */
  async log(level: LogLevel, logger: string, data: unknown): Promise<void> {
    if (levelIndex(level) < levelIndex(this.minLevel)) return;
    if (!this.server) {
      // Fallback to stderr if server not attached yet
      console.error(`[${level}] [${logger}] ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      return;
    }
    try {
      await this.server.sendLoggingMessage({ level, logger, data });
    } catch {
      // Don't let logging failures crash the server
    }
  }

  // Convenience methods
  debug(logger: string, data: unknown): Promise<void> {
    return this.log('debug', logger, data);
  }
  info(logger: string, data: unknown): Promise<void> {
    return this.log('info', logger, data);
  }
  notice(logger: string, data: unknown): Promise<void> {
    return this.log('notice', logger, data);
  }
  warning(logger: string, data: unknown): Promise<void> {
    return this.log('warning', logger, data);
  }
  error(logger: string, data: unknown): Promise<void> {
    return this.log('error', logger, data);
  }
  critical(logger: string, data: unknown): Promise<void> {
    return this.log('critical', logger, data);
  }
}

/** Singleton logger instance */
export const mcpLogger = new McpLogger();
