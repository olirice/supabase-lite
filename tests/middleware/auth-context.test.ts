/**
 * Auth Context Middleware Tests
 *
 * Tests for middleware that extracts auth info from requests
 * and injects RequestContext with role and user ID.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { authContextMiddleware } from '../../src/middleware/auth-context.js';
import { SqliteAuthProvider } from '../../src/auth/provider.js';
import type { ContextRequest } from '../../src/middleware/types.js';
import { TEST_JWT_SECRET } from '../helpers/jwt.js';

describe('Auth Context Middleware', () => {
  let db: Database.Database;
  let authProvider: SqliteAuthProvider;

  beforeEach(() => {
    db = new Database(':memory:');
    authProvider = new SqliteAuthProvider(db, {
      jwtSecret: TEST_JWT_SECRET,
      sessionDuration: 3600,
    });
  });

  describe('Authenticated requests', () => {
    test('Injects authenticated context for valid JWT token', async () => {
      // Create user and login
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');

      const request = new Request('http://localhost/users', {
        headers: {
          'Authorization': `Bearer ${session.token}`,
        },
      }) as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);
      const result = await middleware(request);

      // Middleware should inject context and return null (continue)
      expect(result).toBeNull();
      expect(request.context).toBeDefined();
      expect(request.context?.role).toBe('authenticated');
      expect(request.context?.uid).toBe(session.user.id);
    });

    test('Supports Authorization header without Bearer prefix', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');

      const request = new Request('http://localhost/users', {
        headers: {
          'Authorization': session.token,
        },
      }) as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);
      await middleware(request);

      expect(request.context?.role).toBe('authenticated');
      expect(request.context?.uid).toBe(session.user.id);
    });

    test('Case-insensitive Authorization header', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');

      const request = new Request('http://localhost/users', {
        headers: {
          'authorization': `Bearer ${session.token}`,
        },
      }) as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);
      await middleware(request);

      expect(request.context?.role).toBe('authenticated');
    });
  });

  describe('Anonymous requests', () => {
    test('Injects anon context when no Authorization header', async () => {
      const request = new Request('http://localhost/users') as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);
      const result = await middleware(request);

      expect(result).toBeNull();
      expect(request.context).toBeDefined();
      expect(request.context?.role).toBe('anon');
      expect(request.context?.uid).toBeUndefined();
    });

    test('Injects anon context for invalid JWT token', async () => {
      const request = new Request('http://localhost/users', {
        headers: {
          'Authorization': 'Bearer invalid-token',
        },
      }) as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);
      await middleware(request);

      expect(request.context?.role).toBe('anon');
      expect(request.context?.uid).toBeUndefined();
    });

    test('Injects anon context for expired token', async () => {
      // Create provider with very short session
      const shortSessionProvider = new SqliteAuthProvider(db, {
        jwtSecret: TEST_JWT_SECRET,
        sessionDuration: -1, // Expired
      });

      await shortSessionProvider.signup('alice', 'password123');
      const session = await shortSessionProvider.login('alice', 'password123');

      const request = new Request('http://localhost/users', {
        headers: {
          'Authorization': `Bearer ${session.token}`,
        },
      }) as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);
      await middleware(request);

      expect(request.context?.role).toBe('anon');
      expect(request.context?.uid).toBeUndefined();
    });

    test('Injects anon context for empty Authorization header', async () => {
      const request = new Request('http://localhost/users', {
        headers: {
          'Authorization': '',
        },
      }) as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);
      await middleware(request);

      expect(request.context?.role).toBe('anon');
    });
  });

  describe('Multiple requests', () => {
    test('Each request gets its own context', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');

      const request1 = new Request('http://localhost/users') as ContextRequest;
      const request2 = new Request('http://localhost/users', {
        headers: {
          'Authorization': `Bearer ${session.token}`,
        },
      }) as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);

      await middleware(request1);
      await middleware(request2);

      expect(request1.context?.role).toBe('anon');
      expect(request2.context?.role).toBe('authenticated');
      expect(request2.context?.uid).toBe(session.user.id);
    });
  });

  describe('Error handling', () => {
    test('Does not throw for malformed Authorization header', async () => {
      const request = new Request('http://localhost/users', {
        headers: {
          'Authorization': 'NotBearer xyz',
        },
      }) as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);

      await expect(middleware(request)).resolves.not.toThrow();
      expect(request.context?.role).toBe('anon');
    });

    test('Does not throw for corrupted JWT', async () => {
      const request = new Request('http://localhost/users', {
        headers: {
          'Authorization': 'Bearer not.a.valid.jwt',
        },
      }) as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);

      await expect(middleware(request)).resolves.not.toThrow();
      expect(request.context?.role).toBe('anon');
    });
  });

  describe('Context immutability', () => {
    test('Context object is readonly', async () => {
      const request = new Request('http://localhost/users') as ContextRequest;

      const middleware = authContextMiddleware(authProvider, TEST_JWT_SECRET);
      await middleware(request);

      // TypeScript should enforce readonly, but let's verify runtime behavior
      expect(request.context).toBeDefined();
      expect(Object.isFrozen(request.context)).toBe(true);
    });
  });
});
