/**
 * Cloudflare Workers Entry Point
 *
 * This file demonstrates how to deploy the API to Cloudflare Workers with D1.
 *
 * To deploy:
 * 1. Install wrangler: npm install -g wrangler
 * 2. Create wrangler.toml configuration
 * 3. Create D1 database: wrangler d1 create supabase-db
 * 4. Run migrations to set up schema
 * 5. Deploy: wrangler deploy
 */

import { createServer } from '../api/server.js';
import { D1Adapter } from '../database/d1-adapter.js';

/**
 * Cloudflare Workers ExecutionContext
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
  props: Record<string, unknown>;
}

/**
 * Cloudflare Workers environment bindings
 */
export interface Env {
  // D1 database binding (configured in wrangler.toml)
  DB: D1Database;

  // Optional: CORS configuration
  ALLOWED_ORIGINS?: string;
}

/**
 * D1Database type from Cloudflare Workers
 */
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<D1ExecResult>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    duration: number;
  };
}

interface D1RunResult {
  success: boolean;
  meta: {
    duration: number;
    changes: number;
    last_row_id: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

/**
 * Main fetch handler for Cloudflare Workers
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Create D1 adapter
    const adapter = new D1Adapter(env.DB);

    // Parse CORS configuration
    const allowedOrigins = env.ALLOWED_ORIGINS?.split(',') ?? ['*'];

    // Create server with D1 adapter
    const app = createServer({
      db: adapter,
      cors: {
        origin: allowedOrigins,
        credentials: true,
      },
    });

    // Handle request
    return app.fetch(request, env, ctx);
  },
};

/**
 * Example wrangler.toml configuration:
 *
 * ```toml
 * name = "supabase-lite"
 * main = "src/workers/index.ts"
 * compatibility_date = "2024-01-01"
 *
 * [[d1_databases]]
 * binding = "DB"
 * database_name = "supabase-db"
 * database_id = "your-database-id"
 *
 * [vars]
 * ALLOWED_ORIGINS = "https://example.com,https://app.example.com"
 * ```
 *
 * Example D1 migration (migrations/0001_initial.sql):
 *
 * ```sql
 * CREATE TABLE users (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   name TEXT NOT NULL,
 *   email TEXT NOT NULL UNIQUE,
 *   created_at TEXT DEFAULT CURRENT_TIMESTAMP
 * );
 *
 * CREATE TABLE posts (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   title TEXT NOT NULL,
 *   content TEXT,
 *   author_id INTEGER NOT NULL,
 *   created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 *   FOREIGN KEY (author_id) REFERENCES users(id)
 * );
 * ```
 *
 * Run migration:
 * ```bash
 * wrangler d1 execute supabase-db --file=./migrations/0001_initial.sql
 * ```
 */
