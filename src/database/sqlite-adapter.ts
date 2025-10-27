/**
 * SQLite Adapter - Local Development
 *
 * Wraps better-sqlite3 to conform to the DatabaseAdapter interface.
 * Used for local development and testing.
 */

import type Database from 'better-sqlite3';
import type { DatabaseAdapter, PreparedStatement, QueryResult } from './adapter.js';

/**
 * Prepared statement wrapper for better-sqlite3
 */
class SqlitePreparedStatement implements PreparedStatement {
  constructor(private stmt: Database.Statement) {}

  async all<T = unknown>(...params: readonly unknown[]): Promise<QueryResult<T>> {
    const rows = this.stmt.all(...params) as T[];
    return { rows };
  }

  async first<T = unknown>(...params: readonly unknown[]): Promise<T | null> {
    const row = this.stmt.get(...params) as T | undefined;
    return row ?? null;
  }

  async run(...params: readonly unknown[]): Promise<void> {
    this.stmt.run(...params);
  }
}

/**
 * SQLite database adapter for better-sqlite3
 */
export class SqliteAdapter implements DatabaseAdapter {
  constructor(private db: Database.Database) {}

  prepare(sql: string): PreparedStatement {
    const stmt = this.db.prepare(sql);
    return new SqlitePreparedStatement(stmt);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Get the underlying better-sqlite3 database instance
   * Useful for schema introspection
   */
  getDb(): Database.Database {
    return this.db;
  }
}
