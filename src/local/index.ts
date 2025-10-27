/**
 * Local Development Server
 *
 * Runs the API server locally with better-sqlite3.
 * Perfect for development, testing, and local experimentation.
 *
 * Usage:
 *   npm run dev
 *
 * Or programmatically:
 *   import { startServer } from './src/local/index.js';
 *   const server = await startServer({ port: 3000 });
 */

import { serve } from '@hono/node-server';
import Database from 'better-sqlite3';
import { createServer } from '../api/server.js';
import { SqliteAdapter } from '../database/sqlite-adapter.js';

/**
 * Local server configuration
 */
export interface LocalServerConfig {
  readonly port?: number;
  readonly databasePath?: string; // Path to SQLite file, or ':memory:'
  readonly cors?: {
    readonly origin?: string | string[];
    readonly credentials?: boolean;
  };
  readonly onStart?: (port: number) => void;
}

/**
 * Start the local development server
 */
export async function startServer(config: LocalServerConfig = {}): Promise<{
  stop: () => void;
  adapter: SqliteAdapter;
}> {
  const port = config.port ?? 3000;
  const databasePath = config.databasePath ?? ':memory:';

  // Create SQLite database
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');

  const adapter = new SqliteAdapter(db);

  // Create Hono app
  const serverConfig: { db: SqliteAdapter; cors?: { readonly origin?: string | string[]; readonly credentials?: boolean } } = {
    db: adapter,
  };
  if (config.cors !== undefined) {
    serverConfig.cors = config.cors;
  }
  const app = createServer(serverConfig);

  // Start server
  const server = serve({
    fetch: app.fetch,
    port,
  });

  if (config.onStart) {
    config.onStart(port);
  } else {
    console.log(`🚀 PostgREST-Lite server running on http://localhost:${port}`);
    console.log(`   Database: ${databasePath}`);
    console.log(`   Health check: http://localhost:${port}/health`);
  }

  return {
    stop: () => {
      server.close();
      adapter.close();
    },
    adapter,
  };
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
  const databasePath = process.env.DATABASE_PATH ?? 'data.db';

  startServer({
    port,
    databasePath,
    onStart: (p) => {
      console.log(`🚀 PostgREST-Lite server running on http://localhost:${p}`);
      console.log(`   Database: ${databasePath}`);
      console.log(`   Health check: http://localhost:${p}/health`);
      console.log('');
      console.log('📖 Example requests:');
      console.log(`   GET http://localhost:${p}/users`);
      console.log(`   GET http://localhost:${p}/users?select=id,name`);
      console.log(`   GET http://localhost:${p}/users?age=gte.18&order=age.desc`);
      console.log(`   GET http://localhost:${p}/posts?select=id,title,author(name,email)`);
      console.log('');
      console.log('Press Ctrl+C to stop');
    },
  }).catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
