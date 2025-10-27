/**
 * Tests for Pattern Quantifiers
 *
 * PostgREST supports pattern matching with quantifiers:
 * - like(all) - All patterns must match (AND)
 * - like(any) - Any pattern must match (OR)
 * - ilike(all) - Case-insensitive, all patterns match
 * - ilike(any) - Case-insensitive, any pattern matches
 *
 * These are SQLite-compatible and translate to multiple LIKE clauses.
 *
 * Based on:
 * - PostgREST QueryParams.hs lines 498-510
 * - SQLITE_COMPATIBLE_ROADMAP.md Phase 2A
 */

import { describe, test, expect } from 'vitest';
import { QueryParser } from '../../src/parser/index.js';

describe('PostgREST Pattern Quantifiers', () => {
  const parser = new QueryParser();

  describe('like(all) - All patterns must match', () => {
    test('parses like(all) with two patterns', () => {
      const ast = parser.parse('http://localhost/users?name=like(all).{*Smith,*John}');

      expect(ast.where).toEqual({
        type: 'and',
        conditions: [
          {
            type: 'filter',
            column: 'name',
            operator: 'like',
            value: '*Smith',
          },
          {
            type: 'filter',
            column: 'name',
            operator: 'like',
            value: '*John',
          },
        ],
      });
    });

    test('parses like(all) with three patterns', () => {
      const ast = parser.parse('http://localhost/products?description=like(all).{*fast,*easy,*cheap}');

      expect(ast.where).toEqual({
        type: 'and',
        conditions: [
          {
            type: 'filter',
            column: 'description',
            operator: 'like',
            value: '*fast',
          },
          {
            type: 'filter',
            column: 'description',
            operator: 'like',
            value: '*easy',
          },
          {
            type: 'filter',
            column: 'description',
            operator: 'like',
            value: '*cheap',
          },
        ],
      });
    });

    test('parses like(all) with single pattern', () => {
      const ast = parser.parse('http://localhost/users?name=like(all).{*Smith}');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'name',
        operator: 'like',
        value: '*Smith',
      });
    });
  });

  describe('like(any) - Any pattern can match', () => {
    test('parses like(any) with two patterns', () => {
      const ast = parser.parse('http://localhost/users?email=like(any).{*@gmail.com,*@yahoo.com}');

      expect(ast.where).toEqual({
        type: 'or',
        conditions: [
          {
            type: 'filter',
            column: 'email',
            operator: 'like',
            value: '*@gmail.com',
          },
          {
            type: 'filter',
            column: 'email',
            operator: 'like',
            value: '*@yahoo.com',
          },
        ],
      });
    });

    test('parses like(any) with three patterns', () => {
      const ast = parser.parse('http://localhost/files?name=like(any).{*.pdf,*.doc,*.txt}');

      expect(ast.where).toEqual({
        type: 'or',
        conditions: [
          {
            type: 'filter',
            column: 'name',
            operator: 'like',
            value: '*.pdf',
          },
          {
            type: 'filter',
            column: 'name',
            operator: 'like',
            value: '*.doc',
          },
          {
            type: 'filter',
            column: 'name',
            operator: 'like',
            value: '*.txt',
          },
        ],
      });
    });
  });

  describe('ilike(all) - Case-insensitive, all must match', () => {
    test('parses ilike(all) with two patterns', () => {
      const ast = parser.parse('http://localhost/users?name=ilike(all).{*SMITH,*JOHN}');

      expect(ast.where).toEqual({
        type: 'and',
        conditions: [
          {
            type: 'filter',
            column: 'name',
            operator: 'ilike',
            value: '*SMITH',
          },
          {
            type: 'filter',
            column: 'name',
            operator: 'ilike',
            value: '*JOHN',
          },
        ],
      });
    });
  });

  describe('ilike(any) - Case-insensitive, any can match', () => {
    test('parses ilike(any) with two patterns', () => {
      const ast = parser.parse('http://localhost/users?email=ilike(any).{*@GMAIL.COM,*@YAHOO.COM}');

      expect(ast.where).toEqual({
        type: 'or',
        conditions: [
          {
            type: 'filter',
            column: 'email',
            operator: 'ilike',
            value: '*@GMAIL.COM',
          },
          {
            type: 'filter',
            column: 'email',
            operator: 'ilike',
            value: '*@YAHOO.COM',
          },
        ],
      });
    });
  });

  describe('Negation with pattern quantifiers', () => {
    test('parses not.like(all) - negates entire AND group', () => {
      const ast = parser.parse('http://localhost/users?name=not.like(all).{*Smith,*John}');

      expect(ast.where).toEqual({
        type: 'and',
        negated: true,
        conditions: [
          {
            type: 'filter',
            column: 'name',
            operator: 'like',
            value: '*Smith',
          },
          {
            type: 'filter',
            column: 'name',
            operator: 'like',
            value: '*John',
          },
        ],
      });
    });

    test('parses not.like(any) - negates entire OR group', () => {
      const ast = parser.parse('http://localhost/users?email=not.like(any).{*@spam.com,*@junk.com}');

      expect(ast.where).toEqual({
        type: 'or',
        negated: true,
        conditions: [
          {
            type: 'filter',
            column: 'email',
            operator: 'like',
            value: '*@spam.com',
          },
          {
            type: 'filter',
            column: 'email',
            operator: 'like',
            value: '*@junk.com',
          },
        ],
      });
    });
  });

  describe('Pattern quantifiers with quoted values', () => {
    test('parses like(any) with quoted patterns containing commas', () => {
      const ast = parser.parse('http://localhost/users?name=like(any).{"Smith, John","Doe, Jane"}');

      expect(ast.where).toEqual({
        type: 'or',
        conditions: [
          {
            type: 'filter',
            column: 'name',
            operator: 'like',
            value: 'Smith, John',
          },
          {
            type: 'filter',
            column: 'name',
            operator: 'like',
            value: 'Doe, Jane',
          },
        ],
      });
    });
  });

  describe('Combined with other filters', () => {
    test('combines like(any) with implicit AND', () => {
      const ast = parser.parse('http://localhost/users?name=like(any).{*Smith,*Jones}&age=gte.18');

      expect(ast.where).toEqual({
        type: 'and',
        conditions: [
          {
            type: 'or',
            conditions: [
              {
                type: 'filter',
                column: 'name',
                operator: 'like',
                value: '*Smith',
              },
              {
                type: 'filter',
                column: 'name',
                operator: 'like',
                value: '*Jones',
              },
            ],
          },
          {
            type: 'filter',
            column: 'age',
            operator: 'gte',
            value: 18,
          },
        ],
      });
    });
  });
});
