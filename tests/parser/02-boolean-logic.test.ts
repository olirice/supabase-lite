/**
 * Test Suite 2: Boolean Logic (AND/OR)
 * Based on PostgREST specification
 *
 * AND: Multiple parameters are AND'd together
 * OR: or=(condition1,condition2,...)
 * AND groups: and=(condition1,condition2,...)
 */

import { describe, test, expect } from 'vitest';
import { QueryParser } from '../../src/parser/index.js';

describe('PostgREST Boolean Logic - Implicit AND', () => {
  const parser = new QueryParser();

  test('combines two filters with AND', () => {
    const ast = parser.parse('http://localhost/users?age=gt.18&status=eq.active');

    expect(ast.where).toEqual({
      type: 'and',
      conditions: [
        {
          type: 'filter',
          column: 'age',
          operator: 'gt',
          value: 18,
        },
        {
          type: 'filter',
          column: 'status',
          operator: 'eq',
          value: 'active',
        },
      ],
    });
  });

  test('combines three filters with AND', () => {
    const ast = parser.parse('http://localhost/users?age=gte.21&age=lte.65&status=eq.active');

    expect(ast.where).toEqual({
      type: 'and',
      conditions: [
        {
          type: 'filter',
          column: 'age',
          operator: 'gte',
          value: 21,
        },
        {
          type: 'filter',
          column: 'age',
          operator: 'lte',
          value: 65,
        },
        {
          type: 'filter',
          column: 'status',
          operator: 'eq',
          value: 'active',
        },
      ],
    });
  });

  test('range query (between) using two filters', () => {
    const ast = parser.parse('http://localhost/products?price=gte.100&price=lte.1000');

    expect(ast.where).toEqual({
      type: 'and',
      conditions: [
        {
          type: 'filter',
          column: 'price',
          operator: 'gte',
          value: 100,
        },
        {
          type: 'filter',
          column: 'price',
          operator: 'lte',
          value: 1000,
        },
      ],
    });
  });
});

describe('PostgREST Boolean Logic - OR Groups', () => {
  const parser = new QueryParser();

  test('parses simple OR with two conditions', () => {
    const ast = parser.parse('http://localhost/users?or=(status.eq.active,status.eq.pending)');

    expect(ast.where).toEqual({
      type: 'or',
      conditions: [
        {
          type: 'filter',
          column: 'status',
          operator: 'eq',
          value: 'active',
        },
        {
          type: 'filter',
          column: 'status',
          operator: 'eq',
          value: 'pending',
        },
      ],
    });
  });

  test('parses OR with three conditions', () => {
    const ast = parser.parse('http://localhost/users?or=(id.eq.1,id.eq.2,id.eq.3)');

    expect(ast.where).toEqual({
      type: 'or',
      conditions: [
        {
          type: 'filter',
          column: 'id',
          operator: 'eq',
          value: 1,
        },
        {
          type: 'filter',
          column: 'id',
          operator: 'eq',
          value: 2,
        },
        {
          type: 'filter',
          column: 'id',
          operator: 'eq',
          value: 3,
        },
      ],
    });
  });

  test('parses OR with different columns', () => {
    const ast = parser.parse('http://localhost/users?or=(age.lt.13,age.gt.65)');

    expect(ast.where).toEqual({
      type: 'or',
      conditions: [
        {
          type: 'filter',
          column: 'age',
          operator: 'lt',
          value: 13,
        },
        {
          type: 'filter',
          column: 'age',
          operator: 'gt',
          value: 65,
        },
      ],
    });
  });

  test('parses OR with different operators', () => {
    const ast = parser.parse('http://localhost/users?or=(name.like.*smith*,email.ilike.*@gmail.com)');

    expect(ast.where).toEqual({
      type: 'or',
      conditions: [
        {
          type: 'filter',
          column: 'name',
          operator: 'like',
          value: '*smith*',
        },
        {
          type: 'filter',
          column: 'email',
          operator: 'ilike',
          value: '*@gmail.com',
        },
      ],
    });
  });
});

