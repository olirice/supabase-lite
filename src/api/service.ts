/**
 * API Service - Query Execution Layer
 *
 * Orchestrates the flow from HTTP request to database query:
 * 1. Parse PostgREST query string
 * 2. Introspect database schema
 * 3. Compile AST to SQL
 * 4. Execute query
 * 5. Format response
 *
 * Designed for modularity, testability, and strict type safety.
 */

import { QueryParser } from '../parser/index.js';
import { SQLCompiler } from '../compiler/index.js';
import { SchemaIntrospector } from '../schema/index.js';
import type { DatabaseAdapter } from '../database/index.js';
import type { CompiledQuery } from '../compiler/index.js';
import type { DatabaseSchema } from '../schema/index.js';
import type { RLSASTEnforcer } from '../rls/ast-enforcer.js';
import type { RequestContext } from '../auth/types.js';
import type { WhereNode, LogicalNode } from '../parser/types.js';

/**
 * API request representing a PostgREST-style query
 */
export interface ApiRequest {
  readonly table: string;
  readonly queryString: string; // e.g., "select=id,name&age=gte.18"
}

/**
 * API response containing query results
 */
export interface ApiResponse<T = unknown> {
  readonly data: readonly T[];
  readonly count?: number;
  readonly totalCount?: number; // Total count for pagination (when count=exact is requested)
}

/**
 * Error response
 */
export interface ApiError {
  readonly message: string;
  readonly code: string;
  readonly details?: unknown;
}

/**
 * Execution options for RLS enforcement
 */
export interface ExecutionOptions {
  readonly rlsEnforcer?: RLSASTEnforcer;
  readonly requestContext?: RequestContext;
  readonly includeCount?: boolean; // Whether to include total count for pagination
}

/**
 * API Service configuration
 */
export interface ApiServiceConfig {
  readonly db: DatabaseAdapter;
  readonly cacheSchema?: boolean; // Cache schema introspection (default: true)
}

/**
 * Main API service class
 *
 * Handles query parsing, compilation, and execution with proper error handling.
 */
export class ApiService {
  private parser: QueryParser;
  private cachedSchema?: DatabaseSchema;
  private cacheSchema: boolean;

  constructor(private config: ApiServiceConfig) {
    this.parser = new QueryParser();
    this.cacheSchema = config.cacheSchema ?? true;
  }

  /**
   * Execute a PostgREST-style query
   *
   * @param request - The API request with table and query string
   * @param options - Execution options including RLS enforcement
   * @returns Promise resolving to API response with data
   */
  async execute<T = unknown>(
    request: ApiRequest,
    options?: ExecutionOptions
  ): Promise<ApiResponse<T>> {
    // Get schema (cached or introspect)
    const schema = await this.getSchema();

    // Validate table exists
    if (!schema.tables.has(request.table)) {
      throw new ApiServiceError(
        `Table '${request.table}' not found`,
        'TABLE_NOT_FOUND',
        { table: request.table }
      );
    }

    // Parse query string to AST
    const url = `http://localhost/${request.table}?${request.queryString}`;
    let ast = this.parser.parse(url);

    // Apply RLS enforcement at AST level (before compilation)
    if (options?.rlsEnforcer && options?.requestContext) {
      ast = await options.rlsEnforcer.enforceOnAST(
        ast,
        'SELECT',
        options.requestContext
      );
    }

    // Compile AST to SQL (with RLS policy already integrated)
    const compiler = new SQLCompiler(schema);
    const compiled = compiler.compile(ast);

    // Execute query
    const result = await this.executeQuery<T>(compiled);

    // Format response
    const data = this.formatResponse(result.rows);

    // Get total count if requested (for pagination with Content-Range header)
    let totalCount: number | undefined;
    if (options?.includeCount) {
      totalCount = await this.getTotalCount(ast, schema, options);
    }

    return {
      data,
      count: data.length,
      ...(totalCount !== undefined ? { totalCount } : {}),
    };
  }

  /**
   * Get database schema (cached or introspect)
   */
  private async getSchema(): Promise<DatabaseSchema> {
    if (this.cacheSchema && this.cachedSchema) {
      return this.cachedSchema;
    }

    // For SQLite adapter, we need the underlying db
    const db = (this.config.db as any).getDb();
    if (!db) {
      throw new ApiServiceError(
        'Schema introspection requires database instance',
        'SCHEMA_INTROSPECTION_FAILED'
      );
    }

    const introspector = new SchemaIntrospector(db);
    const schema = introspector.introspect();

    if (this.cacheSchema) {
      this.cachedSchema = schema;
    }

    return schema;
  }

  /**
   * Execute compiled query against database
   */
  private async executeQuery<T>(compiled: CompiledQuery): Promise<{ rows: readonly T[] }> {
    const stmt = this.config.db.prepare(compiled.sql);
    const result = await stmt.all<T>(...compiled.params);
    return result;
  }

