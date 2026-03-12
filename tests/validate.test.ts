import { describe, it, expect } from 'vitest';
import {
  validateIdentifier,
  validateId,
  validateTags,
  validateQuery,
  validateISODate,
  validatePaginationParam,
  validateMetadata,
} from '../src/validate.js';

describe('validateIdentifier', () => {
  it('returns undefined for undefined/null/empty', () => {
    expect(validateIdentifier(undefined, 'ns')).toBeUndefined();
    expect(validateIdentifier(null, 'ns')).toBeUndefined();
    expect(validateIdentifier('', 'ns')).toBeUndefined();
  });

  it('accepts valid identifiers', () => {
    expect(validateIdentifier('default', 'ns')).toBe('default');
    expect(validateIdentifier('my-project', 'ns')).toBe('my-project');
    expect(validateIdentifier('agent_123', 'ns')).toBe('agent_123');
    expect(validateIdentifier('ns.sub', 'ns')).toBe('ns.sub');
    expect(validateIdentifier('user:abc', 'ns')).toBe('user:abc');
    expect(validateIdentifier('user@agent', 'ns')).toBe('user@agent');
  });

  it('rejects non-string values', () => {
    expect(() => validateIdentifier(123, 'ns')).toThrow('must be a string');
    expect(() => validateIdentifier(true, 'ns')).toThrow('must be a string');
  });

  it('rejects identifiers exceeding length limit', () => {
    const long = 'a'.repeat(257);
    expect(() => validateIdentifier(long, 'ns')).toThrow('exceeds 256 character limit');
  });

  it('rejects identifiers with invalid characters', () => {
    expect(() => validateIdentifier('has space', 'ns')).toThrow('invalid characters');
    expect(() => validateIdentifier('has/slash', 'ns')).toThrow('invalid characters');
    expect(() => validateIdentifier('has<html>', 'ns')).toThrow('invalid characters');
    expect(() => validateIdentifier('emoji🎉', 'ns')).toThrow('invalid characters');
  });
});

