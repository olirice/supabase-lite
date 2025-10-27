/**
 * Auth Context Middleware
 *
 * Extracts authentication information from JWT token
 * and injects a RequestContext with role and user ID.
 *
 * Supports both anon keys (role=anon) and user tokens (role=authenticated).
 */

import type { AuthProvider, RequestContext } from '../auth/types.js';
import type { Middleware, ContextRequest } from './types.js';
import { verifyJWT } from '../auth/jwt.js';
import { ROLE_ANON, ROLE_AUTHENTICATED } from '../utils/constants.js';

/**
 * Create auth context middleware
 *
 * Extracts JWT token from headers, decodes it, and injects RequestContext.
 * The JWT role field determines the context role.
 *
 * - role=anon → role: 'anon', uid: undefined
 * - role=authenticated → role: 'authenticated', uid: <user-id>
 */
export function authContextMiddleware(
  authProvider: AuthProvider,
  jwtSecret: string
): Middleware {
  return async (request: ContextRequest): Promise<Response | null> => {
    let role: 'anon' | 'authenticated' = ROLE_ANON;
    let uid: string | undefined;

    // Try to extract JWT from headers
    let token: string | null = null;

    // Check Authorization header FIRST (user token after login)
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      // Try to extract from "Bearer <token>" format
      const match = /^Bearer\s+(.+)$/i.exec(authHeader);
      if (match) {
        token = match[1];
      } else {
        // If no Bearer prefix, treat entire header as token
        token = authHeader;
      }
    }

    // Fall back to apikey header if no Authorization (anonymous/initial requests)
    if (!token) {
      const apikeyHeader = request.headers.get('apikey');
      if (apikeyHeader) {
        token = apikeyHeader;
      }
    }

    // Decode JWT to extract role and user ID
    if (token) {
      const payload = verifyJWT(token, jwtSecret);

      if (payload) {
        // Extract role from JWT
        if (payload.role === ROLE_AUTHENTICATED) {
          role = ROLE_AUTHENTICATED;
          uid = payload.sub;
        } else if (payload.role === ROLE_ANON) {
          role = ROLE_ANON;
          uid = undefined;
        }
        // service_role is treated as anon for RLS purposes (can be extended later)
      }
    }

    // Create immutable context
    const context: RequestContext = Object.freeze({
      role,
      uid,
    });

    // Inject context into request
    request.context = context;

    // Continue processing
    return null;
  };
}
