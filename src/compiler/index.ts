/**
 * SQL Compiler - Converts AST to SQLite SQL
 *
 * Takes a parsed QueryAST and generates executable SQLite SQL.
 */

import { CompilationError } from '../errors/index.js';
import { escapeIdentifier } from '../utils/identifier.js';
import type {
  QueryAST,
  WhereNode,
  FilterNode,
  EmbeddedFilterNode,
  LogicalNode,
  FilterOperator,
  FilterValue,
  OrderNode,
  EmbeddedColumn,
  AggregateColumn,
  ColumnNode,
} from '../parser/types.js';
import type { DatabaseSchema, ForeignKeyInfo } from '../schema/index.js';

export interface CompiledQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

/**
 * Main SQL compiler class
 */
export class SQLCompiler {
  private params: unknown[] = [];
  private schema?: DatabaseSchema;
  private currentMainTable?: string; // Used for resolving embedded filters

  constructor(schema?: DatabaseSchema) {
    this.schema = schema;
  }

  /**
   * Compile a QueryAST to executable SQL
   */
  compile(ast: QueryAST): CompiledQuery {
    // Reset state
    this.params = [];
    this.currentMainTable = ast.from;

    // Build SELECT clause
    const selectClause = this.compileSelect(ast, ast.from);

    // Build FROM clause
    const fromClause = `FROM ${this.escapeIdentifier(ast.from)}`;

    // Merge user WHERE with RLS policy at AST level
    const combinedWhere = this.mergeWhereWithRLS(ast.where, ast.rlsPolicy);

    // Build JOIN clauses for vertical filtering (embedded filters)
    const joinClauses = combinedWhere ? this.compileJoinsForEmbeddedFilters(combinedWhere, ast.from) : [];

    // Build WHERE clause from combined AST
    const whereClause = combinedWhere ? this.compileWhere(combinedWhere) : null;

    // Build GROUP BY clause (automatic when mixing aggregates with regular columns)
    const groupByClause = this.compileGroupBy(ast, ast.from);

    // Build ORDER BY clause
    const orderClause = ast.order ? this.compileOrder(ast.order) : null;

    // Build LIMIT/OFFSET clause
    const limitClause = this.compileLimit(ast.limit, ast.offset);

    // Combine clauses
    const clauses = [
      selectClause,
      fromClause,
      ...joinClauses,
      whereClause ? `WHERE ${whereClause}` : null,
      groupByClause ? `GROUP BY ${groupByClause}` : null,
      orderClause ? `ORDER BY ${orderClause}` : null,
      limitClause,
    ].filter((clause) => clause !== null);

    const sql = clauses.join(' ');

    return {
      sql,
      params: this.params,
    };
  }

  /**
   * Merge user WHERE clause with RLS policy at AST level
   *
   * Combines user WHERE and RLS WHERE using AND.
   * This avoids string manipulation and works correctly with embedding.
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
   * Compile JOIN clauses for embedded filters (vertical filtering)
   * Example: author.status=eq.active requires JOIN users ON posts.author_id = users.id
   */
  private compileJoinsForEmbeddedFilters(where: WhereNode, mainTable: string): string[] {
    // Collect all embedded filter paths
    const embeddedPaths = this.collectEmbeddedFilterPaths(where);

    if (embeddedPaths.length === 0) {
      return [];
    }

    // Generate JOIN clauses for each unique path
    const joins: string[] = [];
    const processedTables = new Set<string>([mainTable]);

    for (const path of embeddedPaths) {
      // For single-level path like ['author', 'status'], we need to join the 'author' table
      // For multi-level path like ['post', 'author', 'status'], we need to join 'post' then 'author'

      let currentTable = mainTable;

      // Process each segment except the last (which is the column name)
      for (let i = 0; i < path.length - 1; i++) {
        const embeddingName = path[i]!;

        // Resolve the embedded table name first
        const embeddedTable = this.resolveEmbeddedTable(currentTable, embeddingName);
        const joinKey = `${currentTable}.${embeddedTable}`;

        // Skip if we already joined this table
        if (processedTables.has(joinKey)) {
          currentTable = embeddedTable;
          continue;
        }

        // Get the foreign key relationship
        const relationship = this.findRelationship(currentTable, embeddedTable);

        if (!relationship) {
          throw new CompilationError(
            `No foreign key relationship found between '${currentTable}' and '${embeddedTable}' for embedded filter`
          );
        }

        const isManyToOne = relationship.fromTable === currentTable;

        if (!isManyToOne) {
          // One-to-many relationship: This is a horizontal filter, skip JOIN generation
          // The filter will be applied in the embedding subquery instead
          break;
        }

        // Many-to-one: Generate JOIN for vertical filtering
        const joinClause = `INNER JOIN ${this.escapeIdentifier(embeddedTable)} ON ${this.escapeIdentifier(currentTable)}.${this.escapeIdentifier(relationship.fromColumn)} = ${this.escapeIdentifier(embeddedTable)}.${this.escapeIdentifier(relationship.toColumn)}`;
        joins.push(joinClause);

        processedTables.add(joinKey);
        currentTable = embeddedTable;
      }
    }

    return joins;
  }

