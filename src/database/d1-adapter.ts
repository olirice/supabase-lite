/**
 * D1 Adapter - Cloudflare Workers
 *
 * Wraps Cloudflare D1 to conform to the DatabaseAdapter interface.
 * Used for production deployment on Cloudflare Workers.
 *
 * D1 API Reference:
 * https://developers.cloudflare.com/d1/platform/client-api/
 */

import type { DatabaseAdapter, PreparedStatement, QueryResult } from './adapter.js';

/**
 * Cloudflare D1 Database interface
 * (minimal type definition - use @cloudflare/workers-types for full types)
 */
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    duration: number;
  };
}

export interface D1RunResult {
  success: boolean;
  meta: {
    duration: number;
    changes: number;
    last_row_id: number;
  };
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

/**
 * Prepared statement wrapper for D1
 */
class D1PreparedStatementWrapper implements PreparedStatement {
  constructor(
    private stmt: D1PreparedStatement,
    private params: readonly unknown[] = []
  ) {}

  async all<T = unknown>(...params: readonly unknown[]): Promise<QueryResult<T>> {
    const boundStmt = params.length > 0 ? this.stmt.bind(...params) : this.stmt;
    const result = await boundStmt.all<T>();

    if (!result.success) {
      throw new Error('D1 query failed');
    }

    return { rows: result.results };
  }

  async first<T = unknown>(...params: readonly unknown[]): Promise<T | null> {
    const boundStmt = params.length > 0 ? this.stmt.bind(...params) : this.stmt;
    const result = await boundStmt.first<T>();
    return result;
  }

  async run(...params: readonly unknown[]): Promise<void> {
    const boundStmt = params.length > 0 ? this.stmt.bind(...params) : this.stmt;
    const result = await boundStmt.run();

    if (!result.success) {
      throw new Error('D1 query failed');
    }
  }
}

/**
 * D1 database adapter for Cloudflare Workers
 */
export class D1Adapter implements DatabaseAdapter {
  constructor(private db: D1Database) {}

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return new D1PreparedStatementWrapper(stmt);
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  close(): void {
    // D1 doesn't require explicit closing
  }

  /**
   * Get the underlying D1 database instance
   */
  getDb(): D1Database {
    return this.db;
  }
}
