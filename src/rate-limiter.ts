/**
 * Simple in-memory sliding window rate limiter.
 * No external dependencies. Tracks request counts per key within configurable time windows.
 */
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Periodically clean up expired entries to prevent memory leaks
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref(); // Don't prevent process exit
  }

  /**
   * Check if a request is allowed under the rate limit.
   * @param key - Identifier (e.g. IP address, "global")
   * @param limit - Maximum requests allowed in the window
   * @param windowMs - Window duration in milliseconds
   * @returns Object with `allowed` boolean and `retryAfterMs` (ms until window resets, 0 if allowed)
   */
  check(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
    if (limit <= 0) return { allowed: true, retryAfterMs: 0 }; // Disabled

    const now = Date.now();
    const entry = this.windows.get(key);

    if (!entry || now >= entry.resetAt) {
      // Window expired or first request — start new window
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (entry.count >= limit) {
      // Rate limited
      return { allowed: false, retryAfterMs: entry.resetAt - now };
    }

    entry.count++;
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Remove expired entries */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) {
        this.windows.delete(key);
      }
    }
  }

  /** Stop the cleanup timer (for graceful shutdown) */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export interface RateLimitConfig {
  /** Per-IP requests per window (default 60, 0 to disable) */
  perIpLimit: number;
  /** Global requests per window (default 200, 0 to disable) */
  globalLimit: number;
  /** Session creation per IP per window (default 10, 0 to disable) */
  sessionLimit: number;
  /** Window size in ms (default 60000 = 1 minute) */
  windowMs: number;
}

export function loadRateLimitConfig(): RateLimitConfig {
  const windowMs = parseInt(process.env.MEMOCLAW_RATE_LIMIT_WINDOW_MS || '', 10) || 60_000;
  const perIpLimit = parseEnvInt('MEMOCLAW_RATE_LIMIT', 60);
  const globalLimit = parseEnvInt('MEMOCLAW_GLOBAL_RATE_LIMIT', 200);
  const sessionLimit = parseEnvInt('MEMOCLAW_SESSION_RATE_LIMIT', 10);

  return { perIpLimit, globalLimit, sessionLimit, windowMs };
}

function parseEnvInt(envVar: string, defaultVal: number): number {
  const raw = process.env[envVar];
  if (raw === undefined || raw === '') return defaultVal;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? defaultVal : parsed;
}

/**
 * Extract client IP from request, respecting X-Forwarded-For if present.
 */
export function getClientIp(req: import('node:http').IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress || 'unknown';
}