  /**
   * Collect all embedded filter paths from WHERE clause
   */
  private collectEmbeddedFilterPaths(where: WhereNode): readonly string[][] {
    const paths: string[][] = [];

    const visit = (node: WhereNode): void => {
      if (node.type === 'embedded_filter') {
        paths.push([...node.path]);
      } else if (node.type === 'and' || node.type === 'or') {
        for (const condition of node.conditions) {
          visit(condition);
        }
      }
      // Regular filters don't contribute to paths
    };

    visit(where);
    return paths;
  }

  /**
   * Compile SELECT clause
   */
  private compileSelect(ast: QueryAST, mainTable: string): string {
    const columns = ast.select.columns;

    if (columns.length === 0) {
      return `SELECT ${this.escapeIdentifier(mainTable)}.*`;
    }

    if (columns.length === 1 && columns[0]?.type === 'wildcard') {
      return `SELECT ${this.escapeIdentifier(mainTable)}.*`;
    }

    const columnStrs = columns.map((col) => {
      if (col.type === 'wildcard') {
        return `${this.escapeIdentifier(mainTable)}.*`;
      }

      if (col.type === 'column') {
        const colName = `${this.escapeIdentifier(mainTable)}.${this.escapeIdentifier(col.name)}`;
        if (col.alias !== undefined) {
          return `${colName} AS ${this.escapeIdentifier(col.alias)}`;
        }
        return colName;
      }

      if (col.type === 'aggregate') {
        return this.compileAggregate(col, mainTable);
      }

      if (col.type === 'embedding') {
        return this.compileEmbedding(col, mainTable);
      }

      const _exhaustive: never = col;
      throw new CompilationError(`Unknown column type: ${(_exhaustive as { type: string }).type}`);
    });

    return `SELECT ${columnStrs.join(', ')}`;
  }

  /**
   * Compile aggregate function
   */
  private compileAggregate(agg: AggregateColumn, mainTable: string): string {
    const funcName = agg.function.toUpperCase();
    const alias = agg.alias || agg.function;

    // count() without column
    if (!agg.column) {
      return `${funcName}(*) AS ${this.escapeIdentifier(alias)}`;
    }

    // column.aggregate()
    const colName = `${this.escapeIdentifier(mainTable)}.${this.escapeIdentifier(agg.column)}`;
    return `${funcName}(${colName}) AS ${this.escapeIdentifier(alias)}`;
  }

  /**
   * Compile GROUP BY clause
   * Automatically groups by non-aggregate columns when aggregates are present
   */
  private compileGroupBy(ast: QueryAST, mainTable: string): string | null {
    const columns = ast.select.columns;

    // Check if there are any aggregates
    const hasAggregates = columns.some((col) => col.type === 'aggregate');

    if (!hasAggregates) {
      return null;
    }

    // Find non-aggregate columns (these become GROUP BY columns)
    const groupByColumns = columns
      .filter((col): col is Extract<ColumnNode, { type: 'column' }> => col.type === 'column')
      .map((col) => `${this.escapeIdentifier(mainTable)}.${this.escapeIdentifier(col.name)}`);

    if (groupByColumns.length === 0) {
      return null; // Pure aggregate query, no grouping needed
    }

    return groupByColumns.join(', ');
  }

