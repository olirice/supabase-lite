/**
 * Comprehensive CRUD + RLS Tests
 *
 * Exhaustively tests all combinations of:
 * - Roles: anon, authenticated
 * - Operations: SELECT, INSERT, UPDATE, DELETE
 * - With proper RLS policies
 *
 * Total: 8 combinations (2 roles × 4 operations)
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';
import { SqliteRLSProvider } from '../../src/rls/storage.js';
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { createTestAnonKey, TEST_JWT_SECRET } from '../helpers/jwt.js';

describe('E2E - Comprehensive CRUD + RLS Tests', () => {
  let db: Database.Database;
  let adapter: SqliteAdapter;
  let server: Server;
  const PORT = 54322; // Different port to avoid conflicts
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
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        user_id TEXT,
        published INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    adapter = new SqliteAdapter(db);

    // Initialize RLS provider
    const rlsProvider = new SqliteRLSProvider(db);

    // Enable RLS on posts table
    await rlsProvider.enableRLS('posts');

    // ANON POLICIES
    // 1. SELECT: can read published posts
    await rlsProvider.createPolicy({
      name: 'anon_select_published',
      tableName: 'posts',
      command: 'SELECT',
      role: 'anon',
      using: 'published = 1',
    });

    // 2. INSERT: can create posts (but they'll be unpublished by default)
    await rlsProvider.createPolicy({
      name: 'anon_insert_posts',
      tableName: 'posts',
      command: 'INSERT',
      role: 'anon',
      withCheck: '1=1', // Allow all inserts
    });

    // 3. UPDATE: deny (no policy created)
    // 4. DELETE: deny (no policy created)

    // AUTHENTICATED POLICIES
    // 1. SELECT: can read own posts or published posts
    await rlsProvider.createPolicy({
      name: 'auth_select_own_or_published',
      tableName: 'posts',
      command: 'SELECT',
      role: 'authenticated',
      using: 'user_id = auth.uid() OR published = 1',
    });

    // 2. INSERT: can create posts but must set user_id to own ID
    await rlsProvider.createPolicy({
      name: 'auth_insert_own',
      tableName: 'posts',
      command: 'INSERT',
      role: 'authenticated',
      withCheck: 'user_id = auth.uid()',
    });

    // 3. UPDATE: can update own posts
    await rlsProvider.createPolicy({
      name: 'auth_update_own',
      tableName: 'posts',
      command: 'UPDATE',
      role: 'authenticated',
      using: 'user_id = auth.uid()',
    });

    // 4. DELETE: can delete own posts
    await rlsProvider.createPolicy({
      name: 'auth_delete_own',
      tableName: 'posts',
      command: 'DELETE',
      role: 'authenticated',
      using: 'user_id = auth.uid()',
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
    // Clear data before each test
    db.exec('DELETE FROM posts');

    // Insert test data
    db.exec(`
      INSERT INTO posts (id, title, content, user_id, published) VALUES
        (1, 'Published Post', 'Content 1', 'user-123', 1),
        (2, 'Draft Post', 'Content 2', 'user-123', 0),
        (3, 'Other Published', 'Content 3', 'user-456', 1);
    `);
  });

  describe('Anonymous Role - CRUD Operations', () => {
    describe('SELECT (anon)', () => {
      test('Can read published posts', async () => {
        const response = await fetch(`${BASE_URL}/posts?select=id,title&order=id.asc`, {
          headers: {
            'apikey': ANON_KEY,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();

        // Should only see published posts (id 1 and 3)
        expect(data).toHaveLength(2);
        expect(data[0].id).toBe(1);
        expect(data[1].id).toBe(3);
      });

      test('Cannot read draft posts even with explicit filter', async () => {
        const response = await fetch(`${BASE_URL}/posts?id=eq.2`, {
          headers: {
            'apikey': ANON_KEY,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();

        // RLS blocks draft post
        expect(data).toHaveLength(0);
      });
    });

    describe('INSERT (anon)', () => {
      test('Can insert new post', async () => {
        const response = await fetch(`${BASE_URL}/posts`, {
          method: 'POST',
          headers: {
            'apikey': ANON_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            title: 'Anon Post',
            content: 'Created by anonymous user',
            user_id: null,
            published: 0,
          }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('Anon Post');
        expect(data[0].user_id).toBeNull();
      });

      test('Can insert published post', async () => {
        const response = await fetch(`${BASE_URL}/posts`, {
          method: 'POST',
          headers: {
            'apikey': ANON_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            title: 'Public Anon Post',
            content: 'Published by anonymous',
            published: 1,
          }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('Public Anon Post');
        expect(data[0].published).toBe(1);
      });
    });

    describe('UPDATE (anon)', () => {
      test('Cannot update posts (no policy)', async () => {
        const response = await fetch(`${BASE_URL}/posts?id=eq.1`, {
          method: 'PATCH',
          headers: {
            'apikey': ANON_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            title: 'Updated Title',
          }),
        });

        // Should return 200 but with 0 rows affected (RLS blocks it)
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toHaveLength(0);

        // Verify post was not updated
        const checkResponse = await fetch(`${BASE_URL}/posts?id=eq.1`, {
          headers: {
            'apikey': ANON_KEY,
          },
        });
        const checkData = await checkResponse.json();
        expect(checkData[0].title).toBe('Published Post'); // Unchanged
      });
    });

    describe('DELETE (anon)', () => {
      test('Cannot delete posts (no policy)', async () => {
        const response = await fetch(`${BASE_URL}/posts?id=eq.1`, {
          method: 'DELETE',
          headers: {
            'apikey': ANON_KEY,
          },
        });

        // Should return 204 but with 0 rows affected (RLS blocks it)
        expect(response.status).toBe(204);

        // Verify post still exists
        const checkResponse = await fetch(`${BASE_URL}/posts?id=eq.1`, {
          headers: {
            'apikey': ANON_KEY,
          },
        });
        const checkData = await checkResponse.json();
        expect(checkData).toHaveLength(1); // Post still exists
      });
    });
  });

  describe('Authenticated Role - CRUD Operations', () => {
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
          username: 'testuser',
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
          username: 'testuser',
          password: 'password123',
        }),
      });

      const loginData = await loginResponse.json();
      authToken = loginData.session.token;
      userId = loginData.user.id;

      // Update test posts to use the real user ID
      db.prepare('UPDATE posts SET user_id = ? WHERE user_id = ?').run(userId, 'user-123');
    });

    describe('SELECT (authenticated)', () => {
      test('Can read own posts (including drafts)', async () => {
        const response = await fetch(`${BASE_URL}/posts?select=id,title&order=id.asc`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();

        // Should see own posts (1, 2) and other published (3)
        expect(data).toHaveLength(3);
        expect(data.find((p: any) => p.id === 2)).toBeDefined(); // Own draft
      });

      test('Can read specific draft post if owned', async () => {
        const response = await fetch(`${BASE_URL}/posts?id=eq.2`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });

        expect(response.status).toBe(200);
        const data = await response.json();

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('Draft Post');
      });

      test('Cannot read other users draft posts', async () => {
        // Insert draft by another user
        db.exec(`INSERT INTO posts (id, title, user_id, published) VALUES (10, 'Other Draft', 'other-user', 0)`);

        const response = await fetch(`${BASE_URL}/posts?id=eq.10`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });

        const data = await response.json();
        expect(data).toHaveLength(0); // RLS blocks it
      });
    });

    describe('INSERT (authenticated)', () => {
      test('Can insert post with own user_id', async () => {
        const response = await fetch(`${BASE_URL}/posts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            title: 'My New Post',
            content: 'Content',
            user_id: userId,
            published: 0,
          }),
        });

        expect(response.status).toBe(201);
        const data = await response.json();

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('My New Post');
        expect(data[0].user_id).toBe(userId);
      });

      test('Cannot insert post with different user_id (WITH CHECK policy)', async () => {
        const response = await fetch(`${BASE_URL}/posts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            title: 'Fake Post',
            content: 'Content',
            user_id: 'other-user-id',
            published: 0,
          }),
        });

        // WITH CHECK policy should block this
        expect(response.status).toBe(201);
        const data = await response.json();
        expect(data).toHaveLength(0); // RLS blocks it
      });
    });

    describe('UPDATE (authenticated)', () => {
      test('Can update own posts', async () => {
        const response = await fetch(`${BASE_URL}/posts?id=eq.1`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            title: 'Updated by Owner',
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();

        expect(data).toHaveLength(1);
        expect(data[0].title).toBe('Updated by Owner');
      });

      test('Cannot update other users posts', async () => {
        const response = await fetch(`${BASE_URL}/posts?id=eq.3`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            title: 'Trying to Update Others Post',
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toHaveLength(0); // RLS blocks it

        // Verify post was not updated
        const checkResponse = await fetch(`${BASE_URL}/posts?id=eq.3`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });
        const checkData = await checkResponse.json();
        expect(checkData[0].title).toBe('Other Published'); // Unchanged
      });
    });

    describe('DELETE (authenticated)', () => {
      test('Can delete own posts', async () => {
        const response = await fetch(`${BASE_URL}/posts?id=eq.1`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });

        expect(response.status).toBe(204);

        // Verify post was deleted
        const checkResponse = await fetch(`${BASE_URL}/posts?id=eq.1`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });
        const checkData = await checkResponse.json();
        expect(checkData).toHaveLength(0);
      });

      test('Cannot delete other users posts', async () => {
        const response = await fetch(`${BASE_URL}/posts?id=eq.3`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });

        expect(response.status).toBe(204);

        // Verify post still exists
        const checkResponse = await fetch(`${BASE_URL}/posts?id=eq.3`, {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        });
        const checkData = await checkResponse.json();
        expect(checkData).toHaveLength(1); // Post still exists
      });
    });
  });
});
