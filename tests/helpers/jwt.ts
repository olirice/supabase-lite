/**
 * Test helpers for JWT generation
 */

import { generateAnonKey, generateServiceRoleKey } from '../../src/auth/jwt.js';

/**
 * Default test JWT secret
 */
export const TEST_JWT_SECRET = 'test-jwt-secret-for-testing-only';

/**
 * Generate a test anon key
 */
export function createTestAnonKey(secret: string = TEST_JWT_SECRET): string {
  return generateAnonKey(secret);
}

/**
 * Generate a test service role key
 */
export function createTestServiceRoleKey(secret: string = TEST_JWT_SECRET): string {
  return generateServiceRoleKey(secret);
}
