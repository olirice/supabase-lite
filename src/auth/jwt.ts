/**
 * JWT Utilities
 *
 * Helper functions for creating and verifying JWTs compatible with Supabase.
 * Supports both anon keys (role=anon) and authenticated user tokens (role=authenticated).
 */

import jwt from 'jsonwebtoken';

/**
 * JWT payload for API keys and user tokens
 */
export interface JWTPayload {
  /** Issuer - typically the project URL */
  iss?: string;
  /** Subject - user ID for authenticated tokens, undefined for anon */
  sub?: string;
  /** Role - either "anon", "authenticated", or "service_role" */
  role: 'anon' | 'authenticated' | 'service_role';
  /** Issued at timestamp */
  iat?: number;
  /** Expiration timestamp */
  exp?: number;
  /** User email (for authenticated tokens) */
  email?: string;
}

/**
 * Generate an anon key JWT
 *
 * This creates a long-lived JWT with role="anon" that acts as the public API key.
 * Compatible with Supabase's anon key format.
 *
 * @param secret - JWT signing secret
 * @param expiresInYears - Expiration time in years (default: 10)
 * @returns Signed JWT string
 */
export function generateAnonKey(secret: string, expiresInYears: number = 10): string {
  const payload: JWTPayload = {
    role: 'anon',
    iss: 'supabase',
  };

  return jwt.sign(payload, secret, {
    expiresIn: `${expiresInYears}y`,
  });
}

/**
 * Generate a service role key JWT
 *
 * This creates a long-lived JWT with role="service_role" for admin access.
 * Compatible with Supabase's service_role key format.
 *
 * @param secret - JWT signing secret
 * @param expiresInYears - Expiration time in years (default: 10)
 * @returns Signed JWT string
 */
export function generateServiceRoleKey(secret: string, expiresInYears: number = 10): string {
  const payload: JWTPayload = {
    role: 'service_role',
    iss: 'supabase',
  };

  return jwt.sign(payload, secret, {
    expiresIn: `${expiresInYears}y`,
  });
}

/**
 * Generate an authenticated user token
 *
 * Creates a short-lived JWT for an authenticated user.
 * Compatible with Supabase's user token format.
 *
 * @param userId - User ID
 * @param secret - JWT signing secret
 * @param expiresInSeconds - Expiration time in seconds (default: 3600)
 * @param jti - Optional unique token ID (generated if not provided)
 * @returns Signed JWT string
 */
export function generateUserToken(
  userId: string,
  secret: string,
  expiresInSeconds: number = 3600,
  jti?: string
): string {
  const payload: any = {
    sub: userId,
    role: 'authenticated',
    iss: 'supabase',
  };

  // Add jti if provided (for uniqueness)
  if (jti) {
    payload.jti = jti;
  }

  return jwt.sign(payload, secret, {
    expiresIn: expiresInSeconds,
  });
}

/**
 * Verify and decode a JWT
 *
 * @param token - JWT string to verify
 * @param secret - JWT signing secret
 * @returns Decoded payload or null if invalid
 */
export function verifyJWT(token: string, secret: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, secret) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Decode a JWT without verifying (for debugging)
 *
 * @param token - JWT string to decode
 * @returns Decoded payload or null if invalid format
 */
export function decodeJWT(token: string): JWTPayload | null {
  try {
    const decoded = jwt.decode(token) as JWTPayload;
    return decoded;
  } catch (error) {
    return null;
  }
}
