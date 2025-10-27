/**
 * HTTP Server - Hono-based REST API
 *
 * Provides HTTP endpoints for PostgREST-style queries with optional auth and RLS.
 * Works on:
 * - Node.js (local development)
 * - Cloudflare Workers (production)
 * - Bun, Deno (alternative runtimes)
 *
 * Uses Hono framework for universal compatibility.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Context } from 'hono';
import type Database from 'better-sqlite3';
import type { DatabaseAdapter } from '../database/index.js';
import { ApiService, ApiServiceError } from './service.js';
import type { ApiError } from './service.js';
import { SqliteAuthProvider } from '../auth/provider.js';
import { SqliteRLSProvider } from '../rls/storage.js';
import { RLSASTEnforcer } from '../rls/ast-enforcer.js';
import { anonKeyMiddleware } from '../middleware/anon-key.js';
import { authContextMiddleware } from '../middleware/auth-context.js';
import type { ContextRequest } from '../middleware/types.js';
import type { RequestContext } from '../auth/types.js';
import { mountGoTrueRoutes } from '../auth/gotrue-adapter.js';

/**
 * Hono app with auth context in variables
 */
type AppVariables = {
  authContext?: RequestContext;
};

/**
 * Server configuration
 */
export interface ServerConfig {
  readonly db: DatabaseAdapter;
  readonly cors?: {
    readonly origin?: string | string[];
    readonly credentials?: boolean;
  };
  readonly auth?: {
    readonly enabled: boolean;
    /** JWT signing secret */
    readonly jwtSecret: string;
    /** Anonymous API key (JWT with role=anon). If not provided, will be generated from jwtSecret */
    readonly anonKey?: string;
    /** Session duration in seconds (default: 3600) */
    readonly sessionDuration?: number;
    /** Enable GoTrue-compatible auth endpoints (/auth/v1/*) for Supabase client compatibility */
    readonly goTrue?: boolean;
  };
  readonly rls?: {
    readonly enabled: boolean;
  };
}

/**
 * System tables that should be hidden from REST API
 */
const SYSTEM_TABLES = new Set([
  'auth_users',
  'auth_sessions',
  '_rls_policies',
  '_rls_enabled_tables',
]);

/**
 * Create Hono app instance with PostgREST endpoints
 */