  /**
   * Format query results
   *
   * Parses JSON strings from SQLite's json_object() and json_group_array()
   * into actual JavaScript objects/arrays.
   */
  private formatResponse<T>(rows: readonly T[]): readonly T[] {
    return rows.map((row) => this.parseJsonFields(row));
  }

  /**
   * Recursively parse JSON string fields
   *
   * SQLite's JSON functions return strings, we need to parse them.
   */
  private parseJsonFields<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.parseJsonFields(item)) as T;
    }

    if (typeof value === 'object') {
      const result: any = {};
      for (const [key, val] of Object.entries(value)) {
        if (typeof val === 'string') {
          // Try to parse as JSON
          try {
            result[key] = JSON.parse(val);
          } catch {
            // Not JSON, keep as string
            result[key] = val;
          }
        } else {
          result[key] = this.parseJsonFields(val);
        }
      }
      return result as T;
    }

    return value;
  }

  /**
   * Execute INSERT operation
   *
   * @param table - Table name
   * @param data - Single object or array of objects to insert
   * @returns Promise resolving to inserted rows
   */
  async insert<T = unknown>(
    table: string,
    data: Record<string, unknown> | Record<string, unknown>[],
    options?: ExecutionOptions
  ): Promise<ApiResponse<T>> {
    // Get schema
    const schema = await this.getSchema();

    // Validate table exists
    if (!schema.tables.has(table)) {
      throw new ApiServiceError(
        `Table '${table}' not found`,
        'TABLE_NOT_FOUND',
        { table }
      );
    }

    // Handle empty array
    const rows = Array.isArray(data) ? data : [data];
    if (rows.length === 0) {
      return { data: [], count: 0 };
    }

    // Compile INSERT with RETURNING clause (SQLite 3.35.0+)
    const compiler = new SQLCompiler(schema);
    const compiled = compiler.compileInsert(table, data);

    // Execute INSERT and get returned rows directly
    // RETURNING clause eliminates race conditions and rowid calculation issues
    const stmt = this.config.db.prepare(compiled.sql);
    const result = await stmt.all<T>(...compiled.params);

    let validatedRows = this.formatResponse(result.rows) as readonly T[];

    // Apply WITH CHECK policy validation if RLS is enabled
    if (options?.rlsEnforcer && options?.requestContext) {
      // Get WITH CHECK policy (now returns WhereNode AST)
      const withCheckPolicyNode = await options.rlsEnforcer.getWithCheckPolicy(
        table,
        options.requestContext
      );

      if (withCheckPolicyNode) {
        // Validate inserted rows against policy
        // This will delete rows that don't pass the check
        const validated = await options.rlsEnforcer.validateWithCheck(
          table,
          validatedRows as any as Record<string, unknown>[],
          withCheckPolicyNode
        );
        validatedRows = validated as any as readonly T[];
      }
    }

    return {
      data: validatedRows,
      count: validatedRows.length,
    };
  }

  /**
   * Execute UPDATE operation
   *
   * @param request - API request with table and query string for filters
   * @param data - Object with fields to update
   * @param options - Execution options including RLS enforcement
   * @returns Promise resolving to updated rows
   */
  async update<T = unknown>(
    request: ApiRequest,
    data: Record<string, unknown>,
    options?: ExecutionOptions
  ): Promise<ApiResponse<T>> {
    // Get schema
    const schema = await this.getSchema();

    // Validate table exists
    if (!schema.tables.has(request.table)) {
      throw new ApiServiceError(
        `Table '${request.table}' not found`,
        'TABLE_NOT_FOUND',
        { table: request.table }
      );
    }

    // Parse query string to get WHERE clause
    const url = `http://localhost/${request.table}?${request.queryString}`;
    let ast = this.parser.parse(url);

    // Apply RLS enforcement at AST level (before compilation)
    if (options?.rlsEnforcer && options?.requestContext) {
      ast = await options.rlsEnforcer.enforceOnAST(
        ast,
        'UPDATE',
        options.requestContext
      );
    }

    // Compile UPDATE with RETURNING clause (SQLite 3.35.0+)
    const compiler = new SQLCompiler(schema);
    // Merge user WHERE with RLS policy before compiling
    const combinedWhere = this.mergeWhereWithRLS(ast.where, ast.rlsPolicy);
    const compiled = compiler.compileUpdate(request.table, data, combinedWhere);

    // Handle empty update (no columns to set)
    if (compiled.sql === '') {
      // Empty update - return empty result set
      return {
        data: [],
        count: 0,
      };
    }

    // Execute UPDATE and get returned rows directly
    // RETURNING clause eliminates need for separate SELECT query
    const stmt = this.config.db.prepare(compiled.sql);
    const result = await stmt.all<T>(...compiled.params);

    return {
      data: this.formatResponse(result.rows),
      count: result.rows.length,
    };
  }

  /**
   * Execute DELETE operation
   *
   * @param request - API request with table and query string for filters
   * @param options - Execution options including RLS enforcement
   * @returns Promise resolving to deleted rows
   */
  async delete<T = unknown>(
    request: ApiRequest,
    options?: ExecutionOptions
  ): Promise<ApiResponse<T>> {
    // Get schema
    const schema = await this.getSchema();

    // Validate table exists
    if (!schema.tables.has(request.table)) {
      throw new ApiServiceError(
        `Table '${request.table}' not found`,
        'TABLE_NOT_FOUND',
        { table: request.table }
      );
    }

    // Parse query string to get WHERE clause
    const url = `http://localhost/${request.table}?${request.queryString}`;
    let ast = this.parser.parse(url);

    // Apply RLS enforcement at AST level (before compilation)
    if (options?.rlsEnforcer && options?.requestContext) {
      ast = await options.rlsEnforcer.enforceOnAST(
        ast,
        'DELETE',
        options.requestContext
      );
    }

    // Compile DELETE with RETURNING clause (SQLite 3.35.0+)
    const compiler = new SQLCompiler(schema);
    // Merge user WHERE with RLS policy before compiling
    const combinedWhere = this.mergeWhereWithRLS(ast.where, ast.rlsPolicy);
    const compiled = compiler.compileDelete(request.table, combinedWhere);

    // Execute DELETE and get returned rows directly
    // RETURNING clause eliminates need for separate SELECT query
    const stmt = this.config.db.prepare(compiled.sql);
    const result = await stmt.all<T>(...compiled.params);

    return {
      data: this.formatResponse(result.rows),
      count: result.rows.length,
    };
  }


  /**
   * Merge user WHERE clause with RLS policy using AND
   */
  private mergeWhereWithRLS(
    userWhere?: WhereNode,
    rlsPolicy?: WhereNode
  ): WhereNode | undefined {
    // No user WHERE, no RLS - return undefined
    if (!userWhere && !rlsPolicy) {
      return undefined;
    }

    // Only user WHERE - return it
    if (userWhere && !rlsPolicy) {
      return userWhere;
    }

    // Only RLS policy - return it
    if (!userWhere && rlsPolicy) {
      return rlsPolicy;
    }

    // Both exist - combine with AND
    const combined: LogicalNode = {
      type: 'and',
      conditions: [userWhere!, rlsPolicy!],
    };

    return combined;
  }

  /**
   * Get total count of rows matching the query (ignoring limit/offset)
   * Used for Content-Range header in pagination
   */
  private async getTotalCount(
    ast: any,
    schema: DatabaseSchema,
    _options?: ExecutionOptions
  ): Promise<number> {
    // Create a count query by removing limit/offset and select
    const countAst = {
      ...ast,
      select: {
        columns: [], // Will be replaced with COUNT(*)
      },
      limit: undefined,
      offset: undefined,
      order: undefined, // Order is irrelevant for count
    };

    // Compile count query
    const compiler = new SQLCompiler(schema);

    // Build count SQL manually to ensure it's just COUNT(*)
    // We need to use the same WHERE clause and JOINs as the main query
    const whereClause = countAst.where ? compiler.compileWhere(countAst.where) : null;

    // Build base count query
    let sql = `SELECT COUNT(*) as total FROM ${this.escapeIdentifier(countAst.from)}`;

    // Add JOINs for embedded filters if needed
    if (whereClause) {
      const joinClauses = compiler['compileJoinsForEmbeddedFilters'](countAst.where, countAst.from);
      if (joinClauses.length > 0) {
        sql += ' ' + joinClauses.join(' ');
      }
    }

    // Add WHERE clause
    if (whereClause) {
      sql += ` WHERE ${whereClause}`;
    }

    // Compile using the compiler to get params
    const compiled = compiler.compile(countAst);

    // Execute count query with proper SQL
    const countCompiled = {
      sql,
      params: compiled.params, // Use same params as main query
    };

    const stmt = this.config.db.prepare(countCompiled.sql);
    const result = await stmt.all<{ total: number }>(...countCompiled.params);

    return result.rows[0]?.total ?? 0;
  }

  /**
   * Escape SQL identifier (table/column name)
   */
  private escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  /**
   * Clear cached schema (useful for testing)
   */
  clearSchemaCache(): void {
    delete this.cachedSchema;
  }
}

/**
 * Custom error class for API service errors
 */
export class ApiServiceError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiServiceError';
  }

  toJSON(): ApiError {
    return {
      message: this.message,
      code: this.code,
      details: this.details,
    };
  }
}
