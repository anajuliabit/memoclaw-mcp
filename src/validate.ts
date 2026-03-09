/**
 * Input validation helpers for MCP tool arguments.
 *
 * Provides fast client-side validation with clear error messages,
 * reducing unnecessary API round-trips for obviously invalid input.
 */

/** Maximum length for string identifiers (namespace, session_id, agent_id, etc.) */
const MAX_IDENTIFIER_LENGTH = 256;

/** Maximum length for tag strings */
const MAX_TAG_LENGTH = 128;

/** Maximum number of tags per memory */
const MAX_TAGS_COUNT = 50;

/** Allowed characters for identifiers: alphanumeric, dash, underscore, dot, colon */
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_\-.:@]+$/;

/**
 * Validate a string identifier parameter (namespace, session_id, agent_id, relation_type).
 * Returns undefined if value is falsy (optional params), throws on invalid.
 */
export function validateIdentifier(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`${label} exceeds ${MAX_IDENTIFIER_LENGTH} character limit (got ${value.length})`);
  }
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label} contains invalid characters. Allowed: letters, numbers, dash, underscore, dot, colon, @`);
  }
  return value;
}

/**
 * Validate an ID parameter (memory ID, relation ID).
 * Must be a non-empty string. Does not enforce UUID format since the API
 * may use other ID schemes.
 */
export function validateId(value: unknown, label = 'id'): string {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required and must be a non-empty string`);
  }
  if (value.length > MAX_IDENTIFIER_LENGTH) {
    throw new Error(`${label} exceeds ${MAX_IDENTIFIER_LENGTH} character limit`);
  }
  return value;
}

/**
 * Validate a tags array. Each tag must be a non-empty string within length limits.
 */
export function validateTags(tags: unknown, label = 'tags'): string[] | undefined {
  if (tags === undefined || tags === null) return undefined;
  if (!Array.isArray(tags)) {
    throw new Error(`${label} must be an array of strings`);
  }
  if (tags.length > MAX_TAGS_COUNT) {
    throw new Error(`${label} exceeds maximum of ${MAX_TAGS_COUNT} tags (got ${tags.length})`);
  }
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (typeof tag !== 'string' || tag.trim() === '') {
      throw new Error(`${label}[${i}] must be a non-empty string`);
    }
    if (tag.length > MAX_TAG_LENGTH) {
      throw new Error(`${label}[${i}] exceeds ${MAX_TAG_LENGTH} character limit (got ${tag.length})`);
    }
  }
  return tags as string[];
}

/**
 * Validate a query string parameter. Must be non-empty after trimming.
 */
export function validateQuery(value: unknown, label = 'query'): string {
  if (!value || typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required and cannot be empty`);
  }
  return value;
}

/** Default upper bound for limit parameters */
const DEFAULT_MAX_LIMIT = 1000;

/** Default upper bound for offset parameters */
const DEFAULT_MAX_OFFSET = 100000;

/**
 * Validate a pagination parameter (limit or offset).
 * Must be a non-negative integer within bounds.
 * Returns undefined if value is falsy (optional params), throws on invalid.
 */
export function validatePaginationParam(
  value: unknown,
  label: string,
  max?: number,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number') {
    throw new Error(`${label} must be a number`);
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer (got ${value})`);
  }
  if (value < 0) {
    throw new Error(`${label} must be non-negative (got ${value})`);
  }
  const upperBound = max ?? (label.toLowerCase().includes('offset') ? DEFAULT_MAX_OFFSET : DEFAULT_MAX_LIMIT);
  if (value > upperBound) {
    throw new Error(`${label} exceeds maximum of ${upperBound} (got ${value})`);
  }
  return value;
}

/**
 * Validate an ISO 8601 date string parameter (expires_at, after, before).
 * Returns undefined if value is falsy (optional params), throws on invalid.
 * Accepts any string that `new Date()` can parse to a valid date.
 */
export function validateISODate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`${label} is not a valid date. Use ISO 8601 format, e.g. "2025-12-31T23:59:59Z".`);
  }
  return value;
}