export function createServer(config: ServerConfig): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  // Initialize API service
  const service = new ApiService({ db: config.db });

  // Initialize auth and RLS if enabled
  let authProvider: SqliteAuthProvider | null = null;
  let rlsProvider: SqliteRLSProvider | null = null;
  let rlsEnforcer: RLSASTEnforcer | null = null;

  if (config.auth?.enabled) {
    // Get underlying SQLite database
    const sqliteDb = (config.db as any).db as Database.Database;
    const authConfig: { jwtSecret: string; sessionDuration?: number } = {
      jwtSecret: config.auth.jwtSecret,
    };
    if (config.auth.sessionDuration !== undefined) {
      authConfig.sessionDuration = config.auth.sessionDuration;
    }
    authProvider = new SqliteAuthProvider(sqliteDb, authConfig);
  }

  if (config.rls?.enabled) {
    const sqliteDb = (config.db as any).db as Database.Database;
    rlsProvider = new SqliteRLSProvider(sqliteDb);
    rlsEnforcer = new RLSASTEnforcer(rlsProvider);
  }

  // CORS middleware
  if (typeof config.cors !== 'boolean') {
    app.use('/*', cors({
      origin: config.cors?.origin ?? '*',
      credentials: config.cors?.credentials ?? false,
    }));
  }

  // Health check endpoint (before auth middleware so it's publicly accessible)
  app.get('/health', (c) => {
    return c.json({ status: 'ok' });
  });

  // Mount GoTrue-compatible auth endpoints BEFORE middleware (publicly accessible)
  if (config.auth?.enabled && config.auth.goTrue && authProvider) {
    const goTrueConfig: { basePath?: string; sessionDuration?: number } = {
      basePath: '/auth/v1',
    };
    if (config.auth.sessionDuration !== undefined) {
      goTrueConfig.sessionDuration = config.auth.sessionDuration;
    }
    mountGoTrueRoutes(app as any, authProvider, goTrueConfig);
  }

  // Anon key middleware (if auth is enabled)
  if (config.auth?.enabled) {
    app.use('/*', async (c, next) => {
      const middleware = anonKeyMiddleware({
        enabled: true,
        jwtSecret: config.auth!.jwtSecret,
      });

      const request = c.req.raw as ContextRequest;
      const result = middleware(request);

      if (result instanceof Response) {
        return result;
      }

      await next();
      return undefined;
    });
  }

  // Auth context middleware (if auth is enabled)
  if (config.auth?.enabled && authProvider) {
    app.use('/*', async (c, next) => {
      const middleware = authContextMiddleware(authProvider!, config.auth!.jwtSecret);

      const request = c.req.raw as ContextRequest;
      await middleware(request);

      // Store context in Hono context for later use
      c.set('authContext', request.context);

      await next();
    });
  }

  // Auth endpoints (if auth is enabled)
  if (config.auth?.enabled && authProvider) {
    // POST /auth/signup
    app.post('/auth/signup', async (c) => {
      try {
        const body = await c.req.json();
        const { username, password } = body;

        if (!username || !password) {
          return c.json({
            message: 'Username and password are required',
            code: 'VALIDATION_ERROR',
          }, 400);
        }

        const user = await authProvider!.signup(username, password);

        return c.json({ user }, 201);
      } catch (error: any) {
        if (error.message.includes('already exists')) {
          return c.json({
            message: error.message,
            code: 'DUPLICATE_USERNAME',
          }, 400);
        }

        return c.json({
          message: error.message,
          code: 'AUTH_ERROR',
        }, 400);
      }
    });

    // POST /auth/login
    app.post('/auth/login', async (c) => {
      try {
        const body = await c.req.json();
        const { username, password } = body;

        if (!username || !password) {
          return c.json({
            message: 'Username and password are required',
            code: 'VALIDATION_ERROR',
          }, 400);
        }

        const session = await authProvider!.login(username, password);

        return c.json({
          user: session.user,
          session: {
            token: session.token,
            expiresAt: session.expiresAt,
          },
        }, 200);
      } catch (error: any) {
        if (error.message.includes('Invalid credentials')) {
          return c.json({
            message: 'Invalid credentials',
            code: 'INVALID_CREDENTIALS',
          }, 401);
        }

        return c.json({
          message: error.message,
          code: 'AUTH_ERROR',
        }, 400);
      }
    });
  }

  // Helper function to create table query handler
  const createGetHandler = () => async (c: Context) => {
    try {
      const table = c.req.param('table');

      // Block access to system tables
      if (SYSTEM_TABLES.has(table)) {
        return c.json({
          message: 'Not found',
          code: 'NOT_FOUND',
        }, 404);
      }

      const queryString = c.req.url.split('?')[1] ?? '';

      // Parse Prefer header for count option
      const preferHeader = c.req.header('Prefer') ?? '';
      const includeCount = preferHeader.includes('count=exact') ||
                          preferHeader.includes('count=planned') ||
                          preferHeader.includes('count=estimated');

      // Build execution options with RLS enforcement if enabled
      let executionOptions: { rlsEnforcer?: RLSASTEnforcer; requestContext?: RequestContext; includeCount?: boolean } = {};

      if (includeCount) {
        executionOptions.includeCount = true;
      }

      if (config.rls?.enabled && rlsEnforcer) {
        const ctx = c.get('authContext') as RequestContext | undefined;
        executionOptions.rlsEnforcer = rlsEnforcer;
        if (ctx !== undefined) {
          executionOptions.requestContext = ctx;
        }
      }

      const response = await service.execute(
        {
          table,
          queryString,
        },
        executionOptions
      );

      // Add Content-Range header if count was requested
      const jsonResponse = c.json(response.data);
      if (includeCount && response.totalCount !== undefined) {
        const contentRange = buildContentRange(response.data.length, response.totalCount, queryString);
        jsonResponse.headers.set('Content-Range', contentRange);
      }

      return jsonResponse;
    } catch (error) {
      return handleError(c, error);
    }
  };

  // Main query endpoint: GET /:table
  // Also supports Supabase-style /rest/v1/:table for client compatibility
  const getHandler = createGetHandler();
  app.get('/:table', getHandler);
  app.get('/rest/v1/:table', getHandler);

  // Helper function to create HEAD handler (same as GET but returns empty body)
  const createHeadHandler = () => async (c: Context) => {
    try {
      const table = c.req.param('table');

      // Block access to system tables
      if (SYSTEM_TABLES.has(table)) {
        return new Response(null, { status: 404 });
      }

      const queryString = c.req.url.split('?')[1] ?? '';

      // Parse Prefer header for count option
      const preferHeader = c.req.header('Prefer') ?? '';
      const includeCount = preferHeader.includes('count=exact') ||
                          preferHeader.includes('count=planned') ||
                          preferHeader.includes('count=estimated');

      // Build execution options with RLS enforcement if enabled
      let executionOptions: { rlsEnforcer?: RLSASTEnforcer; requestContext?: RequestContext; includeCount?: boolean } = {};

      if (includeCount) {
        executionOptions.includeCount = true;
      }

      if (config.rls?.enabled && rlsEnforcer) {
        const ctx = c.get('authContext') as RequestContext | undefined;
        executionOptions.rlsEnforcer = rlsEnforcer;
        if (ctx !== undefined) {
          executionOptions.requestContext = ctx;
        }
      }

      const response = await service.execute(
        {
          table,
          queryString,
        },
        executionOptions
      );

      // Create response with headers but no body
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add Content-Range header if count was requested
      if (includeCount && response.totalCount !== undefined) {
        const contentRange = buildContentRange(response.data.length, response.totalCount, queryString);
        headers['Content-Range'] = contentRange;
      }

      return new Response(null, { status: 200, headers });
    } catch (error) {
      return handleError(c, error);
    }
  };

  // HEAD endpoint: HEAD /:table
  // Also supports Supabase-style /rest/v1/:table for client compatibility
  const headHandler = createHeadHandler();
  app.on('HEAD', '/:table', headHandler);
  app.on('HEAD', '/rest/v1/:table', headHandler);

  // Helper function to create insert handler
  const createPostHandler = () => async (c: Context) => {
    try {
      const table = c.req.param('table');

      // Block access to system tables
      if (SYSTEM_TABLES.has(table)) {
        return c.json({
          message: 'Not found',
          code: 'NOT_FOUND',
        }, 404);
      }

      // Parse JSON body
      let body;
      try {
        body = await c.req.json();
      } catch (jsonError) {
        const errorResponse: ApiError = {
          message: 'Invalid JSON in request body',
          code: 'INVALID_JSON',
        };
        return c.json(errorResponse, 400);
      }

      // Validate body is not empty
      if (body === undefined || body === null || body === '') {
        const errorResponse: ApiError = {
          message: 'Request body cannot be empty',
          code: 'EMPTY_BODY',
        };
        return c.json(errorResponse, 400);
      }

      // Build execution options with RLS enforcement if enabled
      let executionOptions: { rlsEnforcer: RLSASTEnforcer; requestContext?: RequestContext } | undefined;
      if (config.rls?.enabled && rlsEnforcer) {
        const ctx = c.get('authContext') as RequestContext | undefined;
        executionOptions = { rlsEnforcer };
        if (ctx !== undefined) {
          executionOptions.requestContext = ctx;
        }
      }

      // Execute INSERT
      const response = await service.insert(table, body, executionOptions);

      // Parse Prefer header
      const prefer = c.req.header('Prefer') ?? 'return=representation';
      const returnMinimal = prefer.includes('return=minimal');

      // Generate Location header for single insert
      let locationHeader: string | undefined;
      if (!Array.isArray(body) && response.data.length === 1) {
        const row = response.data[0] as any;
        const id = row.id;
        if (id !== undefined) {
          locationHeader = `/${table}?id=eq.${id}`;
        }
      }

      // Return appropriate response
      if (returnMinimal) {
        const headers: Record<string, string> = {};
        if (locationHeader) {
          headers['Location'] = locationHeader;
        }
        return new Response(null, { status: 201, headers });
      } else {
        const jsonResponse = c.json(response.data, 201);
        if (locationHeader) {
          jsonResponse.headers.set('Location', locationHeader);
        }
        return jsonResponse;
      }
    } catch (error) {
      return handleError(c, error);
    }
  };

  // INSERT endpoint: POST /:table
  // Also supports Supabase-style /rest/v1/:table for client compatibility
  const postHandler = createPostHandler();
  app.post('/:table', postHandler);
  app.post('/rest/v1/:table', postHandler);

  // Helper function to create update handler
  const createPatchHandler = () => async (c: Context) => {
    try {
      const table = c.req.param('table');

      // Block access to system tables
      if (SYSTEM_TABLES.has(table)) {
        return c.json({
          message: 'Not found',
          code: 'NOT_FOUND',
        }, 404);
      }

      const queryString = c.req.url.split('?')[1] ?? '';

      // Parse JSON body
      let body;
      try {
        body = await c.req.json();
      } catch (jsonError) {
        const errorResponse: ApiError = {
          message: 'Invalid JSON in request body',
          code: 'INVALID_JSON',
        };
        return c.json(errorResponse, 400);
      }

      // Build execution options with RLS enforcement if enabled
      let executionOptions: { rlsEnforcer: RLSASTEnforcer; requestContext?: RequestContext } | undefined;
      if (config.rls?.enabled && rlsEnforcer) {
        const ctx = c.get('authContext') as RequestContext | undefined;
        executionOptions = { rlsEnforcer };
        if (ctx !== undefined) {
          executionOptions.requestContext = ctx;
        }
      }

      // Execute UPDATE
      const response = await service.update(
        {
          table,
          queryString,
        },
        body,
        executionOptions
      );

      // Parse Prefer header
      const prefer = c.req.header('Prefer') ?? 'return=representation';
      const returnMinimal = prefer.includes('return=minimal');

      // Return appropriate response
      if (returnMinimal) {
        return new Response(null, { status: 204 });
      } else {
        return c.json(response.data, 200);
      }
    } catch (error) {
      return handleError(c, error);
    }
  };

  // UPDATE endpoint: PATCH /:table
  // Also supports Supabase-style /rest/v1/:table for client compatibility
  const patchHandler = createPatchHandler();
  app.patch('/:table', patchHandler);
  app.patch('/rest/v1/:table', patchHandler);

  // Helper function to create delete handler
  const createDeleteHandler = () => async (c: Context) => {
    try {
      const table = c.req.param('table');

      // Block access to system tables
      if (SYSTEM_TABLES.has(table)) {
        return c.json({
          message: 'Not found',
          code: 'NOT_FOUND',
        }, 404);
      }

      const queryString = c.req.url.split('?')[1] ?? '';

      // Build execution options with RLS enforcement if enabled
      let executionOptions: { rlsEnforcer: RLSASTEnforcer; requestContext?: RequestContext } | undefined;
      if (config.rls?.enabled && rlsEnforcer) {
        const ctx = c.get('authContext') as RequestContext | undefined;
        executionOptions = { rlsEnforcer };
        if (ctx !== undefined) {
          executionOptions.requestContext = ctx;
        }
      }

      // Execute DELETE
      const response = await service.delete(
        {
          table,
          queryString,
        },
        executionOptions
      );

      // Parse Prefer header (default to minimal for DELETE)
      const prefer = c.req.header('Prefer') ?? 'return=minimal';
      const returnMinimal = prefer.includes('return=minimal');

      // Return appropriate response
      if (returnMinimal) {
        return new Response(null, { status: 204 });
      } else {
        return c.json(response.data, 200);
      }
    } catch (error) {
      return handleError(c, error);
    }
  };

  // DELETE endpoint: DELETE /:table
  // Also supports Supabase-style /rest/v1/:table for client compatibility
  const deleteHandler = createDeleteHandler();
  app.delete('/:table', deleteHandler);
  app.delete('/rest/v1/:table', deleteHandler);

  // Error handler
  app.onError((err, c) => {
    console.error('Server error:', err);

    const errorResponse: ApiError = {
      message: err.message || 'Internal server error',
      code: 'INTERNAL_SERVER_ERROR',
    };

    return c.json(errorResponse, 500);
  });

  // 404 handler
  app.notFound((c) => {
    const errorResponse: ApiError = {
      message: 'Not found',
      code: 'NOT_FOUND',
    };

    return c.json(errorResponse, 404);
  });

  return app;
}

