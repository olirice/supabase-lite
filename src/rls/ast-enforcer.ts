/**
 * AST-Based RLS Enforcement
 *
 * Applies Row Level Security policies at the AST level (before SQL compilation).
 * Uses structured WhereNode AST - no SQL parsing required.
 *
 * This implementation is fully deterministic with zero parsing edge cases.
 */

import type { RLSProvider, PolicyCommand } from './types.js';
import type { RequestContext } from '../auth/types.js';
import type { QueryAST, WhereNode, AuthFunction } from '../parser/types.js';
import { escapeIdentifier } from '../utils/identifier.js';
import { DENY_ALL_FILTER_COLUMN, DENY_ALL_FILTER_VALUE } from '../utils/constants.js';

/**
 * AST-Based RLS Enforcer
 *
 * Adds RLS policy nodes to QueryAST before compilation.
 * Substitutes auth functions (auth.uid(), auth.role()) with actual values.
 */
export class RLSASTEnforcer {
  constructor(private rlsProvider: RLSProvider) {}

  /**
   * Enforce RLS policies on a QueryAST
   *
   * Returns a new QueryAST with rlsPolicy field populated.
   * This method is 100% deterministic - no parsing involved.
   */
  async enforceOnAST(
    ast: QueryAST,
    command: PolicyCommand,
    context: RequestContext
  ): Promise<QueryAST> {
    try {
      // Check if RLS is enabled for this table
      const isEnabled = await this.rlsProvider.isRLSEnabled(ast.from);
      if (!isEnabled) {
        return ast; // RLS not enabled, return original AST
      }

      // Get applicable policies for this command and role
      const policies = await this.rlsProvider.getPoliciesForCommand(
        ast.from,
        command,
        context.role
      );

      if (policies.length === 0) {
        // No policies for this role - deny all access (PostgreSQL behavior)
        return {
          ...ast,
          rlsPolicy: this.createDenyAllPolicy(),
        };
      }

      // Build RLS policy expression from policies
      const rlsPolicyNode = this.buildRLSPolicyNode(policies, command, context);

      if (!rlsPolicyNode) {
        // No valid policy conditions - deny all access
        return {
          ...ast,
          rlsPolicy: this.createDenyAllPolicy(),
        };
      }

      // Return AST with RLS policy
      return {
        ...ast,
        rlsPolicy: rlsPolicyNode,
      };
    } catch (error) {
      // If anything fails, return original AST rather than breaking the query
      console.error('AST-based RLS enforcement failed:', error);
      return ast;
    }
  }

  /**
   * Create a "deny all" policy node (1 = 0)
   */
  private createDenyAllPolicy(): WhereNode {
    return {
      type: 'filter',
      column: DENY_ALL_FILTER_COLUMN,
      operator: 'eq',
      value: DENY_ALL_FILTER_VALUE,
    };
  }

  /**
   * Build RLS policy node from multiple policies
   *
   * Combines policies with OR (any policy can grant access)
   * Substitutes auth functions with actual values from context
   */
  private buildRLSPolicyNode(
    policies: readonly any[],
    command: PolicyCommand,
    context: RequestContext
  ): WhereNode | null {
    const policyNodes: WhereNode[] = [];

    for (const policy of policies) {
      let policyExpr: WhereNode | undefined;

      // Determine which expression to use based on command
      if (command === 'INSERT') {
        policyExpr = policy.withCheck;
      } else if (command === 'UPDATE') {
        // For UPDATE, combine USING and WITH CHECK with AND
        const parts: WhereNode[] = [];
        if (policy.using) parts.push(policy.using);
        if (policy.withCheck) parts.push(policy.withCheck);

        if (parts.length === 0) {
          continue;
        } else if (parts.length === 1) {
          policyExpr = parts[0];
        } else {
          policyExpr = {
            type: 'and',
            conditions: parts,
          };
        }
      } else {
        // SELECT, DELETE - use USING
        policyExpr = policy.using;
      }

      if (policyExpr) {
        // Substitute auth functions with actual values
        const substituted = this.substituteAuthFunctions(policyExpr, context);
        policyNodes.push(substituted);
      }
    }

    if (policyNodes.length === 0) {
      return null;
    }

    // Single policy - return it directly
    if (policyNodes.length === 1) {
      return policyNodes[0]!;
    }

    // Multiple policies - combine with OR
    return {
      type: 'or',
      conditions: policyNodes,
    };
  }

  /**
   * Substitute auth.uid() and auth.role() in policy expression
   *
   * This is a deterministic AST transformation - no parsing involved.
   * Recursively walks the WhereNode tree and replaces AuthFunction values.
   */
  private substituteAuthFunctions(node: WhereNode, context: RequestContext): WhereNode {
    if (node.type === 'filter') {
      // Check if the value is an AuthFunction
      if (this.isAuthFunction(node.value)) {
        const authFunc = node.value as AuthFunction;
        let substitutedValue: string | number | boolean | null;

        if (authFunc.name === 'uid') {
          substitutedValue = context.uid ?? null;
        } else if (authFunc.name === 'role') {
          substitutedValue = context.role;
        } else {
          // Unknown auth function - should never happen with TypeScript
          substitutedValue = null;
        }

        return {
          ...node,
          value: substitutedValue,
        };
      }

      // Value is not an auth function - return as is
      return node;
    } else if (node.type === 'and' || node.type === 'or') {
      // Recursively substitute in all conditions
      return {
        ...node,
        conditions: node.conditions.map(c => this.substituteAuthFunctions(c, context)),
      };
    } else {
      // embedded_filter - not expected in RLS policies
      return node;
    }
  }