  /**
   * Compile embedded resource (relationship)
   */
  private compileEmbedding(embedding: EmbeddedColumn, mainTable: string): string {
    if (!this.schema) {
      throw new CompilationError('Schema is required for resource embedding');
    }

    const embeddedName = embedding.table;
    const alias = embedding.alias || embeddedName;
    const hint = embedding.hint;

    // Resolve the embedded name to actual table name
    // In PostgREST, you can use either:
    // 1. The actual table name: posts(*)
    // 2. The FK column name without _id: author(*) for author_id FK
    // 3. The table name with hint: users!sender_id(*) to specify exact FK
    const embeddedTable = this.resolveEmbeddedTable(mainTable, embeddedName);

    // Find relationship between main table and embedded table
    // If hint is provided, use it to disambiguate multiple FKs
    const relationship = this.findRelationship(mainTable, embeddedTable, hint);

    if (!relationship) {
      const hintMsg = hint ? ` using foreign key '${hint}'` : '';
      throw new CompilationError(
        `No foreign key relationship found between '${mainTable}' and '${embeddedTable}'${hintMsg}`
      );
    }

    // Determine if this is many-to-one or one-to-many
    const isManyToOne = relationship.fromTable === mainTable;

    if (isManyToOne) {
      // Many-to-one: Use JOIN (will be added to FROM clause later)
      // For now, create json_object inline
      return this.compileManyToOneEmbedding(embedding, mainTable, embeddedTable, relationship, alias);
    } else {
      // One-to-many: Use subquery with json_group_array
      return this.compileOneToManyEmbedding(embedding, mainTable, embeddedTable, relationship, alias);
    }
  }

  /**
   * Resolve embedded name to actual table name
   * Handles PostgREST convention where FK column name without _id can be used
   */
  private resolveEmbeddedTable(mainTable: string, embeddedName: string): string {
    if (!this.schema) {
      throw new CompilationError('Schema is required');
    }

    // First, check if it's an actual table name
    if (this.schema.tables.has(embeddedName)) {
      return embeddedName;
    }

    // Try to find FK column with pattern {embeddedName}_id
    const mainTableSchema = this.schema.tables.get(mainTable);
    if (mainTableSchema) {
      const fkColumn = `${embeddedName}_id`;
      const fk = mainTableSchema.foreignKeys.find((fk) => fk.fromColumn === fkColumn);
      if (fk) {
        return fk.toTable;
      }
    }

    // If not found, throw error
    throw new CompilationError(
      `Table '${embeddedName}' does not exist and no foreign key '${embeddedName}_id' found in '${mainTable}'`
    );
  }

