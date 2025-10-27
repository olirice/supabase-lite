/**
 * E2E Tests - Mutations: DELETE
 *
 * Tests DELETE requests for deleting data, matching PostgREST behavior exactly.
 * Each test creates its own isolated database.
 *
 * PostgREST DELETE behavior:
 * - DELETE /table?filters
 * - Prefer: return=representation - returns deleted rows, 200
 * - Prefer: return=minimal - returns 204 No Content
 * - Filters determine which rows to delete
 * - Deletes multiple rows if filter matches multiple
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

describe('E2E - Mutations: DELETE', () => {
  describe('Single row delete', () => {
    test('DELETE /users?id=eq.1 - delete single user with return=representation', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)`,
        `
          INSERT INTO users (id, name, email) VALUES
            (1, 'Alice', 'alice@example.com'),
            (2, 'Bob', 'bob@example.com')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=representation' },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
      });

      // Verify row was actually deleted
      const remaining = await app.request('/users');
      const remainingData = await remaining.json();
      expect(remainingData).toHaveLength(1);
      expect(remainingData[0].id).toBe(2);

      adapter.close();
    });

    test('DELETE /users?id=eq.1 - delete with return=minimal', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
        `INSERT INTO users (id, name) VALUES (1, 'Alice')`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=minimal' },
      });

      expect(res.status).toBe(204);
      const text = await res.text();
      expect(text).toBe('');

      adapter.close();
    });

    test('DELETE /users?id=eq.1 - default behavior (return=minimal)', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
        `INSERT INTO users (id, name) VALUES (1, 'Alice')`
      );

      const app = createServer({ db: adapter });

      // No Prefer header - should default to return=minimal per PostgREST
      const res = await app.request('/users?id=eq.1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);

      adapter.close();
    });
  });

  describe('Multiple row delete', () => {
    test('DELETE /users?status=eq.inactive - delete multiple rows', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, status TEXT)`,
        `
          INSERT INTO users (id, name, status) VALUES
            (1, 'Alice', 'active'),
            (2, 'Bob', 'inactive'),
            (3, 'Charlie', 'inactive'),
            (4, 'Diana', 'active')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?status=eq.inactive', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=representation' },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data.map((u: any) => u.name).sort()).toEqual(['Bob', 'Charlie']);

      // Verify only 2 rows remain
      const remaining = await app.request('/users');
      const remainingData = await remaining.json();
      expect(remainingData).toHaveLength(2);

      adapter.close();
    });

    test('DELETE /users - delete all rows (no filter)', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
        `
          INSERT INTO users (id, name) VALUES
            (1, 'Alice'),
            (2, 'Bob'),
            (3, 'Charlie')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=representation' },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(3);

      // Verify table is empty
      const remaining = await app.request('/users');
      const remainingData = await remaining.json();
      expect(remainingData).toHaveLength(0);

      adapter.close();
    });
  });

  describe('Complex filters', () => {
    test('DELETE /users with AND filter', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, active INTEGER)`,
        `
          INSERT INTO users (id, name, age, active) VALUES
            (1, 'Alice', 30, 1),
            (2, 'Bob', 25, 1),
            (3, 'Charlie', 35, 0),
            (4, 'Diana', 32, 1)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?age=gte.30&active=eq.1', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=representation' },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(2); // Alice and Diana
      expect(data.map((u: any) => u.name).sort()).toEqual(['Alice', 'Diana']);

      adapter.close();
    });

    test('DELETE /users with OR filter', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, status TEXT)`,
        `
          INSERT INTO users (id, name, status) VALUES
            (1, 'Alice', 'pending'),
            (2, 'Bob', 'active'),
            (3, 'Charlie', 'inactive')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?or=(status.eq.pending,status.eq.inactive)', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=representation' },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data.map((u: any) => u.name).sort()).toEqual(['Alice', 'Charlie']);

      adapter.close();
    });
  });

  describe('No rows matched', () => {
    test('DELETE /users?id=eq.999 - no matching rows', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
        `INSERT INTO users (id, name) VALUES (1, 'Alice')`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.999', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=representation' },
      });

      // PostgREST returns 200 with empty array when no rows match
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual([]);

      adapter.close();
    });

    test('DELETE /users?id=eq.999 - no matching rows with return=minimal', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
        `INSERT INTO users (id, name) VALUES (1, 'Alice')`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.999', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=minimal' },
      });

      // PostgREST returns 204 even when no rows match
      expect(res.status).toBe(204);

      adapter.close();
    });
  });

  describe('Foreign key constraints', () => {
    test('DELETE /users - cascade delete posts', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post 1', 1),
            (2, 'Post 2', 1);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'DELETE',
        headers: { 'Prefer': 'return=representation' },
      });

      expect(res.status).toBe(200);

      // Verify posts were cascade deleted
      const posts = await app.request('/posts');
      const postsData = await posts.json();
      expect(postsData).toHaveLength(0);

      adapter.close();
    });

    test('DELETE /users - foreign key violation', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, author_id) VALUES (1, 'Post 1', 1);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'DELETE',
      });

      // Should fail with foreign key constraint error
      expect(res.status).toBe(400);

      adapter.close();
    });
  });

  describe('Error cases', () => {
    test('DELETE /nonexistent - table not found', async () => {
      const adapter = createTestDb(`CREATE TABLE users (id INTEGER PRIMARY KEY)`);

      const app = createServer({ db: adapter });

      const res = await app.request('/nonexistent?id=eq.1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);

      adapter.close();
    });
  });

  describe('Soft delete pattern', () => {
    test('PATCH to set deleted_at instead of DELETE', async () => {
      // This tests that PATCH can be used for soft deletes
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT)`,
        `INSERT INTO users (id, name, deleted_at) VALUES (1, 'Alice', NULL)`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleted_at: '2024-01-01' }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data[0].deleted_at).toBe('2024-01-01');

      adapter.close();
    });
  });
});
