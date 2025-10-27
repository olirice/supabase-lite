/**
 * Integration Tests - Logical Operators and Pattern Quantifiers
 *
 * Tests complex queries with AND/OR logic and pattern matching quantifiers
 * against real SQLite database.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { QueryParser } from '../../src/parser/index.js';
import { SQLCompiler } from '../../src/compiler/index.js';
import { createTestDatabase, type TestDatabase } from '../fixtures/test-db.js';

describe('Integration - Logical Operators and Patterns', () => {
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

  describe('Logical Operators - Implicit AND', () => {
    test('multiple filters combined with AND', () => {
      const ast = parser.parse('http://localhost/users?age=gte.30&active=is.true');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // John (30, active), Bob (35, active), Charlie (42, active but deleted)
      expect(result).toHaveLength(3);
      expect(result.every((row: any) => row.age >= 30 && row.active === 1)).toBe(true);
    });

    test('three filters with AND', () => {
      const ast = parser.parse('http://localhost/users?age=gte.25&age=lte.35&verified=is.true');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Jane (25, verified), Alice (28, verified), John (30, verified)
      // Bob (35) is not verified
      expect(result).toHaveLength(3);
      expect(result.every((row: any) =>
        row.age >= 25 && row.age <= 35 && row.verified === 1
      )).toBe(true);
    });
  });

  describe('Logical Operators - OR groups', () => {
    test('simple OR with two conditions', () => {
      const ast = parser.parse('http://localhost/users?or=(age.lt.26,age.gt.40)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(2); // Jane (25) and Charlie (42)
      expect(result.every((row: any) => row.age < 26 || row.age > 40)).toBe(true);
    });

    test('OR with three conditions', () => {
      const ast = parser.parse('http://localhost/posts?or=(status.eq.draft,status.eq.archived,id.eq.1)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(3); // draft (id=3), archived (id=5), and id=1
      const statuses = result.map((row: any) => row.status);
      expect(statuses).toContain('draft');
      expect(statuses).toContain('archived');
      expect(statuses).toContain('published'); // id=1 is published
    });

    test('OR combined with AND', () => {
      const ast = parser.parse('http://localhost/users?age=gte.25&or=(name.like.*Smith*,email.like.*@gmail.com)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // age >= 25 AND (name like Smith OR email like gmail)
      // John Smith (30) matches
      // Alice (28, @gmail.com) matches
      expect(result).toHaveLength(2);
    });
  });

  describe('Logical Operators - AND groups', () => {
    test('explicit AND group', () => {
      const ast = parser.parse('http://localhost/users?and=(age.gte.25,age.lte.35)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(4); // Jane (25), Alice (28), John (30), Bob (35)
      expect(result.every((row: any) => row.age >= 25 && row.age <= 35)).toBe(true);
    });

    test('AND combined with OR', () => {
      const ast = parser.parse('http://localhost/users?and=(age.gte.18,verified.is.true)&or=(name.like.*John*,name.like.*Jane*)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // (age >= 18 AND verified) AND (name like John OR name like Jane)
      // John Smith matches (30, verified)
      // Jane Doe matches (25, verified)
      expect(result).toHaveLength(2);
    });
  });

  describe('Nested Logical Groups', () => {
    test('OR with nested AND', () => {
      const ast = parser.parse('http://localhost/users?or=(id.eq.1,and(age.gte.25,age.lte.30))');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // id=1 OR (age between 25 and 30)
      // John (1, 30), Jane (2, 25), Alice (4, 28)
      expect(result).toHaveLength(3);
      const ids = result.map((row: any) => row.id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
      expect(ids).toContain(4);
    });

    test('AND with nested OR', () => {
      const ast = parser.parse('http://localhost/users?and=(age.gte.25,or(name.like.*John*,name.like.*Jane*))');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // age >= 25 AND (name like John OR name like Jane)
      // John Smith (30), Jane Doe (25), Bob Johnson (35)
      expect(result).toHaveLength(3);
    });

    test('complex three-level nesting', () => {
      const ast = parser.parse(
        'http://localhost/users?and=(age.gte.18,or(name.like.*Smith*,and(verified.is.true,age.lt.30)))'
      );
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // age >= 18 AND (name like Smith OR (verified AND age < 30))
      // John Smith (30) - matches name like Smith
      // Jane Doe (25, verified) - matches verified AND age < 30
      // Alice Brown (28, verified) - matches verified AND age < 30
      expect(result).toHaveLength(3);
    });
  });

  describe('Pattern Quantifiers - like(all)', () => {
    test('like(all) with two patterns', () => {
      const ast = parser.parse('http://localhost/users?name=like(all).{*o*,*n*}');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Names containing both 'o' and 'n':
      // John Smith, Jane Doe (has 'o' and 'e' but Doe has 'o'),
      // Bob Johnson, Alice Brown, Charlie Wilson
      expect(result).toHaveLength(5);
      expect(result.every((row: any) => {
        const lower = row.name.toLowerCase();
        return lower.includes('o') && lower.includes('n');
      })).toBe(true);
    });

    test('like(all) with three patterns - product descriptions', () => {
      const ast = parser.parse('http://localhost/products?description=like(all).{*a*,*e*,*i*}');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Descriptions containing 'a', 'e', and 'i':
      // "An amazing gadget"
      // "A mysterious thingamajig"
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((row: any) => {
        const desc = row.description.toLowerCase();
        return desc.includes('a') && desc.includes('e') && desc.includes('i');
      })).toBe(true);
    });

    test('like(all) with single pattern degrades to simple like', () => {
      const ast = parser.parse('http://localhost/users?name=like(all).{*Smith*}');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'John Smith' });
    });
  });

  describe('Pattern Quantifiers - like(any)', () => {
    test('like(any) with email domains', () => {
      const ast = parser.parse('http://localhost/users?email=like(any).{*@gmail.com,*@yahoo.com}');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Alice (@gmail.com) and Charlie (@yahoo.com)
      expect(result).toHaveLength(2);
      expect(result.every((row: any) =>
        row.email.endsWith('@gmail.com') || row.email.endsWith('@yahoo.com')
      )).toBe(true);
    });

    test('like(any) with product categories', () => {
      const ast = parser.parse('http://localhost/products?category=like(any).{tools,electronics}');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Widget, Gadget, Doohickey, Gizmo
      expect(result).toHaveLength(4);
      expect(result.every((row: any) =>
        ['tools', 'electronics'].includes(row.category)
      )).toBe(true);
    });
  });

  describe('Pattern Quantifiers - ilike (case-insensitive)', () => {
    test('ilike(all) with mixed case patterns', () => {
      const ast = parser.parse('http://localhost/users?name=ilike(all).{*JOHN*,*SMITH*}');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'John Smith' });
    });

    test('ilike(any) with email domains - mixed case', () => {
      const ast = parser.parse('http://localhost/users?email=ilike(any).{*@GMAIL.COM,*@YAHOO.COM}');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(2);
      const emails = result.map((row: any) => row.email);
      expect(emails).toContain('alice@gmail.com');
      expect(emails).toContain('charlie@yahoo.com');
    });
  });

  describe('Pattern Quantifiers with Negation', () => {
    test('not.like(any) - excludes multiple patterns', () => {
      const ast = parser.parse('http://localhost/users?name=not.like(any).{*Smith*,*Doe*}');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Should exclude anyone matching Smith OR Doe
      // NOT (name LIKE Smith OR name LIKE Doe)
      // This is NOT (Smith) AND NOT (Doe)
      // All users have names, should return all that don't match either
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((row: any) =>
        !row.name.includes('Smith') && !row.name.includes('Doe')
      )).toBe(true);
    });

    test('not.like(all) - negates AND condition', () => {
      const ast = parser.parse('http://localhost/users?name=not.like(all).{*a*,*e*}');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Should exclude names containing both 'a' and 'e'
      // Jane Doe has both
      // Charlie Wilson has both
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((row: any) => {
        const name = row.name.toLowerCase();
        return !(name.includes('a') && name.includes('e'));
      })).toBe(true);
    });
  });

  describe('Complex Combined Queries', () => {
    test('OR groups with pattern quantifiers', () => {
      const ast = parser.parse(
        'http://localhost/users?or=(name.like(any).{*Smith*,*Doe*},age.gt.40)'
      );
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // John Smith, Jane Doe, Charlie Wilson (42)
      expect(result).toHaveLength(3);
    });

    test('AND with pattern quantifier and IS operator', () => {
      const ast = parser.parse(
        'http://localhost/users?name=like(all).{*o*,*n*}&verified=is.true'
      );
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Names with 'o' and 'n' AND verified
      // John Smith (verified), Jane Doe (verified),
      // Bob Johnson (not verified), Alice Brown (verified), Charlie Wilson (verified)
      // So: John, Jane, Alice, Charlie = 4
      expect(result).toHaveLength(4);
      expect(result.every((row: any) => {
        const lower = row.name.toLowerCase();
        return lower.includes('o') && lower.includes('n') && row.verified === 1;
      })).toBe(true);
    });

    test('nested groups with pattern quantifiers', () => {
      const ast = parser.parse(
        'http://localhost/users?and=(age.gte.25,or(name.like(any).{*John*,*Jane*},verified.is.false))'
      );
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // age >= 25 AND (name contains John/Jane OR not verified)
      // John Smith (30, verified, matches name)
      // Jane Doe (25, verified, matches name)
      // Bob Johnson (35, not verified)
      expect(result).toHaveLength(3);
    });
  });
});
