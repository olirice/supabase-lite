/**
 * E2E Test - Auth Demo with Supabase-JS Client
 *
 * Tests the exact flow from the Jupyter notebook using the official Supabase client.
 * This verifies that the Python client should work the same way.
 *
 * Flow:
 * 1. Query as anon → expect 2 posts (published only)
 * 2. Sign up new user
 * 3. Login with credentials
 * 4. Query as authenticated → expect 3 posts (including unpublished)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';
import { SqliteRLSProvider } from '../../src/rls/storage.js';
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import { createClient } from '@supabase/supabase-js';
import { generateAnonKey } from '../../src/auth/jwt.js';
import { policy } from '../../src/rls/policy-builder.js';

const PORT = 54324;
const BASE_URL = `http://localhost:${PORT}`;
const JWT_SECRET = 'test-secret-for-auth-demo';
const ANON_KEY = generateAnonKey(JWT_SECRET);

describe('E2E - Auth Demo with Supabase Client (Jupyter Notebook Flow)', () => {
  let db: Database.Database;
  let adapter: SqliteAdapter;
  let server: Server;
  let supabase: ReturnType<typeof createClient>;

  beforeAll(async () => {
    // Create database
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create schema - exact same as auth-rls-demo.ts
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

    // Insert exact same data as auth-rls-demo.ts
    const systemUserId = '00000000-0000-0000-0000-000000000001';
    const demoUserId = '00000000-0000-0000-0000-000000000002';

    db.exec(`
      INSERT INTO posts (id, title, content, user_id, published) VALUES
        (1, 'Welcome to PostgREST-Lite', 'This is a public post everyone can see', '${systemUserId}', 1),
        (2, 'Getting Started Guide', 'Learn how to use this API', '${systemUserId}', 1),
        (3, 'Draft: Private Thoughts', 'Only I can see this', '${demoUserId}', 0);
    `);

    adapter = new SqliteAdapter(db);

    // Set up RLS - exact same policies as auth-rls-demo.ts
    const rlsProvider = new SqliteRLSProvider(db);
    await rlsProvider.enableRLS('posts');

    // Policy 1: Anonymous users can only read published posts
    await rlsProvider.createPolicy({
      name: 'anon_read_published',
      tableName: 'posts',
      command: 'SELECT',
      role: 'anon',
      using: policy.eq('published', 1),
    });

    // Policy 2: Authenticated users can read ALL posts
    await rlsProvider.createPolicy({
      name: 'auth_read_all',
      tableName: 'posts',
      command: 'SELECT',
      role: 'authenticated',
      using: policy.alwaysAllow(), // No restrictions
    });

    // Create server
    const app = createServer({
      db: adapter,
      cors: {
        origin: '*',
        credentials: true,
      },
      auth: {
        enabled: true,
        jwtSecret: JWT_SECRET,
        goTrue: true, // Enable GoTrue-compatible endpoints for Supabase client
      },
      rls: {
        enabled: true,
      },
    });

    // Start server
    server = serve({
      fetch: app.fetch,
      port: PORT,
    });

    // Wait for server
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create Supabase client
    supabase = createClient(BASE_URL, ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  });

  afterAll(() => {
    if (server) {
      server.close();
    }
    if (db) {
      db.close();
    }
  });

  test('Complete flow: anon → signup → login → authenticated (Jupyter notebook)', async () => {
    // ============================================================
    // STEP 1: Query as anonymous user
    // ============================================================
    console.log('\n📋 STEP 1: Query as anonymous user');

    const { data: anonData, error: anonError } = await supabase
      .from('posts')
      .select('id,title,published')
      .order('id', { ascending: true });

    console.log('Anon query result:', { count: anonData?.length, data: anonData });

    expect(anonError).toBeNull();
    expect(anonData).toBeDefined();
    expect(anonData).toHaveLength(2); // Should only see published posts
    expect(anonData![0].id).toBe(1);
    expect(anonData![0].published).toBe(1);
    expect(anonData![1].id).toBe(2);
    expect(anonData![1].published).toBe(1);
    // Should NOT see id=3 (unpublished)
    expect(anonData!.find(p => p.id === 3)).toBeUndefined();

    // ============================================================
    // STEP 2: Sign up new user
    // ============================================================
    console.log('\n📋 STEP 2: Sign up new user');

    const { data: signupData, error: signupError } = await supabase.auth.signUp({
      email: 'alice@example.com',
      password: 'password123',
    });

    console.log('Signup result:', {
      user: signupData?.user?.id,
      session: signupData?.session ? 'exists' : 'none',
      error: signupError
    });

    expect(signupError).toBeNull();
    expect(signupData?.user).toBeDefined();
    expect(signupData?.user?.email).toBe('alice@example.com');

    // ============================================================
    // STEP 3: Login (may not be needed if signup returns session)
    // ============================================================
    console.log('\n📋 STEP 3: Login');

    const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
      email: 'alice@example.com',
      password: 'password123',
    });

    console.log('Login result:', {
      user: loginData?.user?.id,
      session: loginData?.session ? 'exists' : 'none',
      token: loginData?.session?.access_token ? 'exists' : 'none',
      error: loginError
    });

    expect(loginError).toBeNull();
    expect(loginData?.session).toBeDefined();
    expect(loginData?.session?.access_token).toBeDefined();
    expect(loginData?.user?.email).toBe('alice@example.com');

    // ============================================================
    // STEP 4: Query as authenticated user
    // ============================================================
    console.log('\n📋 STEP 4: Query as authenticated user');

    // The session should be automatically set by signInWithPassword
    // But let's verify we're authenticated
    const { data: sessionData } = await supabase.auth.getSession();
    console.log('Current session:', {
      exists: !!sessionData?.session,
      access_token: sessionData?.session?.access_token ? 'exists' : 'none'
    });

    const { data: authData, error: authError } = await supabase
      .from('posts')
      .select('id,title,published')
      .order('id', { ascending: true });

    console.log('Authenticated query result:', {
      count: authData?.length,
      data: authData
    });

    expect(authError).toBeNull();
    expect(authData).toBeDefined();

    // THIS IS THE KEY TEST: Authenticated users should see ALL 3 posts
    expect(authData).toHaveLength(3);
    expect(authData![0].id).toBe(1);
    expect(authData![0].published).toBe(1);
    expect(authData![1].id).toBe(2);
    expect(authData![1].published).toBe(1);

    // CRITICAL: Should now see the unpublished post (id=3)
    expect(authData![2].id).toBe(3);
    expect(authData![2].published).toBe(0);

    console.log('\n✅ SUCCESS: Authenticated user can see unpublished post!');
  });

  test('Verify auth token is being sent correctly', async () => {
    // Sign up and login
    await supabase.auth.signUp({
      email: 'bob@example.com',
      password: 'test123',
    });

    const { data: loginData } = await supabase.auth.signInWithPassword({
      email: 'bob@example.com',
      password: 'test123',
    });

    expect(loginData?.session?.access_token).toBeDefined();

    // Query to trigger auth
    const { data, error } = await supabase
      .from('posts')
      .select('id,published');

    console.log('Token verification query:', {
      tokenExists: !!loginData?.session?.access_token,
      resultCount: data?.length,
      error
    });

    expect(error).toBeNull();
    expect(data).toHaveLength(3); // Should see all posts when authenticated
  });

  test('Direct comparison: anon vs authenticated queries', async () => {
    // Create a fresh client without auth
    const anonClient = createClient(BASE_URL, ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Query as anon
    const { data: anonPosts } = await anonClient
      .from('posts')
      .select('id')
      .order('id');

    console.log('Anon posts:', anonPosts?.map(p => p.id));
    expect(anonPosts).toHaveLength(2);

    // Create authenticated client
    const authClient = createClient(BASE_URL, ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    await authClient.auth.signUp({
      email: 'charlie@example.com',
      password: 'test123',
    });

    await authClient.auth.signInWithPassword({
      email: 'charlie@example.com',
      password: 'test123',
    });

    // Query as authenticated
    const { data: authPosts } = await authClient
      .from('posts')
      .select('id')
      .order('id');

    console.log('Authenticated posts:', authPosts?.map(p => p.id));
    expect(authPosts).toHaveLength(3);
    expect(authPosts?.map(p => p.id)).toEqual([1, 2, 3]);
  });
});