  /**
   * Compile many-to-one embedding (foreign key from main table)
   * Example: posts.author_id → users.id
   */
  private compileManyToOneEmbedding(
    embedding: EmbeddedColumn,
    mainTable: string,
    embeddedTable: string,
    fk: ForeignKeyInfo,
    alias: string
  ): string {
    // Build SELECT clause for the embedded table, handling nested embeddings
    const selectParts: string[] = [];

    // Handle each column in the select
    for (const col of embedding.select.columns) {
      if (col.type === 'column') {
        selectParts.push(`'${col.name}'`);
        selectParts.push(this.escapeIdentifier(col.name));
      } else if (col.type === 'embedding') {
        // Recursively compile nested embedding
        const nestedEmbedding = this.compileEmbedding(col, embeddedTable);
        selectParts.push(`'${col.alias || col.table}'`);
        selectParts.push(nestedEmbedding.replace(/ AS .*$/, '')); // Remove the AS clause
      } else if (col.type === 'wildcard') {
        // For wildcard, get all columns
        const allCols = this.getAllTableColumns(embeddedTable);
        for (const c of allCols) {
          selectParts.push(`'${c.name}'`);
          selectParts.push(this.escapeIdentifier(c.name));
        }
      }
    }

    // If no columns specified, select all
    if (embedding.select.columns.length === 0) {
      const allCols = this.getAllTableColumns(embeddedTable);
      for (const c of allCols) {
        selectParts.push(`'${c.name}'`);
        selectParts.push(this.escapeIdentifier(c.name));
      }
    }

    const jsonObject = `json_object(${selectParts.join(', ')})`;

    // Build WHERE clause
    const joinCondition = `${this.escapeIdentifier(embeddedTable)}.${this.escapeIdentifier(fk.toColumn)} = ${this.escapeIdentifier(mainTable)}.${this.escapeIdentifier(fk.fromColumn)}`;

    // Add embedded filters if present
    let whereClause = joinCondition;
    if (embedding.where) {
      const embeddedFilterResult = this.compileWhereClause(embedding.where);
      if (embeddedFilterResult.sql) {
        whereClause = `${joinCondition} AND (${embeddedFilterResult.sql})`;
        // Add params from embedded filter to our params list
        embeddedFilterResult.params.forEach(param => this.addParam(param));
      }
    }

    // Build ORDER BY clause if present
    let orderClause = '';
    if (embedding.order && embedding.order.length > 0) {
      const orderParts = embedding.order.map(order =>
        `${this.escapeIdentifier(embeddedTable)}.${this.escapeIdentifier(order.column)} ${order.direction.toUpperCase()}`
      );
      orderClause = `ORDER BY ${orderParts.join(', ')}`;
    }

    // Build LIMIT clause (default to 1 for many-to-one)
    const limitClause = `LIMIT ${embedding.limit ?? 1}`;

    // Build subquery to get the related record
    const subquery = `
      (
        SELECT ${jsonObject}
        FROM ${this.escapeIdentifier(embeddedTable)}
        WHERE ${whereClause}
        ${orderClause}
        ${limitClause}
      )
    `.trim();

    return `${subquery} AS ${this.escapeIdentifier(alias)}`;
  }

  /**
   * Compile one-to-many embedding (foreign key from embedded table)
   * Example: users → posts (posts.author_id → users.id)
   */
  private compileOneToManyEmbedding(
    embedding: EmbeddedColumn,
    mainTable: string,
    embeddedTable: string,
    fk: ForeignKeyInfo,
    alias: string
  ): string {
    // Build SELECT clause for the embedded table, handling nested embeddings
    const selectParts: string[] = [];

    // Handle each column in the select
    for (const col of embedding.select.columns) {
      if (col.type === 'column') {
        selectParts.push(`'${col.name}'`);
        selectParts.push(this.escapeIdentifier(col.name));
      } else if (col.type === 'embedding') {
        // Recursively compile nested embedding
        const nestedEmbedding = this.compileEmbedding(col, embeddedTable);
        selectParts.push(`'${col.alias || col.table}'`);
        selectParts.push(nestedEmbedding.replace(/ AS .*$/, '')); // Remove the AS clause
      } else if (col.type === 'wildcard') {
        // For wildcard, get all columns
        const allCols = this.getAllTableColumns(embeddedTable);
        for (const c of allCols) {
          selectParts.push(`'${c.name}'`);
          selectParts.push(this.escapeIdentifier(c.name));
        }
      }
    }

    // If no columns specified, select all
    if (embedding.select.columns.length === 0) {
      const allCols = this.getAllTableColumns(embeddedTable);
      for (const c of allCols) {
        selectParts.push(`'${c.name}'`);
        selectParts.push(this.escapeIdentifier(c.name));
      }
    }

    const jsonObject = `json_object(${selectParts.join(', ')})`;

    // Build WHERE clause for filtering embedded rows
    const joinCondition = `${this.escapeIdentifier(embeddedTable)}.${this.escapeIdentifier(fk.fromColumn)} = ${this.escapeIdentifier(mainTable)}.${this.escapeIdentifier(fk.toColumn)}`;

    // Add embedded filters if present
    let whereClause = joinCondition;
    if (embedding.where) {
      const embeddedFilterResult = this.compileWhereClause(embedding.where);
      if (embeddedFilterResult.sql) {
        whereClause = `${joinCondition} AND (${embeddedFilterResult.sql})`;
        // Add params from embedded filter to our params list
        embeddedFilterResult.params.forEach(param => this.addParam(param));
      }
    }

    // Build ORDER BY clause if present
    let orderClause = '';
    if (embedding.order && embedding.order.length > 0) {
      const orderParts = embedding.order.map(order =>
        `${this.escapeIdentifier(order.column)} ${order.direction.toUpperCase()}`
      );
      orderClause = `ORDER BY ${orderParts.join(', ')}`;
    }

    // Build LIMIT clause if present
    let limitClause = '';
    if (embedding.limit !== undefined) {
      limitClause = `LIMIT ${embedding.limit}`;
    }

    // Build subquery with ORDER BY and LIMIT applied INSIDE the aggregation
    // This ensures json_group_array respects the ordering and limit
    const subquery = `
      (
        SELECT json_group_array(${jsonObject})
        FROM (
          SELECT *
          FROM ${this.escapeIdentifier(embeddedTable)}
          WHERE ${whereClause}
          ${orderClause}
          ${limitClause}
        )
      )
    `.trim();

    return `${subquery} AS ${this.escapeIdentifier(alias)}`;
  }

