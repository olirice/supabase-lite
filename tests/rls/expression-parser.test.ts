/**
 * RLS Expression Parser Tests
 *
 * Tests for SQL expression parser used in RLS policy USING clauses.
 * Covers tokenization, operator parsing, value parsing, and logical combinations.
 */

import { describe, test, expect } from 'vitest';
import { parseSQLExpression } from '../../src/rls/expression-parser.js';
import type { FilterNode, LogicalNode } from '../../src/parser/types.js';

describe('RLS Expression Parser', () => {
  describe('Simple comparisons', () => {
    test('parses equality with number', () => {
      const result = parseSQLExpression('published = 1') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('published');
      expect(result.operator).toBe('eq');
      expect(result.value).toBe(1);
    });

    test('parses equality with string (single quotes)', () => {
      const result = parseSQLExpression("status = 'active'") as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('status');
      expect(result.operator).toBe('eq');
      expect(result.value).toBe('active');
    });

    test('parses equality with string (double quotes)', () => {
      const result = parseSQLExpression('status = "active"') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('status');
      expect(result.operator).toBe('eq');
      expect(result.value).toBe('active');
    });

    test('parses equality with boolean true', () => {
      const result = parseSQLExpression('public = true') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('public');
      expect(result.value).toBe(true);
    });

    test('parses equality with boolean TRUE (uppercase)', () => {
      const result = parseSQLExpression('public = TRUE') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.value).toBe(true);
    });

    test('parses equality with boolean false', () => {
      const result = parseSQLExpression('deleted = false') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('deleted');
      expect(result.value).toBe(false);
    });

    test('parses equality with boolean FALSE (uppercase)', () => {
      const result = parseSQLExpression('deleted = FALSE') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.value).toBe(false);
    });

    test('parses equality with NULL', () => {
      const result = parseSQLExpression('deleted_at = NULL') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('deleted_at');
      expect(result.value).toBeNull();
    });

    test('parses equality with null (lowercase)', () => {
      const result = parseSQLExpression('deleted_at = null') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.value).toBeNull();
    });
  });

  describe('Comparison operators', () => {
    test('parses != (not equal)', () => {
      const result = parseSQLExpression('status != draft') as FilterNode;

      expect(result.operator).toBe('neq');
    });

    test('parses <> (not equal)', () => {
      const result = parseSQLExpression('status <> draft') as FilterNode;

      expect(result.operator).toBe('neq');
    });

    test('parses > (greater than)', () => {
      const result = parseSQLExpression('age > 18') as FilterNode;

      expect(result.operator).toBe('gt');
      expect(result.value).toBe(18);
    });

    test('parses >= (greater than or equal)', () => {
      const result = parseSQLExpression('age >= 21') as FilterNode;

      expect(result.operator).toBe('gte');
      expect(result.value).toBe(21);
    });

    test('parses < (less than)', () => {
      const result = parseSQLExpression('count < 100') as FilterNode;

      expect(result.operator).toBe('lt');
      expect(result.value).toBe(100);
    });

    test('parses <= (less than or equal)', () => {
      const result = parseSQLExpression('count <= 50') as FilterNode;

      expect(result.operator).toBe('lte');
      expect(result.value).toBe(50);
    });

    test('parses LIKE operator', () => {
      const result = parseSQLExpression("name LIKE 'John%'") as FilterNode;

      expect(result.operator).toBe('like');
      expect(result.value).toBe('John%');
    });

    test('parses ILIKE operator (case-insensitive)', () => {
      const result = parseSQLExpression("email ILIKE '%@example.com'") as FilterNode;

      expect(result.operator).toBe('ilike');
      expect(result.value).toBe('%@example.com');
    });

    test('parses IN operator', () => {
      const result = parseSQLExpression("status IN 'active'") as FilterNode;

      expect(result.operator).toBe('in');
    });
  });

  describe('IS NULL / IS NOT NULL', () => {
    test('parses IS NULL', () => {
      const result = parseSQLExpression('deleted_at IS NULL') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('deleted_at');
      expect(result.operator).toBe('is');
      expect(result.value).toBeNull();
      expect(result.negated).toBeUndefined();
    });

    test('parses IS null (lowercase)', () => {
      const result = parseSQLExpression('deleted_at IS null') as FilterNode;

      expect(result.operator).toBe('is');
      expect(result.value).toBeNull();
    });

    test('parses IS NOT NULL', () => {
      const result = parseSQLExpression('email IS NOT NULL') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('email');
      expect(result.operator).toBe('is');
      expect(result.value).toBeNull();
      expect(result.negated).toBe(true);
    });

    test('parses IS NOT null (lowercase)', () => {
      const result = parseSQLExpression('email IS NOT null') as FilterNode;

      expect(result.operator).toBe('is');
      expect(result.value).toBeNull();
      expect(result.negated).toBe(true);
    });
  });

  describe('Logical operators', () => {
    test('parses OR expression', () => {
      const result = parseSQLExpression('published = 1 OR featured = 1') as LogicalNode;

      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(2);
      expect((result.conditions[0] as FilterNode).column).toBe('published');
      expect((result.conditions[1] as FilterNode).column).toBe('featured');
    });

    test('parses OR expression (lowercase)', () => {
      const result = parseSQLExpression('published = 1 or featured = 1') as LogicalNode;

      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(2);
    });

    test('parses AND expression', () => {
      const result = parseSQLExpression('published = 1 AND deleted = 0') as LogicalNode;

      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(2);
      expect((result.conditions[0] as FilterNode).column).toBe('published');
      expect((result.conditions[1] as FilterNode).column).toBe('deleted');
    });

    test('parses AND expression (lowercase)', () => {
      const result = parseSQLExpression('published = 1 and deleted = 0') as LogicalNode;

      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(2);
    });

    test('parses multiple OR conditions', () => {
      const result = parseSQLExpression('a = 1 OR b = 2 OR c = 3') as LogicalNode;

      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(3);
    });

    test('parses multiple AND conditions', () => {
      const result = parseSQLExpression('a = 1 AND b = 2 AND c = 3') as LogicalNode;

      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(3);
    });

    test('AND has higher precedence than OR', () => {
      const result = parseSQLExpression('a = 1 OR b = 2 AND c = 3') as LogicalNode;

      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(2);

      // Second condition should be an AND node
      const andNode = result.conditions[1] as LogicalNode;
      expect(andNode.type).toBe('and');
      expect(andNode.conditions).toHaveLength(2);
    });
  });

  describe('Parenthesized expressions', () => {
    test('parses simple parenthesized expression', () => {
      const result = parseSQLExpression('(published = 1)') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('published');
    });

    test('parses parentheses to override precedence', () => {
      const result = parseSQLExpression('(a = 1 OR b = 2) AND c = 3') as LogicalNode;

      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(2);

      // First condition should be an OR node
      const orNode = result.conditions[0] as LogicalNode;
      expect(orNode.type).toBe('or');
      expect(orNode.conditions).toHaveLength(2);
    });

    test('parses nested parentheses', () => {
      const result = parseSQLExpression('((a = 1))') as FilterNode;

      expect(result.type).toBe('filter');
      expect(result.column).toBe('a');
    });

    test('parses complex nested expression', () => {
      const result = parseSQLExpression('(a = 1 AND b = 2) OR (c = 3 AND d = 4)') as LogicalNode;

      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(2);

      const leftAnd = result.conditions[0] as LogicalNode;
      const rightAnd = result.conditions[1] as LogicalNode;

      expect(leftAnd.type).toBe('and');
      expect(rightAnd.type).toBe('and');
    });
  });

  describe('Value parsing edge cases', () => {
    test('parses negative number', () => {
      const result = parseSQLExpression('count = -5') as FilterNode;

      expect(result.value).toBe(-5);
    });

    test('parses decimal number', () => {
      const result = parseSQLExpression('price = 19.99') as FilterNode;

      expect(result.value).toBe(19.99);
    });

    test('parses zero', () => {
      const result = parseSQLExpression('count = 0') as FilterNode;

      expect(result.value).toBe(0);
    });

    test('parses string with spaces', () => {
      const result = parseSQLExpression("name = 'John Doe'") as FilterNode;

      expect(result.value).toBe('John Doe');
    });

    test('parses empty string', () => {
      const result = parseSQLExpression("name = ''") as FilterNode;

      expect(result.value).toBe('');
    });

    test('parses unquoted string (fallback)', () => {
      const result = parseSQLExpression('status = active') as FilterNode;

      expect(result.value).toBe('active');
    });
  });

  describe('Column name handling', () => {
    test('parses quoted column name (double quotes)', () => {
      const result = parseSQLExpression('"user_id" = 123') as FilterNode;

      expect(result.column).toBe('user_id');
      expect(result.value).toBe(123);
    });

    test('parses unquoted column name', () => {
      const result = parseSQLExpression('user_id = 123') as FilterNode;

      expect(result.column).toBe('user_id');
    });

    test('parses column name with special characters (quoted)', () => {
      const result = parseSQLExpression('"User ID" = 123') as FilterNode;

      expect(result.column).toBe('User ID');
    });
  });

  describe('Whitespace handling', () => {
    test('handles extra spaces', () => {
      const result = parseSQLExpression('  published   =   1  ') as FilterNode;

      expect(result.column).toBe('published');
      expect(result.value).toBe(1);
    });

    test('handles tabs', () => {
      const result = parseSQLExpression('published\t=\t1') as FilterNode;

      expect(result.column).toBe('published');
      expect(result.value).toBe(1);
    });

    test('handles newlines', () => {
      const result = parseSQLExpression('published\n=\n1') as FilterNode;

      expect(result.column).toBe('published');
      expect(result.value).toBe(1);
    });

    test('handles mixed whitespace', () => {
      const result = parseSQLExpression('  published \t= \n 1  ') as FilterNode;

      expect(result.column).toBe('published');
      expect(result.value).toBe(1);
    });
  });

  describe('Real-world RLS patterns', () => {
    test('parses user ownership check', () => {
      const result = parseSQLExpression("user_id = 'abc123'") as FilterNode;

      expect(result.column).toBe('user_id');
      expect(result.operator).toBe('eq');
      expect(result.value).toBe('abc123');
    });

    test('parses published content check', () => {
      const result = parseSQLExpression('published = true AND deleted = false') as LogicalNode;

      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(2);
    });

    test('parses role-based access', () => {
      const result = parseSQLExpression("role = 'admin' OR role = 'moderator'") as LogicalNode;

      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(2);
    });

    test('parses visibility check with ownership fallback', () => {
      const result = parseSQLExpression("public = true OR owner_id = 'user123'") as LogicalNode;

      expect(result.type).toBe('or');
      const cond1 = result.conditions[0] as FilterNode;
      const cond2 = result.conditions[1] as FilterNode;

      expect(cond1.column).toBe('public');
      expect(cond1.value).toBe(true);
      expect(cond2.column).toBe('owner_id');
      expect(cond2.value).toBe('user123');
    });

    test('parses complex policy with multiple conditions', () => {
      const result = parseSQLExpression(
        "(status = 'published' OR status = 'draft') AND deleted_at IS NULL"
      ) as LogicalNode;

      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(2);

      const orNode = result.conditions[0] as LogicalNode;
      const isNullNode = result.conditions[1] as FilterNode;

      expect(orNode.type).toBe('or');
      expect(isNullNode.operator).toBe('is');
      expect(isNullNode.value).toBeNull();
    });
  });

  describe('Error handling', () => {
    test('throws on missing column name', () => {
      expect(() => {
        parseSQLExpression('= 1');
      }).toThrow(/Expected/); // Can be column or value depending on tokenization
    });

    test('throws on missing operator', () => {
      expect(() => {
        parseSQLExpression('published');
      }).toThrow(/Expected/); // Can be operator or value
    });

    test('throws on missing value', () => {
      expect(() => {
        parseSQLExpression('published =');
      }).toThrow(/Expected value/);
    });
  });

  describe('Unknown operators (fallback to eq)', () => {
    test('treats unknown operator as eq', () => {
      const result = parseSQLExpression('col ~ value') as FilterNode;

      expect(result.operator).toBe('eq');
    });
  });
});
