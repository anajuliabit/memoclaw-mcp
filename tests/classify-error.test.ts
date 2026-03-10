import { describe, it, expect } from 'vitest';

// Set required env vars before importing index (which calls loadConfig on init)
process.env.MEMOCLAW_PRIVATE_KEY = '0x4c0883a69102937d6231471b5dbb6204fe512961708279f15a8f7e20b4e3b1fb';

import { classifyError } from '../src/classify-error.js';

describe('classifyError', () => {
  it('returns UNKNOWN for falsy input', () => {
    expect(classifyError(null)).toBe('UNKNOWN');
    expect(classifyError(undefined)).toBe('UNKNOWN');
    expect(classifyError('')).toBe('UNKNOWN');
    expect(classifyError(0)).toBe('UNKNOWN');
  });

  // --- Timeout (must come before cancellation tests) ---
  it('classifies timeout errors', () => {
    expect(classifyError(new Error('Request timed out after 30000ms'))).toBe('TIMEOUT');
    expect(classifyError(new Error('Connection timeout'))).toBe('TIMEOUT');
    expect(classifyError(new Error('ETIMEDOUT'))).toBe('TIMEOUT');
  });

  it('classifies ECONNABORTED as TIMEOUT, not CANCELLED', () => {
    // ECONNABORTED contains "aborted" which previously matched CANCELLED
    expect(classifyError(new Error('ECONNABORTED'))).toBe('TIMEOUT');
  });

  // --- Cancellation ---
  it('classifies CancellationError by name', () => {
    const err = new Error('something');
    err.name = 'CancellationError';
    expect(classifyError(err)).toBe('CANCELLED');
  });

  it('classifies "cancelled" in message', () => {
    expect(classifyError(new Error('Request cancelled by client'))).toBe('CANCELLED');
  });

  it('classifies "aborted" in message (non-ECONNABORTED)', () => {
    expect(classifyError(new Error('The operation was aborted'))).toBe('CANCELLED');
  });

  // --- Validation ---
  it('classifies validation errors', () => {
    expect(classifyError(new Error('id is required'))).toBe('VALIDATION_ERROR');
    expect(classifyError(new Error('importance must be a number'))).toBe('VALIDATION_ERROR');
    expect(classifyError(new Error('content cannot be empty'))).toBe('VALIDATION_ERROR');
    expect(classifyError(new Error('namespace contains invalid characters'))).toBe('VALIDATION_ERROR');
    expect(classifyError(new Error('content exceeds 8192 character limit'))).toBe('VALIDATION_ERROR');
    expect(classifyError(new Error('foo is not a valid date'))).toBe('VALIDATION_ERROR');
    expect(classifyError(new Error('no valid update fields'))).toBe('VALIDATION_ERROR');
  });

  // --- Rate limiting ---
  it('classifies HTTP 429 as RATE_LIMITED', () => {
    expect(classifyError(new Error('HTTP 429: Too Many Requests'))).toBe('RATE_LIMITED');
    expect(classifyError(new Error('http 429'))).toBe('RATE_LIMITED');
  });

  it('classifies rate limit phrases', () => {
    expect(classifyError(new Error('rate limit exceeded'))).toBe('RATE_LIMITED');
    expect(classifyError(new Error('too many requests'))).toBe('RATE_LIMITED');
  });

  it('does NOT false-match bare "429" without HTTP prefix', () => {
    expect(classifyError(new Error('connected to port 429'))).not.toBe('RATE_LIMITED');
    expect(classifyError(new Error('item 429 not found'))).not.toBe('RATE_LIMITED');
  });

  // --- Payment required ---
  it('classifies HTTP 402 as PAYMENT_REQUIRED', () => {
    expect(classifyError(new Error('HTTP 402: Payment Required'))).toBe('PAYMENT_REQUIRED');
    expect(classifyError(new Error('http 402'))).toBe('PAYMENT_REQUIRED');
  });

  it('classifies payment phrases', () => {
    expect(classifyError(new Error('payment required'))).toBe('PAYMENT_REQUIRED');
    expect(classifyError(new Error('x402 payment needed'))).toBe('PAYMENT_REQUIRED');
  });

  it('does NOT false-match bare "402" without HTTP prefix', () => {
    expect(classifyError(new Error('room 402 is unavailable'))).not.toBe('PAYMENT_REQUIRED');
  });

  // --- API errors ---
  it('classifies HTTP errors as API_ERROR', () => {
    expect(classifyError(new Error('HTTP 500: Internal Server Error'))).toBe('API_ERROR');
    expect(classifyError(new Error('HTTP 503: Service Unavailable'))).toBe('API_ERROR');
    expect(classifyError(new Error('bad status code'))).toBe('API_ERROR');
  });

  it('does NOT false-match non-HTTP numbers (issue #153)', () => {
    expect(classifyError(new Error('port 4500 unavailable'))).toBe('UNKNOWN');
    expect(classifyError(new Error('error code 404'))).toBe('UNKNOWN');
    expect(classifyError(new Error('allocated 512 bytes'))).toBe('UNKNOWN');
  });

  // --- UNKNOWN fallback ---
  it('returns UNKNOWN for unrecognized errors', () => {
    expect(classifyError(new Error('something went wrong'))).toBe('UNKNOWN');
    expect(classifyError('a plain string error')).toBe('UNKNOWN');
    expect(classifyError(42)).toBe('UNKNOWN');
  });

  // --- String input ---
  it('handles string input (non-Error)', () => {
    expect(classifyError('HTTP 500: oops')).toBe('API_ERROR');
    expect(classifyError('request cancelled')).toBe('CANCELLED');
  });
});
