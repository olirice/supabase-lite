/**
 * E2E Tests - Mutations: UPDATE (PATCH)
 *
 * Tests PATCH requests for updating data, matching PostgREST behavior exactly.
 * Each test creates its own isolated database.
 *
 * PostgREST UPDATE behavior:
 * - PATCH /table?filters with JSON body
 * - Prefer: return=representation - returns updated rows, 200
 * - Prefer: return=minimal - returns 204 No Content
 * - Filters determine which rows to update
 * - Updates multiple rows if filter matches multiple
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

describe('E2E - Mutations: UPDATE', () => {
  describe('Single row update', () => {
    test('PATCH /users?id=eq.1 - update single user with return=representation', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            age INTEGER
          )
        `,
        `
          INSERT INTO users (id, name, email, age) VALUES
            (1, 'Alice', 'alice@example.com', 30),
            (2, 'Bob', 'bob@example.com', 25)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          name: 'Alice Updated',
          age: 31,
        }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        id: 1,
        name: 'Alice Updated',
        email: 'alice@example.com', // Unchanged
        age: 31,
      });

      adapter.close();
    });

    test('PATCH /users?id=eq.1 - update with return=minimal', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
        `INSERT INTO users (id, name) VALUES (1, 'Alice')`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ name: 'Alice Updated' }),
      });

      expect(res.status).toBe(204);
      const text = await res.text();
      expect(text).toBe('');

      adapter.close();
    });
  });

  describe('Multiple row update', () => {
    test('PATCH /users?age=gte.30 - update multiple rows', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, status TEXT)`,
        `
          INSERT INTO users (id, name, age, status) VALUES
            (1, 'Alice', 30, 'pending'),
            (2, 'Bob', 25, 'pending'),
            (3, 'Charlie', 35, 'pending')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?age=gte.30', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(2); // Alice and Charlie
      expect(data.every((u: any) => u.status === 'active')).toBe(true);

      adapter.close();
    });

    test('PATCH /users - update all rows (no filter)', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, status TEXT)`,
        `
          INSERT INTO users (id, status) VALUES
            (1, 'pending'),
            (2, 'pending'),
            (3, 'pending')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(3);
      expect(data.every((u: any) => u.status === 'active')).toBe(true);

      adapter.close();
    });
  });

  describe('Partial updates', () => {
    test('PATCH /users?id=eq.1 - update single field', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, age INTEGER)`,
        `INSERT INTO users (id, name, email, age) VALUES (1, 'Alice', 'alice@example.com', 30)`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ age: 31 }), // Only update age
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data[0]).toMatchObject({
        name: 'Alice', // Unchanged
        email: 'alice@example.com', // Unchanged
        age: 31, // Updated
      });

      adapter.close();
    });

    test('PATCH /users?id=eq.1 - set field to NULL', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, bio TEXT)`,
        `INSERT INTO users (id, name, bio) VALUES (1, 'Alice', 'Some bio')`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bio: null }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data[0].bio).toBeNull();

      adapter.close();
    });
  });

  describe('Complex filters', () => {
    test('PATCH /users with AND filter', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, active INTEGER)`,
        `
          INSERT INTO users (id, name, age, active) VALUES
            (1, 'Alice', 30, 1),
            (2, 'Bob', 25, 1),
            (3, 'Charlie', 35, 0)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?age=gte.30&active=eq.1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'UPDATED' }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(1); // Only Alice
      expect(data[0].name).toBe('UPDATED');

      adapter.close();
    });
  });

  describe('No rows matched', () => {
    test('PATCH /users?id=eq.999 - no matching rows', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
        `INSERT INTO users (id, name) VALUES (1, 'Alice')`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      });

      // PostgREST returns 200 with empty array when no rows match
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual([]);

      adapter.close();
    });

    test('PATCH /users?id=eq.999 - no matching rows with return=minimal', async () => {
      const adapter = createTestDb(
        `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
        `INSERT INTO users (id, name) VALUES (1, 'Alice')`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.999', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ name: 'Updated' }),
      });

      // PostgREST returns 204 even when no rows match
      expect(res.status).toBe(204);

      adapter.close();
    });
  });

  describe('Error cases', () => {
    test('PATCH /nonexistent - table not found', async () => {
      const adapter = createTestDb(`CREATE TABLE users (id INTEGER PRIMARY KEY)`);

      const app = createServer({ db: adapter });

      const res = await app.request('/nonexistent?id=eq.1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      });

      expect(res.status).toBe(404);

      adapter.close();
    });

    test('PATCH /users - invalid JSON', async () => {
      const adapter = createTestDb(`CREATE TABLE users (id INTEGER PRIMARY KEY)`);

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      });

      expect(res.status).toBe(400);

      adapter.close();
    });

    test('PATCH /users - empty body', async () => {
      const adapter = createTestDb(`CREATE TABLE users (id INTEGER PRIMARY KEY)`);

      const app = createServer({ db: adapter });

      const res = await app.request('/users?id=eq.1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // Empty object
      });

      // Should succeed but do nothing
      expect(res.status).toBe(200);

      adapter.close();
    });
  });
});
