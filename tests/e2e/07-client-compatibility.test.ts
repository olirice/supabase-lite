/**
 * E2E Tests - Supabase Client Compatibility
 *
 * Tests using the actual @supabase/supabase-js client library (which uses postgrest-js).
 * This proves that real-world PostgREST clients work with our implementation.
 *
 * If these tests pass, it means any application using supabase-js can work
 * with supabase-lite as a partially-compatible alternative (for supported features).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';
import { createClient } from '@supabase/supabase-js';

// We'll start a local server and point the Supabase client at it
let server: any;
let adapter: SqliteAdapter;
let supabase: ReturnType<typeof createClient>;
let serverUrl: string;

describe('E2E - Supabase Client Compatibility', () => {
  beforeAll(async () => {
    // Create test database with schema
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    // Create comprehensive schema for testing
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT,
        author_id INTEGER NOT NULL,
        status TEXT DEFAULT 'draft',
        view_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (author_id) REFERENCES users(id)
      );

      CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES posts(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      -- Insert test data
      INSERT INTO users (id, name, email, age, status) VALUES
        (1, 'Alice', 'alice@example.com', 30, 'active'),
        (2, 'Bob', 'bob@example.com', 25, 'active'),
        (3, 'Charlie', 'charlie@example.com', 35, 'inactive');

      INSERT INTO posts (id, title, content, author_id, status, view_count) VALUES
        (1, 'First Post', 'Hello world', 1, 'published', 100),
        (2, 'Second Post', 'More content', 1, 'draft', 0),
        (3, 'Third Post', 'Even more', 2, 'published', 50);

      INSERT INTO comments (id, post_id, user_id, content) VALUES
        (1, 1, 2, 'Great post!'),
        (2, 1, 3, 'Thanks for sharing'),
        (3, 3, 1, 'Interesting');
    `);

    adapter = new SqliteAdapter(db);
    const coreApp = createServer({ db: adapter });

    // Supabase client expects routes at /rest/v1/*
    // So we'll wrap our app and mount it at that path
    const { Hono } = await import('hono');
    const app = new Hono();

    // Mount our PostgREST app at /rest/v1
    app.route('/rest/v1', coreApp);

    // Start local server
    const port = 8765;
    serverUrl = `http://localhost:${port}`;

    server = (await import('@hono/node-server')).serve({
      fetch: app.fetch,
      port,
    });

    // Create Supabase client pointing to our server
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

  describe('Basic Queries', () => {
    test('select all rows', async () => {
      const { data, error } = await supabase.from('users').select('*');

      expect(error).toBeNull();
      expect(data).toHaveLength(3);
      expect(data?.[0]).toHaveProperty('name');
    });

    test('select specific columns', async () => {
      const { data, error } = await supabase.from('users').select('id,name,email');

      expect(error).toBeNull();
      expect(data).toHaveLength(3);
      expect(data?.[0]).toHaveProperty('name');
      expect(data?.[0]).not.toHaveProperty('age');
    });

    test('filter with eq', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('name', 'Alice');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.name).toBe('Alice');
    });

    test('filter with gte', async () => {
      const { data, error} = await supabase
        .from('users')
        .select('*')
        .gte('age', 30);

      expect(error).toBeNull();
      expect(data).toHaveLength(2); // Alice (30) and Charlie (35)
    });

    test('multiple filters (AND)', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('status', 'active')
        .gte('age', 26);

      expect(error).toBeNull();
      expect(data).toHaveLength(1); // Alice
      expect(data?.[0]?.name).toBe('Alice');
    });

    test('or filter', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .or('name.eq.Alice,name.eq.Bob');

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    });

    test('in filter', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .in('name', ['Alice', 'Bob']);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    });

    test('like pattern matching', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .like('email', '%@example.com');

      expect(error).toBeNull();
      expect(data).toHaveLength(3);
    });

    test('ilike case-insensitive', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .ilike('name', 'ALICE');

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.name).toBe('Alice');
    });

    test('is null / is not null', async () => {
      // Create a user with null age
      await supabase.from('users').insert({ name: 'Dave', email: 'dave@example.com', age: null });

      const { data: nullAge } = await supabase
        .from('users')
        .select('*')
        .is('age', null);

      expect(nullAge).toHaveLength(1);
      expect(nullAge?.[0]?.name).toBe('Dave');

      const { data: notNullAge } = await supabase
        .from('users')
        .select('*')
        .not('age', 'is', null);

      expect(notNullAge?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Ordering and Pagination', () => {
    test('order by ascending', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .not('age', 'is', null) // Exclude null ages
        .order('age', { ascending: true });

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      // Check ordering
      for (let i = 0; i < data!.length - 1; i++) {
        expect(data![i]!.age).toBeLessThanOrEqual(data![i + 1]!.age);
      }
    });

    test('order by descending', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('age', { ascending: false });

      expect(error).toBeNull();
      expect(data?.[0]?.age).toBeGreaterThanOrEqual(data?.[1]?.age || 0);
    });

    test('limit results', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .limit(2);

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    });

    test('limit with offset', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .range(1, 2); // offset 1, limit 2

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
    });
  });

  describe('Resource Embedding', () => {
    test('many-to-one: posts with author', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('id,title,author:users(name,email)');

      expect(error).toBeNull();
      expect(data).toHaveLength(3);
      expect(data?.[0]).toHaveProperty('author');
      expect(data?.[0]?.author).toHaveProperty('name');
      expect(data?.[0]?.author).not.toHaveProperty('age');
    });

    test('one-to-many: users with posts', async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id,name,posts(id,title)');

      expect(error).toBeNull();
      expect(data).toHaveLength(4); // 3 original + Dave
      const alice = data?.find((u: any) => u.name === 'Alice');
      expect(alice?.posts).toHaveLength(2);
    });

    test('nested embedding', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('title,author:users(name,posts(title))');

      expect(error).toBeNull();
      expect(data?.[0]?.author).toHaveProperty('name');
      expect(data?.[0]?.author).toHaveProperty('posts');
    });
  });

  describe('Mutations - Insert', () => {
    test('insert single row', async () => {
      const { data, error } = await supabase
        .from('users')
        .insert({ name: 'Eve', email: 'eve@example.com', age: 28 })
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.name).toBe('Eve');
      expect(data?.[0]).toHaveProperty('id');
    });

    test('insert multiple rows', async () => {
      const { data, error } = await supabase
        .from('users')
        .insert([
          { name: 'Frank', email: 'frank@example.com', age: 40 },
          { name: 'Grace', email: 'grace@example.com', age: 22 },
        ])
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(2);
      expect(data?.[0]?.name).toBe('Frank');
      expect(data?.[1]?.name).toBe('Grace');
    });
  });

  describe('Mutations - Update', () => {
    test('update with filter', async () => {
      const { data, error } = await supabase
        .from('users')
        .update({ status: 'inactive' })
        .eq('name', 'Eve')
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.status).toBe('inactive');
    });

    test('update multiple rows', async () => {
      const { data, error } = await supabase
        .from('users')
        .update({ status: 'verified' })
        .gte('age', 30)
        .select();

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Mutations - Delete', () => {
    test('delete with filter', async () => {
      const { data, error } = await supabase
        .from('users')
        .delete()
        .eq('name', 'Frank')
        .select();

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.name).toBe('Frank');
    });

    test('verify deletion', async () => {
      const { data } = await supabase
        .from('users')
        .select('*')
        .eq('name', 'Frank');

      expect(data).toHaveLength(0);
    });
  });

  describe('Aggregates', () => {
    test('count all rows', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('*');

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(3);
    });

    // Note: supabase-js doesn't directly expose aggregate functions like sum/avg
    // in the same way PostgREST does, but we can test via raw select
    // The count: 'exact' feature requires Content-Range headers which we haven't implemented yet
  });

  describe('Complex Queries', () => {
    test('combination of filters, embedding, and ordering', async () => {
      const { data, error } = await supabase
        .from('posts')
        .select('id,title,view_count,author:users(name)')
        .eq('status', 'published')
        .gte('view_count', 50)
        .order('view_count', { ascending: false });

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThanOrEqual(1);
      expect(data?.[0]?.author).toHaveProperty('name');
    });

    test('multiple nested embeddings', async () => {
      const { data, error } = await supabase
        .from('comments')
        .select('content,post:posts(title,author:users(name)),user:users(name)');

      expect(error).toBeNull();
      expect(data?.[0]).toHaveProperty('post');
      expect(data?.[0]).toHaveProperty('user');
      expect(data?.[0]?.post).toHaveProperty('author');
    });
  });
});
