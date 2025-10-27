/**
 * SQLite RLS Storage Provider
 *
 * Stores and retrieves RLS policies in SQLite tables.
 * Implements the RLSProvider interface.
 *
 * Policies are stored as JSON-serialized WhereNode AST.
 */

import type Database from 'better-sqlite3';
import type { RLSProvider, RLSPolicy, PolicyCommand, PolicyRole } from './types.js';
import type { WhereNode } from '../parser/types.js';

/**
 * SQLite-based RLS storage provider
 */
export class SqliteRLSProvider implements RLSProvider {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initializeSchema();
  }

  /**
   * Initialize database schema for RLS storage
   */
  private initializeSchema(): void {
    // Table to track which tables have RLS enabled
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _rls_enabled_tables (
        table_name TEXT PRIMARY KEY
      )
    `);

    // Table to store policy definitions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _rls_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        table_name TEXT NOT NULL,
        command TEXT NOT NULL,
        role TEXT NOT NULL,
        using_expr TEXT,
        with_check_expr TEXT,
        restrictive INTEGER DEFAULT 0,
        UNIQUE(name, table_name)
      )
    `);

    // Index for efficient policy lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rls_policies_table_command_role
      ON _rls_policies(table_name, command, role)
    `);
  }

  /**
   * Enable RLS on a table
   */
  async enableRLS(tableName: string): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO _rls_enabled_tables (table_name) VALUES (?)')
      .run(tableName);
  }

  /**
   * Disable RLS on a table
   */
  async disableRLS(tableName: string): Promise<void> {
    this.db.prepare('DELETE FROM _rls_enabled_tables WHERE table_name = ?').run(tableName);
  }

  /**
   * Check if RLS is enabled on a table
   */
  async isRLSEnabled(tableName: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 FROM _rls_enabled_tables WHERE table_name = ?')
      .get(tableName);

    return row !== undefined;
  }

  /**
   * Create a new RLS policy
   *
   * Serializes WhereNode AST to JSON for storage
   */
  async createPolicy(policy: RLSPolicy): Promise<void> {
    try {
      this.db
        .prepare(
          `INSERT INTO _rls_policies (name, table_name, command, role, using_expr, with_check_expr, restrictive)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          policy.name,
          policy.tableName,
          policy.command,
          policy.role,
          policy.using ? JSON.stringify(policy.using) : null,
          policy.withCheck ? JSON.stringify(policy.withCheck) : null,
          policy.restrictive ? 1 : 0
        );
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        throw new Error(
          `Policy '${policy.name}' already exists on table '${policy.tableName}'`
        );
      }
      throw error;
    }
  }

  /**
   * Drop an RLS policy
   */
  async dropPolicy(tableName: string, policyName: string): Promise<void> {
    this.db
      .prepare('DELETE FROM _rls_policies WHERE table_name = ? AND name = ?')
      .run(tableName, policyName);
  }

  /**
   * Get all policies for a table
   */
  async getPolicies(tableName: string): Promise<readonly RLSPolicy[]> {
    const rows = this.db
      .prepare('SELECT * FROM _rls_policies WHERE table_name = ?')
      .all(tableName) as Array<{
      name: string;
      table_name: string;
      command: PolicyCommand;
      role: PolicyRole;
      using_expr: string | null;
      with_check_expr: string | null;
      restrictive: number;
    }>;

    return rows.map(row => this.rowToPolicy(row));
  }

  /**
   * Get policies for a specific command and role
   */
  async getPoliciesForCommand(
    tableName: string,
    command: PolicyCommand,
    role: PolicyRole
  ): Promise<readonly RLSPolicy[]> {
    // Get policies that match:
    // 1. Exact command match OR command = 'ALL'
    // 2. Exact role match OR role = 'PUBLIC'
    const rows = this.db
      .prepare(
        `SELECT * FROM _rls_policies
         WHERE table_name = ?
         AND (command = ? OR command = 'ALL')
         AND (role = ? OR role = 'PUBLIC')`
      )
      .all(tableName, command, role) as Array<{
      name: string;
      table_name: string;
      command: PolicyCommand;
      role: PolicyRole;
      using_expr: string | null;
      with_check_expr: string | null;
      restrictive: number;
    }>;

    return rows.map(row => this.rowToPolicy(row));
  }

  /**
   * Convert database row to RLSPolicy
   *
   * Deserializes JSON back to WhereNode AST
   */
  private rowToPolicy(row: {
    name: string;
    table_name: string;
    command: PolicyCommand;
    role: PolicyRole;
    using_expr: string | null;
    with_check_expr: string | null;
    restrictive: number;
  }): RLSPolicy {
    const policy: RLSPolicy = {
      name: row.name,
      tableName: row.table_name,
      command: row.command,
      role: row.role,
    };

    if (row.using_expr) {
      policy.using = JSON.parse(row.using_expr) as WhereNode;
    }

    if (row.with_check_expr) {
      policy.withCheck = JSON.parse(row.with_check_expr) as WhereNode;
    }

    if (row.restrictive === 1) {
      policy.restrictive = true;
    }

    return policy;
  }

  /**
   * Execute a validation query
   * Used by RLS enforcer for WITH CHECK validation
   */
  async executeQuery(sql: string, params: unknown[]): Promise<unknown> {
    if (params.length === 0) {
      return this.db.prepare(sql).get();
    }
    return this.db.prepare(sql).get(...params);
  }

  /**
   * Execute a modification query (INSERT, UPDATE, DELETE)
   * Used by RLS enforcer for WITH CHECK cleanup
   */
  async executeModification(sql: string, params: unknown[]): Promise<void> {
    if (params.length === 0) {
      this.db.prepare(sql).run();
    } else {
      this.db.prepare(sql).run(...params);
    }
  }
}
