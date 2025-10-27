/**
 * E2E Tests - Mutations: INSERT (POST)
 *
 * Tests POST requests for inserting data, matching PostgREST behavior exactly.
 * Each test creates its own isolated database.
 *
 * PostgREST INSERT behavior:
 * - POST /table with JSON body
 * - Prefer: return=representation (default) - returns inserted rows, 201
 * - Prefer: return=minimal - returns 201 with no body
 * - Single insert: Location header with resource URL
 * - Bulk insert: array of inserted rows
 */

import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';

/**
 * Helper to create a test database with custom schema
 */
function createTestDb(schema: string, data?: string): SqliteAdapter {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  if (data) db.exec(data);
  return new SqliteAdapter(db);
}

describe('E2E - Mutations: INSERT', () => {
  describe('Single row insert', () => {
    test('POST /users - insert single user with return=representation', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          age INTEGER
        )
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          name: 'Alice',
          email: 'alice@example.com',
          age: 30,
        }),
      });

      // Should return 201 Created
      expect(res.status).toBe(201);

      // Should have Location header with resource URL
      expect(res.headers.get('Location')).toMatch(/\/users\?id=eq\.\d+/);

      // Should return the inserted row
      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      });
      expect(data[0]).toHaveProperty('id');
      expect(typeof data[0].id).toBe('number');

      adapter.close();
    });

    test('POST /users - insert with return=minimal', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL
        )
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          name: 'Bob',
          email: 'bob@example.com',
        }),
      });

      // Should return 201 Created
      expect(res.status).toBe(201);

      // Should have Location header
      expect(res.headers.get('Location')).toMatch(/\/users\?id=eq\.\d+/);

      // Should have no body (or empty array per PostgREST)
      const text = await res.text();
      expect(text).toBe('');

      adapter.close();
    });

    test('POST /users - default behavior (return=representation)', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL
        )
      `);

      const app = createServer({ db: adapter });

      // No Prefer header - should default to return=representation
      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Charlie' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0]).toHaveProperty('id');
      expect(data[0].name).toBe('Charlie');

      adapter.close();
    });
  });

  describe('Bulk insert', () => {
    test('POST /users - insert multiple rows', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL
        )
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify([
          { name: 'Alice', email: 'alice@example.com' },
          { name: 'Bob', email: 'bob@example.com' },
          { name: 'Charlie', email: 'charlie@example.com' },
        ]),
      });

      expect(res.status).toBe(201);

      // No Location header for bulk inserts
      expect(res.headers.get('Location')).toBeNull();

      const data = await res.json();
      expect(data).toHaveLength(3);
      expect(data[0].name).toBe('Alice');
      expect(data[1].name).toBe('Bob');
      expect(data[2].name).toBe('Charlie');

      // All should have IDs
      expect(data.every((row: any) => typeof row.id === 'number')).toBe(true);

      adapter.close();
    });

    test('POST /users - bulk insert with return=minimal', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL
        )
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify([
          { name: 'User 1' },
          { name: 'User 2' },
        ]),
      });

      expect(res.status).toBe(201);
      const text = await res.text();
      expect(text).toBe('');

      adapter.close();
    });
  });

  describe('Default values and constraints', () => {
    test('POST /users - columns with defaults', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          status TEXT DEFAULT 'active',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data[0]).toHaveProperty('status', 'active');
      expect(data[0]).toHaveProperty('created_at');

      adapter.close();
    });

    test('POST /users - with explicit NULL', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          bio TEXT
        )
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Alice',
          bio: null,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data[0].bio).toBeNull();

      adapter.close();
    });
  });

  describe('Error cases', () => {
    test('POST /nonexistent - table not found', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (id INTEGER PRIMARY KEY)
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/nonexistent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }),
      });

      expect(res.status).toBe(404);
      const error = await res.json();
      expect(error).toHaveProperty('code', 'TABLE_NOT_FOUND');

      adapter.close();
    });

    test('POST /users - missing required field', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL
        )
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }), // Missing email
      });

      expect(res.status).toBe(400);
      const error = await res.json();
      expect(error).toHaveProperty('code');

      adapter.close();
    });

    test('POST /users - invalid JSON', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (id INTEGER PRIMARY KEY)
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      });

      expect(res.status).toBe(400);

      adapter.close();
    });

    test('POST /users - empty body', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (id INTEGER PRIMARY KEY)
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      expect(res.status).toBe(400);

      adapter.close();
    });
  });

  describe('Special cases', () => {
    test('POST /users - insert with foreign key', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `INSERT INTO users (id, name) VALUES (1, 'Alice')`
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'First Post',
          author_id: 1,
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data[0]).toMatchObject({
        title: 'First Post',
        author_id: 1,
      });

      adapter.close();
    });

    test('POST /users - empty array should return 201 with empty array', async () => {
      const adapter = createTestDb(`
        CREATE TABLE users (id INTEGER PRIMARY KEY)
      `);

      const app = createServer({ db: adapter });

      const res = await app.request('/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([]),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual([]);

      adapter.close();
    });
  });
});
