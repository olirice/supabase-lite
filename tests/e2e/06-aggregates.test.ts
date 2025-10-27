/**
 * E2E Tests - Aggregates
 *
 * Tests aggregate functions (count, sum, avg, min, max) following PostgREST exact syntax.
 * Each test creates its own isolated database.
 *
 * PostgREST Aggregate Syntax:
 * - column.sum() - Sum values
 * - column.avg() - Average values
 * - column.min() - Minimum value
 * - column.max() - Maximum value
 * - column.count() - Count non-null values
 * - count() - Count rows
 * - Automatic GROUP BY when mixing aggregates with regular columns
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

describe('E2E - Aggregates', () => {
  describe('count()', () => {
    test('GET /orders?select=count() - count all rows', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL, status TEXT)`,
        `
          INSERT INTO orders (id, amount, status) VALUES
            (1, 100.50, 'completed'),
            (2, 200.00, 'pending'),
            (3, 150.75, 'completed'),
            (4, 300.00, 'completed')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=count()');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ count: 4 }]);

      adapter.close();
    });

    test('GET /orders?select=status.count() - count non-null values', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT)`,
        `
          INSERT INTO orders (id, status) VALUES
            (1, 'completed'),
            (2, NULL),
            (3, 'pending'),
            (4, NULL)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=status.count()');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ count: 2 }]); // Only non-null

      adapter.close();
    });

    test('GET /orders?select=count() with filter - count matching rows', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT)`,
        `
          INSERT INTO orders (id, status) VALUES
            (1, 'completed'),
            (2, 'pending'),
            (3, 'completed'),
            (4, 'cancelled')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=count()&status=eq.completed');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ count: 2 }]);

      adapter.close();
    });
  });

  describe('sum()', () => {
    test('GET /orders?select=amount.sum() - sum column values', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL)`,
        `
          INSERT INTO orders (id, amount) VALUES
            (1, 100.50),
            (2, 200.00),
            (3, 150.75)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=amount.sum()');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ sum: 451.25 }]);

      adapter.close();
    });

    test('GET /orders?select=amount.sum() with filter', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL, status TEXT)`,
        `
          INSERT INTO orders (id, amount, status) VALUES
            (1, 100.00, 'completed'),
            (2, 200.00, 'pending'),
            (3, 300.00, 'completed')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=amount.sum()&status=eq.completed');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ sum: 400.00 }]);

      adapter.close();
    });
  });

  describe('avg()', () => {
    test('GET /orders?select=amount.avg() - average column values', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL)`,
        `
          INSERT INTO orders (id, amount) VALUES
            (1, 100.00),
            (2, 200.00),
            (3, 300.00)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=amount.avg()');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ avg: 200.00 }]);

      adapter.close();
    });
  });

  describe('min() and max()', () => {
    test('GET /orders?select=amount.min(),amount.max() - multiple aggregates', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL)`,
        `
          INSERT INTO orders (id, amount) VALUES
            (1, 100.00),
            (2, 500.00),
            (3, 250.00)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=amount.min(),amount.max()');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ min: 100.00, max: 500.00 }]);

      adapter.close();
    });
  });

  describe('GROUP BY (automatic)', () => {
    test('GET /orders?select=status,amount.sum() - group by non-aggregate column', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, amount REAL)`,
        `
          INSERT INTO orders (id, status, amount) VALUES
            (1, 'completed', 100.00),
            (2, 'completed', 200.00),
            (3, 'pending', 150.00),
            (4, 'pending', 250.00),
            (5, 'cancelled', 50.00)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=status,amount.sum()');

      expect(res.status).toBe(200);
      const data = await res.json();

      // Should group by status
      expect(data).toHaveLength(3);
      expect(data).toEqual(
        expect.arrayContaining([
          { status: 'completed', sum: 300.00 },
          { status: 'pending', sum: 400.00 },
          { status: 'cancelled', sum: 50.00 },
        ])
      );

      adapter.close();
    });

    test('GET /orders?select=status,count(),amount.sum() - multiple aggregates with grouping', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT, amount REAL)`,
        `
          INSERT INTO orders (id, status, amount) VALUES
            (1, 'completed', 100.00),
            (2, 'completed', 200.00),
            (3, 'pending', 150.00)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=status,count(),amount.sum()');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toEqual(
        expect.arrayContaining([
          { status: 'completed', count: 2, sum: 300.00 },
          { status: 'pending', count: 1, sum: 150.00 },
        ])
      );

      adapter.close();
    });

    test('GET /orders?select=user_id,status,count() - group by multiple columns', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT)`,
        `
          INSERT INTO orders (id, user_id, status) VALUES
            (1, 1, 'completed'),
            (2, 1, 'completed'),
            (3, 1, 'pending'),
            (4, 2, 'completed'),
            (5, 2, 'pending')
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=user_id,status,count()');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toHaveLength(4);
      expect(data).toEqual(
        expect.arrayContaining([
          { user_id: 1, status: 'completed', count: 2 },
          { user_id: 1, status: 'pending', count: 1 },
          { user_id: 2, status: 'completed', count: 1 },
          { user_id: 2, status: 'pending', count: 1 },
        ])
      );

      adapter.close();
    });
  });

  describe('Aliases', () => {
    test('GET /orders?select=total:amount.sum() - aliased aggregate', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL)`,
        `
          INSERT INTO orders (id, amount) VALUES
            (1, 100.00),
            (2, 200.00)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=total:amount.sum()');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ total: 300.00 }]);

      adapter.close();
    });

    test('GET /orders?select=total:amount.sum(),average:amount.avg() - multiple aliased aggregates', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL)`,
        `
          INSERT INTO orders (id, amount) VALUES
            (1, 100.00),
            (2, 200.00),
            (3, 300.00)
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=total:amount.sum(),average:amount.avg()');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ total: 600.00, average: 200.00 }]);

      adapter.close();
    });
  });

  describe('Edge cases', () => {
    test('GET /orders?select=amount.sum() - empty result set', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY, amount REAL)`,
        ``
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=amount.sum()');

      expect(res.status).toBe(200);
      const data = await res.json();
      // SQL SUM returns NULL for empty set
      expect(data).toEqual([{ sum: null }]);

      adapter.close();
    });

    test('GET /orders?select=count() - empty result set', async () => {
      const adapter = createTestDb(
        `CREATE TABLE orders (id INTEGER PRIMARY KEY)`,
        ``
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/orders?select=count()');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([{ count: 0 }]);

      adapter.close();
    });
  });
});