  /**
   * Get columns to select from embedded table
   */
  private getEmbeddedColumns(
    embedding: EmbeddedColumn,
    tableName: string,
    tableAlias: string
  ): Array<{ name: string }> {
    const selectNode = embedding.select;

    if (selectNode.columns.length === 0) {
      // No columns specified, select all
      return this.getAllTableColumns(tableName);
    }

    if (selectNode.columns.length === 1 && selectNode.columns[0]?.type === 'wildcard') {
      // Wildcard, select all columns
      return this.getAllTableColumns(tableName);
    }

    // Extract column names
    return selectNode.columns
      .filter((col) => col.type === 'column')
      .map((col) => ({ name: (col as any).name }));
  }

  /**
   * Get all columns for a table from schema
   */
  private getAllTableColumns(tableName: string): Array<{ name: string }> {
    if (!this.schema) {
      throw new CompilationError('Schema is required');
    }

    const table = this.schema.tables.get(tableName);
    if (!table) {
      throw new CompilationError(`Table '${tableName}' not found in schema`);
    }

    return table.columns.map((col) => ({ name: col.name }));
  }

  /**
   * Find foreign key relationship between two tables
   * @param fromTable The source table
   * @param toTable The target table
   * @param hint Optional FK column name hint to disambiguate multiple relationships
   */
  private findRelationship(fromTable: string, toTable: string, hint?: string): ForeignKeyInfo | null {
    if (!this.schema) {
      return null;
    }

    // If hint is provided, look for specific FK column
    if (hint) {
      // Check if fromTable has FK to toTable with the specified column
      const fromTableSchema = this.schema.tables.get(fromTable);
      if (fromTableSchema) {
        const fk = fromTableSchema.foreignKeys.find(
          (fk) => fk.toTable === toTable && fk.fromColumn === hint
        );
        if (fk) {
          return fk;
        }
      }

      // Check reverse: toTable has FK to fromTable with the specified column
      const toTableSchema = this.schema.tables.get(toTable);
      if (toTableSchema) {
        const fk = toTableSchema.foreignKeys.find(
          (fk) => fk.toTable === fromTable && fk.fromColumn === hint
        );
        if (fk) {
          return fk;
        }
      }

      // Hint provided but not found
      return null;
    }

    // No hint: use existing logic to find any relationship
    // Check if fromTable has FK to toTable
    const fromTableSchema = this.schema.tables.get(fromTable);
    if (fromTableSchema) {
      const fk = fromTableSchema.foreignKeys.find((fk) => fk.toTable === toTable);
      if (fk) {
        return fk;
      }
    }

    // Check reverse: toTable has FK to fromTable
    const toTableSchema = this.schema.tables.get(toTable);
    if (toTableSchema) {
      const fk = toTableSchema.foreignKeys.find((fk) => fk.toTable === fromTable);
      if (fk) {
        return fk;
      }
    }

    return null;
  }

  /**
   * Compile WHERE clause (public for use in ApiService)
   */
  public compileWhere(where: WhereNode): string {
    if (where.type === 'filter') {
      return this.compileFilter(where);
    }

    if (where.type === 'embedded_filter') {
      return this.compileEmbeddedFilter(where);
    }

    // where.type is 'and' or 'or'
    return this.compileLogical(where as LogicalNode);
  }

