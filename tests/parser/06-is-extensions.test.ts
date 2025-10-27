/**
 * Tests for IS Operator Extensions
 *
 * PostgREST supports additional IS operator values beyond null/true/false:
 * - is.not_null - Check for NOT NULL (IS NOT NULL in SQL)
 * - is.unknown - SQL standard UNKNOWN (rare, but spec-compliant)
 *
 * These are SQLite-compatible and translate directly to SQL.
 *
 * Based on:
 * - PostgREST QueryParams.hs lines 380-390
 * - SQLITE_COMPATIBLE_ROADMAP.md Phase 2B
 */

import { describe, test, expect } from 'vitest';
import { QueryParser } from '../../src/parser/index.js';

describe('PostgREST IS Operator Extensions', () => {
  const parser = new QueryParser();

  describe('is.not_null - Check for NOT NULL', () => {
    test('parses is.not_null', () => {
      const ast = parser.parse('http://localhost/users?deleted_at=is.not_null');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'deleted_at',
        operator: 'is',
        value: 'not_null',
      });
    });

    test('parses is.not_null with different column', () => {
      const ast = parser.parse('http://localhost/products?discontinued_at=is.not_null');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'discontinued_at',
        operator: 'is',
        value: 'not_null',
      });
    });
  });

  describe('is.unknown - SQL standard UNKNOWN', () => {
    test('parses is.unknown', () => {
      const ast = parser.parse('http://localhost/users?status=is.unknown');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'status',
        operator: 'is',
        value: 'unknown',
      });
    });
  });

  describe('Case insensitivity', () => {
    test('parses is.NOT_NULL (uppercase)', () => {
      const ast = parser.parse('http://localhost/users?deleted_at=is.NOT_NULL');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'deleted_at',
        operator: 'is',
        value: 'not_null',
      });
    });

    test('parses is.UNKNOWN (uppercase)', () => {
      const ast = parser.parse('http://localhost/users?status=is.UNKNOWN');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'status',
        operator: 'is',
        value: 'unknown',
      });
    });

    test('parses is.Not_Null (mixed case)', () => {
      const ast = parser.parse('http://localhost/users?deleted_at=is.Not_Null');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'deleted_at',
        operator: 'is',
        value: 'not_null',
      });
    });
  });

  describe('Combined with other filters', () => {
    test('combines is.not_null with implicit AND', () => {
      const ast = parser.parse('http://localhost/users?deleted_at=is.not_null&age=gte.18');

      expect(ast.where).toEqual({
        type: 'and',
        conditions: [
          {
            type: 'filter',
            column: 'deleted_at',
            operator: 'is',
            value: 'not_null',
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

    test('uses is.not_null in OR group', () => {
      const ast = parser.parse('http://localhost/users?or=(deleted_at.is.not_null,archived.is.true)');

      expect(ast.where).toEqual({
        type: 'or',
        conditions: [
          {
            type: 'filter',
            column: 'deleted_at',
            operator: 'is',
            value: 'not_null',
          },
          {
            type: 'filter',
            column: 'archived',
            operator: 'is',
            value: true,
          },
        ],
      });
    });
  });

  describe('Negation with IS extensions', () => {
    test('parses not.is.not_null (double negative)', () => {
      const ast = parser.parse('http://localhost/users?deleted_at=not.is.not_null');

      expect(ast.where).toEqual({
        type: 'filter',
        column: 'deleted_at',
        operator: 'is',
        value: 'not_null',
        negated: true,
      });
    });
  });
});
