/**
 * E2E Tests - single() and maybeSingle() with Supabase Client
 *
 * Tests the single object response functionality using the official @supabase/supabase-js client.
 * This validates that our Accept header and cardinality checking works correctly with
 * the real Supabase client library.
 *
 * - single(): Returns single object, errors if 0 or >1 results
 * - maybeSingle(): Returns single object or null, errors if >1 results
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';
import { createClient } from '@supabase/supabase-js';

let server: any;
let adapter: SqliteAdapter;
let supabase: ReturnType<typeof createClient>;
let serverUrl: string;

describe('E2E - single() and maybeSingle() (Supabase Client)', () => {
  beforeAll(async () => {
    // Create test database
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        age INTEGER
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        status TEXT DEFAULT 'draft',
        author_id INTEGER,
        FOREIGN KEY (author_id) REFERENCES users(id)
      );

      -- Insert test data
      INSERT INTO users (id, name, email, age) VALUES
        (1, 'Alice', 'alice@example.com', 30),
        (2, 'Bob', 'bob@example.com', 25),
        (3, 'Charlie', 'charlie@example.com', 35);

      INSERT INTO posts (id, title, content, status, author_id) VALUES
        (1, 'Unique Post', 'Content 1', 'published', 1),
        (2, 'Draft Post 1', 'Content 2', 'draft', 1),
        (3, 'Draft Post 2', 'Content 3', 'draft', 2),
        (4, 'Published Post', 'Content 4', 'published', 2);
    `);

    adapter = new SqliteAdapter(db);
    const coreApp = createServer({ db: adapter });

    // Mount at /rest/v1 for Supabase client
    const { Hono } = await import('hono');
    const app = new Hono();
    app.route('/rest/v1', coreApp);

    // Start server
    const port = 8767;
    serverUrl = `http://localhost:${port}`;

    server = (await import('@hono/node-server')).serve({
      fetch: app.fetch,
      port,
    });

    // Create Supabase client
    supabase = createClient(serverUrl, 'fake-anon-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // Give server time to start
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  afterAll(() => {
    if (server && typeof server.close === 'function') {
      server.close();
    }
    if (adapter) {
      adapter.close();
    }
  });

  describe('single() - expect exactly one result', () => {
    test('returns single object when exactly one row matches', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', 1)
        .single();

      expect(error).toBeNull();
      expect(data).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        age: 30
      });
      expect(Array.isArray(data)).toBe(false);
    });

    test('errors when zero rows match', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', 999)
        .single();

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toContain('0');
    });

    test('errors when multiple rows match', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('status', 'draft')
        .single();

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toContain('multiple');
    });

    test('works with column selection', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id,name,email')
        .eq('email', 'bob@example.com')
        .single();

      expect(error).toBeNull();
      expect(data).toEqual({
        id: 2,
        name: 'Bob',
        email: 'bob@example.com'
      });
      expect(data).not.toHaveProperty('age');
    });

    test('works with resource embedding', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('id,title,author:users(name,email)')
        .eq('id', 1)
        .single();

      expect(error).toBeNull();
      expect(data).toEqual({
        id: 1,
        title: 'Unique Post',
        author: {
          name: 'Alice',
          email: 'alice@example.com'
        }
      });
    });

    test('works with filters and ordering', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .gte('age', 30)
        .order('age', { ascending: true })
        .limit(1)
        .single();

      expect(error).toBeNull();
      expect(data?.name).toBe('Alice'); // Age 30, youngest of >= 30
    });

    test('works with unique constraint query', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id,name')
        .eq('email', 'charlie@example.com')
        .single();

      expect(error).toBeNull();
      expect(data).toEqual({
        id: 3,
        name: 'Charlie'
      });
    });
  });

  describe('maybeSingle() - expect zero or one result', () => {
    test('returns single object when exactly one row matches', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        age: 30
      });
      expect(Array.isArray(data)).toBe(false);
    });

    test('returns null when zero rows match (not an error)', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', 999)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    test('errors when multiple rows match', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('status', 'draft')
        .maybeSingle();

      expect(data).toBeNull();
      expect(error).not.toBeNull();
      expect(error?.message).toContain('multiple');
    });

    test('works with column selection', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id,name')
        .eq('email', 'bob@example.com')
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toEqual({
        id: 2,
        name: 'Bob'
      });
    });

    test('works with resource embedding', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('title,author:users(name)')
        .eq('id', 1)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toEqual({
        title: 'Unique Post',
        author: {
          name: 'Alice'
        }
      });
    });

    test('returns null for filtered query with no matches', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*')
        .eq('status', 'archived')
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    test('works with limit(1) when multiple could match', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('id,title')
        .eq('status', 'draft')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toEqual({
        id: 2,
        title: 'Draft Post 1'
      });
    });
  });

  describe('Comparison with normal queries', () => {
    test('normal query returns array, single returns object', async () => {
      const normalResult = await supabase
        .from('users')
        .select('*')
        .eq('id', 1);

      const singleResult = await supabase
        .from('users')
        .select('*')
        .eq('id', 1)
        .single();

      expect(normalResult.error).toBeNull();
      expect(singleResult.error).toBeNull();

      expect(Array.isArray(normalResult.data)).toBe(true);
      expect(Array.isArray(singleResult.data)).toBe(false);

      expect(normalResult.data).toHaveLength(1);
      expect(normalResult.data![0]).toEqual(singleResult.data);
    });

    test('normal query with no results returns empty array, maybeSingle returns null', async () => {
      const normalResult = await supabase
        .from('users')
        .select('*')
        .eq('id', 999);

      const maybeSingleResult = await supabase
        .from('users')
        .select('*')
        .eq('id', 999)
        .maybeSingle();

      expect(normalResult.error).toBeNull();
      expect(maybeSingleResult.error).toBeNull();

      expect(normalResult.data).toEqual([]);
      expect(maybeSingleResult.data).toBeNull();
    });
  });

  describe('Real-world usage patterns', () => {
    test('fetch user by unique email (typical single() use case)', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id,name,email')
        .eq('email', 'alice@example.com')
        .single();

      expect(error).toBeNull();
      expect(data?.email).toBe('alice@example.com');
    });

    test('fetch user profile with maybe (user might not exist)', async () => {
      const { data: exists, error: error1 } = await supabase
        .from('users')
        .select('*')
        .eq('email', 'alice@example.com')
        .maybeSingle();

      const { data: notExists, error: error2 } = await supabase
        .from('users')
        .select('*')
        .eq('email', 'nobody@example.com')
        .maybeSingle();

      expect(error1).toBeNull();
      expect(error2).toBeNull();
      expect(exists).not.toBeNull();
      expect(notExists).toBeNull();
    });

    test('fetch post with author details (single with embedding)', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select(`
          id,
          title,
          content,
          author:users(name,email)
        `)
        .eq('id', 1)
        .single();

      expect(error).toBeNull();
      expect(data).toMatchObject({
        id: 1,
        title: 'Unique Post',
        author: {
          name: 'Alice'
        }
      });
    });
  });
});
