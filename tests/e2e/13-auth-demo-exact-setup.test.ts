/**
 * E2E Tests - Auth Demo Exact Setup
 *
 * Tests the exact RLS configuration from examples/auth-rls-demo.ts
 * where authenticated users have `using: 'true'` (can see ALL posts).
 *
 * This verifies that the server correctly applies unrestricted RLS policies.
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

describe('E2E - Auth Demo Exact Setup (using: true for authenticated)', () => {
  let db: Database.Database;
  let adapter: SqliteAdapter;
  let server: Server;
  const PORT = 54323; // Different port to avoid conflicts
  const BASE_URL = `http://localhost:${PORT}`;
  const ANON_KEY = createTestAnonKey(TEST_JWT_SECRET);
  const JWT_SECRET = TEST_JWT_SECRET;

  beforeAll(async () => {
    // Create database and adapter
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create schema - exactly as in auth-rls-demo.ts
    db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
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

    // Policy 1: Anonymous users can only read published posts
    await rlsProvider.createPolicy({
      name: 'anon_read_published',
      tableName: 'posts',
      command: 'SELECT',
      role: 'anon',
      using: policy.eq('published', 1),
    });

    // Policy 2: Authenticated users can read ALL posts (using: alwaysAllow)
    // This is the key difference from the standard e2e test
    await rlsProvider.createPolicy({
      name: 'auth_read_all',
      tableName: 'posts',
      command: 'SELECT',
      role: 'authenticated',
      using: policy.alwaysAllow(), // No restrictions - can see everything
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
    db.exec('DELETE FROM posts');
    db.exec('DELETE FROM auth_users');
    db.exec('DELETE FROM auth_sessions');

    // Insert test data - exactly as in auth-rls-demo.ts
    // Using placeholder user IDs that will be updated in tests
    db.exec(`
      INSERT INTO posts (id, title, content, user_id, published) VALUES
        (1, 'Welcome to PostgREST-Lite', 'This is a public post...', 'system-user', 1),
        (2, 'Getting Started Guide', 'Learn how to use this API', 'system-user', 1),
        (3, 'Draft: Private Thoughts', 'Only I can see this', 'demo-user', 0);
    `);
  });

  describe('Anonymous user - sees only published posts', () => {
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

    test('Only sees published posts (2 posts)', async () => {
      const response = await fetch(`${BASE_URL}/posts?select=id,title,published&order=id.asc`, {
        headers: {
          'apikey': ANON_KEY,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should only see 2 published posts
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe(1);
      expect(data[0].published).toBe(1);
      expect(data[1].id).toBe(2);
      expect(data[1].published).toBe(1);

      // Should NOT see unpublished post (id=3)
      expect(data.find((p: any) => p.id === 3)).toBeUndefined();
    });

    test('Cannot see unpublished posts even with explicit filter', async () => {
      const response = await fetch(`${BASE_URL}/posts?id=eq.3`, {
        headers: {
          'apikey': ANON_KEY,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveLength(0); // RLS blocks it
    });
  });

  describe('Authenticated user - sees ALL posts (using: true)', () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      // Signup a new user
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

      // Login to get auth token
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
      authToken = loginData.session.token;
      userId = loginData.user.id;

      expect(authToken).toBeDefined();
      expect(userId).toBeDefined();
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

    test('Sees ALL posts including unpublished (3 posts total)', async () => {
      const response = await fetch(`${BASE_URL}/posts?select=id,title,published&order=id.asc`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // With using: 'true', authenticated users should see ALL posts
      expect(data).toHaveLength(3);

      // Should see both published posts
      expect(data[0].id).toBe(1);
      expect(data[0].published).toBe(1);
      expect(data[1].id).toBe(2);
      expect(data[1].published).toBe(1);

      // Should ALSO see unpublished post (id=3)
      expect(data[2].id).toBe(3);
      expect(data[2].published).toBe(0);
    });

    test('Can query unpublished posts directly', async () => {
      const response = await fetch(`${BASE_URL}/posts?id=eq.3&select=id,title,published`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should see the unpublished post
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(3);
      expect(data[0].published).toBe(0);
    });

    test('Can filter to see only unpublished posts', async () => {
      const response = await fetch(`${BASE_URL}/posts?published=eq.0&select=id,title,published`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // Should see only the unpublished post
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe(3);
      expect(data[0].published).toBe(0);
    });

    test('Sees posts regardless of user_id ownership', async () => {
      // Add posts by different users
      db.exec(`
        INSERT INTO posts (id, title, user_id, published) VALUES
          (4, 'Other User Published', 'other-user-1', 1),
          (5, 'Other User Draft', 'other-user-2', 0);
      `);

      const response = await fetch(`${BASE_URL}/posts?select=id,title,user_id,published&order=id.asc`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = await response.json();

      // With using: 'true', should see ALL 5 posts regardless of ownership
      expect(data).toHaveLength(5);

      // Verify we see the other users' posts
      expect(data.find((p: any) => p.id === 4)).toBeDefined();
      expect(data.find((p: any) => p.id === 5)).toBeDefined();
    });
  });

  describe('Workflow matching Jupyter notebook', () => {
    test('Complete flow: anon query → signup → login → authenticated query', async () => {
      // Step 1: Query as anonymous user
      const anonResponse = await fetch(`${BASE_URL}/posts?select=id,title,published&order=id.asc`, {
        headers: {
          'apikey': ANON_KEY,
        },
      });
      const anonData = await anonResponse.json();
      expect(anonData).toHaveLength(2); // Only published posts
      expect(anonData[0].id).toBe(1);
      expect(anonData[1].id).toBe(2);

      // Step 2: Signup
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

      // Step 3: Login
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
      const authToken = loginData.session.token;

      // Step 4: Query as authenticated user
      const authResponse = await fetch(`${BASE_URL}/posts?select=id,title,published&order=id.asc`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });
      const authData = await authResponse.json();

      // Should now see ALL 3 posts including the unpublished one
      expect(authData).toHaveLength(3);
      expect(authData[0].id).toBe(1);
      expect(authData[0].published).toBe(1);
      expect(authData[1].id).toBe(2);
      expect(authData[1].published).toBe(1);
      expect(authData[2].id).toBe(3);
      expect(authData[2].published).toBe(0); // The unpublished post
    });
  });
});
