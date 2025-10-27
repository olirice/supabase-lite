/**
 * PostgREST-Lite
 *
 * A strongly-typed TypeScript library that brings PostgREST's query interface
 * to SQLite, optimized for Cloudflare Workers.
 */

// Export parser
export { QueryParser } from './parser/index.js';

// Export types
export type {
  QueryAST,
  SelectNode,
  ColumnNode,
  WildcardColumn,
  SimpleColumn,
  EmbeddedColumn,
  WhereNode,
  FilterNode,
  FilterOperator,
  FilterValue,
  LogicalNode,
  OrderNode,
  ParseResult,
  ParseError as ParseErrorType,
} from './parser/types.js';

// Export errors
export {
  PostgRESTLiteError,
  UnsupportedFeatureError,
  ParseError,
  ValidationError,
  CompilationError,
  ExecutionError,
  UNSUPPORTED_FEATURES,
  checkOperatorSupport,
} from './errors/index.js';

// Export auth (optional module)
export { mountGoTrueRoutes } from './auth/gotrue-adapter.js';
export type { GoTrueSession, GoTrueUser } from './auth/gotrue-adapter.js';