  /**
   * Compile WHERE clause and return both SQL and params
   */
  public compileWhereClause(where: WhereNode | undefined): { sql: string; params: unknown[] } {
    if (!where) {
      return { sql: '', params: [] };
    }

    // Reset params to capture only WHERE clause params
    const savedParams = this.params;
    this.params = [];

    const sql = this.compileWhere(where);
    const params = this.params;

    // Restore original params
    this.params = savedParams;

    return { sql, params };
  }

  /**
   * Compile a single filter condition
   */
  private compileFilter(filter: FilterNode): string {
    // Check if column is a numeric literal (for deny-all policies like "1" = 0)
    // If so, don't escape it as an identifier
    const column = /^\d+$/.test(filter.column)
      ? filter.column
      : this.escapeIdentifier(filter.column);
    const { sql, negated } = this.compileOperator(
      filter.operator,
      filter.value,
      column
    );

    // Apply negation if specified
    if (filter.negated === true || negated) {
      return `NOT (${sql})`;
    }

    return sql;
  }

  /**
   * Compile embedded filter condition
   * Determines if filter should be vertical (many-to-one) or horizontal (one-to-many)
   *
   * - Many-to-one (posts.author.status): Filter is applied VERTICALLY via JOIN WHERE
   * - One-to-many (users.posts.status): Filter is applied HORIZONTALLY in embedding subquery (skip here)
   */
  private compileEmbeddedFilter(filter: EmbeddedFilterNode): string {
    if (!this.schema) {
      throw new CompilationError('Schema is required for embedded filters');
    }

    if (!this.currentMainTable) {
      throw new CompilationError('Main table context required for embedded filters');
    }

    // Path is like ['author', 'status'] or ['post', 'author', 'status']
    // The last element is the column name, everything before is the table path
    const columnName = filter.path[filter.path.length - 1]!;
    const tablePath = filter.path.slice(0, -1);

    // Traverse the path to find the final table and check if entire path is many-to-one
    let currentTable = this.currentMainTable;
    let finalTable = currentTable;

    for (const embeddingName of tablePath) {
      // Resolve the embedded table at this level
      const embeddedTable = this.resolveEmbeddedTable(currentTable, embeddingName);

      // Determine relationship direction
      const relationship = this.findRelationship(currentTable, embeddedTable);

      if (!relationship) {
        throw new CompilationError(
          `No foreign key relationship found between '${currentTable}' and '${embeddedTable}' for filter`
        );
      }

      const isManyToOne = relationship.fromTable === currentTable;

      if (!isManyToOne) {
        // One-to-many relationship: This filter should be applied horizontally (in the embedding subquery)
        // It's already been added to the embedding's WHERE clause by parseEmbeddedWhere
        // Return empty string to skip in main WHERE
        return '';
      }

      // Continue traversing
      finalTable = embeddedTable;
      currentTable = embeddedTable;
    }

    // All relationships are many-to-one: Apply filter vertically (in main WHERE via JOIN)
    const column = `${this.escapeIdentifier(finalTable)}.${this.escapeIdentifier(columnName)}`;
    const { sql, negated } = this.compileOperator(
      filter.operator,
      filter.value,
      column
    );

    // Apply negation if specified
    if (filter.negated === true || negated) {
      return `NOT (${sql})`;
    }

    return sql;
  }

  /**
   * Compile operator and value
   */
  private compileOperator(
    operator: FilterOperator,
    value: FilterValue,
    column: string
  ): { sql: string; negated: boolean } {
    switch (operator) {
      case 'eq':
        return { sql: `${column} = ${this.addParam(value)}`, negated: false };

      case 'neq':
        return { sql: `${column} <> ${this.addParam(value)}`, negated: false };

      case 'gt':
        return { sql: `${column} > ${this.addParam(value)}`, negated: false };

      case 'gte':
        return { sql: `${column} >= ${this.addParam(value)}`, negated: false };

      case 'lt':
        return { sql: `${column} < ${this.addParam(value)}`, negated: false };

      case 'lte':
        return { sql: `${column} <= ${this.addParam(value)}`, negated: false };

      case 'like':
        return {
          sql: `${column} LIKE ${this.addParam(this.convertPattern(value as string))}`,
          negated: false,
        };

      case 'ilike':
        return {
          sql: `${column} LIKE ${this.addParam(this.convertPattern(value as string))} COLLATE NOCASE`,
          negated: false,
        };

      case 'is':
        return this.compileIsOperator(column, value);

      case 'in':
        return this.compileInOperator(column, value);

      default: {
        const _exhaustive: never = operator;
        throw new CompilationError(`Unknown operator: ${_exhaustive}`);
      }
    }
  }