describe('PostgREST Boolean Logic - Mixed AND/OR', () => {
  const parser = new QueryParser();

  test('combines AND filters with OR group', () => {
    const ast = parser.parse('http://localhost/users?age=gt.18&or=(status.eq.active,status.eq.pending)');

    expect(ast.where).toEqual({
      type: 'and',
      conditions: [
        {
          type: 'filter',
          column: 'age',
          operator: 'gt',
          value: 18,
        },
        {
          type: 'or',
          conditions: [
            {
              type: 'filter',
              column: 'status',
              operator: 'eq',
              value: 'active',
            },
            {
              type: 'filter',
              column: 'status',
              operator: 'eq',
              value: 'pending',
            },
          ],
        },
      ],
    });
  });

  test('multiple AND filters with OR group', () => {
    const ast = parser.parse(
      'http://localhost/users?age=gte.18&verified=is.true&or=(status.eq.premium,status.eq.vip)'
    );

    expect(ast.where).toEqual({
      type: 'and',
      conditions: [
        {
          type: 'filter',
          column: 'age',
          operator: 'gte',
          value: 18,
        },
        {
          type: 'filter',
          column: 'verified',
          operator: 'is',
          value: true,
        },
        {
          type: 'or',
          conditions: [
            {
              type: 'filter',
              column: 'status',
              operator: 'eq',
              value: 'premium',
            },
            {
              type: 'filter',
              column: 'status',
              operator: 'eq',
              value: 'vip',
            },
          ],
        },
      ],
    });
  });
});

describe('PostgREST Boolean Logic - Explicit AND Groups', () => {
  const parser = new QueryParser();

  test('parses explicit AND group', () => {
    const ast = parser.parse('http://localhost/users?and=(age.gte.18,student.is.true)');

    expect(ast.where).toEqual({
      type: 'and',
      conditions: [
        {
          type: 'filter',
          column: 'age',
          operator: 'gte',
          value: 18,
        },
        {
          type: 'filter',
          column: 'student',
          operator: 'is',
          value: true,
        },
      ],
    });
  });

  test('combines explicit AND with other filters', () => {
    const ast = parser.parse('http://localhost/users?status=eq.active&and=(age.gte.18,verified.is.true)');

    expect(ast.where).toEqual({
      type: 'and',
      conditions: [
        {
          type: 'filter',
          column: 'status',
          operator: 'eq',
          value: 'active',
        },
        {
          type: 'and',
          conditions: [
            {
              type: 'filter',
              column: 'age',
              operator: 'gte',
              value: 18,
            },
            {
              type: 'filter',
              column: 'verified',
              operator: 'is',
              value: true,
            },
          ],
        },
      ],
    });
  });
});

describe('PostgREST Boolean Logic - Nested Groups', () => {
  const parser = new QueryParser();

  test('parses OR with nested AND', () => {
    const ast = parser.parse('http://localhost/users?or=(id.eq.1,and(age.gte.18,status.eq.active))');

    expect(ast.where).toEqual({
      type: 'or',
      conditions: [
        {
          type: 'filter',
          column: 'id',
          operator: 'eq',
          value: 1,
        },
        {
          type: 'and',
          conditions: [
            {
              type: 'filter',
              column: 'age',
              operator: 'gte',
              value: 18,
            },
            {
              type: 'filter',
              column: 'status',
              operator: 'eq',
              value: 'active',
            },
          ],
        },
      ],
    });
  });

  test('parses AND with nested OR', () => {
    const ast = parser.parse('http://localhost/users?and=(age.gte.18,or(status.eq.active,status.eq.premium))');

    expect(ast.where).toEqual({
      type: 'and',
      conditions: [
        {
          type: 'filter',
          column: 'age',
          operator: 'gte',
          value: 18,
        },
        {
          type: 'or',
          conditions: [
            {
              type: 'filter',
              column: 'status',
              operator: 'eq',
              value: 'active',
            },
            {
              type: 'filter',
              column: 'status',
              operator: 'eq',
              value: 'premium',
            },
          ],
        },
      ],
    });
  });

  test('parses complex nested logic', () => {
    const ast = parser.parse(
      'http://localhost/users?and=(age.gte.18,or(status.eq.premium,and(verified.is.true,posts.gt.10)))'
    );

    expect(ast.where).toEqual({
      type: 'and',
      conditions: [
        {
          type: 'filter',
          column: 'age',
          operator: 'gte',
          value: 18,
        },
        {
          type: 'or',
          conditions: [
            {
              type: 'filter',
              column: 'status',
              operator: 'eq',
              value: 'premium',
            },
            {
              type: 'and',
              conditions: [
                {
                  type: 'filter',
                  column: 'verified',
                  operator: 'is',
                  value: true,
                },
                {
                  type: 'filter',
                  column: 'posts',
                  operator: 'gt',
                  value: 10,
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
