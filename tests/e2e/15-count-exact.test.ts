/**
 * E2E Tests - Count Exact with Supabase Client
 *
 * Tests the count: 'exact' functionality using the official @supabase/supabase-js client.
 * This validates that our Content-Range header implementation works correctly with
 * the real Supabase client library.
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

describe('E2E - Count Exact (Supabase Client)', () => {
  beforeAll(async () => {
    // Create test database
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL
      );

      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        views INTEGER DEFAULT 0,
        author_id INTEGER,
        FOREIGN KEY (author_id) REFERENCES users(id)
      );

      -- Insert test data: 25 posts
      INSERT INTO users (id, name, email) VALUES
        (1, 'Alice', 'alice@example.com'),
        (2, 'Bob', 'bob@example.com');
    `);

    // Insert 25 posts
    for (let i = 1; i <= 25; i++) {
      const status = i % 3 === 0 ? 'published' : 'draft';
      const author_id = i % 2 === 0 ? 2 : 1;
      db.exec(`
        INSERT INTO posts (id, title, status, views, author_id)
        VALUES (${i}, 'Post ${i}', '${status}', ${i * 10}, ${author_id})
      `);
    }

    adapter = new SqliteAdapter(db);
    const coreApp = createServer({ db: adapter });

    // Mount at /rest/v1 for Supabase client
    const { Hono } = await import('hono');
    const app = new Hono();
    app.route('/rest/v1', coreApp);

    // Start server
    const port = 8766;
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

  describe('Basic count functionality', () => {
    test('select all with exact count', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' });

      expect(error).toBeNull();
      expect(data).toHaveLength(25);
      expect(count).toBe(25);
    });

    test('select with limit still returns total count', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .limit(10);

      expect(error).toBeNull();
      expect(data).toHaveLength(10);
      expect(count).toBe(25); // Total count, not just returned rows
    });

    test('select with offset and limit', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .range(10, 19); // offset 10, get 10 rows (10-19 inclusive)

      expect(error).toBeNull();
      expect(data).toHaveLength(10);
      expect(count).toBe(25);
      expect(data![0]!.id).toBe(11); // First row is id=11
    });

    test('select specific columns with count', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('id,title', { count: 'exact' });

      expect(error).toBeNull();
      expect(data).toHaveLength(25);
      expect(count).toBe(25);
      expect(data![0]).toHaveProperty('id');
      expect(data![0]).toHaveProperty('title');
      expect(data![0]).not.toHaveProperty('status');
    });
  });

  describe('Count with filters', () => {
    test('count with eq filter', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .eq('status', 'published');

      expect(error).toBeNull();
      expect(data!.length).toBeGreaterThan(0);
      expect(count).toBe(8); // 25 posts, every 3rd is published (3,6,9,12,15,18,21,24)
      expect(data).toHaveLength(8);
    });

    test('count with gte filter', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .gte('views', 150);

      expect(error).toBeNull();
      expect(count).toBe(11); // views >= 150 means id >= 15
      expect(data).toHaveLength(11);
    });

    test('count with multiple filters', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .eq('status', 'published')
        .gte('views', 100);

      expect(error).toBeNull();
      expect(count).toBeGreaterThan(0);
      expect(data!.every((p: any) => p.status === 'published')).toBe(true);
      expect(data!.every((p: any) => p.views >= 100)).toBe(true);
    });

    test('count with filter that matches nothing', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .eq('status', 'deleted');

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
      expect(count).toBe(0);
    });
  });

  describe('Count with ordering', () => {
    test('count with order by', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .order('views', { ascending: false })
        .limit(5);

      expect(error).toBeNull();
      expect(data).toHaveLength(5);
      expect(count).toBe(25);
      // Should be ordered by views descending
      expect(data![0]!.views).toBeGreaterThan(data![1]!.views);
    });
  });

  describe('Pagination scenarios', () => {
    test('paginate through all results', async () => {
      const pageSize = 10;
      const pages: any[][] = [];
      let totalCount = 0;

      // Page 1
      const page1 = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .range(0, pageSize - 1);

      expect(page1.error).toBeNull();
      expect(page1.data).toHaveLength(10);
      expect(page1.count).toBe(25);
      pages.push(page1.data!);
      totalCount = page1.count!;

      // Page 2
      const page2 = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .range(10, 19);

      expect(page2.error).toBeNull();
      expect(page2.data).toHaveLength(10);
      expect(page2.count).toBe(25);
      pages.push(page2.data!);

      // Page 3 (partial)
      const page3 = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .range(20, 29);

      expect(page3.error).toBeNull();
      expect(page3.data).toHaveLength(5); // Only 5 rows left
      expect(page3.count).toBe(25);
      pages.push(page3.data!);

      // Verify we got all rows
      const allIds = pages.flat().map((p) => p.id);
      expect(allIds).toHaveLength(25);
      expect(new Set(allIds).size).toBe(25); // All unique
    });

    test('calculate number of pages', async () => {
      const pageSize = 7;

      const { count } = await supabase
        .from('posts')
        .select('id', { count: 'exact', head: true });

      expect(count).toBe(25);
      const numPages = Math.ceil(count! / pageSize);
      expect(numPages).toBe(4); // 25 / 7 = 3.57, rounded up to 4
    });
  });

  describe('Count with resource embedding', () => {
    test('count with embedded resource', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('id,title,author:users(name)', { count: 'exact' })
        .limit(5);

      expect(error).toBeNull();
      expect(data).toHaveLength(5);
      expect(count).toBe(25);
      expect(data![0]).toHaveProperty('author');
      expect(data![0]!.author).toHaveProperty('name');
    });
  });

  describe('Head option (count without data)', () => {
    test('head: true returns count but no data', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact', head: true });

      expect(error).toBeNull();
      expect(data).toBeNull(); // No data returned with head
      expect(count).toBe(25);
    });

    test('head with filters returns filtered count', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'published');

      expect(error).toBeNull();
      expect(data).toBeNull();
      expect(count).toBe(8);
    });

    test('head is faster for count-only queries', async () => {
      // Both should work, but head is conceptually for count-only
      const start1 = Date.now();
      const { count: count1 } = await supabase
        .from('posts')
        .select('*', { count: 'exact', head: true });
      const time1 = Date.now() - start1;

      const start2 = Date.now();
      const { count: count2 } = await supabase
        .from('posts')
        .select('*', { count: 'exact' });
      const time2 = Date.now() - start2;

      expect(count1).toBe(25);
      expect(count2).toBe(25);
      // Both should be fast for small dataset, just verify both work
    });
  });

  describe('Edge cases', () => {
    // Note: Skipping "count on empty table" test as it requires schema cache invalidation
    // which is not easily accessible from e2e test context. The feature is tested in integration tests.

    test('without count option, count is null', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*');

      expect(error).toBeNull();
      expect(data).toHaveLength(25);
      expect(count).toBeNull(); // No count requested
    });

    test('count with limit=0 returns count but no rows', async () => {
      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .limit(0);

      expect(error).toBeNull();
      expect(data).toHaveLength(0);
      expect(count).toBe(25);
    });
  });

  describe('Real-world pagination UI scenario', () => {
    test('build pagination UI with count', async () => {
      const pageSize = 10;
      const currentPage = 2; // 0-indexed

      const { data, error, count } = await supabase
        .from('posts')
        .select('*', { count: 'exact' })
        .range(currentPage * pageSize, (currentPage + 1) * pageSize - 1);

      expect(error).toBeNull();

      // Calculate pagination metadata
      const totalPages = Math.ceil(count! / pageSize);
      const hasNextPage = currentPage < totalPages - 1;
      const hasPrevPage = currentPage > 0;

      expect(count).toBe(25);
      expect(totalPages).toBe(3); // 25 / 10 = 3 pages
      expect(data).toHaveLength(5); // Page 3 has only 5 items
      expect(hasNextPage).toBe(false); // On last page
      expect(hasPrevPage).toBe(true); // Not on first page
    });
  });
});
