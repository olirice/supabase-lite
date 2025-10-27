/**
 * RLS Policy Builder
 *
 * Provides a structured, type-safe API for building RLS policies.
 * No SQL parsing - policies are built as AST nodes directly.
 *
 * Example:
 *   using: policy.or(
 *     policy.eq('user_id', policy.authUid()),
 *     policy.eq('published', 1)
 *   )
 */

import type { WhereNode, FilterNode, LogicalNode, FilterOperator } from '../parser/types.js';

/**
 * Special marker type for auth function values
 */
export interface AuthFunction {
  type: 'auth_function';
  name: 'uid' | 'role';
}

/**
 * Policy value - can be a literal or an auth function
 */
export type PolicyValue = string | number | boolean | null | AuthFunction;

/**
 * Helper to create auth.uid() reference
 */
export function authUid(): AuthFunction {
  return { type: 'auth_function', name: 'uid' };
}

/**
 * Helper to create auth.role() reference
 */
export function authRole(): AuthFunction {
  return { type: 'auth_function', name: 'role' };
}

/**
 * Always allow (true)
 */
export function alwaysAllow(): FilterNode {
  return {
    type: 'filter',
    column: '1',
    operator: 'eq',
    value: 1,
  };
}

/**
 * Always deny (false)
 */
export function alwaysDeny(): FilterNode {
  return {
    type: 'filter',
    column: '1',
    operator: 'eq',
    value: 0,
  };
}

/**
 * Equality comparison
 */
export function eq(column: string, value: PolicyValue): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'eq',
    value,
  };
}

/**
 * Not equal comparison
 */
export function neq(column: string, value: PolicyValue): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'neq',
    value,
  };
}

/**
 * Greater than comparison
 */
export function gt(column: string, value: PolicyValue): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'gt',
    value,
  };
}

/**
 * Greater than or equal comparison
 */
export function gte(column: string, value: PolicyValue): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'gte',
    value,
  };
}

/**
 * Less than comparison
 */
export function lt(column: string, value: PolicyValue): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'lt',
    value,
  };
}

/**
 * Less than or equal comparison
 */
export function lte(column: string, value: PolicyValue): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'lte',
    value,
  };
}

/**
 * IN comparison
 */
export function inList(column: string, values: PolicyValue[]): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'in',
    value: values,
  };
}

/**
 * IS NULL comparison
 */
export function isNull(column: string): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'is',
    value: null,
  };
}

/**
 * IS NOT NULL comparison
 */
export function isNotNull(column: string): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'is',
    value: null,
    negated: true,
  };
}

/**
 * LIKE comparison
 */
export function like(column: string, pattern: string): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'like',
    value: pattern,
  };
}

/**
 * Case-insensitive LIKE comparison
 */
export function ilike(column: string, pattern: string): FilterNode {
  return {
    type: 'filter',
    column,
    operator: 'ilike',
    value: pattern,
  };
}

/**
 * AND combination of conditions
 */
export function and(...conditions: WhereNode[]): LogicalNode {
  if (conditions.length === 0) {
    throw new Error('AND requires at least one condition');
  }
  if (conditions.length === 1) {
    // Optimization: single condition doesn't need AND wrapper
    // But return as AND node for consistency
    return {
      type: 'and',
      conditions,
    };
  }
  return {
    type: 'and',
    conditions,
  };
}

/**
 * OR combination of conditions
 */
export function or(...conditions: WhereNode[]): LogicalNode {
  if (conditions.length === 0) {
    throw new Error('OR requires at least one condition');
  }
  if (conditions.length === 1) {
    // Optimization: single condition doesn't need OR wrapper
    // But return as OR node for consistency
    return {
      type: 'or',
      conditions,
    };
  }
  return {
    type: 'or',
    conditions,
  };
}

/**
 * Policy builder namespace for convenient imports
 *
 * Usage:
 *   import { policy } from './rls/policy-builder';
 *   using: policy.eq('user_id', policy.authUid())
 */
export const policy = {
  // Auth functions
  authUid,
  authRole,

  // Special cases
  alwaysAllow,
  alwaysDeny,

  // Comparisons
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  in: inList,
  isNull,
  isNotNull,
  like,
  ilike,

  // Logical operators
  and,
  or,
};
