import { describe, it, expect } from 'vitest';
import { validateIdentifier, validateId, validateTags, validateQuery, validateISODate } from '../src/validate.js';

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