  /**
   * Compile IS operator
   */
  private compileIsOperator(
    column: string,
    value: FilterValue
  ): { sql: string; negated: boolean } {
    if (value === null) {
      return { sql: `${column} IS NULL`, negated: false };
    }

    if (value === true) {
      return { sql: `${column} = 1`, negated: false };
    }

    if (value === false) {
      return { sql: `${column} = 0`, negated: false };
    }

    if (value === 'not_null') {
      return { sql: `${column} IS NOT NULL`, negated: false };
    }

    if (value === 'unknown') {
      // SQLite doesn't distinguish UNKNOWN from NULL
      return { sql: `${column} IS NULL`, negated: false };
    }

    throw new CompilationError(`Invalid IS operator value: ${String(value)}`);
  }

  /**
   * Compile IN operator
   */
  private compileInOperator(
    column: string,
    value: FilterValue
  ): { sql: string; negated: boolean } {
    if (!Array.isArray(value)) {
      throw new CompilationError('IN operator requires array value');
    }

    if (value.length === 0) {
      // Empty IN list is always false
      return { sql: '0 = 1', negated: false };
    }

    const placeholders = value.map((v) => this.addParam(v)).join(', ');
    return { sql: `${column} IN (${placeholders})`, negated: false };
  }

  /**
   * Compile logical operator (AND/OR)
   */
  private compileLogical(logical: LogicalNode): string {
    if (logical.conditions.length === 0) {
      throw new CompilationError('Logical operator requires at least one condition');
    }

    // Compile all conditions and filter out empty strings
    // (empty strings come from horizontal filters that should be handled in subqueries)
    const conditionStrs = logical.conditions
      .map((cond) => this.compileWhere(cond))
      .filter((sql) => sql !== '');

    // If all conditions were filtered out, return empty string
    if (conditionStrs.length === 0) {
      return '';
    }

    // Single condition - no need for grouping
    if (conditionStrs.length === 1) {
      const sql = conditionStrs[0]!;
      // Apply negation if specified
      if (logical.negated === true) {
        return `NOT (${sql})`;
      }
      return sql;
    }

    // Multiple conditions - combine with AND/OR
    const operator = logical.type === 'and' ? ' AND ' : ' OR ';
    const sql = `(${conditionStrs.join(operator)})`;

    // Apply negation if specified
    if (logical.negated === true) {
      return `NOT ${sql}`;
    }

    return sql;
  }

  /**
   * Compile ORDER BY clause
   */
  private compileOrder(order: readonly OrderNode[]): string {
    const orderStrs = order.map((node) => {
      const column = this.escapeIdentifier(node.column);
      const direction = node.direction.toUpperCase();

      if (node.nulls !== undefined) {
        const nullsClause = node.nulls === 'first' ? 'NULLS FIRST' : 'NULLS LAST';
        return `${column} ${direction} ${nullsClause}`;
      }

      return `${column} ${direction}`;
    });

    return orderStrs.join(', ');
  }

  /**
   * Compile LIMIT/OFFSET clause
   */
  private compileLimit(limit?: number, offset?: number): string | null {
    if (limit === undefined && offset === undefined) {
      return null;
    }

    if (limit !== undefined && offset !== undefined) {
      return `LIMIT ${limit} OFFSET ${offset}`;
    }

    if (limit !== undefined) {
      return `LIMIT ${limit}`;
    }

    if (offset !== undefined) {
      // SQLite requires LIMIT when using OFFSET
      return `LIMIT -1 OFFSET ${offset}`;
    }

    return null;
  }

