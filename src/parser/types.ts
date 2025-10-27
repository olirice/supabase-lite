/**
 * AST Type Definitions for PostgREST-Lite Query Parser
 *
 * These types represent the Abstract Syntax Tree for parsed PostgREST queries.
 * All types are strongly typed to ensure compile-time correctness.
 */

/**
 * Root query AST node representing a complete query
 */
export type QueryAST = {
  readonly select: SelectNode;
  readonly from: string;
  readonly where?: WhereNode;
  readonly rlsPolicy?: WhereNode; // RLS policy expression added at AST level
  readonly order?: readonly OrderNode[];
  readonly limit?: number;
  readonly offset?: number;
};

/**
 * SELECT clause node
 */
export type SelectNode = {
  readonly type: 'select';
  readonly columns: readonly ColumnNode[];
};

/**
 * Column selection nodes
 */
export type ColumnNode =
  | WildcardColumn
  | SimpleColumn
  | AggregateColumn
  | EmbeddedColumn;

export type WildcardColumn = {
  readonly type: 'wildcard';
};

export type SimpleColumn = {
  readonly type: 'column';
  readonly name: string;
  readonly alias?: string;
};

export type AggregateColumn = {
  readonly type: 'aggregate';
  readonly function: 'count' | 'sum' | 'avg' | 'min' | 'max';
  readonly column?: string; // undefined for count() without column
  readonly alias?: string;
};

export type EmbeddedColumn = {
  readonly type: 'embedding';
  readonly table: string;
  readonly alias?: string;
  readonly hint?: string; // Foreign key column hint (e.g., "sender_id" from users!sender_id)
  readonly select: SelectNode;
  readonly where?: WhereNode;
  readonly order?: readonly OrderNode[];
  readonly limit?: number;
};

/**
 * WHERE clause nodes
 */
export type WhereNode =
  | FilterNode
  | EmbeddedFilterNode
  | LogicalNode;

/**
 * Individual filter condition
 */
export type FilterNode = {
  readonly type: 'filter';
  readonly column: string;
  readonly operator: FilterOperator;
  readonly value: FilterValue;
  readonly negated?: boolean;
};

/**
 * Filter on embedded resource (vertical filtering)
 * Example: author.status=eq.active filters parent rows based on embedded criteria
 */
export type EmbeddedFilterNode = {
  readonly type: 'embedded_filter';
  readonly path: readonly string[]; // e.g., ['author', 'status'] for author.status
  readonly operator: FilterOperator;
  readonly value: FilterValue;
  readonly negated?: boolean;
};

/**
 * Supported filter operators
 */
export type FilterOperator =
  // Equality
  | 'eq'
  | 'neq'
  // Comparison
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  // Pattern matching
  | 'like'
  | 'ilike'
  // Special
  | 'is'
  | 'in';

/**
 * Auth function reference (used in RLS policies)
 */
export interface AuthFunction {
  type: 'auth_function';
  name: 'uid' | 'role';
}

/**
 * Filter value types
 */
export type FilterValue =
  | string
  | number
  | boolean
  | null
  | readonly (string | number)[]
  | AuthFunction;

/**
 * Logical combination of conditions
 */
export type LogicalNode = {
  readonly type: 'and' | 'or';
  readonly conditions: readonly WhereNode[];
  readonly negated?: boolean;
};

/**
 * ORDER BY clause node
 */
export type OrderNode = {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
  readonly nulls?: 'first' | 'last';
};

/**
 * Result type for parser operations
 */
export type ParseResult<T, E = ParseError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Parse error details
 */
export type ParseError = {
  readonly message: string;
  readonly location?: string;
  readonly details?: string;
};
