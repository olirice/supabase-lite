/**
 * Database Adapter - Abstraction for SQLite and D1
 *
 * Provides a unified interface for database operations that works with:
 * - better-sqlite3 (local development)
 * - Cloudflare D1 (production deployment)
 *
 * This enables seamless switching between local and cloud environments.
 */

/**
 * Result from a database query
 */
export interface QueryResult<T = unknown> {
  readonly rows: readonly T[];
}

/**
 * Prepared statement interface
 */
export interface PreparedStatement {
  /**
   * Execute query and return all rows
   */
  all<T = unknown>(...params: readonly unknown[]): Promise<QueryResult<T>>;

  /**
   * Execute query and return first row
   */
  first<T = unknown>(...params: readonly unknown[]): Promise<T | null>;

  /**
   * Execute query without returning results
   */
  run(...params: readonly unknown[]): Promise<void>;
}

/**
 * Database adapter interface
 *
 * Provides methods for executing SQL queries in a database-agnostic way.
 */
export interface DatabaseAdapter {
  /**
   * Prepare a SQL statement
   */
  prepare(sql: string): PreparedStatement;

  /**
   * Execute raw SQL (for schema setup in tests)
   */
  exec(sql: string): Promise<void>;

  /**
   * Close the database connection
   */
  close(): void;
}
