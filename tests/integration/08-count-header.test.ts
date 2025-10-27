/**
 * Integration Tests - Count Header Support (Prefer: count=exact)
 *
 * Tests PostgREST count header functionality for pagination.
 * The client sends Prefer: count=exact and expects Content-Range header in response.
 *
 * PostgREST Count Syntax:
 * - Prefer: count=exact - Return exact count via Content-Range header
 * - Prefer: count=planned - Use query planner estimate (not implemented for SQLite)
 * - Prefer: count=estimated - Use exact for small tables, planned for large (not implemented)
 *
 * Content-Range header format: start-end/total or star/total for count-only
 *
 * This is separate from aggregate count() which returns count as data.
 */

import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';

function createTestDb(schema: string, data?: string): SqliteAdapter {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  if (data) db.exec(data);
  return new SqliteAdapter(db);
}

describe('Integration - Count Header (Prefer: count=exact)', () => {
  describe('GET with count=exact', () => {
    test('returns Content-Range header with total count', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES
          (1, 'Post 1'), (2, 'Post 2'), (3, 'Post 3'), (4, 'Post 4'), (5, 'Post 5')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('0-4/5');

      const data = await res.json();
      expect(data).toHaveLength(5);

      adapter.close();
    });

    test('respects limit and shows correct range', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES
          (1, 'Post 1'), (2, 'Post 2'), (3, 'Post 3'), (4, 'Post 4'), (5, 'Post 5')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?limit=2', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('0-1/5');

      const data = await res.json();
      expect(data).toHaveLength(2);

      adapter.close();
    });

    test('respects offset and shows correct range', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES
          (1, 'Post 1'), (2, 'Post 2'), (3, 'Post 3'), (4, 'Post 4'), (5, 'Post 5')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?limit=2&offset=2', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('2-3/5');

      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data[0].id).toBe(3);

      adapter.close();
    });

    test('works with filters - count only matching rows', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, status TEXT)`,
        `INSERT INTO posts (id, title, status) VALUES
          (1, 'Post 1', 'published'),
          (2, 'Post 2', 'draft'),
          (3, 'Post 3', 'published'),
          (4, 'Post 4', 'draft'),
          (5, 'Post 5', 'published')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?status=eq.published', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('0-2/3');

      const data = await res.json();
      expect(data).toHaveLength(3);

      adapter.close();
    });

    test('empty result returns 0 count', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        ``
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('*/0');

      const data = await res.json();
      expect(data).toHaveLength(0);

      adapter.close();
    });

    test('filtered query with no matches returns 0 count', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, status TEXT)`,
        `INSERT INTO posts (id, title, status) VALUES (1, 'Post 1', 'published')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?status=eq.deleted', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('*/0');

      const data = await res.json();
      expect(data).toHaveLength(0);

      adapter.close();
    });

    test('when offset exceeds count, returns empty with correct total', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES (1, 'Post 1'), (2, 'Post 2')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?offset=10', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('*/2');

      const data = await res.json();
      expect(data).toHaveLength(0);

      adapter.close();
    });
  });

  describe('HEAD with count=exact', () => {
    test('HEAD /table returns count without body', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES
          (1, 'Post 1'), (2, 'Post 2'), (3, 'Post 3')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts', {
        method: 'HEAD',
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('0-2/3');

      const text = await res.text();
      expect(text).toBe('');

      adapter.close();
    });

    test('HEAD with filters returns filtered count', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, status TEXT)`,
        `INSERT INTO posts (id, status) VALUES
          (1, 'published'), (2, 'draft'), (3, 'published')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?status=eq.published', {
        method: 'HEAD',
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('0-1/2');

      const text = await res.text();
      expect(text).toBe('');

      adapter.close();
    });

    test('HEAD with limit/offset shows range', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY)`,
        `INSERT INTO posts (id) VALUES (1), (2), (3), (4), (5)`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?limit=2&offset=1', {
        method: 'HEAD',
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('1-2/5');

      adapter.close();
    });
  });

  describe('Without count header', () => {
    test('no Prefer header means no Content-Range', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES (1, 'Post 1'), (2, 'Post 2')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts');

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBeNull();

      const data = await res.json();
      expect(data).toHaveLength(2);

      adapter.close();
    });

    test('Prefer: count=planned not supported, falls back to exact', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY)`,
        `INSERT INTO posts (id) VALUES (1), (2), (3)`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts', {
        headers: { 'Prefer': 'count=planned' }
      });

      expect(res.status).toBe(200);
      // For SQLite, we'll just do exact count (no query planner stats)
      expect(res.headers.get('Content-Range')).toBe('0-2/3');

      adapter.close();
    });
  });

  describe('Edge cases', () => {
    test('works with resource embedding', async () => {
      const adapter = createTestDb(
        `
        CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE posts (id INTEGER PRIMARY KEY, author_id INTEGER, title TEXT,
          FOREIGN KEY (author_id) REFERENCES users(id));
        `,
        `
        INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob');
        INSERT INTO posts (id, author_id, title) VALUES
          (1, 1, 'Post 1'), (2, 1, 'Post 2'), (3, 2, 'Post 3');
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?select=title,author:users(name)', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('0-2/3');

      const data = await res.json();
      expect(data).toHaveLength(3);
      expect(data[0]).toHaveProperty('author');

      adapter.close();
    });

    test('works with ordering', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, views INTEGER)`,
        `INSERT INTO posts (id, title, views) VALUES
          (1, 'Post 1', 100), (2, 'Post 2', 200), (3, 'Post 3', 150)`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?order=views.desc&limit=2', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('0-1/3');

      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data[0].views).toBe(200); // Ordered correctly

      adapter.close();
    });

    test('large dataset pagination', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        Array.from({ length: 100 }, (_, i) =>
          `INSERT INTO posts (id, title) VALUES (${i + 1}, 'Post ${i + 1}')`
        ).join(';')
      );

      const app = createServer({ db: adapter });

      // Page 3 (rows 20-29)
      const res = await app.request('/posts?limit=10&offset=20', {
        headers: { 'Prefer': 'count=exact' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Range')).toBe('20-29/100');

      const data = await res.json();
      expect(data).toHaveLength(10);
      expect(data[0].id).toBe(21);

      adapter.close();
    });
  });
});
