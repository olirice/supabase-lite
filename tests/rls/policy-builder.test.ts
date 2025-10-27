/**
 * Policy Builder Tests
 *
 * Tests the structured, type-safe policy builder API
 */

import { describe, test, expect } from 'vitest';
import {
  policy,
  authUid,
  authRole,
  alwaysAllow,
  alwaysDeny,
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  inList,
  isNull,
  isNotNull,
  like,
  ilike,
  and,
  or,
} from '../../src/rls/policy-builder.js';
import type { FilterNode, LogicalNode } from '../../src/parser/types.js';

describe('Policy Builder', () => {
  describe('Auth Functions', () => {
    test('authUid() creates auth function marker', () => {
      const result = authUid();
      expect(result).toEqual({
        type: 'auth_function',
        name: 'uid',
      });
    });

    test('authRole() creates auth function marker', () => {
      const result = authRole();
      expect(result).toEqual({
        type: 'auth_function',
        name: 'role',
      });
    });

    test('policy.authUid() creates auth function marker', () => {
      const result = policy.authUid();
      expect(result).toEqual({
        type: 'auth_function',
        name: 'uid',
      });
    });

    test('policy.authRole() creates auth function marker', () => {
      const result = policy.authRole();
      expect(result).toEqual({
        type: 'auth_function',
        name: 'role',
      });
    });
  });

  describe('Special Cases', () => {
    test('alwaysAllow() creates 1=1 filter', () => {
      const result = alwaysAllow();
      expect(result).toEqual({
        type: 'filter',
        column: '1',
        operator: 'eq',
        value: 1,
      });
    });

    test('alwaysDeny() creates 1=0 filter', () => {
      const result = alwaysDeny();
      expect(result).toEqual({
        type: 'filter',
        column: '1',
        operator: 'eq',
        value: 0,
      });
    });

    test('policy.alwaysAllow() works', () => {
      const result = policy.alwaysAllow();
      expect(result.type).toBe('filter');
      expect(result.value).toBe(1);
    });

    test('policy.alwaysDeny() works', () => {
      const result = policy.alwaysDeny();
      expect(result.type).toBe('filter');
      expect(result.value).toBe(0);
    });
  });

  describe('Comparison Operators', () => {
    test('eq() creates equality filter with string', () => {
      const result = eq('status', 'active');
      expect(result).toEqual({
        type: 'filter',
        column: 'status',
        operator: 'eq',
        value: 'active',
      });
    });

    test('eq() creates equality filter with number', () => {
      const result = eq('age', 25);
      expect(result).toEqual({
        type: 'filter',
        column: 'age',
        operator: 'eq',
        value: 25,
      });
    });

    test('eq() creates equality filter with boolean', () => {
      const result = eq('published', true);
      expect(result).toEqual({
        type: 'filter',
        column: 'published',
        operator: 'eq',
        value: true,
      });
    });

    test('eq() creates equality filter with null', () => {
      const result = eq('deleted_at', null);
      expect(result).toEqual({
        type: 'filter',
        column: 'deleted_at',
        operator: 'eq',
        value: null,
      });
    });

    test('eq() creates equality filter with auth function', () => {
      const result = eq('user_id', authUid());
      expect(result).toEqual({
        type: 'filter',
        column: 'user_id',
        operator: 'eq',
        value: { type: 'auth_function', name: 'uid' },
      });
    });

    test('neq() creates not equal filter', () => {
      const result = neq('status', 'deleted');
      expect(result).toEqual({
        type: 'filter',
        column: 'status',
        operator: 'neq',
        value: 'deleted',
      });
    });

    test('gt() creates greater than filter', () => {
      const result = gt('age', 18);
      expect(result).toEqual({
        type: 'filter',
        column: 'age',
        operator: 'gt',
        value: 18,
      });
    });

    test('gte() creates greater than or equal filter', () => {
      const result = gte('price', 100);
      expect(result).toEqual({
        type: 'filter',
        column: 'price',
        operator: 'gte',
        value: 100,
      });
    });

    test('lt() creates less than filter', () => {
      const result = lt('quantity', 10);
      expect(result).toEqual({
        type: 'filter',
        column: 'quantity',
        operator: 'lt',
        value: 10,
      });
    });

    test('lte() creates less than or equal filter', () => {
      const result = lte('score', 100);
      expect(result).toEqual({
        type: 'filter',
        column: 'score',
        operator: 'lte',
        value: 100,
      });
    });

    test('inList() creates IN filter with array of values', () => {
      const result = inList('status', ['active', 'pending', 'review']);
      expect(result).toEqual({
        type: 'filter',
        column: 'status',
        operator: 'in',
        value: ['active', 'pending', 'review'],
      });
    });

    test('inList() creates IN filter with numbers', () => {
      const result = inList('id', [1, 2, 3, 4, 5]);
      expect(result).toEqual({
        type: 'filter',
        column: 'id',
        operator: 'in',
        value: [1, 2, 3, 4, 5],
      });
    });

    test('isNull() creates IS NULL filter', () => {
      const result = isNull('deleted_at');
      expect(result).toEqual({
        type: 'filter',
        column: 'deleted_at',
        operator: 'is',
        value: null,
      });
    });

    test('isNotNull() creates IS NOT NULL filter', () => {
      const result = isNotNull('email');
      expect(result).toEqual({
        type: 'filter',
        column: 'email',
        operator: 'is',
        value: null,
        negated: true,
      });
    });

    test('like() creates LIKE filter', () => {
      const result = like('name', 'John%');
      expect(result).toEqual({
        type: 'filter',
        column: 'name',
        operator: 'like',
        value: 'John%',
      });
    });

    test('ilike() creates case-insensitive LIKE filter', () => {
      const result = ilike('email', '%@example.com');
      expect(result).toEqual({
        type: 'filter',
        column: 'email',
        operator: 'ilike',
        value: '%@example.com',
      });
    });
  });

  describe('Policy Namespace', () => {
    test('policy.eq() works', () => {
      const result = policy.eq('published', 1);
      expect(result.type).toBe('filter');
      expect(result.operator).toBe('eq');
      expect(result.column).toBe('published');
      expect(result.value).toBe(1);
    });

    test('policy.neq() works', () => {
      const result = policy.neq('status', 'deleted');
      expect(result.operator).toBe('neq');
    });

    test('policy.gt() works', () => {
      const result = policy.gt('age', 18);
      expect(result.operator).toBe('gt');
    });

    test('policy.gte() works', () => {
      const result = policy.gte('price', 100);
      expect(result.operator).toBe('gte');
    });

    test('policy.lt() works', () => {
      const result = policy.lt('quantity', 10);
      expect(result.operator).toBe('lt');
    });

    test('policy.lte() works', () => {
      const result = policy.lte('score', 100);
      expect(result.operator).toBe('lte');
    });

    test('policy.in() works', () => {
      const result = policy.in('status', ['active', 'pending']);
      expect(result.operator).toBe('in');
      expect(result.value).toEqual(['active', 'pending']);
    });

    test('policy.isNull() works', () => {
      const result = policy.isNull('deleted_at');
      expect(result.operator).toBe('is');
      expect(result.value).toBe(null);
      expect(result.negated).toBeUndefined();
    });

    test('policy.isNotNull() works', () => {
      const result = policy.isNotNull('email');
      expect(result.operator).toBe('is');
      expect(result.value).toBe(null);
      expect(result.negated).toBe(true);
    });

    test('policy.like() works', () => {
      const result = policy.like('name', 'John%');
      expect(result.operator).toBe('like');
    });

    test('policy.ilike() works', () => {
      const result = policy.ilike('email', '%@example.com');
      expect(result.operator).toBe('ilike');
    });
  });

  describe('Logical Operators - AND', () => {
    test('and() combines two conditions', () => {
      const result = and(
        eq('status', 'active'),
        eq('published', 1)
      );
      expect(result).toEqual({
        type: 'and',
        conditions: [
          { type: 'filter', column: 'status', operator: 'eq', value: 'active' },
          { type: 'filter', column: 'published', operator: 'eq', value: 1 },
        ],
      });
    });

    test('and() combines multiple conditions', () => {
      const result = and(
        eq('status', 'active'),
        gt('age', 18),
        isNotNull('email')
      );
      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(3);
    });

    test('and() with single condition returns AND node', () => {
      const result = and(eq('status', 'active'));
      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(1);
    });

    test('and() throws error with no conditions', () => {
      expect(() => and()).toThrow('AND requires at least one condition');
    });

    test('and() can nest other logical nodes', () => {
      const result = and(
        eq('status', 'active'),
        or(
          eq('role', 'admin'),
          eq('role', 'moderator')
        )
      );
      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions[1]!.type).toBe('or');
    });

    test('policy.and() works', () => {
      const result = policy.and(
        policy.eq('published', 1),
        policy.eq('user_id', policy.authUid())
      );
      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(2);
    });
  });

  describe('Logical Operators - OR', () => {
    test('or() combines two conditions', () => {
      const result = or(
        eq('user_id', authUid()),
        eq('published', 1)
      );
      expect(result).toEqual({
        type: 'or',
        conditions: [
          { type: 'filter', column: 'user_id', operator: 'eq', value: { type: 'auth_function', name: 'uid' } },
          { type: 'filter', column: 'published', operator: 'eq', value: 1 },
        ],
      });
    });

    test('or() combines multiple conditions', () => {
      const result = or(
        eq('role', 'admin'),
        eq('role', 'moderator'),
        eq('role', 'editor')
      );
      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(3);
    });

    test('or() with single condition returns OR node', () => {
      const result = or(eq('status', 'active'));
      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(1);
    });

    test('or() throws error with no conditions', () => {
      expect(() => or()).toThrow('OR requires at least one condition');
    });

    test('or() can nest other logical nodes', () => {
      const result = or(
        and(
          eq('status', 'active'),
          gt('age', 18)
        ),
        eq('role', 'admin')
      );
      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions[0]!.type).toBe('and');
    });

    test('policy.or() works', () => {
      const result = policy.or(
        policy.eq('user_id', policy.authUid()),
        policy.eq('published', 1)
      );
      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(2);
    });
  });

  describe('Complex Nested Conditions', () => {
    test('deeply nested AND and OR conditions', () => {
      const result = and(
        eq('status', 'active'),
        or(
          and(
            eq('role', 'admin'),
            gt('permissions', 5)
          ),
          and(
            eq('user_id', authUid()),
            eq('published', 1)
          )
        )
      );

      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(2);

      const orNode = result.conditions[1] as LogicalNode;
      expect(orNode.type).toBe('or');
      expect(orNode.conditions).toHaveLength(2);

      const firstAndNode = orNode.conditions[0] as LogicalNode;
      expect(firstAndNode.type).toBe('and');
      expect(firstAndNode.conditions).toHaveLength(2);
    });

    test('complex policy with auth functions', () => {
      const result = or(
        and(
          eq('user_id', authUid()),
          neq('status', 'deleted')
        ),
        and(
          eq('public', true),
          eq('published', 1)
        ),
        eq('role', authRole())
      );

      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(3);

      // Check auth functions are preserved
      const firstAnd = result.conditions[0] as LogicalNode;
      const userIdFilter = firstAnd.conditions[0] as FilterNode;
      expect(userIdFilter.value).toEqual({ type: 'auth_function', name: 'uid' });
    });

    test('policy builder chaining with all operators', () => {
      const result = policy.and(
        policy.or(
          policy.eq('user_id', policy.authUid()),
          policy.in('role', ['admin', 'moderator'])
        ),
        policy.gt('age', 18),
        policy.isNotNull('email'),
        policy.like('name', 'John%')
      );

      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(4);

      // Verify each condition type
      const orCondition = result.conditions[0] as LogicalNode;
      expect(orCondition.type).toBe('or');

      const gtCondition = result.conditions[1] as FilterNode;
      expect(gtCondition.operator).toBe('gt');

      const isNotNullCondition = result.conditions[2] as FilterNode;
      expect(isNotNullCondition.negated).toBe(true);

      const likeCondition = result.conditions[3] as FilterNode;
      expect(likeCondition.operator).toBe('like');
    });
  });

  describe('Real-World Policy Examples', () => {
    test('user can only see their own posts', () => {
      const policy = eq('user_id', authUid());

      expect(policy).toEqual({
        type: 'filter',
        column: 'user_id',
        operator: 'eq',
        value: { type: 'auth_function', name: 'uid' },
      });
    });

    test('user can see own posts or published posts', () => {
      const result = or(
        eq('user_id', authUid()),
        eq('published', 1)
      );

      expect(result.type).toBe('or');
      expect(result.conditions).toHaveLength(2);
    });

    test('admin or moderator roles only', () => {
      const result = inList('role', ['admin', 'moderator']);

      expect(result).toEqual({
        type: 'filter',
        column: 'role',
        operator: 'in',
        value: ['admin', 'moderator'],
      });
    });

    test('active posts in specific categories', () => {
      const result = and(
        eq('status', 'active'),
        inList('category', ['news', 'blog', 'announcement']),
        isNull('deleted_at')
      );

      expect(result.type).toBe('and');
      expect(result.conditions).toHaveLength(3);
    });

    test('authenticated users can see all posts (no restriction)', () => {
      const result = alwaysAllow();

      expect(result).toEqual({
        type: 'filter',
        column: '1',
        operator: 'eq',
        value: 1,
      });
    });

    test('deny all access', () => {
      const result = alwaysDeny();

      expect(result).toEqual({
        type: 'filter',
        column: '1',
        operator: 'eq',
        value: 0,
      });
    });
  });

  describe('Edge Cases and Type Safety', () => {
    test('handles empty string value', () => {
      const result = eq('name', '');
      expect(result.value).toBe('');
    });

    test('handles zero as value', () => {
      const result = eq('count', 0);
      expect(result.value).toBe(0);
    });

    test('handles false as value', () => {
      const result = eq('enabled', false);
      expect(result.value).toBe(false);
    });

    test('handles special characters in column names', () => {
      const result = eq('user_email_address', 'test@example.com');
      expect(result.column).toBe('user_email_address');
    });

    test('handles wildcards in LIKE patterns', () => {
      const result = like('email', '%@example.com');
      expect(result.value).toBe('%@example.com');
    });

    test('handles empty array in IN clause', () => {
      const result = inList('status', []);
      expect(result.value).toEqual([]);
    });

    test('preserves auth function references in complex queries', () => {
      const result = and(
        or(
          eq('user_id', authUid()),
          eq('owner_id', authUid())
        ),
        eq('role', authRole())
      );

      const orNode = result.conditions[0] as LogicalNode;
      const firstEq = orNode.conditions[0] as FilterNode;
      const secondEq = orNode.conditions[1] as FilterNode;
      const roleEq = result.conditions[1] as FilterNode;

      expect(firstEq.value).toEqual({ type: 'auth_function', name: 'uid' });
      expect(secondEq.value).toEqual({ type: 'auth_function', name: 'uid' });
      expect(roleEq.value).toEqual({ type: 'auth_function', name: 'role' });
    });
  });
});
