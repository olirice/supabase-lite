/**
 * Test Suite 3: SELECT, ORDER BY, and Pagination
 * Based on PostgREST specification
 */

import { describe, test, expect } from 'vitest';
import { QueryParser } from '../../src/parser/index.js';

describe('PostgREST SELECT Clause', () => {
  const parser = new QueryParser();

  test('parses wildcard select (default)', () => {
    const ast = parser.parse('http://localhost/users?select=*');

    expect(ast.select).toEqual({
      type: 'select',
      columns: [{ type: 'wildcard' }],
    });
  });

  test('parses implicit wildcard (no select param)', () => {
    const ast = parser.parse('http://localhost/users');

    expect(ast.select).toEqual({
      type: 'select',
      columns: [{ type: 'wildcard' }],
    });
  });

  test('parses single column', () => {
    const ast = parser.parse('http://localhost/users?select=id');

    expect(ast.select).toEqual({
      type: 'select',
      columns: [{ type: 'column', name: 'id' }],
    });
  });

  test('parses multiple columns', () => {
    const ast = parser.parse('http://localhost/users?select=id,name,email');

    expect(ast.select).toEqual({
      type: 'select',
      columns: [
        { type: 'column', name: 'id' },
        { type: 'column', name: 'name' },
        { type: 'column', name: 'email' },
      ],
    });
  });

  test('parses column with alias', () => {
    const ast = parser.parse('http://localhost/users?select=userId:id,userName:name');

    expect(ast.select).toEqual({
      type: 'select',
      columns: [
        { type: 'column', name: 'id', alias: 'userId' },
        { type: 'column', name: 'name', alias: 'userName' },
      ],
    });
  });

  test('parses mixed columns and aliases', () => {
    const ast = parser.parse('http://localhost/users?select=id,full_name:name,email');

    expect(ast.select).toEqual({
      type: 'select',
      columns: [
        { type: 'column', name: 'id' },
        { type: 'column', name: 'name', alias: 'full_name' },
        { type: 'column', name: 'email' },
      ],
    });
  });
});

describe('PostgREST SELECT - Resource Embedding', () => {
  const parser = new QueryParser();

  test('parses simple embedding with wildcard', () => {
    const ast = parser.parse('http://localhost/posts?select=id,author(*)');

    expect(ast.select).toEqual({
      type: 'select',
      columns: [
        { type: 'column', name: 'id' },
        {
          type: 'embedding',
          table: 'author',
          select: {
            type: 'select',
            columns: [{ type: 'wildcard' }],
          },
        },
      ],
    });
  });

  test('parses embedding with specific columns', () => {
    const ast = parser.parse('http://localhost/posts?select=id,title,author(id,name,email)');

    expect(ast.select).toEqual({
      type: 'select',
      columns: [
        { type: 'column', name: 'id' },
        { type: 'column', name: 'title' },
        {
          type: 'embedding',
          table: 'author',
          select: {
            type: 'select',
            columns: [
              { type: 'column', name: 'id' },
              { type: 'column', name: 'name' },
              { type: 'column', name: 'email' },
            ],
          },
        },
      ],
    });
  });

  test('parses multiple embeddings', () => {
    const ast = parser.parse('http://localhost/posts?select=*,author(*),comments(*)');

    expect(ast.select.columns).toHaveLength(3);
    expect(ast.select.columns[0]).toEqual({ type: 'wildcard' });
    expect(ast.select.columns[1]).toMatchObject({
      type: 'embedding',
      table: 'author',
    });
    expect(ast.select.columns[2]).toMatchObject({
      type: 'embedding',
      table: 'comments',
    });
  });

  test('parses nested embedding', () => {
    const ast = parser.parse('http://localhost/posts?select=*,author(id,name,profile(*))');

    expect(ast.select.columns[1]).toEqual({
      type: 'embedding',
      table: 'author',
      select: {
        type: 'select',
        columns: [
          { type: 'column', name: 'id' },
          { type: 'column', name: 'name' },
          {
            type: 'embedding',
            table: 'profile',
            select: {
              type: 'select',
              columns: [{ type: 'wildcard' }],
            },
          },
        ],
      },
    });
  });

  test('parses embedding with alias', () => {
    const ast = parser.parse('http://localhost/posts?select=id,creator:author(name,email)');

    expect(ast.select.columns[1]).toEqual({
      type: 'embedding',
      table: 'author',
      alias: 'creator',
      select: {
        type: 'select',
        columns: [
          { type: 'column', name: 'name' },
          { type: 'column', name: 'email' },
        ],
      },
    });
  });
});

