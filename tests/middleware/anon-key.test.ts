/**
 * Anon Key Middleware Tests
 *
 * Tests for anonymous API key validation middleware.
 * All API requests must include a valid JWT (anon key or user token).
 */

import { describe, test, expect } from 'vitest';
import { anonKeyMiddleware } from '../../src/middleware/anon-key.js';
import { createTestAnonKey, TEST_JWT_SECRET } from '../helpers/jwt.js';

describe('Anon Key Middleware', () => {
  const VALID_ANON_KEY = createTestAnonKey(TEST_JWT_SECRET);

  describe('Valid requests', () => {
    test('Allows request with valid anon key in apikey header', () => {
      const request = new Request('http://localhost/users', {
        headers: {
          'apikey': VALID_ANON_KEY,
        },
      });

      const middleware = anonKeyMiddleware({ jwtSecret: TEST_JWT_SECRET });
      const result = middleware(request);

      // Middleware should return null to continue processing
      expect(result).toBeNull();
    });

    test('Allows request with valid anon key in Authorization Bearer', () => {
      const request = new Request('http://localhost/users', {
        headers: {
          'Authorization': `Bearer ${VALID_ANON_KEY}`,
        },
      });

      const middleware = anonKeyMiddleware({ jwtSecret: TEST_JWT_SECRET });
      const result = middleware(request);

      expect(result).toBeNull();
    });

    test('Case-insensitive header names', () => {
      const request = new Request('http://localhost/users', {
        headers: {
          'ApiKey': VALID_ANON_KEY,  // Different casing
        },
      });

      const middleware = anonKeyMiddleware({ jwtSecret: TEST_JWT_SECRET });
      const result = middleware(request);

      expect(result).toBeNull();
    });
  });

  describe('Invalid requests', () => {
    test('Rejects request without any auth headers', () => {
      const request = new Request('http://localhost/users');

      const middleware = anonKeyMiddleware({ jwtSecret: TEST_JWT_SECRET });
      const result = middleware(request);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
    });

    test('Rejects request with invalid anon key', () => {
      const request = new Request('http://localhost/users', {
        headers: {
          'apikey': 'wrong-key',
        },
      });

      const middleware = anonKeyMiddleware({ jwtSecret: TEST_JWT_SECRET });
      const result = middleware(request);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
    });

    test('Rejects request with empty apikey header', () => {
      const request = new Request('http://localhost/users', {
        headers: {
          'apikey': '',
        },
      });

      const middleware = anonKeyMiddleware({ jwtSecret: TEST_JWT_SECRET });
      const result = middleware(request);

      expect(result).toBeInstanceOf(Response);
      expect(result?.status).toBe(401);
    });

    test('Returns JSON error response with proper structure', async () => {
      const request = new Request('http://localhost/users');

      const middleware = anonKeyMiddleware({ jwtSecret: TEST_JWT_SECRET });
      const result = middleware(request);

      expect(result).toBeInstanceOf(Response);

      const json = await result?.json();
      expect(json).toHaveProperty('message');
      expect(json).toHaveProperty('code');
      expect(json.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Disabled mode', () => {
    test('Allows all requests when disabled', () => {
      const request = new Request('http://localhost/users');

      const middleware = anonKeyMiddleware({ enabled: false, jwtSecret: TEST_JWT_SECRET });
      const result = middleware(request);

      // Should return null (continue) even without anon key
      expect(result).toBeNull();
    });
  });
});
