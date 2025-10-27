/**
 * Middleware Module
 *
 * HTTP middleware for authentication, authorization, and request context.
 * Integrates with Hono framework to provide JWT verification and role-based access.
 */

// Authentication Middleware
export { anonKeyMiddleware } from './anon-key.js';
export { authContextMiddleware } from './auth-context.js';

// Types
export type { Middleware, AuthMiddleware } from './types.js';
