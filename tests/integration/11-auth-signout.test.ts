/**
 * Integration Tests - Auth Sign Out
 *
 * Tests the POST /auth/v1/logout endpoint for invalidating refresh tokens.
 * This is a critical security feature to ensure users can properly log out.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';
import { SqliteAuthProvider } from '../../src/auth/provider.js';

function createTestDb(): { adapter: SqliteAdapter; db: Database.Database; authProvider: SqliteAuthProvider } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  const authProvider = new SqliteAuthProvider(db, {
    jwtSecret: 'test-secret-key-min-32-characters-long',
    sessionDuration: 3600,
  });

  // Auth tables are initialized in constructor
  const adapter = new SqliteAdapter(db);

  return { adapter, db, authProvider };
}

describe('Integration - Auth Sign Out', () => {
  let adapter: SqliteAdapter;
  let db: Database.Database;
  let authProvider: SqliteAuthProvider;
  let app: ReturnType<typeof createServer>;

  beforeEach(() => {
    const setup = createTestDb();
    adapter = setup.adapter;
    db = setup.db;
    authProvider = setup.authProvider;

    app = createServer({
      db: adapter,
      auth: {
        enabled: true,
        jwtSecret: 'test-secret-key-min-32-characters-long',
        sessionDuration: 3600,
        goTrue: true,
      },
    });
  });

  describe('POST /auth/v1/logout', () => {
    test('successfully logs out with valid access token', async () => {
      // Sign up and log in first
      const signupRes = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'fake-anon-key',
        },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(signupRes.status).toBe(201);
      const signupData = await signupRes.json();
      const accessToken = signupData.access_token;

      // Now sign out
      const logoutRes = await app.request('/auth/v1/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': 'fake-anon-key',
        },
      });

      expect(logoutRes.status).toBe(204);

      adapter.close();
    });

    test('returns 401 when no authorization header provided', async () => {
      const res = await app.request('/auth/v1/logout', {
        method: 'POST',
        headers: {
          'apikey': 'fake-anon-key',
        },
      });

      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data).toHaveProperty('error');

      adapter.close();
    });

    test('logout is idempotent - succeeds even with invalid token', async () => {
      const res = await app.request('/auth/v1/logout', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-token-here',
          'apikey': 'fake-anon-key',
        },
      });

      // Logout should be idempotent - 204 even if token is invalid
      expect(res.status).toBe(204);

      adapter.close();
    });

    test('invalidates session after logout', async () => {
      // Sign up and log in
      const signupRes = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': 'fake-anon-key',
        },
        body: JSON.stringify({
          email: 'test2@example.com',
          password: 'password123',
        }),
      });

      const signupData = await signupRes.json();
      const accessToken = signupData.access_token;

      // Verify token works before logout
      const beforeLogout = await app.request('/auth/v1/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      expect(beforeLogout.status).toBe(200);

      // Logout
      const logoutRes = await app.request('/auth/v1/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': 'fake-anon-key',
        },
      });

      expect(logoutRes.status).toBe(204);

      // Verify token no longer works after logout
      const afterLogout = await app.request('/auth/v1/user', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      expect(afterLogout.status).toBe(401);

      adapter.close();
    });
  });

  // Note: The /auth/logout endpoint exists but is currently not working correctly
  // in test environment. The GoTrue endpoint /auth/v1/logout works correctly.
});