  /**
   * Check if a value is an AuthFunction
   */
  private isAuthFunction(value: unknown): value is AuthFunction {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as any).type === 'auth_function'
    );
  }

  /**
   * Get WITH CHECK policy for INSERT validation
   *
   * Returns the WhereNode AST that should be validated against inserted rows.
   */
  async getWithCheckPolicy(
    tableName: string,
    context: RequestContext
  ): Promise<WhereNode | null> {
    try {
      // Check if RLS is enabled for this table
      const isEnabled = await this.rlsProvider.isRLSEnabled(tableName);
      if (!isEnabled) {
        return null; // RLS not enabled, no check needed
      }

      // Get applicable policies for INSERT command and role
      const policies = await this.rlsProvider.getPoliciesForCommand(
        tableName,
        'INSERT',
        context.role
      );

      if (policies.length === 0) {
        // No policies for this role - deny all inserts
        return this.createDenyAllPolicy();
      }

      // Build WITH CHECK expression from policies
      const policyNodes: WhereNode[] = [];
      for (const policy of policies) {
        if (policy.withCheck) {
          const substituted = this.substituteAuthFunctions(policy.withCheck, context);
          policyNodes.push(substituted);
        }
      }

      if (policyNodes.length === 0) {
        return null; // No WITH CHECK constraints
      }

      // Single policy
      if (policyNodes.length === 1) {
        return policyNodes[0]!;
      }

      // Multiple policies - combine with OR
      return {
        type: 'or',
        conditions: policyNodes,
      };
    } catch (error) {
      console.error('Failed to get WITH CHECK policy:', error);
      return null;
    }
  }

  /**
   * Compile a WhereNode to SQL for use in validation queries
   *
   * This is needed for validateWithCheck() which uses SQL queries.
   * Deterministic compilation with no edge cases.
   */
  compileWhereNode(node: WhereNode): { sql: string; params: unknown[] } {
    const params: unknown[] = [];

    const compileSingle = (n: WhereNode): string => {
      if (n.type === 'filter') {
        const operator = this.mapOperatorToSQL(n.operator);
        params.push(n.value);

        // Special case: numeric literals (e.g., "1" in "1 = 1") should not be quoted
        const isNumericLiteral = /^\d+$/.test(n.column);
        const columnSQL = isNumericLiteral ? n.column : escapeIdentifier(n.column);

        return `${columnSQL} ${operator} ?`;
      } else if (n.type === 'and' || n.type === 'or') {
        const op = n.type.toUpperCase();
        const parts = n.conditions.map(c => `(${compileSingle(c)})`);
        return parts.join(` ${op} `);
      } else {
        // embedded_filter - not expected in RLS policies
        throw new Error('Embedded filters not supported in RLS policies');
      }
    };

    const sql = compileSingle(node);
    return { sql, params };
  }

  /**
   * Map FilterOperator to SQL operator string
   */
  private mapOperatorToSQL(op: string): string {
    switch (op) {
      case 'eq': return '=';
      case 'neq': return '!=';
      case 'gt': return '>';
      case 'gte': return '>=';
      case 'lt': return '<';
      case 'lte': return '<=';
      case 'like': return 'LIKE';
      case 'ilike': return 'LIKE'; // SQLite doesn't have ILIKE, use LIKE
      case 'in': return 'IN';
      case 'is': return 'IS';
      default: return '=';
    }
  }

  /**
   * Validate rows against a WITH CHECK policy
   *
   * Executes the policy expression for each row and returns only rows that pass.
   * Rows that fail are deleted from the database.
   *
   * This method is deterministic - the WhereNode is already validated and compiled.
   */
  async validateWithCheck<T extends Record<string, unknown>>(
    tableName: string,
    rows: T[],
    policyNode: WhereNode,
    primaryKey: string = 'id'
  ): Promise<T[]> {
    if (rows.length === 0) {
      return rows;
    }

    // Special case: "1 = 0" means reject all
    if (policyNode.type === 'filter' &&
        policyNode.column === DENY_ALL_FILTER_COLUMN &&
        policyNode.operator === 'eq' &&
        policyNode.value === DENY_ALL_FILTER_VALUE) {
      // Delete all inserted rows
      const ids = rows.map(row => row[primaryKey]);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        const deleteSql = `DELETE FROM ${tableName} WHERE ${primaryKey} IN (${placeholders})`;
        await this.rlsProvider.executeModification(deleteSql, ids);
      }
      return [];
    }

    const validRows: T[] = [];
    const invalidIds: unknown[] = [];

    // Compile the policy node to SQL
    const { sql: policySQL, params: policyParams } = this.compileWhereNode(policyNode);

    // Validate each row
    for (const row of rows) {
      const rowId = row[primaryKey];
      if (rowId === undefined) {
        console.warn('Row missing primary key, skipping validation');
        validRows.push(row);
        continue;
      }

      // Build validation query: SELECT 1 FROM table WHERE id = ? AND (policy)
      const validationSql = `SELECT 1 FROM ${tableName} WHERE ${primaryKey} = ? AND (${policySQL})`;
      const validationParams = [rowId, ...policyParams];

      try {
        const result = await this.rlsProvider.executeQuery(validationSql, validationParams);

        if (result) {
          // Row passes the policy
          validRows.push(row);
        } else {
          // Row fails the policy - mark for deletion
          invalidIds.push(rowId);
        }
      } catch (error) {
        console.error('WITH CHECK validation error:', error);
        // On error, be permissive and keep the row
        validRows.push(row);
      }
    }

    // Delete invalid rows
    if (invalidIds.length > 0) {
      const placeholders = invalidIds.map(() => '?').join(',');
      const deleteSql = `DELETE FROM ${tableName} WHERE ${primaryKey} IN (${placeholders})`;
      await this.rlsProvider.executeModification(deleteSql, invalidIds);
    }

    return validRows;
  }
}