describe('validateId', () => {
  it('accepts valid IDs', () => {
    expect(validateId('abc-123')).toBe('abc-123');
    expect(validateId('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects empty/missing IDs', () => {
    expect(() => validateId(undefined)).toThrow('required');
    expect(() => validateId(null)).toThrow('required');
    expect(() => validateId('')).toThrow('required');
    expect(() => validateId('   ')).toThrow('required');
  });

  it('rejects IDs exceeding length limit', () => {
    const long = 'x'.repeat(257);
    expect(() => validateId(long)).toThrow('exceeds 256 character limit');
  });
});

describe('validateTags', () => {
  it('returns undefined for undefined/null', () => {
    expect(validateTags(undefined)).toBeUndefined();
    expect(validateTags(null)).toBeUndefined();
  });

  it('accepts valid tag arrays', () => {
    expect(validateTags(['bug', 'feature'])).toEqual(['bug', 'feature']);
    expect(validateTags([])).toEqual([]);
  });

  it('rejects non-array', () => {
    expect(() => validateTags('not-array')).toThrow('must be an array');
  });

  it('rejects arrays with too many tags', () => {
    const many = Array.from({ length: 51 }, (_, i) => `tag${i}`);
    expect(() => validateTags(many)).toThrow('exceeds maximum of 50 tags');
  });

  it('rejects empty string tags', () => {
    expect(() => validateTags(['good', ''])).toThrow('tags[1] must be a non-empty string');
  });

  it('rejects tags exceeding length limit', () => {
    const longTag = 'x'.repeat(129);
    expect(() => validateTags([longTag])).toThrow('exceeds 128 character limit');
  });
});

describe('validateQuery', () => {
  it('accepts valid queries', () => {
    expect(validateQuery('search term')).toBe('search term');
  });

  it('rejects empty/missing queries', () => {
    expect(() => validateQuery(undefined)).toThrow('required');
    expect(() => validateQuery('')).toThrow('required');
    expect(() => validateQuery('   ')).toThrow('required');
  });
});

describe('validatePaginationParam', () => {
  it('returns undefined for undefined/null', () => {
    expect(validatePaginationParam(undefined, 'limit')).toBeUndefined();
    expect(validatePaginationParam(null, 'limit')).toBeUndefined();
  });

  it('accepts valid non-negative integers', () => {
    expect(validatePaginationParam(0, 'limit')).toBe(0);
    expect(validatePaginationParam(10, 'limit')).toBe(10);
    expect(validatePaginationParam(100, 'offset')).toBe(100);
  });

  it('rejects non-number values', () => {
    expect(() => validatePaginationParam('10' as unknown as number, 'limit')).toThrow('must be a number');
    expect(() => validatePaginationParam(true as unknown as number, 'limit')).toThrow('must be a number');
  });

  it('rejects non-integer values', () => {
    expect(() => validatePaginationParam(10.5, 'limit')).toThrow('must be an integer');
    expect(() => validatePaginationParam(0.1, 'offset')).toThrow('must be an integer');
  });

  it('rejects negative values', () => {
    expect(() => validatePaginationParam(-1, 'limit')).toThrow('must be non-negative');
    expect(() => validatePaginationParam(-100, 'offset')).toThrow('must be non-negative');
  });

  it('rejects values exceeding default max for limit (1000)', () => {
    expect(() => validatePaginationParam(1001, 'limit')).toThrow('exceeds maximum of 1000');
  });

  it('rejects values exceeding default max for offset (100000)', () => {
    expect(() => validatePaginationParam(100001, 'offset')).toThrow('exceeds maximum of 100000');
  });

  it('respects custom max', () => {
    expect(validatePaginationParam(50, 'limit', 50)).toBe(50);
    expect(() => validatePaginationParam(51, 'limit', 50)).toThrow('exceeds maximum of 50');
  });
});

describe('validateISODate', () => {
  it('returns undefined for undefined/null/empty', () => {
    expect(validateISODate(undefined, 'expires_at')).toBeUndefined();
    expect(validateISODate(null, 'expires_at')).toBeUndefined();
    expect(validateISODate('', 'expires_at')).toBeUndefined();
  });

  it('accepts valid ISO 8601 dates', () => {
    expect(validateISODate('2025-12-31T23:59:59Z', 'expires_at')).toBe('2025-12-31T23:59:59Z');
    expect(validateISODate('2025-01-01T00:00:00.000Z', 'after')).toBe('2025-01-01T00:00:00.000Z');
    expect(validateISODate('2025-06-15', 'before')).toBe('2025-06-15');
    expect(validateISODate('2025-03-09T01:28:00+00:00', 'after')).toBe('2025-03-09T01:28:00+00:00');
  });

  it('rejects non-string values', () => {
    expect(() => validateISODate(123, 'expires_at')).toThrow('must be a string');
    expect(() => validateISODate(true, 'expires_at')).toThrow('must be a string');
  });

  it('rejects invalid date strings', () => {
    expect(() => validateISODate('not-a-date', 'expires_at')).toThrow('not a valid date');
    expect(() => validateISODate('2025-13-45', 'after')).toThrow('not a valid date');
    expect(() => validateISODate('yesterday', 'before')).toThrow('not a valid date');
  });
});

// ── validateSimilarity ──────────────────────────────────────────────────────

import { validateSimilarity } from '../src/validate.js';

describe('validateSimilarity', () => {
  it('returns undefined for undefined/null', () => {
    expect(validateSimilarity(undefined)).toBeUndefined();
    expect(validateSimilarity(null)).toBeUndefined();
  });

  it('accepts valid similarity values', () => {
    expect(validateSimilarity(0)).toBe(0);
    expect(validateSimilarity(0.5)).toBe(0.5);
    expect(validateSimilarity(1)).toBe(1);
    expect(validateSimilarity(0.85)).toBe(0.85);
  });

  it('rejects non-number values', () => {
    expect(() => validateSimilarity('0.5')).toThrow('must be a number');
    expect(() => validateSimilarity(true)).toThrow('must be a number');
    expect(() => validateSimilarity(NaN)).toThrow('must be a number');
  });

  it('rejects out-of-range values', () => {
    expect(() => validateSimilarity(-0.1)).toThrow('must be between 0.0 and 1.0');
    expect(() => validateSimilarity(1.1)).toThrow('must be between 0.0 and 1.0');
    expect(() => validateSimilarity(5)).toThrow('must be between 0.0 and 1.0');
  });
});

describe('validateMetadata', () => {
  it('returns undefined for undefined/null', () => {
    expect(validateMetadata(undefined)).toBeUndefined();
    expect(validateMetadata(null)).toBeUndefined();
  });

  it('accepts a valid plain object', () => {
    const obj = { key: 'value', nested: { a: 1 } };
    expect(validateMetadata(obj)).toEqual(obj);
  });

  it('accepts an empty object', () => {
    expect(validateMetadata({})).toEqual({});
  });

  it('rejects arrays', () => {
    expect(() => validateMetadata([1, 2, 3])).toThrow('must be a plain object');
  });

  it('rejects strings', () => {
    expect(() => validateMetadata('not an object')).toThrow('must be a plain object');
  });

  it('rejects numbers', () => {
    expect(() => validateMetadata(42)).toThrow('must be a plain object');
  });

  it('rejects booleans', () => {
    expect(() => validateMetadata(true)).toThrow('must be a plain object');
  });

  it('rejects objects with too many keys', () => {
    const bigObj: Record<string, number> = {};
    for (let i = 0; i < 51; i++) bigObj[`key${i}`] = i;
    expect(() => validateMetadata(bigObj)).toThrow('too many keys');
  });

  it('accepts objects at the key limit', () => {
    const obj: Record<string, number> = {};
    for (let i = 0; i < 50; i++) obj[`key${i}`] = i;
    expect(validateMetadata(obj)).toEqual(obj);
  });

  it('rejects objects that are too large when serialised', () => {
    const bigObj = { data: 'x'.repeat(9000) };
    expect(() => validateMetadata(bigObj)).toThrow('too large');
  });

  it('uses custom label in error messages', () => {
    expect(() => validateMetadata('bad', 'custom_field')).toThrow('custom_field must be a plain object');
  });
});
