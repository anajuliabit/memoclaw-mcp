/** Error codes for structured error responses (MCP 2025-06-18). */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'API_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'PAYMENT_REQUIRED'
  | 'CANCELLED'
  | 'UNKNOWN';

/**
 * Classify an error into a structured error code.
 * Inspects the error message and known error types to determine the category.
 *
 * Ordering matters: more specific checks (timeout, cancellation) come before
 * broader ones (HTTP/API) to avoid mis-classification. In particular, timeout
 * is checked before cancellation so that ECONNABORTED (which contains "aborted")
 * is correctly classified as TIMEOUT rather than CANCELLED.
 */
export function classifyError(error: unknown): ErrorCode {
  if (!error) return 'UNKNOWN';

  const name = error instanceof Error ? error.name : '';
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

  // Timeout (checked before cancellation so ECONNABORTED → TIMEOUT, not CANCELLED)
  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout') ||
    msg.includes('econnaborted')
  ) {
    return 'TIMEOUT';
  }

  // Cancellation (from MCP notifications/cancelled)
  if (name === 'CancellationError' || msg.includes('cancelled') || msg.includes('aborted')) {
    return 'CANCELLED';
  }

  // Validation errors (client-side input validation)
  if (
    msg.includes('is required') ||
    msg.includes('must be') ||
    msg.includes('cannot be empty') ||
    msg.includes('invalid characters') ||
    msg.includes('exceeds') ||
    msg.includes('not a valid') ||
    msg.includes('no valid update fields')
  ) {
    return 'VALIDATION_ERROR';
  }

  // Rate limiting — match "HTTP 429" pattern or descriptive phrases, not bare "429"
  if (/\bhttp\s+429\b/.test(msg) || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'RATE_LIMITED';
  }

  // Payment required (x402) — match "HTTP 402" pattern or descriptive phrases, not bare "402"
  if (/\bhttp\s+402\b/.test(msg) || msg.includes('payment required') || msg.includes('x402')) {
    return 'PAYMENT_REQUIRED';
  }

  // HTTP/API errors — match "HTTP" or "status" keywords only; the standalone
  // /\b[45]\d{2}\b/ regex was removed because it false-matched non-HTTP numbers
  // like "port 4500" or "limit of 500" (see issue #153).
  if (msg.includes('http') || msg.includes('status')) {
    return 'API_ERROR';
  }

  return 'UNKNOWN';
}
