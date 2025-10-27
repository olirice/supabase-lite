/**
 * Test Suite 1: Basic Filter Operators
 * Based on PostgREST specification
 *
 * Query format: column=operator.value
 */

import { describe, test, expect } from 'vitest';
import { QueryParser } from '../../src/parser/index.js';

describe('PostgREST Basic Filters - Comparison Operators', () => {
  const parser = new QueryParser();

  describe('eq (equals)', () => {
    test('parses integer value', () => {
      const ast = parser.parse('http://localhost/users?id=eq.5');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'id',
        operator: 'eq',
        value: 5,
      });
    });

    test('parses string value', () => {
      const ast = parser.parse('http://localhost/users?name=eq.John');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'name',
        operator: 'eq',
        value: 'John',
      });
    });

    test('parses decimal value', () => {
      const ast = parser.parse('http://localhost/products?price=eq.99.99');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'price',
        operator: 'eq',
        value: 99.99,
      });
    });
  });

  describe('neq (not equals)', () => {
    test('parses neq filter', () => {
      const ast = parser.parse('http://localhost/users?status=neq.deleted');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'status',
        operator: 'neq',
        value: 'deleted',
      });
    });
  });

  describe('gt (greater than)', () => {
    test('parses gt filter', () => {
      const ast = parser.parse('http://localhost/users?age=gt.18');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'age',
        operator: 'gt',
        value: 18,
      });
    });
  });

  describe('gte (greater than or equal)', () => {
    test('parses gte filter', () => {
      const ast = parser.parse('http://localhost/users?age=gte.21');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'age',
        operator: 'gte',
        value: 21,
      });
    });
  });

  describe('lt (less than)', () => {
    test('parses lt filter', () => {
      const ast = parser.parse('http://localhost/users?age=lt.65');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'age',
        operator: 'lt',
        value: 65,
      });
    });
  });

  describe('lte (less than or equal)', () => {
    test('parses lte filter', () => {
      const ast = parser.parse('http://localhost/users?age=lte.100');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'age',
        operator: 'lte',
        value: 100,
      });
    });
  });
});

describe('PostgREST Basic Filters - Pattern Matching', () => {
  const parser = new QueryParser();

  describe('like (pattern match)', () => {
    test('parses like with wildcard pattern', () => {
      const ast = parser.parse('http://localhost/users?name=like.*smith*');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'name',
        operator: 'like',
        value: '*smith*',
      });
    });

    test('parses like with prefix pattern', () => {
      const ast = parser.parse('http://localhost/users?email=like.john*');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'email',
        operator: 'like',
        value: 'john*',
      });
    });
  });

  describe('ilike (case-insensitive pattern match)', () => {
    test('parses ilike filter', () => {
      const ast = parser.parse('http://localhost/users?email=ilike.*@gmail.com');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'email',
        operator: 'ilike',
        value: '*@gmail.com',
      });
    });
  });
});

describe('PostgREST Basic Filters - Special Operators', () => {
  const parser = new QueryParser();

  describe('is operator', () => {
    test('parses is.null', () => {
      const ast = parser.parse('http://localhost/users?deleted_at=is.null');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'deleted_at',
        operator: 'is',
        value: null,
      });
    });

    test('parses is.true', () => {
      const ast = parser.parse('http://localhost/users?active=is.true');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'active',
        operator: 'is',
        value: true,
      });
    });

    test('parses is.false', () => {
      const ast = parser.parse('http://localhost/users?verified=is.false');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'verified',
        operator: 'is',
        value: false,
      });
    });
  });

  describe('in operator', () => {
    test('parses in with integer values', () => {
      const ast = parser.parse('http://localhost/users?id=in.(1,2,3,4,5)');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'id',
        operator: 'in',
        value: [1, 2, 3, 4, 5],
      });
    });

    test('parses in with string values', () => {
      const ast = parser.parse('http://localhost/users?status=in.(active,pending,review)');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'status',
        operator: 'in',
        value: ['active', 'pending', 'review'],
      });
    });

    test('parses in with mixed values', () => {
      const ast = parser.parse('http://localhost/items?priority=in.(1,high,3,urgent)');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'priority',
        operator: 'in',
        value: [1, 'high', 3, 'urgent'],
      });
    });

    test('parses in with quoted values containing commas', () => {
      const ast = parser.parse('http://localhost/users?name=in.("Smith, John","Doe, Jane")');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'name',
        operator: 'in',
        value: ['Smith, John', 'Doe, Jane'],
      });
    });

    test('parses in with spaces (trimmed)', () => {
      const ast = parser.parse('http://localhost/users?id=in.( 1 , 2 , 3 )');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'id',
        operator: 'in',
        value: [1, 2, 3],
      });
    });
  });
});

describe('PostgREST Basic Filters - Negation', () => {
  const parser = new QueryParser();

  test('parses not.eq', () => {
    const ast = parser.parse('http://localhost/users?status=not.eq.deleted');

    expect(ast.where).toEqual({
      type: 'filter',
      column: 'status',
      operator: 'eq',
      value: 'deleted',
      negated: true,
    });
  });

  test('parses not.in', () => {
    const ast = parser.parse('http://localhost/users?status=not.in.(banned,suspended)');

    expect(ast.where).toEqual({
      type: 'filter',
      column: 'status',
      operator: 'in',
      value: ['banned', 'suspended'],
      negated: true,
    });
  });

  test('parses not.like', () => {
    const ast = parser.parse('http://localhost/users?name=not.like.*admin*');

    expect(ast.where).toEqual({
      type: 'filter',
      column: 'name',
      operator: 'like',
      value: '*admin*',
      negated: true,
    });
  });

  test('parses not.gte', () => {
    const ast = parser.parse('http://localhost/users?age=not.gte.18');

    expect(ast.where).toEqual({
      type: 'filter',
      column: 'age',
      operator: 'gte',
      value: 18,
      negated: true,
    });
  });
});
