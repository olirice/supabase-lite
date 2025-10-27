/**
 * Authentication Module
 *
 * Provides JWT-based authentication and Supabase GoTrue-compatible endpoints.
 * Includes user management, session handling, and token generation.
 */

// Auth Provider
export { SqliteAuthProvider, type SqliteAuthConfig } from './provider.js';

// JWT Utilities
export {
  generateAnonKey,
  generateServiceRoleKey,
  generateUserToken,
  verifyJWT,
  decodeJWT,
  type JWTPayload,
} from './jwt.js';

// GoTrue Adapter
export { mountGoTrueRoutes, type GoTrueConfig } from './gotrue-adapter.js';

// Types
export type { AuthProvider, AuthUser, AuthSession, RequestContext } from './types.js';
