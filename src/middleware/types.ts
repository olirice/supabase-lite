/**
 * Middleware Type Definitions
 *
 * Defines the middleware pattern for request processing.
 */

import type { RequestContext } from '../auth/types.js';

/**
 * Extended request with auth context
 */
export interface ContextRequest extends Request {
  /** Auth context (injected by middleware) */
  context?: RequestContext;
}

/**
 * Middleware function type
 * Returns a Response to short-circuit, or null to continue
 */
export type Middleware = (
  request: ContextRequest
) => Promise<Response | null> | Response | null;

/**
 * Auth middleware type (alias for Middleware)
 */
export type AuthMiddleware = Middleware;

/**
 * Middleware configuration
 */
export interface MiddlewareConfig {
  /** Anon key validator */
  anonKey?: {
    enabled: boolean;
    key: string;
  };

  /** Auth context injector */
  auth?: {
    enabled: boolean;
    jwtSecret: string;
  };

  /** RLS enforcer */
  rls?: {
    enabled: boolean;
  };
}
