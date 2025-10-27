/**
 * E2E Server Integration Tests - Auth + RLS
 *
 * Tests server configuration with authentication and RLS middleware.
 * Uses Hono test client (not Supabase client yet).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';
import { SqliteRLSProvider } from '../../src/rls/storage.js';
import { createTestAnonKey, TEST_JWT_SECRET } from '../helpers/jwt.js';

describe('E2E - Server Auth + RLS Integration', () => {
  let db: Database.Database;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create schema
    db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT,
        content TEXT,
        user_id TEXT,
        published INTEGER DEFAULT 0
      );
    `);

    // Insert test data
    db.exec(`
      INSERT INTO posts (id, title, content, user_id, published) VALUES
        (1, 'Public Post', 'Content', 'user-1', 1),
        (2, 'Private Post', 'Content', 'user-1', 0),
        (3, 'Another Public', 'Content', 'user-2', 1);
    `);

    adapter = new SqliteAdapter(db);

    // Initialize RLS provider to create system tables
    // This ensures _rls_enabled_tables and _rls_policies tables exist
    new SqliteRLSProvider(db);
  });

  describe('Server configuration', () => {
    test('Creates server with auth configuration', () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      expect(app).toBeDefined();
    });

    test('Creates server with RLS configuration', () => {
      const app = createServer({
        db: adapter,
        rls: {
          enabled: true,
        },
      });

      expect(app).toBeDefined();
    });

    test('Creates server with both auth and RLS', () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          anonKey: 'test-anon-key',
          jwtSecret: 'test-jwt-secret',
        },
        rls: {
          enabled: true,
        },
      });

      expect(app).toBeDefined();
    });

    test('Creates server without auth/RLS (backwards compatible)', () => {
      const app = createServer({
        db: adapter,
      });

      expect(app).toBeDefined();
    });
  });

  describe('Anon key validation', () => {
    test('Rejects requests without anon key when auth is enabled', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      const res = await app.request('/posts');

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.code).toBe('UNAUTHORIZED');
    });

    test('Accepts requests with valid anon key', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      const res = await app.request('/posts', {
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
        },
      });

      expect(res.status).toBe(200);
    });

    test('Accepts requests with anon key in Authorization header', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      const res = await app.request('/posts', {
        headers: {
          'Authorization': `Bearer ${createTestAnonKey(TEST_JWT_SECRET)}`,
        },
      });

      expect(res.status).toBe(200);
    });

    test('Does not require anon key when auth is disabled', async () => {
      const app = createServer({
        db: adapter,
      });

      const res = await app.request('/posts');

      expect(res.status).toBe(200);
    });
  });

  describe('Auth signup endpoint', () => {
    test('Provides /auth/signup endpoint when auth is enabled', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      const res = await app.request('/auth/signup', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.user).toBeDefined();
      expect(data.user.username).toBe('alice');
    });

    test('Returns error for duplicate username', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      // First signup
      await app.request('/auth/signup', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      // Duplicate signup
      const res = await app.request('/auth/signup', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'different',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toMatch(/already exists/i);
    });
  });

  describe('Auth login endpoint', () => {
    test('Provides /auth/login endpoint when auth is enabled', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      // Signup first
      await app.request('/auth/signup', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      // Login
      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.session).toBeDefined();
      expect(data.session.token).toBeDefined();
      expect(data.user).toBeDefined();
      expect(data.user.username).toBe('alice');
    });

    test('Returns error for invalid credentials', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      const res = await app.request('/auth/login', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'nonexistent',
          password: 'wrong',
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.message).toMatch(/invalid credentials/i);
    });
  });

  describe('Auth context injection', () => {
    test('Injects anon context for unauthenticated requests', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      // This test verifies the context is injected properly
      // The actual verification would happen in RLS enforcement
      const res = await app.request('/posts', {
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
        },
      });

      expect(res.status).toBe(200);
    });

    test('Injects authenticated context for valid JWT', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      // Signup and login
      await app.request('/auth/signup', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      const loginRes = await app.request('/auth/login', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      const loginData = await loginRes.json();
      const token = loginData.session.token;

      // Make authenticated request
      const res = await app.request('/posts', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
    });
  });

  describe('RLS enforcement', () => {
    test('Enforces RLS policies when enabled', async () => {
      // Enable RLS on posts table
      db.exec(`
        INSERT INTO _rls_enabled_tables (table_name) VALUES ('posts');
        INSERT INTO _rls_policies (name, table_name, command, role, using_expr)
        VALUES ('anon_published', 'posts', 'SELECT', 'anon', 'published = 1');
      `);

      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
        rls: {
          enabled: true,
        },
      });

      const res = await app.request('/posts?select=id,title', {
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // Should only see published posts (id 1 and 3)
      expect(data).toHaveLength(2);
      expect(data.every((p: any) => p.id === 1 || p.id === 3)).toBe(true);
    });

    test('Does not enforce RLS when disabled', async () => {
      // Enable RLS on posts table
      db.exec(`
        INSERT INTO _rls_enabled_tables (table_name) VALUES ('posts');
        INSERT INTO _rls_policies (name, table_name, command, role, using_expr)
        VALUES ('anon_published', 'posts', 'SELECT', 'anon', 'published = 1');
      `);

      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
        rls: {
          enabled: false,
        },
      });

      const res = await app.request('/posts?select=id,title', {
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // Should see all posts (RLS disabled)
      expect(data).toHaveLength(3);
    });

    test('Applies different policies for authenticated users', async () => {
      // Create user and get token
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
        rls: {
          enabled: true,
        },
      });

      await app.request('/auth/signup', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      const loginRes = await app.request('/auth/login', {
        method: 'POST',
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      const loginData = await loginRes.json();
      const token = loginData.session.token;
      const userId = loginData.user.id;

      // Update test data to use real user ID
      db.prepare('UPDATE posts SET user_id = ? WHERE user_id = ?').run(userId, 'user-1');

      // Enable RLS with auth policy
      db.exec(`
        INSERT INTO _rls_enabled_tables (table_name) VALUES ('posts');
        INSERT INTO _rls_policies (name, table_name, command, role, using_expr)
        VALUES ('auth_own_or_published', 'posts', 'SELECT', 'authenticated', 'user_id = auth.uid() OR published = 1');
      `);

      // Make authenticated request
      const res = await app.request('/posts?select=id,title', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(200);
      const data = await res.json();

      // Should see own posts (1, 2) and other published (3)
      expect(data).toHaveLength(3);
    });
  });

  describe('Hidden tables', () => {
    test('Hides auth tables from REST API', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
      });

      const res = await app.request('/auth_users', {
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
        },
      });

      expect(res.status).toBe(404);
    });

    test('Hides RLS tables from REST API', async () => {
      const app = createServer({
        db: adapter,
        auth: {
          enabled: true,
          jwtSecret: TEST_JWT_SECRET,
        },
        rls: {
          enabled: true,
        },
      });

      const res1 = await app.request('/_rls_policies', {
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
        },
      });

      const res2 = await app.request('/_rls_enabled_tables', {
        headers: {
          'apikey': createTestAnonKey(TEST_JWT_SECRET),
        },
      });

      expect(res1.status).toBe(404);
      expect(res2.status).toBe(404);
    });
  });
});
