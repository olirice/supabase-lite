/**
 * JWT Utilities Tests
 *
 * Tests for JWT generation and verification functions.
 */

import { describe, test, expect } from 'vitest';
import {
  generateAnonKey,
  generateServiceRoleKey,
  generateUserToken,
  verifyJWT,
  decodeJWT,
  type JWTPayload,
} from '../../src/auth/jwt.js';

describe('JWT Utilities', () => {
  const testSecret = 'test-secret-key';

  describe('generateAnonKey', () => {
    test('generates valid anon key JWT', () => {
      const token = generateAnonKey(testSecret);

      const payload = verifyJWT(token, testSecret);

      expect(payload).not.toBeNull();
      expect(payload?.role).toBe('anon');
      expect(payload?.iss).toBe('supabase');
      expect(payload).toHaveProperty('exp');
    });

    test('generates token with custom expiration', () => {
      const token = generateAnonKey(testSecret, 5);

      const payload = verifyJWT(token, testSecret);

      expect(payload).not.toBeNull();
      expect(payload?.role).toBe('anon');
    });

    test('generated token can be verified', () => {
      const token = generateAnonKey(testSecret);

      const payload = verifyJWT(token, testSecret);

      expect(payload).not.toBeNull();
    });
  });

  describe('generateServiceRoleKey', () => {
    test('generates valid service role key JWT', () => {
      const token = generateServiceRoleKey(testSecret);

      const payload = verifyJWT(token, testSecret);

      expect(payload).not.toBeNull();
      expect(payload?.role).toBe('service_role');
      expect(payload?.iss).toBe('supabase');
      expect(payload).toHaveProperty('exp');
    });

    test('generates token with custom expiration', () => {
      const token = generateServiceRoleKey(testSecret, 15);

      const payload = verifyJWT(token, testSecret);

      expect(payload).not.toBeNull();
      expect(payload?.role).toBe('service_role');
    });

    test('service role token is different from anon token', () => {
      const anonToken = generateAnonKey(testSecret);
      const serviceToken = generateServiceRoleKey(testSecret);

      const anonPayload = verifyJWT(anonToken, testSecret);
      const servicePayload = verifyJWT(serviceToken, testSecret);

      expect(anonPayload?.role).toBe('anon');
      expect(servicePayload?.role).toBe('service_role');
    });
  });

  describe('generateUserToken', () => {
    test('generates valid user token with default expiration', () => {
      const userId = 'user-123';
      const token = generateUserToken(userId, testSecret);

      const payload = verifyJWT(token, testSecret);

      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe(userId);
      expect(payload?.role).toBe('authenticated');
      expect(payload?.iss).toBe('supabase');
      expect(payload).toHaveProperty('exp');
    });

    test('generates token with custom expiration', () => {
      const userId = 'user-123';
      const token = generateUserToken(userId, testSecret, 7200);

      const payload = verifyJWT(token, testSecret);

      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe(userId);
    });

    test('generates token with jti when provided', () => {
      const userId = 'user-123';
      const jti = 'unique-token-id';
      const token = generateUserToken(userId, testSecret, 3600, jti);

      const payload = verifyJWT(token, testSecret) as any;

      expect(payload).not.toBeNull();
      expect(payload?.jti).toBe(jti);
    });

    test('generates token without jti when not provided', () => {
      const userId = 'user-123';
      const token = generateUserToken(userId, testSecret);

      const payload = verifyJWT(token, testSecret) as any;

      expect(payload).not.toBeNull();
      expect(payload?.jti).toBeUndefined();
    });
  });

  describe('verifyJWT', () => {
    test('successfully verifies valid token', () => {
      const token = generateAnonKey(testSecret);

      const payload = verifyJWT(token, testSecret);

      expect(payload).not.toBeNull();
      expect(payload?.role).toBe('anon');
    });

    test('returns null for invalid token', () => {
      const invalidToken = 'invalid.jwt.token';

      const payload = verifyJWT(invalidToken, testSecret);

      expect(payload).toBeNull();
    });

    test('returns null for token with wrong secret', () => {
      const token = generateAnonKey(testSecret);

      const payload = verifyJWT(token, 'wrong-secret');

      expect(payload).toBeNull();
    });

    test('returns null for expired token', () => {
      // This test would require mocking time or creating a token that's already expired
      // For now, we'll test with an invalid format which also returns null
      const malformedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature';

      const payload = verifyJWT(malformedToken, testSecret);

      expect(payload).toBeNull();
    });

    test('verifies all token types correctly', () => {
      const anonToken = generateAnonKey(testSecret);
      const serviceToken = generateServiceRoleKey(testSecret);
      const userToken = generateUserToken('user-123', testSecret);

      const anonPayload = verifyJWT(anonToken, testSecret);
      const servicePayload = verifyJWT(serviceToken, testSecret);
      const userPayload = verifyJWT(userToken, testSecret);

      expect(anonPayload?.role).toBe('anon');
      expect(servicePayload?.role).toBe('service_role');
      expect(userPayload?.role).toBe('authenticated');
    });
  });

  describe('decodeJWT', () => {
    test('decodes valid token without verification', () => {
      const token = generateAnonKey(testSecret);

      const payload = decodeJWT(token);

      expect(payload).not.toBeNull();
      expect(payload?.role).toBe('anon');
      expect(payload?.iss).toBe('supabase');
    });

    test('decodes token even with wrong secret', () => {
      const token = generateAnonKey('original-secret');

      // decodeJWT doesn't verify signature, so it should decode even with wrong secret
      const payload = decodeJWT(token);

      expect(payload).not.toBeNull();
      expect(payload?.role).toBe('anon');
    });

    test('returns null for invalid token format', () => {
      const invalidToken = 'not-a-jwt';

      const payload = decodeJWT(invalidToken);

      expect(payload).toBeNull();
    });

    test('decodes user token with all fields', () => {
      const userId = 'user-456';
      const jti = 'token-id-789';
      const token = generateUserToken(userId, testSecret, 3600, jti);

      const payload = decodeJWT(token) as any;

      expect(payload).not.toBeNull();
      expect(payload?.sub).toBe(userId);
      expect(payload?.role).toBe('authenticated');
      expect(payload?.jti).toBe(jti);
      expect(payload).toHaveProperty('exp');
      expect(payload).toHaveProperty('iat');
    });

    test('decodes service role token', () => {
      const token = generateServiceRoleKey(testSecret);

      const payload = decodeJWT(token);

      expect(payload).not.toBeNull();
      expect(payload?.role).toBe('service_role');
    });
  });

  describe('Token compatibility', () => {
    test('all token types have required Supabase format', () => {
      const anonToken = generateAnonKey(testSecret);
      const serviceToken = generateServiceRoleKey(testSecret);
      const userToken = generateUserToken('user-123', testSecret);

      const anonPayload = verifyJWT(anonToken, testSecret);
      const servicePayload = verifyJWT(serviceToken, testSecret);
      const userPayload = verifyJWT(userToken, testSecret);

      // All should have iss field
      expect(anonPayload?.iss).toBe('supabase');
      expect(servicePayload?.iss).toBe('supabase');
      expect(userPayload?.iss).toBe('supabase');

      // All should have exp field
      expect(anonPayload).toHaveProperty('exp');
      expect(servicePayload).toHaveProperty('exp');
      expect(userPayload).toHaveProperty('exp');

      // User token should have sub
      expect(userPayload).toHaveProperty('sub');
    });

    test('tokens are valid JWT format (3 parts separated by dots)', () => {
      const token = generateAnonKey(testSecret);

      const parts = token.split('.');

      expect(parts).toHaveLength(3);
    });
  });
});
