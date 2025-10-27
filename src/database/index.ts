/**
 * Database Adapters
 *
 * Exports database adapter interfaces and implementations for:
 * - Local development (better-sqlite3)
 * - Cloudflare Workers (D1)
 */

export type { DatabaseAdapter, PreparedStatement, QueryResult } from './adapter.js';
export { SqliteAdapter } from './sqlite-adapter.js';
export { D1Adapter } from './d1-adapter.js';
export type { D1Database } from './d1-adapter.js';
