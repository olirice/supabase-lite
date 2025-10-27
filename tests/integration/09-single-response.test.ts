/**
 * Integration Tests - Single Object Response (Accept: application/vnd.pgrst.object+json)
 *
 * Tests PostgREST single() and maybeSingle() functionality via Accept header.
 *
 * PostgREST Single Response Syntax:
 * - Accept: application/vnd.pgrst.object+json - Return single object instead of array
 * - single() - Error if 0 or >1 results
 * - maybeSingle() - Return null if 0 results, error if >1 results
 *
 * This is separate from returning arrays - it changes the response shape from
 * [{"id":1}] to {"id":1} and enforces cardinality constraints.
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

describe('Integration - Single Object Response', () => {
  describe('GET with Accept: application/vnd.pgrst.object+json', () => {
    test('returns single object when exactly one row matches', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES (1, 'Post 1'), (2, 'Post 2')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?id=eq.1', {
        headers: { 'Accept': 'application/vnd.pgrst.object+json' }
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('application/json');

      const data = await res.json();
      expect(data).toEqual({ id: 1, title: 'Post 1' });
      expect(Array.isArray(data)).toBe(false); // Not an array!

      adapter.close();
    });

    test('returns 406 Not Acceptable when zero rows match', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES (1, 'Post 1')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?id=eq.999', {
        headers: { 'Accept': 'application/vnd.pgrst.object+json' }
      });

      expect(res.status).toBe(406);

      const error = await res.json();
      expect(error).toHaveProperty('message');
      expect(error.message).toContain('0 rows');

      adapter.close();
    });

    test('returns 406 Not Acceptable when multiple rows match', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, status TEXT)`,
        `INSERT INTO posts (id, status) VALUES (1, 'active'), (2, 'active'), (3, 'inactive')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?status=eq.active', {
        headers: { 'Accept': 'application/vnd.pgrst.object+json' }
      });

      expect(res.status).toBe(406);

      const error = await res.json();
      expect(error).toHaveProperty('message');
      expect(error.message).toContain('multiple');

      adapter.close();
    });

    test('works with column selection', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, content TEXT)`,
        `INSERT INTO posts (id, title, content) VALUES (1, 'Post 1', 'Long content here')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?select=id,title&id=eq.1', {
        headers: { 'Accept': 'application/vnd.pgrst.object+json' }
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({ id: 1, title: 'Post 1' });
      expect(data).not.toHaveProperty('content');

      adapter.close();
    });

    test('works with resource embedding', async () => {
      const adapter = createTestDb(
        `
        CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
        CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, author_id INTEGER,
          FOREIGN KEY (author_id) REFERENCES users(id));
        `,
        `
        INSERT INTO users (id, name) VALUES (1, 'Alice');
        INSERT INTO posts (id, title, author_id) VALUES (1, 'Post 1', 1);
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?select=title,author:users(name)&id=eq.1', {
        headers: { 'Accept': 'application/vnd.pgrst.object+json' }
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({
        title: 'Post 1',
        author: { name: 'Alice' }
      });

      adapter.close();
    });

    test('works with ordering (returns first row)', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, views INTEGER)`,
        `INSERT INTO posts (id, title, views) VALUES
          (1, 'Post 1', 100),
          (2, 'Post 2', 200)`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?order=views.desc&limit=1', {
        headers: { 'Accept': 'application/vnd.pgrst.object+json' }
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({ id: 2, title: 'Post 2', views: 200 });

      adapter.close();
    });
  });

  describe('GET with Prefer: return=representation-single', () => {
    test('alternative header format also works', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES (1, 'Post 1')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?id=eq.1', {
        headers: { 'Prefer': 'return=representation-single' }
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({ id: 1, title: 'Post 1' });
      expect(Array.isArray(data)).toBe(false);

      adapter.close();
    });
  });

  describe('maybeSingle behavior (Prefer: return=representation-maybe-single)', () => {
    test('returns single object when exactly one row matches', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES (1, 'Post 1')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?id=eq.1', {
        headers: { 'Prefer': 'return=representation-maybe-single' }
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({ id: 1, title: 'Post 1' });

      adapter.close();
    });

    test('returns null when zero rows match (not an error)', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES (1, 'Post 1')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?id=eq.999', {
        headers: { 'Prefer': 'return=representation-maybe-single' }
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toBeNull();

      adapter.close();
    });

    test('returns 406 when multiple rows match', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, status TEXT)`,
        `INSERT INTO posts (id, status) VALUES (1, 'active'), (2, 'active')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?status=eq.active', {
        headers: { 'Prefer': 'return=representation-maybe-single' }
      });

      expect(res.status).toBe(406);

      const error = await res.json();
      expect(error.message).toContain('multiple');

      adapter.close();
    });
  });

  describe('Without single headers', () => {
    test('normal request still returns array', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES (1, 'Post 1')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?id=eq.1');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toEqual([{ id: 1, title: 'Post 1' }]);

      adapter.close();
    });
  });

  describe('Edge cases', () => {
    test('works with limit=1 and single header', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        `INSERT INTO posts (id, title) VALUES (1, 'Post 1'), (2, 'Post 2')`
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?limit=1', {
        headers: { 'Accept': 'application/vnd.pgrst.object+json' }
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({ id: 1, title: 'Post 1' });

      adapter.close();
    });

    test('single on empty table returns 406', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        ``
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts', {
        headers: { 'Accept': 'application/vnd.pgrst.object+json' }
      });

      expect(res.status).toBe(406);

      adapter.close();
    });

    test('maybeSingle on empty table returns null', async () => {
      const adapter = createTestDb(
        `CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)`,
        ``
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts', {
        headers: { 'Prefer': 'return=representation-maybe-single' }
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toBeNull();

      adapter.close();
    });
  });
});