  /**
   * Convert PostgREST pattern (* wildcard) to SQL pattern (% wildcard)
   */
  private convertPattern(pattern: string): string {
    // Replace * with % for SQL LIKE
    return pattern.replace(/\*/g, '%');
  }

  /**
   * Add parameter and return placeholder
   */
  private addParam(value: unknown): string {
    this.params.push(value);
    return '?';
  }

  /**
   * Escape SQL identifier (table/column name)
   */
  private escapeIdentifier(identifier: string): string {
    return escapeIdentifier(identifier);
  }

  /**
   * Compile INSERT statement
   *
   * @param table - Table name
   * @param data - Single object or array of objects to insert
   * @returns CompiledQuery with INSERT SQL
   */
  compileInsert(table: string, data: Record<string, unknown> | Record<string, unknown>[]): CompiledQuery {
    // Reset state
    this.params = [];

    // Handle single object vs array
    const rows = Array.isArray(data) ? data : [data];

    if (rows.length === 0) {
      // Empty insert - return empty result
      return {
        sql: '',
        params: [],
      };
    }

    // Get columns from first row
    const firstRow = rows[0];
    if (!firstRow) {
      throw new CompilationError('Invalid insert data');
    }

    const columns = Object.keys(firstRow);

    if (columns.length === 0) {
      throw new CompilationError('No columns specified for insert');
    }

    // Build column list
    const columnList = columns.map((col) => this.escapeIdentifier(col)).join(', ');

    // Build values list for each row
    const valueLists: string[] = [];

    for (const row of rows) {
      const values: string[] = [];
      for (const col of columns) {
        const value = row[col];
        values.push(this.addParam(value));
      }
      valueLists.push(`(${values.join(', ')})`);
    }

    let sql = `INSERT INTO ${this.escapeIdentifier(table)} (${columnList}) VALUES ${valueLists.join(', ')}`;

    // Add RETURNING clause for SQLite 3.35.0+ (eliminates need for last_insert_rowid)
    sql += ' RETURNING *';

    return {
      sql,
      params: this.params,
    };
  }

  /**
   * Compile UPDATE statement
   *
   * @param table - Table name
   * @param data - Object with fields to update
   * @param where - WHERE clause AST (optional)
   * @returns CompiledQuery with UPDATE SQL
   */
  compileUpdate(table: string, data: Record<string, unknown>, where?: WhereNode): CompiledQuery {
    // Reset state
    this.params = [];

    const columns = Object.keys(data);

    // Build SET clause
    const setClause = columns.length > 0
      ? columns.map((col) => `${this.escapeIdentifier(col)} = ${this.addParam(data[col])}`).join(', ')
      : null;

    // Build WHERE clause
    const whereClause = where ? this.compileWhere(where) : null;

    // Handle empty update (no columns to set)
    if (!setClause) {
      // For empty updates, return a no-op query that just returns empty result
      // This is valid per PostgREST
      return {
        sql: '',
        params: [],
      };
    }

    // Combine clauses
    const parts = [
      `UPDATE ${this.escapeIdentifier(table)}`,
      `SET ${setClause}`,
    ];

    if (whereClause) {
      parts.push(`WHERE ${whereClause}`);
    }

    let sql = parts.join(' ');

    // Add RETURNING clause for SQLite 3.35.0+
    sql += ' RETURNING *';

    return {
      sql,
      params: this.params,
    };
  }

  /**
   * Compile DELETE statement
   *
   * @param table - Table name
   * @param where - WHERE clause AST (optional)
   * @returns CompiledQuery with DELETE SQL
   */
  compileDelete(table: string, where?: WhereNode): CompiledQuery {
    // Reset state
    this.params = [];

    // Build WHERE clause
    const whereClause = where ? this.compileWhere(where) : null;

    // Build DELETE statement
    const parts = [`DELETE FROM ${this.escapeIdentifier(table)}`];

    if (whereClause) {
      parts.push(`WHERE ${whereClause}`);
    }

    let sql = parts.join(' ');

    // Add RETURNING clause for SQLite 3.35.0+
    sql += ' RETURNING *';

    return {
      sql,
      params: this.params,
    };
  }
}
