/**
 * Row-Level Security (RLS) Module
 *
 * Implements PostgreSQL-style Row-Level Security for SQLite databases.
 * Provides policy builders, storage, and AST-based enforcement.
 *
 * Uses structured WhereNode AST instead of SQL strings for deterministic behavior.
 */

// RLS AST Enforcer
export { RLSASTEnforcer } from './ast-enforcer.js';

// RLS Storage Provider
export { SqliteRLSProvider } from './storage.js';

// Policy Builder Helpers
export { policy } from './policy-builder.js';
export type { AuthFunction, PolicyValue } from './policy-builder.js';

// RLS Policy Parser (for SQL statements)
export { parseRLSStatement } from './parser.js';

// Types
export type {
  RLSProvider,
  RLSPolicy,
  RLSStatement,
  PolicyCommand,
  PolicyRole,
} from './types.js';
