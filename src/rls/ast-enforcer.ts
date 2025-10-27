/**
 * AST-Based RLS Enforcement
 *
 * Applies Row Level Security policies at the AST level (before SQL compilation).
 * This avoids string manipulation and allows proper integration with resource embedding.
 */

import type { RLSProvider, PolicyCommand } from './types.js';
import type { RequestContext } from '../auth/types.js';
import type { QueryAST, WhereNode, LogicalNode } from '../parser/types.js';
import { parseSQLExpression } from './expression-parser.js';

/**
 * AST-Based RLS Enforcer
 *
 * Adds RLS policy nodes to QueryAST before compilation.
 */
export class RLSASTEnforcer {
  constructor(private rlsProvider: RLSProvider) {}

  /**
   * Enforce RLS policies on a QueryAST
   *
   * Returns a new QueryAST with rlsPolicy field populated.
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
        // Add a FALSE condition (1 = 0)
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
      column: '1',
      operator: 'eq',
      value: 0,
    };
  }

  /**
   * Build RLS policy node from multiple policies
   */
  private buildRLSPolicyNode(
    policies: readonly any[],
    command: PolicyCommand,
    context: RequestContext
  ): WhereNode | null {
    const policyNodes: WhereNode[] = [];

    for (const policy of policies) {
      let expr: string | undefined;

      // Determine which expression to use based on command
      if (command === 'INSERT') {
        expr = policy.withCheck;
      } else if (command === 'UPDATE') {
        // For UPDATE, combine USING and WITH CHECK with AND
        const parts: string[] = [];
        if (policy.using) parts.push(policy.using);
        if (policy.withCheck) parts.push(policy.withCheck);
        expr = parts.length > 0 ? parts.join(' AND ') : undefined;
      } else {
        // SELECT, DELETE - use USING
        expr = policy.using;
      }

      if (!expr) {
        continue;
      }

      try {
        // Substitute auth functions BEFORE parsing
        const substituted = this.substituteAuthFunctions(expr, context);

        // Parse SQL expression into WhereNode AST
        const node = parseSQLExpression(substituted);
        policyNodes.push(node);
      } catch (error) {
        console.error(`Failed to parse RLS policy expression "${expr}":`, error);
        // Skip this policy if parsing fails
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
    const combinedNode: LogicalNode = {
      type: 'or',
      conditions: policyNodes,
    };

    return combinedNode;
  }

  /**
   * Substitute auth.uid() and auth.role() in policy expression
   */
  private substituteAuthFunctions(expression: string, context: RequestContext): string {
    let result = expression;

    // Replace auth.uid() with actual user ID (or NULL for anon)
    const uid = context.uid ? `'${this.escapeSqlString(context.uid)}'` : 'NULL';
    result = result.replace(/auth\.uid\(\)/gi, uid);

    // Replace auth.role() with actual role
    const role = `'${context.role}'`;
    result = result.replace(/auth\.role\(\)/gi, role);

    return result;
  }

  /**
   * Escape SQL string literals to prevent injection
   */
  private escapeSqlString(str: string): string {
    return str.replace(/'/g, "''");
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
          try {
            const substituted = this.substituteAuthFunctions(policy.withCheck, context);
            const node = parseSQLExpression(substituted);
            policyNodes.push(node);
          } catch (error) {
            console.error(`Failed to parse WITH CHECK expression "${policy.withCheck}":`, error);
          }
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
   */
  compileWhereNode(node: WhereNode): { sql: string; params: unknown[] } {
    const params: unknown[] = [];

    const compileSingle = (n: WhereNode): string => {
      if (n.type === 'filter') {
        const operator = this.mapOperatorToSQL(n.operator);
        params.push(n.value);
        return `${this.quoteIdentifier(n.column)} ${operator} ?`;
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
   * Quote identifier for SQL
   */
  private quoteIdentifier(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  /**
   * Validate rows against a WITH CHECK policy
   *
   * Executes the policy expression for each row and returns only rows that pass.
   * Rows that fail are deleted from the database.
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
        policyNode.column === '1' &&
        policyNode.operator === 'eq' &&
        policyNode.value === 0) {
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
