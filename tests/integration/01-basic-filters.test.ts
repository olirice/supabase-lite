/**
 * Integration Tests - Basic Filters with SQLite Execution
 *
 * Tests the complete pipeline:
 * 1. Parse query string → AST
 * 2. Compile AST → SQL
 * 3. Execute SQL → SQLite
 * 4. Verify results
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { QueryParser } from '../../src/parser/index.js';
import { SQLCompiler } from '../../src/compiler/index.js';
import { createTestDatabase, type TestDatabase } from '../fixtures/test-db.js';

describe('Integration - Basic Filters', () => {
  let testDb: TestDatabase;
  let parser: QueryParser;
  let compiler: SQLCompiler;

  beforeEach(() => {
    testDb = createTestDatabase();
    parser = new QueryParser();
    compiler = new SQLCompiler();
  });

  afterEach(() => {
    testDb.close();
  });

  describe('Equality operators', () => {
    test('eq - filters by exact match', () => {
      const ast = parser.parse('http://localhost/users?name=eq.John Smith');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        name: 'John Smith',
        email: 'john@example.com',
      });
    });

    test('eq - filters by integer', () => {
      const ast = parser.parse('http://localhost/users?id=eq.2');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 2,
        name: 'Jane Doe',
      });
    });

    test('neq - excludes exact match', () => {
      const ast = parser.parse('http://localhost/users?name=neq.John Smith');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((row: any) => row.name !== 'John Smith')).toBe(true);
    });
  });

  describe('Comparison operators', () => {
    test('gt - greater than', () => {
      const ast = parser.parse('http://localhost/users?age=gt.30');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(2); // Bob (35) and Charlie (42)
      expect(result.every((row: any) => row.age > 30)).toBe(true);
    });

    test('gte - greater than or equal', () => {
      const ast = parser.parse('http://localhost/users?age=gte.30');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(3); // John (30), Bob (35), Charlie (42)
      expect(result.every((row: any) => row.age >= 30)).toBe(true);
    });

    test('lt - less than', () => {
      const ast = parser.parse('http://localhost/users?age=lt.30');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(2); // Jane (25), Alice (28)
      expect(result.every((row: any) => row.age < 30)).toBe(true);
    });

    test('lte - less than or equal', () => {
      const ast = parser.parse('http://localhost/users?age=lte.30');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(3); // Jane (25), Alice (28), John (30)
      expect(result.every((row: any) => row.age <= 30)).toBe(true);
    });
  });

  describe('Pattern matching', () => {
    test('like - pattern match with wildcards', () => {
      const ast = parser.parse('http://localhost/users?name=like.*Smith*');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'John Smith' });
    });

    test('like - prefix match', () => {
      const ast = parser.parse('http://localhost/users?name=like.John*');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'John Smith' });
    });

    test('ilike - case-insensitive pattern match', () => {
      const ast = parser.parse('http://localhost/users?name=ilike.*SMITH*');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'John Smith' });
    });

    test('ilike - case-insensitive email domain', () => {
      const ast = parser.parse('http://localhost/users?email=ilike.*@GMAIL.COM');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ email: 'alice@gmail.com' });
    });
  });

  describe('IS operator', () => {
    test('is.null - finds NULL values', () => {
      const ast = parser.parse('http://localhost/users?deleted_at=is.null');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(4); // All except Charlie who has deleted_at
      expect(result.every((row: any) => row.deleted_at === null)).toBe(true);
    });

    test('is.not_null - finds NOT NULL values', () => {
      const ast = parser.parse('http://localhost/users?deleted_at=is.not_null');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'Charlie Wilson' });
    });

    test('is.true - finds boolean true (SQLite integer 1)', () => {
      const ast = parser.parse('http://localhost/users?active=is.true');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(4); // All except Alice
      expect(result.every((row: any) => row.active === 1)).toBe(true);
    });

    test('is.false - finds boolean false (SQLite integer 0)', () => {
      const ast = parser.parse('http://localhost/users?active=is.false');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'Alice Brown' });
    });

    test('is.false - unverified users', () => {
      const ast = parser.parse('http://localhost/users?verified=is.false');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'Bob Johnson' });
    });
  });

  describe('IN operator', () => {
    test('in - multiple integer values', () => {
      const ast = parser.parse('http://localhost/users?id=in.(1,2,3)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(3);
      const ids = result.map((row: any) => row.id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
      expect(ids).toContain(3);
    });

    test('in - multiple string values', () => {
      const ast = parser.parse('http://localhost/posts?status=in.(published,draft)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(4);
      expect(result.every((row: any) =>
        ['published', 'draft'].includes(row.status)
      )).toBe(true);
    });
  });

  describe('Negation', () => {
    test('not.eq - negated equality', () => {
      const ast = parser.parse('http://localhost/posts?status=not.eq.published');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(2); // draft and archived
      expect(result.every((row: any) => row.status !== 'published')).toBe(true);
    });

    test('not.in - negated IN', () => {
      const ast = parser.parse('http://localhost/users?id=not.in.(1,2)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(3);
      expect(result.every((row: any) => ![1, 2].includes(row.id))).toBe(true);
    });

    test('not.like - negated pattern', () => {
      const ast = parser.parse('http://localhost/users?name=not.like.*Smith*');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((row: any) => !row.name.includes('Smith'))).toBe(true);
    });
  });

  describe('SELECT clause', () => {
    test('select specific columns', () => {
      const ast = parser.parse('http://localhost/users?select=id,name');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(5);
      // Check first row has only id and name
      const firstRow = result[0] as Record<string, unknown>;
      expect(Object.keys(firstRow)).toEqual(['id', 'name']);
    });

    test('select with alias', () => {
      const ast = parser.parse('http://localhost/users?select=id,user_name:name');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(5);
      const firstRow = result[0] as Record<string, unknown>;
      expect(firstRow).toHaveProperty('id');
      expect(firstRow).toHaveProperty('user_name');
      expect(firstRow).not.toHaveProperty('name');
    });
  });

  describe('ORDER BY clause', () => {
    test('order by ASC', () => {
      const ast = parser.parse('http://localhost/users?select=id,age&order=age.asc');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      const ages = result.map((row: any) => row.age);
      expect(ages).toEqual([25, 28, 30, 35, 42]);
    });

    test('order by DESC', () => {
      const ast = parser.parse('http://localhost/users?select=id,age&order=age.desc');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      const ages = result.map((row: any) => row.age);
      expect(ages).toEqual([42, 35, 30, 28, 25]);
    });

    test('order by multiple columns', () => {
      const ast = parser.parse('http://localhost/posts?select=id,status&order=status.asc,id.desc');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Should be ordered by status first, then id descending within each status
      expect(result).toHaveLength(5);
      const statuses = result.map((row: any) => row.status);
      // archived < draft < published alphabetically
      expect(statuses[0]).toBe('archived');
      expect(statuses[1]).toBe('draft');
    });
  });

  describe('LIMIT and OFFSET', () => {
    test('limit only', () => {
      const ast = parser.parse('http://localhost/users?limit=2');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(2);
    });

    test('offset only', () => {
      const ast = parser.parse('http://localhost/users?offset=3');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(2); // 5 total - 3 offset = 2
    });

    test('limit and offset', () => {
      const ast = parser.parse('http://localhost/users?limit=2&offset=1');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(2);
      // Should skip first user and return next 2
      const ids = result.map((row: any) => row.id);
      expect(ids).toEqual([2, 3]);
    });
  });
});
