/**
 * PostgREST Query Parser
 *
 * Parses PostgREST-style query strings into a strongly-typed AST.
 */

import { ParseError, UnsupportedFeatureError } from '../errors/index.js';
import type {
  QueryAST,
  SelectNode,
  ColumnNode,
  WhereNode,
  FilterNode,
  EmbeddedFilterNode,
  FilterOperator,
  FilterValue,
  LogicalNode,
  OrderNode,
} from './types.js';
import { checkOperatorSupport } from '../errors/index.js';

/**
 * Main query parser class
 */
export class QueryParser {
  /**
   * Parse a PostgREST query URL into an AST
   */
  parse(urlString: string): QueryAST {
    try {
      // Handle both full URLs and paths
      const url = urlString.startsWith('http')
        ? new URL(urlString)
        : new URL(urlString, 'http://localhost');

      const params = url.searchParams;

      // Extract table name from path
      const from = this.extractTable(url.pathname);

      // Collect embedded resource parameters (posts.status=eq.published, posts.order=..., etc.)
      const embeddedParams = this.parseEmbeddedParams(params);

      // Parse components
      const select = this.parseSelect(params.get('select'), embeddedParams);
      const where = this.parseWhere(params, embeddedParams);
      const order = this.parseOrder(params.get('order'));
      const limit = this.parseLimit(params.get('limit'));
      const offset = this.parseOffset(params.get('offset'));

      const ast: QueryAST = {
        select,
        from,
        ...(where !== undefined && { where }),
        ...(order !== undefined && { order }),
        ...(limit !== undefined && { limit }),
        ...(offset !== undefined && { offset }),
      };

      return ast;
    } catch (error) {
      if (error instanceof ParseError || error instanceof UnsupportedFeatureError) {
        throw error;
      }
      throw new ParseError(
        `Failed to parse query: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Extract table name from URL pathname
   */
  private extractTable(pathname: string): string {
    // Remove leading/trailing slashes and extract table name
    const cleaned = pathname.replace(/^\/+|\/+$/g, '');
    const parts = cleaned.split('/');

    if (parts.length === 0 || parts[0] === '') {
      throw new ParseError('Table name is required in URL path');
    }

    // Handle PostgREST-style paths like /rest/v1/table_name
    // Look for the last part that's not 'rest' or 'v1'
    const tableName = parts.filter(
      (part) => part && !part.match(/^(rest|v\d+)$/)
    )[0];

    if (!tableName) {
      throw new ParseError('Table name is required in URL path');
    }

    return tableName;
  }

  /**
   * Parse embedded resource parameters (filters, order, limit)
   * Used for BOTH horizontal filtering (one-to-many) and tracking for vertical filtering (many-to-one)
   * Returns a nested map: { posts: { status: [...], order: '...', limit: '...' }, ... }
   */
  private parseEmbeddedParams(params: URLSearchParams): Map<string, Map<string, string[]>> {
    const embeddedParams = new Map<string, Map<string, string[]>>();

    for (const [key, value] of params.entries()) {
      // Check if this is an embedded resource parameter (contains a dot)
      const dotIndex = key.indexOf('.');
      if (dotIndex === -1) {
        continue; // Not an embedded parameter
      }

      // Extract the path: posts.status, posts.order, posts.limit
      const path = key.split('.');
      const tableName = path[0]!;
      const paramName = path.slice(1).join('.'); // e.g., 'status', 'order', 'limit'

      if (!embeddedParams.has(tableName)) {
        embeddedParams.set(tableName, new Map());
      }

      const tableParams = embeddedParams.get(tableName)!;
      if (!tableParams.has(paramName)) {
        tableParams.set(paramName, []);
      }
      tableParams.get(paramName)!.push(value);
    }

    return embeddedParams;
  }

  /**
   * Parse SELECT clause
   */
  private parseSelect(selectParam: string | null, embeddedParams: Map<string, Map<string, string[]>>): SelectNode {
    if (!selectParam || selectParam === '*') {
      return {
        type: 'select',
        columns: [{ type: 'wildcard' }],
      };
    }

    const columns: ColumnNode[] = [];
    const parts = this.splitSelectColumns(selectParam);

    for (const part of parts) {
      // Check for aggregates with alias (alias:column.aggregate() or alias:count())
      // Must check BEFORE embeddings since count() would match embedding pattern
      const aliasedAggregateMatch = part.match(/^(\w+):((?:(\w+)\.)?(\w+)\(\))$/);
      if (aliasedAggregateMatch) {
        const alias = aliasedAggregateMatch[1]!;
        const column = aliasedAggregateMatch[3]; // undefined for count()
        const func = aliasedAggregateMatch[4]!;

        if (!['count', 'sum', 'avg', 'min', 'max'].includes(func)) {
          throw new ParseError(`Unknown aggregate function: ${func}`, 'select');
        }

        columns.push({
          type: 'aggregate',
          function: func as 'count' | 'sum' | 'avg' | 'min' | 'max',
          ...(column !== undefined && { column }),
          alias,
        });
        continue;
      }

      // Check for aggregates without alias (column.aggregate() or count())
      // Must check BEFORE embeddings since count() would match embedding pattern
      const aggregateMatch = part.match(/^((?:(\w+)\.)?(\w+)\(\))$/);
      if (aggregateMatch) {
        const column = aggregateMatch[2]; // undefined for count()
        const func = aggregateMatch[3]!;

        if (['count', 'sum', 'avg', 'min', 'max'].includes(func)) {
          columns.push({
            type: 'aggregate',
            function: func as 'count' | 'sum' | 'avg' | 'min' | 'max',
            ...(column !== undefined && { column }),
          });
          continue;
        }
        // If not an aggregate function, fall through to embedding check
      }

      // Check for embedding with alias (alias:table(...) or alias:table!hint(...))
      if (part.includes('(') && part.includes(':')) {
        const colonIndex = part.indexOf(':');
        const parenIndex = part.indexOf('(');

        // Only treat as aliased embedding if colon comes before paren
        if (colonIndex < parenIndex) {
          const alias = part.slice(0, colonIndex);
          const tableWithHint = part.slice(colonIndex + 1, parenIndex);

          // Check for hint syntax (table!hint)
          let table: string;
          let hint: string | undefined;
          if (tableWithHint.includes('!')) {
            const hintIndex = tableWithHint.indexOf('!');
            table = tableWithHint.slice(0, hintIndex);
            hint = tableWithHint.slice(hintIndex + 1);

            if (!/^\w+$/.test(alias) || !/^\w+$/.test(table) || !/^\w+$/.test(hint)) {
              throw new ParseError(`Invalid embedding with alias and hint: ${part}`, 'select');
            }
          } else {
            table = tableWithHint;
            if (!/^\w+$/.test(alias) || !/^\w+$/.test(table)) {
              throw new ParseError(`Invalid embedding with alias: ${part}`, 'select');
            }
          }

          // Extract content between parentheses, respecting nesting
          const selectStr = this.extractParenContent(part.slice(parenIndex));

          if (selectStr === null) {
            throw new ParseError(`Unmatched parentheses in embedding: ${part}`, 'select');
          }

          // Get embedded params for this alias (e.g., posts.status, posts.order, posts.limit)
          const embeddedWhere = this.parseEmbeddedWhere(alias, embeddedParams);
          const embeddedOrder = this.parseEmbeddedOrder(alias, embeddedParams);
          const embeddedLimit = this.parseEmbeddedLimit(alias, embeddedParams);

          columns.push({
            type: 'embedding',
            table,
            alias,
            ...(hint !== undefined && { hint }),
            select: this.parseSelect(selectStr ?? '*', embeddedParams),
            ...(embeddedWhere !== undefined && { where: embeddedWhere }),
            ...(embeddedOrder !== undefined && { order: embeddedOrder }),
            ...(embeddedLimit !== undefined && { limit: embeddedLimit }),
          });
          continue;
        }
      }

      // Check for embedding without alias (table(...) or table!hint(...))
      if (part.includes('(')) {
        const parenIndex = part.indexOf('(');
        const tableWithHint = part.slice(0, parenIndex);

        // Check for hint syntax (table!hint)
        let table: string;
        let hint: string | undefined;
        if (tableWithHint.includes('!')) {
          const hintIndex = tableWithHint.indexOf('!');
          table = tableWithHint.slice(0, hintIndex);
          hint = tableWithHint.slice(hintIndex + 1);

          if (!/^\w+$/.test(table) || !/^\w+$/.test(hint)) {
            throw new ParseError(`Invalid embedding with hint: ${part}`, 'select');
          }
        } else {
          table = tableWithHint;
          if (!/^\w+$/.test(table)) {
            throw new ParseError(`Invalid table name in embedding: ${table}`, 'select');
          }
        }

        // Extract content between parentheses, respecting nesting
        const selectStr = this.extractParenContent(part.slice(parenIndex));

        if (selectStr === null) {
          throw new ParseError(`Unmatched parentheses in embedding: ${part}`, 'select');
        }

        // Get embedded params for this table (e.g., posts.status, posts.order, posts.limit)
        const embeddedWhere = this.parseEmbeddedWhere(table, embeddedParams);
        const embeddedOrder = this.parseEmbeddedOrder(table, embeddedParams);
        const embeddedLimit = this.parseEmbeddedLimit(table, embeddedParams);

        columns.push({
          type: 'embedding',
          table,
          ...(hint !== undefined && { hint }),
          select: this.parseSelect(selectStr ?? '*', embeddedParams),
          ...(embeddedWhere !== undefined && { where: embeddedWhere }),
          ...(embeddedOrder !== undefined && { order: embeddedOrder }),
          ...(embeddedLimit !== undefined && { limit: embeddedLimit }),
        });
        continue;
      }

      // Check for simple column alias (alias:columnName)
      const aliasMatch = part.match(/^(\w+):(\w+)$/);
      if (aliasMatch && aliasMatch[1] && aliasMatch[2]) {
        columns.push({
          type: 'column',
          name: aliasMatch[2],
          alias: aliasMatch[1],
        });
        continue;
      }

      // Simple column
      if (part === '*') {
        columns.push({ type: 'wildcard' });
      } else if (/^\w+$/.test(part)) {
        columns.push({ type: 'column', name: part });
      } else {
        throw new ParseError(`Invalid column specification: ${part}`, 'select');
      }
    }

    return {
      type: 'select',
      columns,
    };
  }

  /**
   * Extract content between parentheses, respecting nesting
   * Returns the content without outer parentheses, or null if unmatched
   */
  private extractParenContent(str: string): string | null {
    if (!str.startsWith('(')) {
      return null;
    }

    let depth = 0;
    let start = -1;

    for (let i = 0; i < str.length; i++) {
      if (str[i] === '(') {
        if (depth === 0) start = i + 1;
        depth++;
      } else if (str[i] === ')') {
        depth--;
        if (depth === 0) {
          return str.slice(start, i);
        }
      }
    }

    return null; // Unmatched parentheses
  }

  /**
   * Split SELECT columns, respecting parentheses for embeddings
   */
  private splitSelectColumns(select: string): string[] {
    const parts: string[] = [];
    let current = '';
    let depth = 0;

    for (const char of select) {
      if (char === '(') {
        depth++;
        current += char;
      } else if (char === ')') {
        depth--;
        current += char;
      } else if (char === ',' && depth === 0) {
        if (current.trim()) {
          parts.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts;
  }

  /**
   * Parse WHERE clause for an embedded resource (HORIZONTAL filtering for one-to-many)
   * This handles filters like: /users?select=posts(title)&posts.status=eq.published
   * The compiler will determine based on relationship direction whether to use this or vertical filtering.
   */
  private parseEmbeddedWhere(tableName: string, embeddedParams: Map<string, Map<string, string[]>>): WhereNode | undefined {
    const tableParams = embeddedParams.get(tableName);
    if (!tableParams) {
      return undefined;
    }

    const conditions: WhereNode[] = [];

    // Process all filter parameters for this table (excluding 'order' and 'limit')
    for (const [paramName, values] of tableParams.entries()) {
      if (paramName === 'order' || paramName === 'limit') {
        continue;
      }

      // Skip dotted parameters (e.g., 'author.status') - these are nested filters
      // that should be handled in the main WHERE clause, not in this embedding's WHERE
      if (paramName.includes('.')) {
        continue;
      }

      // Parse as filter: paramName is the column, values[0] is the filter value
      if (values.length > 0) {
        conditions.push(this.parseFilter(paramName, values[0]!));
      }
    }

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    // Multiple conditions are combined with AND
    return {
      type: 'and',
      conditions,
    };
  }

  /**
   * Parse ORDER BY for an embedded resource
   */
  private parseEmbeddedOrder(tableName: string, embeddedParams: Map<string, Map<string, string[]>>): readonly OrderNode[] | undefined {
    const tableParams = embeddedParams.get(tableName);
    if (!tableParams) {
      return undefined;
    }

    const orderValues = tableParams.get('order');
    if (!orderValues || orderValues.length === 0) {
      return undefined;
    }

    // Parse the order value (e.g., 'created_at.desc')
    return this.parseOrder(orderValues[0]!);
  }

  /**
   * Parse LIMIT for an embedded resource
   */
  private parseEmbeddedLimit(tableName: string, embeddedParams: Map<string, Map<string, string[]>>): number | undefined {
    const tableParams = embeddedParams.get(tableName);
    if (!tableParams) {
      return undefined;
    }

    const limitValues = tableParams.get('limit');
    if (!limitValues || limitValues.length === 0) {
      return undefined;
    }

    // Parse the limit value (e.g., '2')
    return this.parseLimit(limitValues[0]!);
  }

  /**
   * Parse WHERE clause from query parameters
   */
  private parseWhere(params: URLSearchParams, _embeddedParams: Map<string, Map<string, string[]>>): WhereNode | undefined {
    const conditions: WhereNode[] = [];

    // Reserved parameters that are not filters
    const reserved = new Set(['select', 'order', 'limit', 'offset']);

    for (const [key, value] of params.entries()) {
      // Handle OR filters
      if (key === 'or') {
        conditions.push(this.parseLogicalGroup('or', value));
        continue;
      }

      // Handle AND filters
      if (key === 'and') {
        conditions.push(this.parseLogicalGroup('and', value));
        continue;
      }

      // Skip reserved parameters
      if (reserved.has(key)) {
        continue;
      }

      // Check if this is an embedded filter
      // Could be vertical (many-to-one) or horizontal (one-to-many)
      // Compiler will determine which based on relationship direction
      // Example: author.status=eq.active (vertical) or posts.status=eq.published (horizontal)
      if (key.includes('.')) {
        const path = key.split('.');

        // Skip embedded order/limit params (e.g., posts.order, posts.limit)
        // These are handled by parseEmbeddedParams for the embedding, not in WHERE
        if (path.length === 2 && (path[1] === 'order' || path[1] === 'limit')) {
          continue;
        }

        conditions.push(this.parseEmbeddedFilter(path, value));
        continue;
      }

      // Parse as regular filter
      conditions.push(this.parseFilter(key, value));
    }

    if (conditions.length === 0) {
      return undefined;
    }

    if (conditions.length === 1) {
      return conditions[0];
    }

    // Multiple conditions are combined with AND
    return {
      type: 'and',
      conditions,
    };
  }

  /**
   * Parse a single filter condition
   * Returns WhereNode to support pattern quantifiers (like(all), like(any))
   */
  private parseFilter(column: string, filterValue: string): WhereNode {
    // Format: operator.value or not.operator.value
    const parts = filterValue.split('.');

    if (parts.length < 2) {
      throw new ParseError(
        `Invalid filter format: ${filterValue}`,
        column,
        'Expected format: operator.value'
      );
    }

    // Check for negation
    let negated = false;
    let operator: string;
    let valueStr: string;

    if (parts[0] === 'not') {
      negated = true;
      if (!parts[1]) {
        throw new ParseError(
          `Invalid filter format: missing operator after 'not'`,
          column
        );
      }
      operator = parts[1];
      valueStr = parts.slice(2).join('.');
    } else {
      if (!parts[0]) {
        throw new ParseError(
          `Invalid filter format: missing operator`,
          column
        );
      }
      operator = parts[0];
      valueStr = parts.slice(1).join('.');
    }

    // Check for pattern quantifiers: like(all), like(any), ilike(all), ilike(any)
    const patternQuantifierMatch = operator.match(/^(i?like)\((all|any)\)$/);
    if (patternQuantifierMatch) {
      const baseOperator = patternQuantifierMatch[1] as 'like' | 'ilike';
      const quantifier = patternQuantifierMatch[2] as 'all' | 'any';

      return this.parsePatternQuantifier(
        column,
        baseOperator,
        quantifier,
        valueStr,
        negated
      );
    }

    // Check if operator is supported
    checkOperatorSupport(operator);

    // Validate operator
    const validatedOperator = this.validateOperator(operator, column);

    // Parse value based on operator
    const value = this.parseFilterValue(validatedOperator, valueStr, column);

    const filter: FilterNode = {
      type: 'filter',
      column,
      operator: operator as FilterOperator,
      value,
      ...(negated && { negated }),
    };

    return filter;
  }

  /**
   * Parse embedded filter for vertical filtering
   * Example: author.status=eq.active -> path=['author', 'status']
   * Example: post.author.status=eq.active -> path=['post', 'author', 'status']
   */
  private parseEmbeddedFilter(path: string[], filterValue: string): EmbeddedFilterNode {
    if (path.length < 2) {
      throw new ParseError(
        `Invalid embedded filter path: ${path.join('.')}`,
        'embedded_filter',
        'Expected format: table.column=operator.value'
      );
    }

    // Format: operator.value or not.operator.value
    const parts = filterValue.split('.');

    if (parts.length < 2) {
      throw new ParseError(
        `Invalid filter format: ${filterValue}`,
        path.join('.'),
        'Expected format: operator.value'
      );
    }

    // Check for negation
    let negated = false;
    let operator: string;
    let valueStr: string;

    if (parts[0] === 'not') {
      negated = true;
      if (!parts[1]) {
        throw new ParseError(
          `Invalid filter format: missing operator after 'not'`,
          path.join('.')
        );
      }
      operator = parts[1];
      valueStr = parts.slice(2).join('.');
    } else {
      if (!parts[0]) {
        throw new ParseError(
          `Invalid filter format: missing operator`,
          path.join('.')
        );
      }
      operator = parts[0];
      valueStr = parts.slice(1).join('.');
    }

    // Check if operator is supported
    checkOperatorSupport(operator);

    // Validate operator
    const validatedOperator = this.validateOperator(operator, path.join('.'));

    // Parse value based on operator
    const value = this.parseFilterValue(validatedOperator, valueStr, path.join('.'));

    const filter: EmbeddedFilterNode = {
      type: 'embedded_filter',
      path,
      operator: operator as FilterOperator,
      value,
      ...(negated && { negated }),
    };

    return filter;
  }

  /**
   * Parse pattern quantifier: like(all), like(any), ilike(all), ilike(any)
   *
   * Format: like(all).{pattern1,pattern2,...}
   * Returns:
   * - like(all) → AND group of LIKE filters
   * - like(any) → OR group of LIKE filters
   * - ilike(all) → AND group of ILIKE filters
   * - ilike(any) → OR group of ILIKE filters
   */
  private parsePatternQuantifier(
    column: string,
    operator: 'like' | 'ilike',
    quantifier: 'all' | 'any',
    valueStr: string,
    negated: boolean
  ): WhereNode {
    // Value should be in format: {pattern1,pattern2,...}
    if (!valueStr.startsWith('{') || !valueStr.endsWith('}')) {
      throw new ParseError(
        `Pattern quantifier requires braces: ${operator}(${quantifier}).{pattern1,pattern2}`,
        column
      );
    }

    // Extract patterns from {pattern1,pattern2,...}
    const patternsStr = valueStr.slice(1, -1);
    const patterns = this.splitInValues(patternsStr);

    if (patterns.length === 0) {
      throw new ParseError(
        `Pattern quantifier requires at least one pattern`,
        column
      );
    }

    // Remove quotes from patterns if present
    const cleanedPatterns = patterns.map((p) => {
      const trimmed = p.trim();
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        return trimmed.slice(1, -1);
      }
      return trimmed;
    });

    // If single pattern, return a simple filter
    if (cleanedPatterns.length === 1) {
      const pattern = cleanedPatterns[0];
      if (pattern === undefined) {
        throw new ParseError('Internal error: pattern is undefined', column);
      }
      return {
        type: 'filter',
        column,
        operator,
        value: pattern,
        ...(negated && { negated }),
      };
    }

    // Multiple patterns: create logical group
    const conditions: FilterNode[] = cleanedPatterns.map((pattern) => ({
      type: 'filter',
      column,
      operator,
      value: pattern,
    }));

    // all → AND, any → OR
    const logicalType = quantifier === 'all' ? 'and' : 'or';

    return {
      type: logicalType,
      conditions,
      ...(negated && { negated }),
    };
  }

  /**
   * Split IN values on commas, respecting quotes
   */
  private splitInValues(valuesStr: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < valuesStr.length; i++) {
      const char = valuesStr[i];

      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
      } else if (char === ',' && !inQuotes) {
        if (current.trim()) {
          values.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      values.push(current.trim());
    }

    return values;
  }

  /**
   * Validate that an operator is supported
   */
  private validateOperator(operator: string, context: string): FilterOperator {
    const validOperators: FilterOperator[] = [
      'eq',
      'neq',
      'gt',
      'gte',
      'lt',
      'lte',
      'like',
      'ilike',
      'is',
      'in',
    ];

    if (!validOperators.includes(operator as FilterOperator)) {
      throw new ParseError(`Unknown operator: ${operator}`, context);
    }

    return operator as FilterOperator;
  }

  /**
   * Parse filter value based on operator
   */
  private parseFilterValue(
    operator: FilterOperator,
    valueStr: string,
    column: string
  ): FilterValue {
    // Handle 'in' operator
    if (operator === 'in') {
      // Format: in.(value1,value2,value3)
      const match = valueStr.match(/^\((.+)\)$/);
      if (!match || !match[1]) {
        throw new ParseError(
          `Invalid 'in' operator format: expected (value1,value2,...)`,
          column
        );
      }

      // Split on commas, respecting quotes
      const rawValues = this.splitInValues(match[1]);

      const values = rawValues.map((v) => {
        const trimmed = v.trim();
        // Remove quotes if present
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
          return trimmed.slice(1, -1);
        }
        // Try to parse as number
        const num = Number(trimmed);
        return isNaN(num) ? trimmed : num;
      });

      return values;
    }

    // Handle 'is' operator (case-insensitive)
    if (operator === 'is') {
      const lowerValue = valueStr.toLowerCase();

      if (lowerValue === 'null') return null;
      if (lowerValue === 'true') return true;
      if (lowerValue === 'false') return false;

      // IS extensions (SQLite-compatible)
      if (lowerValue === 'not_null') return 'not_null';
      if (lowerValue === 'unknown') return 'unknown';

      throw new ParseError(
        `Invalid 'is' operator value: expected null, true, false, not_null, or unknown`,
        column
      );
    }

    // Try to parse as number
    const num = Number(valueStr);
    if (!isNaN(num) && valueStr !== '') {
      return num;
    }

    // Return as string
    return valueStr;
  }

  /**
   * Parse logical group (OR or AND)
   * Format: or=(filter1,filter2,...) or and=(filter1,filter2,...)
   * Supports nested groups: or=(filter1,and(filter2,filter3))
   */
  private parseLogicalGroup(type: 'or' | 'and', value: string): LogicalNode {
    // Remove outer parentheses
    const match = value.match(/^\((.+)\)$/);
    if (!match || !match[1]) {
      throw new ParseError(
        `Invalid ${type.toUpperCase()} filter format: expected (filter1,filter2,...)`,
        type
      );
    }

    const filtersStr = match[1];
    const filters = this.splitLogicalFilters(filtersStr);

    const conditions: WhereNode[] = filters.map((filterStr) => {
      // Check if this is a nested group (starts with 'and(' or 'or(')
      const nestedOrMatch = filterStr.match(/^or\((.+)\)$/);
      if (nestedOrMatch) {
        return this.parseLogicalGroup('or', `(${nestedOrMatch[1]})`);
      }

      const nestedAndMatch = filterStr.match(/^and\((.+)\)$/);
      if (nestedAndMatch) {
        return this.parseLogicalGroup('and', `(${nestedAndMatch[1]})`);
      }

      // Parse as filter in format: column.operator.value
      // Extract column name (first part before first dot)
      const firstDotIndex = filterStr.indexOf('.');
      if (firstDotIndex === -1) {
        throw new ParseError(`Invalid ${type.toUpperCase()} filter: ${filterStr}`, type);
      }

      const column = filterStr.slice(0, firstDotIndex);
      const filterValue = filterStr.slice(firstDotIndex + 1);

      if (!column || !filterValue) {
        throw new ParseError(`Invalid ${type.toUpperCase()} filter format: ${filterStr}`, type);
      }

      // Use parseFilter which handles pattern quantifiers and all operators
      return this.parseFilter(column, filterValue);
    });

    return {
      type,
      conditions,
    };
  }

  /**
   * Split logical filter conditions, respecting nested parentheses and braces
   */
  private splitLogicalFilters(filtersStr: string): string[] {
    const filters: string[] = [];
    let current = '';
    let parenDepth = 0;
    let braceDepth = 0;

    for (const char of filtersStr) {
      if (char === '(') {
        parenDepth++;
        current += char;
      } else if (char === ')') {
        parenDepth--;
        current += char;
      } else if (char === '{') {
        braceDepth++;
        current += char;
      } else if (char === '}') {
        braceDepth--;
        current += char;
      } else if (char === ',' && parenDepth === 0 && braceDepth === 0) {
        if (current.trim()) {
          filters.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      filters.push(current.trim());
    }

    return filters;
  }

  /**
   * Parse ORDER BY clause
   */
  private parseOrder(orderParam: string | null): OrderNode[] | undefined {
    if (!orderParam) {
      return undefined;
    }

    const orders: OrderNode[] = [];
    const parts = orderParam.split(',');

    for (const part of parts) {
      const segments = part.trim().split('.');

      if (segments.length < 2) {
        throw new ParseError(
          `Invalid order format: ${part}`,
          'order',
          'Expected format: column.asc or column.desc'
        );
      }

      const column = segments[0];
      const direction = segments[1];

      if (!column || !direction) {
        throw new ParseError(
          `Invalid order format: missing column or direction in ${part}`,
          'order'
        );
      }

      if (direction !== 'asc' && direction !== 'desc') {
        throw new ParseError(
          `Invalid order direction: ${direction}`,
          'order',
          'Expected asc or desc'
        );
      }

      const nullsSegment = segments[2];
      if (nullsSegment && nullsSegment !== 'nullsfirst' && nullsSegment !== 'nullslast') {
        throw new ParseError(
          `Invalid nulls handling: ${nullsSegment}`,
          'order',
          'Expected nullsfirst or nullslast'
        );
      }

      const order: OrderNode = {
        column,
        direction,
        ...(nullsSegment === 'nullsfirst' && { nulls: 'first' as const }),
        ...(nullsSegment === 'nullslast' && { nulls: 'last' as const }),
      };

      orders.push(order);
    }

    return orders;
  }

  /**
   * Parse LIMIT clause
   */
  private parseLimit(limitParam: string | null): number | undefined {
    if (!limitParam) {
      return undefined;
    }

    const limit = parseInt(limitParam, 10);

    if (isNaN(limit) || limit < 0) {
      throw new ParseError(`Invalid limit value: ${limitParam}`, 'limit');
    }

    return limit;
  }

  /**
   * Parse OFFSET clause
   */
  private parseOffset(offsetParam: string | null): number | undefined {
    if (!offsetParam) {
      return undefined;
    }

    const offset = parseInt(offsetParam, 10);

    if (isNaN(offset) || offset < 0) {
      throw new ParseError(`Invalid offset value: ${offsetParam}`, 'offset');
    }

    return offset;
  }
}

// Re-export types
export * from './types.js';
