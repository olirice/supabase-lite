/**
 * Error types for PostgREST-Lite
 */

/**
 * Base error class for PostgREST-Lite errors
 */
export class PostgRESTLiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostgRESTLiteError';
    Object.setPrototypeOf(this, PostgRESTLiteError.prototype);
  }
}

/**
 * Error thrown when a feature is not supported
 */
export class UnsupportedFeatureError extends PostgRESTLiteError {
  public readonly feature: string;
  public readonly hint: string;

  constructor(feature: string, context?: string) {
    const message = context
      ? `Feature '${feature}' is not supported in PostgREST-Lite (${context})`
      : `Feature '${feature}' is not supported in PostgREST-Lite`;

    super(message);
    this.name = 'UnsupportedFeatureError';
    this.feature = feature;
    this.hint = 'Consider upgrading to PostgreSQL with PostgREST for full feature support';
    Object.setPrototypeOf(this, UnsupportedFeatureError.prototype);
  }
}

/**
 * Error thrown during query parsing
 */
export class ParseError extends PostgRESTLiteError {
  public readonly location?: string | undefined;
  public readonly details?: string | undefined;

  constructor(message: string, location?: string, details?: string) {
    super(message);
    this.name = 'ParseError';
    if (location !== undefined) this.location = location;
    if (details !== undefined) this.details = details;
    Object.setPrototypeOf(this, ParseError.prototype);
  }
}

/**
 * Error thrown during query validation
 */
export class ValidationError extends PostgRESTLiteError {
  public readonly column?: string | undefined;
  public readonly table?: string | undefined;

  constructor(message: string, context?: { column?: string; table?: string }) {
    super(message);
    this.name = 'ValidationError';
    if (context?.column !== undefined) this.column = context.column;
    if (context?.table !== undefined) this.table = context.table;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error thrown during SQL compilation
 */
export class CompilationError extends PostgRESTLiteError {
  constructor(message: string) {
    super(message);
    this.name = 'CompilationError';
    Object.setPrototypeOf(this, CompilationError.prototype);
  }
}

/**
 * Error thrown during query execution
 */
export class ExecutionError extends PostgRESTLiteError {
  public readonly code?: string | undefined;
  public readonly sqliteError?: Error | undefined;

  constructor(message: string, sqliteError?: Error, code?: string) {
    super(message);
    this.name = 'ExecutionError';
    if (sqliteError !== undefined) this.sqliteError = sqliteError;
    if (code !== undefined) this.code = code;
    Object.setPrototypeOf(this, ExecutionError.prototype);
  }
}

/**
 * Map of unsupported features to their descriptions
 */
export const UNSUPPORTED_FEATURES: Record<string, string> = {
  // Full-text search operators
  fts: 'Full-text search',
  plfts: 'Full-text search (plain)',
  phfts: 'Full-text search (phrase)',
  wfts: 'Full-text search (websearch)',

  // Array/JSON operators
  cs: 'Array/JSON contains operator',
  cd: 'Array/JSON contained-by operator',
  ov: 'Array/range overlaps operator',

  // Range operators
  sl: 'Range strictly-left operator',
  sr: 'Range strictly-right operator',
  nxl: 'Range not-extends-left operator',
  nxr: 'Range not-extends-right operator',
  adj: 'Range adjacent operator',

  // Regex operators
  match: 'Regex match operator',
  imatch: 'Case-insensitive regex match operator',

  // Special equality operators
  isdistinct: 'IS DISTINCT FROM operator',

  // Other features
  rpc: 'Remote Procedure Calls (stored procedures)',
  explain: 'Query EXPLAIN plans',
  geojson: 'GeoJSON response format',
  spread: 'Horizontal filtering with !inner',
} as const;

/**
 * Check if an operator is supported
 */
export function checkOperatorSupport(operator: string): void {
  if (operator in UNSUPPORTED_FEATURES) {
    throw new UnsupportedFeatureError(
      UNSUPPORTED_FEATURES[operator] ?? operator,
      `operator: ${operator}`
    );
  }
}
