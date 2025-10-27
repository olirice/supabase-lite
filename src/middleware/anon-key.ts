/**
 * Anonymous API Key Middleware
 *
 * Validates that all requests include a valid JWT.
 * The JWT can be:
 * - An anon key (role=anon) - long-lived, public API key
 * - A user token (role=authenticated) - short-lived, per-user
 * - A service role key (role=service_role) - admin access
 *
 * This is the first line of defense for API security.
 */

import type { Middleware, ContextRequest } from './types.js';
import { verifyJWT } from '../auth/jwt.js';

/**
 * Anon key middleware configuration
 */
export interface AnonKeyConfig {
  /** Whether anon key validation is enabled */
  enabled?: boolean;

  /** The JWT signing secret used to verify all tokens */
  jwtSecret: string;
}

/**
 * Create anon key validation middleware
 *
 * Validates JWT tokens from either:
 * 1. `apikey` header
 * 2. `Authorization: Bearer <token>` header
 *
 * The JWT must be signed with the correct secret and have a valid role.
 * Returns 401 if no valid JWT is found.
 */
export function anonKeyMiddleware(config: AnonKeyConfig): Middleware {
  return (request: ContextRequest): Response | null => {
    // If disabled, allow all requests
    if (config.enabled === false) {
      return null;
    }

    // Try to extract JWT from headers
    let token: string | undefined;

    // Check apikey header first
    const apikeyHeader = request.headers.get('apikey');
    if (apikeyHeader) {
      token = apikeyHeader;
    }

    // Check Authorization Bearer header if no apikey
    if (!token) {
      const authHeader = request.headers.get('authorization');
      if (authHeader) {
        const match = /^Bearer\s+(.+)$/i.exec(authHeader);
        if (match) {
          token = match[1];
        }
      }
    }

    // No token found
    if (!token) {
      return new Response(
        JSON.stringify({
          message: 'Missing API key or authorization token',
          code: 'UNAUTHORIZED',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Verify JWT signature
    const payload = verifyJWT(token, config.jwtSecret);
    if (!payload) {
      return new Response(
        JSON.stringify({
          message: 'Invalid or expired token',
          code: 'UNAUTHORIZED',
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    }

    // Valid JWT - continue to next middleware
    return null;
  };
}
