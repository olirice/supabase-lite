/**
 * GoTrue-Compatible Auth Adapter
 *
 * Optional module that provides Supabase GoTrue-compatible endpoints.
 * This allows using the official Supabase client's auth methods.
 *
 * GoTrue API Reference:
 * - POST /auth/v1/signup - Create new user
 * - POST /auth/v1/token?grant_type=password - Login (password grant)
 * - GET /auth/v1/user - Get current user info
 *
 * This is separate from core PostgREST-Lite to keep the library modular.
 */

import type { Hono, Context } from 'hono';
import type { SqliteAuthProvider } from './provider.js';

/**
 * GoTrue configuration type
 */
export interface GoTrueConfig {
  /** Base path for auth routes (default: '/auth/v1') */
  basePath?: string;
  /** Session duration in seconds (default: 3600) */
  sessionDuration?: number;
}

/**
 * GoTrue session response format
 */
export interface GoTrueSession {
  access_token: string;
  token_type: 'bearer';
  expires_in: number;
  expires_at: number;
  refresh_token: string;
  user: GoTrueUser;
}

/**
 * GoTrue user format
 */
export interface GoTrueUser {
  id: string;
  aud: string;
  role: string;
  email?: string;
  email_confirmed_at?: string;
  phone?: string;
  confirmed_at?: string;
  last_sign_in_at?: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities?: unknown[];
  created_at: string;
  updated_at: string;
}

/**
 * Mount GoTrue-compatible auth endpoints to a Hono app
 *
 * @param app - Hono app instance
 * @param authProvider - Auth provider for user management
 * @param options - Configuration options
 */
export function mountGoTrueRoutes(
  app: Hono,
  authProvider: SqliteAuthProvider,
  options: GoTrueConfig = {}
): void {
  const basePath = options.basePath ?? '/auth/v1';
  const sessionDuration = options.sessionDuration ?? 3600;

  /**
   * POST /auth/v1/signup
   * Create a new user account
   *
   * Body: { email: string, password: string, data?: object }
   * Response: GoTrueSession
   */
  app.post(`${basePath}/signup`, async (c: Context) => {
    try {
      const body = await c.req.json();
      const { email, password, data } = body;

      // Validate required fields
      if (!email || !password) {
        return c.json(
          {
            error: 'invalid_request',
            error_description: 'Email and password are required',
          },
          400
        );
      }

      // Create user (using email as username for compatibility)
      const user = await authProvider.signup(email, password);

      // Generate session token
      const session = await authProvider.login(email, password);

      // Format as GoTrue response
      const goTrueSession: GoTrueSession = {
        access_token: session.token,
        token_type: 'bearer',
        expires_in: sessionDuration,
        expires_at: Math.floor(Date.now() / 1000) + sessionDuration,
        refresh_token: session.token, // Using same token for simplicity
        user: formatUserAsGoTrue(user, data),
      };

      return c.json(goTrueSession, 201);
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        return c.json(
          {
            error: 'user_already_exists',
            error_description: 'User already registered',
          },
          422
        );
      }

      return c.json(
        {
          error: 'internal_server_error',
          error_description: error.message,
        },
        500
      );
    }
  });

  /**
   * POST /auth/v1/token?grant_type=password
   * Login with email and password
   *
   * Body: { email: string, password: string }
   * Response: GoTrueSession
   *
   * Note: Modern Supabase clients may call this without grant_type query param
   */
  app.post(`${basePath}/token`, async (c: Context) => {
    try {
      const grantType = c.req.query('grant_type');

      // Modern Supabase clients don't send grant_type for password auth
      // If grant_type is provided and it's not 'password', reject it
      if (grantType && grantType !== 'password') {
        return c.json(
          {
            error: 'unsupported_grant_type',
            error_description: 'Only password grant type is supported',
          },
          400
        );
      }

      const body = await c.req.json();
      const { email, password } = body;

      if (!email || !password) {
        return c.json(
          {
            error: 'invalid_request',
            error_description: 'Email and password are required',
          },
          400
        );
      }

      // Authenticate user (using email as username)
      const session = await authProvider.login(email, password);

      // Format as GoTrue response
      const goTrueSession: GoTrueSession = {
        access_token: session.token,
        token_type: 'bearer',
        expires_in: sessionDuration,
        expires_at: Math.floor(Date.now() / 1000) + sessionDuration,
        refresh_token: session.token, // Using same token for simplicity
        user: formatUserAsGoTrue(session.user),
      };

      return c.json(goTrueSession, 200);
    } catch (error: any) {
      if (error.message.includes('Invalid credentials')) {
        return c.json(
          {
            error: 'invalid_grant',
            error_description: 'Invalid login credentials',
          },
          400
        );
      }

      return c.json(
        {
          error: 'internal_server_error',
          error_description: error.message,
        },
        500
      );
    }
  });

  /**
   * GET /auth/v1/user
   * Get current user from JWT token
   *
   * Headers: Authorization: Bearer <token>
   * Response: GoTrueUser
   */
  app.get(`${basePath}/user`, async (c: Context) => {
    try {
      // Get JWT from Authorization header
      const authHeader = c.req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json(
          {
            error: 'invalid_token',
            error_description: 'Invalid or missing authorization token',
          },
          401
        );
      }

      const token = authHeader.substring(7); // Remove 'Bearer '

      // Verify session (checks both JWT and database)
      const user = await authProvider.verifySession(token);

      if (!user) {
        return c.json(
          {
            error: 'invalid_token',
            error_description: 'Invalid or expired token',
          },
          401
        );
      }

      // Format as GoTrue user
      const goTrueUser: GoTrueUser = {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.username, // Using username as email
        confirmed_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return c.json({ user: goTrueUser }, 200);
    } catch (error: any) {
      return c.json(
        {
          error: 'invalid_token',
          error_description: 'Invalid or expired token',
        },
        401
      );
    }
  });

  /**
   * POST /auth/v1/logout
   * Sign out the current user (invalidate session)
   *
   * Headers: Authorization: Bearer <token>
   * Response: 204 No Content
   */
  app.post(`${basePath}/logout`, async (c: Context) => {
    // Get JWT from Authorization header
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json(
        {
          error: 'invalid_token',
          error_description: 'Invalid or missing authorization token',
        },
        401
      );
    }

    const token = authHeader.substring(7); // Remove 'Bearer '

    // Invalidate the session (idempotent - doesn't throw if token doesn't exist)
    await authProvider.logout(token);

    // Return 204 No Content (successful logout)
    return new Response(null, { status: 204 });
  });
}

/**
 * Convert internal user format to GoTrue format
 */
function formatUserAsGoTrue(
  user: { id: string; username: string },
  metadata?: Record<string, unknown>
): GoTrueUser {
  const now = new Date().toISOString();

  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.username, // Using username as email
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: {},
    user_metadata: metadata || {},
    identities: [],
    created_at: now,
    updated_at: now,
  };
}
