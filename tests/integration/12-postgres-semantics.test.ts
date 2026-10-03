/**
 * Integration Tests - Postgres semantics for LIKE and NULL ordering
 *
 * PostgREST runs on Postgres, where:
 * - LIKE is case-sensitive (ILIKE is the case-insensitive one)
 * - ORDER BY ... ASC puts NULLs last, DESC puts NULLs first, unless
 *   nullsfirst / nullslast is given
 * SQLite's defaults differ on both, so the compiler spells them out.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { QueryParser } from '../../src/parser/index.js';
import { SQLCompiler } from '../../src/compiler/index.js';
import { SchemaIntrospector } from '../../src/schema/index.js';
import { createTestDatabase, type TestDatabase } from '../fixtures/test-db.js';

const parser = new QueryParser();
const ids = (rows: any[]) => rows.map((r) => r.id);

describe('Integration - Postgres semantics', () => {
  let db: Database.Database;
  const run = (path: string) => {
    const compiled = new SQLCompiler().compile(parser.parse(`http://localhost/${path}`));
    return db.prepare(compiled.sql).all(...compiled.params) as any[];
  };

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, score INTEGER);
      INSERT INTO people (id, name, score) VALUES
        (1, 'Alice', 10),
        (2, 'alice', NULL),
        (3, 'ALICE', 7),
        (4, 'Bob', 5),
        (5, '50% off', NULL),
        (6, 'a_b', 3),
        (7, 'axb', 8),
        (8, 'what?', 1),
        (9, '[draft] Bob', 2);
    `);
  });

  afterEach(() => db.close());

  describe('like is case-sensitive', () => {
    test('% wildcard matches only the exact case', () => {
      expect(ids(run('people?name=like.Al%25&order=id.asc'))).toEqual([1]);
    });

    test('* is accepted as an alias for %', () => {
      expect(ids(run('people?name=like.Al*&order=id.asc'))).toEqual([1]);
    });

    test('_ matches exactly one character', () => {
      expect(ids(run('people?name=like.a_b&order=id.asc'))).toEqual([6, 7]);
    });

    test('backslash escapes a wildcard', () => {
      expect(ids(run('people?name=like.a%5C_b&order=id.asc'))).toEqual([6]);
      expect(ids(run('people?name=like.50%5C%25*&order=id.asc'))).toEqual([5]);
    });

    test('GLOB metacharacters in the pattern are literal', () => {
      expect(ids(run('people?name=like.what%3F&order=id.asc'))).toEqual([8]);
      expect(ids(run('people?name=like.%5Bdraft%5D*&order=id.asc'))).toEqual([9]);
    });

    test('not.like negates the case-sensitive match', () => {
      expect(ids(run('people?name=not.like.Al*&order=id.asc'))).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    });

    test('ilike stays case-insensitive', () => {
      expect(ids(run('people?name=ilike.al*&order=id.asc'))).toEqual([1, 2, 3]);
    });
  });

  describe('NULL ordering follows Postgres defaults', () => {
    test('asc puts NULLs last', () => {
      expect(ids(run('people?select=id&order=score.asc,id.asc'))).toEqual([8, 9, 6, 4, 3, 7, 1, 2, 5]);
    });

    test('desc puts NULLs first', () => {
      expect(ids(run('people?select=id&order=score.desc,id.asc'))).toEqual([2, 5, 1, 7, 3, 4, 6, 9, 8]);
    });

    test('explicit nullsfirst / nullslast is still honored', () => {
      expect(ids(run('people?select=id&order=score.asc.nullsfirst,id.asc')).slice(0, 2)).toEqual([2, 5]);
      expect(ids(run('people?select=id&order=score.desc.nullslast,id.asc')).slice(-2)).toEqual([2, 5]);
    });
  });
});

describe('Integration - Postgres NULL ordering in embedded resources', () => {
  // Jane Doe (user 2) wrote post 3 (published_at NULL) and post 5 ('2023-12-01')
  let testDb: TestDatabase;
  const embeddedPostIds = (path: string) => {
    const compiler = new SQLCompiler(new SchemaIntrospector(testDb.db).introspect());
    const compiled = compiler.compile(parser.parse(`http://localhost/${path}`));
    const row = testDb.db.prepare(compiled.sql).get(...compiled.params) as any;
    const posts = typeof row.posts === 'string' ? JSON.parse(row.posts) : row.posts;
    return posts.map((p: any) => p.id);
  };

  beforeEach(() => {
    testDb = createTestDatabase();
  });

  afterEach(() => testDb.close());

  test('asc puts NULLs last', () => {
    expect(embeddedPostIds('users?select=id,posts(id)&id=eq.2&posts.order=published_at.asc')).toEqual([5, 3]);
  });

  test('desc puts NULLs first', () => {
    expect(embeddedPostIds('users?select=id,posts(id)&id=eq.2&posts.order=published_at.desc')).toEqual([3, 5]);
  });

  test('explicit nullsfirst / nullslast is honored', () => {
    expect(embeddedPostIds('users?select=id,posts(id)&id=eq.2&posts.order=published_at.asc.nullsfirst')).toEqual([3, 5]);
    expect(embeddedPostIds('users?select=id,posts(id)&id=eq.2&posts.order=published_at.desc.nullslast')).toEqual([5, 3]);
  });
});