/**
 * Handle errors and return appropriate HTTP response
 */
function handleError(c: any, error: unknown): Response {
  if (error instanceof ApiServiceError) {
    const status = getHttpStatus(error.code);
    return c.json(error.toJSON(), status);
  }

  if (error instanceof Error) {
    const errorResponse: ApiError = {
      message: error.message,
      code: 'QUERY_ERROR',
    };
    return c.json(errorResponse, 400);
  }

  const errorResponse: ApiError = {
    message: 'Unknown error',
    code: 'UNKNOWN_ERROR',
  };

  return c.json(errorResponse, 500);
}

/**
 * Map error codes to HTTP status codes
 */
function getHttpStatus(code: string): number {
  switch (code) {
    case 'TABLE_NOT_FOUND':
      return 404;
    case 'VALIDATION_ERROR':
    case 'QUERY_ERROR':
      return 400;
    case 'SCHEMA_INTROSPECTION_FAILED':
      return 500;
    default:
      return 500;
  }
}

/**
 * Build Content-Range header for pagination
 * Format: "start-end/total" or "star/total" for empty results
 *
 * @param rowCount - Number of rows returned
 * @param totalCount - Total rows matching the query
 * @param queryString - Query string to extract offset
 * @returns Content-Range header value
 */
function buildContentRange(rowCount: number, totalCount: number, queryString: string): string {
  // Parse offset from query string
  const offsetMatch = queryString.match(/[?&]offset=(\d+)/);
  const offset = offsetMatch ? parseInt(offsetMatch[1]!, 10) : 0;

  // If no rows returned, use "star/total" format
  if (rowCount === 0) {
    return `*/${totalCount}`;
  }

  // Calculate range: start-end/total
  const start = offset;
  const end = offset + rowCount - 1;

  return `${start}-${end}/${totalCount}`;
}
