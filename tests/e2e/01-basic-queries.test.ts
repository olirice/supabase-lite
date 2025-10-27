/**
 * E2E Tests - Basic Queries
 *
 * Tests the full HTTP stack from request to response.
 * Each test creates its own database, schema, and data for complete isolation.
 *
 * Testing approach:
 * - No shared fixtures
 * - Each test is independent
 * - Tests the actual HTTP interface
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

  // Execute schema
  db.exec(schema);

  // Execute data if provided
  if (data) {
    db.exec(data);
  }

  return new SqliteAdapter(db);
}

describe('E2E - Basic Queries', () => {
  describe('Simple SELECT queries', () => {
    test('GET /users - all rows', async () => {
      // Create isolated database for this test
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
            (2, 'Bob', 'bob@example.com', 25),
            (3, 'Charlie', 'charlie@example.com', 35)
        `
      );

      // Create server
      const app = createServer({ db: adapter });

      // Make request
      const res = await app.request('/users');

      // Verify response
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(3);
      expect(data[0]).toMatchObject({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
      });

      // Cleanup
      adapter.close();
    });

    test('GET /products?select=id,name,price - column selection', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE products (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            price REAL NOT NULL,
            in_stock INTEGER DEFAULT 1
          )
        `,
        `
          INSERT INTO products (id, name, description, price, in_stock) VALUES
            (1, 'Widget', 'A useful widget', 19.99, 1),
            (2, 'Gadget', 'An amazing gadget', 29.99, 1),
            (3, 'Doohickey', 'Out of stock', 9.99, 0)
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/products?select=id,name,price');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(3);
      expect(data[0]).toMatchObject({
        id: 1,
        name: 'Widget',
        price: 19.99,
      });
      // description and in_stock should not be present
      expect(data[0]).not.toHaveProperty('description');
      expect(data[0]).not.toHaveProperty('in_stock');

      adapter.close();
    });

    test('GET /users?age=gte.30 - basic filter', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER
          )
        `,
        `
          INSERT INTO users (id, name, age) VALUES
            (1, 'Alice', 30),
            (2, 'Bob', 25),
            (3, 'Charlie', 35),
            (4, 'Diana', 28)
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/users?age=gte.30');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data.map((u: any) => u.name)).toEqual(['Alice', 'Charlie']);

      adapter.close();
    });

    test('GET /users?order=age.desc - ordering', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            age INTEGER
          )
        `,
        `
          INSERT INTO users (id, name, age) VALUES
            (1, 'Alice', 30),
            (2, 'Bob', 25),
            (3, 'Charlie', 35)
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/users?order=age.desc');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(3);
      expect(data[0].name).toBe('Charlie'); // age 35
      expect(data[1].name).toBe('Alice'); // age 30
      expect(data[2].name).toBe('Bob'); // age 25

      adapter.close();
    });

    test('GET /users?limit=2&offset=1 - pagination', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          )
        `,
        `
          INSERT INTO users (id, name) VALUES
            (1, 'Alice'),
            (2, 'Bob'),
            (3, 'Charlie'),
            (4, 'Diana')
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/users?limit=2&offset=1');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data[0].name).toBe('Bob');
      expect(data[1].name).toBe('Charlie');

      adapter.close();
    });
  });

  describe('Complex queries', () => {
    test('GET /users with multiple filters and ordering', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            age INTEGER,
            active INTEGER DEFAULT 1
          )
        `,
        `
          INSERT INTO users (id, name, email, age, active) VALUES
            (1, 'Alice', 'alice@example.com', 30, 1),
            (2, 'Bob', 'bob@example.com', 25, 1),
            (3, 'Charlie', 'charlie@example.com', 35, 0),
            (4, 'Diana', 'diana@example.com', 28, 1)
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/users?active=eq.1&age=gte.25&order=age.desc&select=id,name,age');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(3);
      expect(data[0].name).toBe('Alice'); // age 30, active
      expect(data[1].name).toBe('Diana'); // age 28, active
      expect(data[2].name).toBe('Bob'); // age 25, active

      adapter.close();
    });

    test('GET /products with LIKE filter', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE products (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            category TEXT
          )
        `,
        `
          INSERT INTO products (id, name, category) VALUES
            (1, 'Smart Phone', 'electronics'),
            (2, 'Smart Watch', 'electronics'),
            (3, 'Regular Phone', 'electronics'),
            (4, 'Smart TV', 'electronics')
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/products?name=like.*Smart*');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(3);
      expect(data.every((p: any) => p.name.includes('Smart'))).toBe(true);

      adapter.close();
    });
  });

  describe('Error cases', () => {
    test('GET /nonexistent - table not found', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          )
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/nonexistent');

      expect(res.status).toBe(404);

      const error = await res.json();
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('code');
      expect(error.code).toBe('TABLE_NOT_FOUND');

      adapter.close();
    });

    test('GET /users with invalid query syntax', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          )
        `
      );

      const app = createServer({ db: adapter });
      // Invalid operator
      const res = await app.request('/users?age=invalid_op.30');

      expect(res.status).toBe(400);

      const error = await res.json();
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('code');

      adapter.close();
    });
  });

  describe('Health check', () => {
    test('GET /health - returns ok', async () => {
      const adapter = createTestDb('CREATE TABLE dummy (id INTEGER)');

      const app = createServer({ db: adapter });
      const res = await app.request('/health');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toEqual({ status: 'ok' });

      adapter.close();
    });
  });
});