describe('PostgREST ORDER BY', () => {
  const parser = new QueryParser();

  test('parses ascending order (explicit)', () => {
    const ast = parser.parse('http://localhost/users?order=name.asc');

    expect(ast.order).toEqual([{ column: 'name', direction: 'asc' }]);
  });

  test('parses descending order', () => {
    const ast = parser.parse('http://localhost/users?order=created_at.desc');

    expect(ast.order).toEqual([{ column: 'created_at', direction: 'desc' }]);
  });

  test('parses multiple order columns', () => {
    const ast = parser.parse('http://localhost/users?order=age.desc,name.asc');

    expect(ast.order).toEqual([
      { column: 'age', direction: 'desc' },
      { column: 'name', direction: 'asc' },
    ]);
  });

  test('parses order with nullsfirst', () => {
    const ast = parser.parse('http://localhost/users?order=age.desc.nullsfirst');

    expect(ast.order).toEqual([
      { column: 'age', direction: 'desc', nulls: 'first' },
    ]);
  });

  test('parses order with nullslast', () => {
    const ast = parser.parse('http://localhost/users?order=age.asc.nullslast');

    expect(ast.order).toEqual([
      { column: 'age', direction: 'asc', nulls: 'last' },
    ]);
  });

  test('parses multiple columns with null handling', () => {
    const ast = parser.parse('http://localhost/users?order=age.desc.nullslast,name.asc.nullsfirst');

    expect(ast.order).toEqual([
      { column: 'age', direction: 'desc', nulls: 'last' },
      { column: 'name', direction: 'asc', nulls: 'first' },
    ]);
  });

  test('returns undefined when no order specified', () => {
    const ast = parser.parse('http://localhost/users');

    expect(ast.order).toBeUndefined();
  });
});

describe('PostgREST Pagination', () => {
  const parser = new QueryParser();

  describe('limit', () => {
    test('parses limit parameter', () => {
      const ast = parser.parse('http://localhost/users?limit=10');

      expect(ast.limit).toBe(10);
    });

    test('parses large limit', () => {
      const ast = parser.parse('http://localhost/users?limit=1000');

      expect(ast.limit).toBe(1000);
    });

    test('returns undefined when no limit', () => {
      const ast = parser.parse('http://localhost/users');

      expect(ast.limit).toBeUndefined();
    });
  });

  describe('offset', () => {
    test('parses offset parameter', () => {
      const ast = parser.parse('http://localhost/users?offset=20');

      expect(ast.offset).toBe(20);
    });

    test('parses offset 0', () => {
      const ast = parser.parse('http://localhost/users?offset=0');

      expect(ast.offset).toBe(0);
    });

    test('returns undefined when no offset', () => {
      const ast = parser.parse('http://localhost/users');

      expect(ast.offset).toBeUndefined();
    });
  });

  describe('limit and offset together', () => {
    test('parses both limit and offset', () => {
      const ast = parser.parse('http://localhost/users?limit=10&offset=20');

      expect(ast.limit).toBe(10);
      expect(ast.offset).toBe(20);
    });

    test('typical pagination pattern', () => {
      const ast = parser.parse('http://localhost/users?limit=25&offset=50');

      expect(ast.limit).toBe(25);
      expect(ast.offset).toBe(50);
    });
  });
});

describe('PostgREST Table Extraction', () => {
  const parser = new QueryParser();

  test('extracts table from simple path', () => {
    const ast = parser.parse('http://localhost/users');

    expect(ast.from).toBe('users');
  });

  test('extracts table from PostgREST-style path (/rest/v1/table)', () => {
    const ast = parser.parse('http://localhost:3000/rest/v1/users?select=*');

    expect(ast.from).toBe('users');
  });

  test('extracts table with trailing slash', () => {
    const ast = parser.parse('http://localhost/users/');

    expect(ast.from).toBe('users');
  });

  test('extracts table from path-only URL', () => {
    const ast = parser.parse('/users?select=*');

    expect(ast.from).toBe('users');
  });
});
