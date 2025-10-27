/**
 * Schema Introspection for SQLite
 *
 * Reads table structure, columns, and foreign key relationships
 * from SQLite database to enable resource embedding.
 */

import type Database from 'better-sqlite3';
import { escapeIdentifier } from '../utils/identifier.js';

export interface ColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultValue: string | null;
  readonly primaryKey: boolean;
}

export interface ForeignKeyInfo {
  readonly fromTable: string;
  readonly fromColumn: string;
  readonly toTable: string;
  readonly toColumn: string;
}

export interface TableSchema {
  readonly name: string;
  readonly columns: readonly ColumnInfo[];
  readonly foreignKeys: readonly ForeignKeyInfo[];
}

export interface DatabaseSchema {
  readonly tables: ReadonlyMap<string, TableSchema>;
}

/**
 * Introspect SQLite database schema
 */
export class SchemaIntrospector {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Read complete database schema
   */
  introspect(): DatabaseSchema {
    const tableNames = this.getTableNames();
    const tables = new Map<string, TableSchema>();

    for (const tableName of tableNames) {
      const columns = this.getColumns(tableName);
      const foreignKeys = this.getForeignKeys(tableName);

      tables.set(tableName, {
        name: tableName,
        columns,
        foreignKeys,
      });
    }

    return { tables };
  }

  /**
   * Get all table names (excluding sqlite_* internal tables)
   */
  private getTableNames(): string[] {
    const stmt = this.db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    const rows = stmt.all() as Array<{ name: string }>;
    return rows.map((row) => row.name);
  }

  /**
   * Get column information for a table
   */
  private getColumns(tableName: string): ColumnInfo[] {
    const stmt = this.db.prepare(`PRAGMA table_info(${this.escapeIdentifier(tableName)})`);

    const rows = stmt.all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;

    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      notNull: row.notnull === 1,
      defaultValue: row.dflt_value,
      primaryKey: row.pk > 0,
    }));
  }

  /**
   * Get foreign key relationships for a table
   */
  private getForeignKeys(tableName: string): ForeignKeyInfo[] {
    const stmt = this.db.prepare(`PRAGMA foreign_key_list(${this.escapeIdentifier(tableName)})`);

    const rows = stmt.all() as Array<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      on_update: string;
      on_delete: string;
      match: string;
    }>;

    return rows.map((row) => ({
      fromTable: tableName,
      fromColumn: row.from,
      toTable: row.table,
      toColumn: row.to,
    }));
  }

  /**
   * Escape identifier for use in PRAGMA
   */
  private escapeIdentifier(identifier: string): string {
    return escapeIdentifier(identifier);
  }

  /**
   * Find foreign key relationship between two tables
   */
  findRelationship(
    schema: DatabaseSchema,
    fromTable: string,
    toTable: string
  ): ForeignKeyInfo | null {
    const tableSchema = schema.tables.get(fromTable);
    if (!tableSchema) {
      return null;
    }

    // Look for foreign key pointing to toTable
    const fk = tableSchema.foreignKeys.find((fk) => fk.toTable === toTable);
    if (fk) {
      return fk;
    }

    // Look for reverse relationship (toTable has FK pointing to fromTable)
    const toTableSchema = schema.tables.get(toTable);
    if (!toTableSchema) {
      return null;
    }

    const reverseFk = toTableSchema.foreignKeys.find((fk) => fk.toTable === fromTable);
    if (reverseFk) {
      return reverseFk;
    }

    return null;
  }
}
