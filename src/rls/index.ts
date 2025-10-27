/**
 * Row-Level Security (RLS) Module
 *
 * Implements PostgreSQL-style Row-Level Security for SQLite databases.
 * Provides policy parsing, storage, and AST-based enforcement.
 */

// RLS AST Enforcer
export { RLSASTEnforcer } from './ast-enforcer.js';

// RLS Storage Provider
export { SqliteRLSProvider } from './storage.js';

// SQL Expression Parser
export { parseSQLExpression } from './expression-parser.js';

// RLS Policy Parser
export { parseRLSStatement } from './parser.js';

// Types
export type {
  RLSProvider,
  RLSPolicy,
  RLSStatement,
  PolicyCommand,
  PolicyRole,
} from './types.js';
