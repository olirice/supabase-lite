/**
 * E2E Tests with Real HTTP Server
 *
 * Tests complete auth + RLS flow using a real HTTP server and fetch requests.
 * Verifies that authentication and RLS work end-to-end with proper HTTP semantics.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';
import { SqliteRLSProvider } from '../../src/rls/storage.js';
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { createTestAnonKey, TEST_JWT_SECRET } from '../helpers/jwt.js';
import { policy } from '../../src/rls/policy-builder.js';

describe('E2E - HTTP Server with Auth + RLS', () => {
  let db: Database.Database;
  let adapter: SqliteAdapter;
  let server: Server;
  const PORT = 54321;
  const BASE_URL = `http://localhost:${PORT}`;
  const ANON_KEY = createTestAnonKey(TEST_JWT_SECRET);
  const JWT_SECRET = TEST_JWT_SECRET;

  beforeAll(async () => {
    // Create database and adapter
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create schema
    db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        user_id TEXT,
        published INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE comments (
        id INTEGER PRIMARY KEY,
        post_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        user_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id)
      );
    `);

    adapter = new SqliteAdapter(db);

    // Initialize RLS provider to create system tables
    const rlsProvider = new SqliteRLSProvider(db);

    // Enable RLS on posts table
    await rlsProvider.enableRLS('posts');
    await rlsProvider.createPolicy({
      name: 'anon_read_published',
      tableName: 'posts',
      command: 'SELECT',
      role: 'anon',
      using: policy.eq('published', 1),
    });
    await rlsProvider.createPolicy({
      name: 'auth_read_own_or_published',
      tableName: 'posts',
      command: 'SELECT',
      role: 'authenticated',
      using: policy.or(
        policy.eq('user_id', policy.authUid()),
        policy.eq('published', 1)
      ),
    });

    // Enable RLS on comments table
    await rlsProvider.enableRLS('comments');
    await rlsProvider.createPolicy({
      name: 'auth_read_own',
      tableName: 'comments',
      command: 'SELECT',
      role: 'authenticated',
      using: policy.eq('user_id', policy.authUid()),
    });

    // Create Hono app
    const app = createServer({
      db: adapter,
      cors: {
        origin: '*',
        credentials: true,
      },
      auth: {
        enabled: true,
        jwtSecret: JWT_SECRET,
      },
      rls: {
        enabled: true,
      },
    });

    // Start HTTP server
    server = serve({
      fetch: app.fetch,
      port: PORT,
    });

    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(() => {
    if (server) {
      server.close();
    }
    if (db) {
      db.close();
    }
  });

  beforeEach(() => {
    // Clear and reset data before each test
    db.exec('DELETE FROM comments');
    db.exec('DELETE FROM posts');
    db.exec(`
      INSERT INTO posts (id, title, content, user_id, published) VALUES
        (1, 'Public Post 1', 'Everyone can see this', 'user-123', 1),
        (2, 'Draft Post', 'Only author can see', 'user-123', 0),
        (3, 'Public Post 2', 'Another public post', 'user-456', 1);
    `);
  });

  describe('Anonymous user queries', () => {
    test('Can query posts without authentication', async () => {
      const response = await fetch(`${BASE_URL}/posts`, {
        headers: {
          'apikey': ANON_KEY,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test('Only sees published posts due to RLS', async () => {
      const response = await fetch(`${BASE_URL}/posts?select=id,title&order=id.asc`, {
        headers: {
          'apikey': ANON_KEY,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe(1);
      expect(data[1].id).toBe(3);
      // Should not see draft post (id=2)
    });

    test('Can filter published posts', async () => {
      const response = await fetch(`${BASE_URL}/posts?id=eq.1`, {
        headers: {
          'apikey': ANON_KEY,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Public Post 1');
    });

    test('Cannot see draft posts even with explicit filter', async () => {
      const response = await fetch(`${BASE_URL}/posts?id=eq.2`, {
        headers: {
          'apikey': ANON_KEY,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveLength(0); // RLS blocks it
    });
  });

  describe('Authentication', () => {
    test('Can signup a new user', async () => {
      const signupResponse = await fetch(`${BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      expect(signupResponse.status).toBe(201);
      const signupData = await signupResponse.json();
      expect(signupData.user).toBeDefined();
      expect(signupData.user.username).toBe('alice');
    });

    test('Can login with credentials', async () => {
      // First signup
      await fetch(`${BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      // Then login
      const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      expect(loginResponse.status).toBe(200);
      const loginData = await loginResponse.json();
      expect(loginData.session).toBeDefined();
      expect(loginData.session.token).toBeDefined();
      expect(loginData.user.username).toBe('alice');
    });
  });

  describe('Authenticated user queries', () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      // Signup and login before each test
      await fetch(`${BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
        }),
      });

      const loginData = await loginResponse.json();
      authToken = loginData.session.token;
      userId = loginData.user.id;

      // Update posts to use the real user ID
      db.prepare('UPDATE posts SET user_id = ? WHERE user_id = ?').run(userId, 'user-123');
    });

    test('Can query with JWT token', async () => {
      const response = await fetch(`${BASE_URL}/posts`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    });

    test('Can see own draft posts with RLS', async () => {
      const response = await fetch(`${BASE_URL}/posts?select=id,title&order=id.asc`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should see all posts: own draft (id=2) and all published (id=1,3)
      expect(data).toHaveLength(3);
      expect(data.find((p: any) => p.id === 2)).toBeDefined(); // Own draft
    });

    test('Cannot see other users draft posts', async () => {
      // Add a draft post by another user
      db.exec(`INSERT INTO posts (id, title, user_id, published) VALUES (4, 'Other Draft', 'other-user', 0)`);

      const response = await fetch(`${BASE_URL}/posts?select=id,title&order=id.asc`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should NOT see other user's draft (id=4)
      expect(data.find((p: any) => p.id === 4)).toBeUndefined();
    });

    test('RLS applies to filtered queries', async () => {
      const response = await fetch(`${BASE_URL}/posts?id=eq.2&select=id,title`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      const data = await response.json();

      // Can see own draft (id=2)
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(2);
    });
  });

  describe('RLS with related tables', () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      // Signup and login
      await fetch(`${BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'bob',
          password: 'password123',
        }),
      });

      const loginResponse = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'apikey': ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'bob',
          password: 'password123',
        }),
      });

      const loginData = await loginResponse.json();
      authToken = loginData.session.token;
      userId = loginData.user.id;

      // Add comments
      db.exec(`
        INSERT INTO comments (id, post_id, content, user_id) VALUES
          (1, 1, 'Comment by bob', '${userId}'),
          (2, 1, 'Comment by other', 'other-user'),
          (3, 2, 'Another by bob', '${userId}');
      `);
    });

    test('Can only see own comments', async () => {
      const response = await fetch(`${BASE_URL}/comments?select=id,content&order=id.asc`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should only see own comments (id=1,3)
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe(1);
      expect(data[1].id).toBe(3);
    });

    test('Anonymous user cannot see any comments', async () => {
      const response = await fetch(`${BASE_URL}/comments`, {
        headers: {
          'apikey': ANON_KEY,
        },
      });

      const data = await response.json();

      // No policy for anon role, should see nothing
      expect(data).toHaveLength(0);
    });
  });

  describe('Health and system endpoints', () => {
    test('Health endpoint works', async () => {
      const response = await fetch(`${BASE_URL}/health`);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('ok');
    });

    test('System tables are hidden', async () => {
      const response = await fetch(`${BASE_URL}/auth_users`, {
        headers: {
          'apikey': ANON_KEY,
        },
      });

      expect(response.status).toBe(404);
    });
  });
});
