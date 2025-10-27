/**
 * GoTrue Adapter Tests
 *
 * Tests for Supabase GoTrue-compatible auth endpoints.
 * These endpoints allow using the official Supabase client's auth methods.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { SqliteAuthProvider } from '../../src/auth/provider.js';
import { mountGoTrueRoutes } from '../../src/auth/gotrue-adapter.js';

describe('GoTrue Adapter', () => {
  let db: Database.Database;
  let authProvider: SqliteAuthProvider;
  let app: Hono;

  beforeEach(() => {
    db = new Database(':memory:');
    authProvider = new SqliteAuthProvider(db, {
      jwtSecret: 'test-secret',
      sessionDuration: 3600,
    });

    app = new Hono();
    mountGoTrueRoutes(app, authProvider);
  });

  describe('POST /auth/v1/signup', () => {
    test('creates new user and returns GoTrue session', async () => {
      const res = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data).toHaveProperty('access_token');
      expect(data).toHaveProperty('refresh_token');
      expect(data.token_type).toBe('bearer');
      expect(data.expires_in).toBe(3600);
      expect(data).toHaveProperty('expires_at');

      // Check user object
      expect(data.user).toHaveProperty('id');
      expect(data.user.email).toBe('test@example.com');
      expect(data.user.role).toBe('authenticated');
      expect(data.user.aud).toBe('authenticated');
    });

    test('includes user metadata in response', async () => {
      const metadata = { name: 'Test User', age: 30 };

      const res = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
          data: metadata,
        }),
      });

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.user.user_metadata).toEqual(metadata);
    });

    test('returns 400 when email is missing', async () => {
      const res = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'password123',
        }),
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('invalid_request');
      expect(data.error_description).toContain('Email and password are required');
    });

    test('returns 400 when password is missing', async () => {
      const res = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
        }),
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('invalid_request');
    });

    test('returns 422 when user already exists', async () => {
      // Create user first
      await authProvider.signup('test@example.com', 'password123');

      // Try to create again
      const res = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(422);

      const data = await res.json();
      expect(data.error).toBe('user_already_exists');
    });

    test('handles internal errors gracefully', async () => {
      // Close DB to simulate error
      db.close();

      const res = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(500);

      const data = await res.json();
      expect(data.error).toBe('internal_server_error');
    });
  });

  describe('POST /auth/v1/token', () => {
    beforeEach(async () => {
      // Create user for login tests
      await authProvider.signup('test@example.com', 'password123');
    });

    test('logs in with valid credentials', async () => {
      const res = await app.request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty('access_token');
      expect(data).toHaveProperty('refresh_token');
      expect(data.token_type).toBe('bearer');
      expect(data.user.email).toBe('test@example.com');
    });

    test('returns 400 for unsupported grant type', async () => {
      const res = await app.request('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('unsupported_grant_type');
    });

    test('returns 400 when email is missing', async () => {
      const res = await app.request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: 'password123',
        }),
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('invalid_request');
    });

    test('returns 400 when password is missing', async () => {
      const res = await app.request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
        }),
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('invalid_request');
    });

    test('returns 400 for invalid credentials', async () => {
      const res = await app.request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'wrongpassword',
        }),
      });

      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBe('invalid_grant');
      expect(data.error_description).toContain('Invalid login credentials');
    });

    test('handles internal errors gracefully', async () => {
      // Close DB to simulate error
      db.close();

      const res = await app.request('/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(500);

      const data = await res.json();
      expect(data.error).toBe('internal_server_error');
    });
  });

  describe('GET /auth/v1/user', () => {
    let validToken: string;

    beforeEach(async () => {
      // Create user and get token
      await authProvider.signup('test@example.com', 'password123');
      const session = await authProvider.login('test@example.com', 'password123');
      validToken = session.token;
    });

    test('returns user info for valid token', async () => {
      const res = await app.request('/auth/v1/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.user).toHaveProperty('id');
      expect(data.user.role).toBe('authenticated');
      expect(data.user.aud).toBe('authenticated');
    });

    test('returns 401 when Authorization header is missing', async () => {
      const res = await app.request('/auth/v1/user', {
        method: 'GET',
      });

      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe('invalid_token');
    });

    test('returns 401 when Bearer prefix is missing', async () => {
      const res = await app.request('/auth/v1/user', {
        method: 'GET',
        headers: {
          Authorization: validToken, // Missing 'Bearer '
        },
      });

      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe('invalid_token');
    });

    test('returns 401 for invalid token', async () => {
      const res = await app.request('/auth/v1/user', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      });

      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe('invalid_token');
    });

    test('returns 401 for expired token', async () => {
      // Create provider with very short session duration
      const shortProvider = new SqliteAuthProvider(db, {
        jwtSecret: 'test-secret',
        sessionDuration: -1, // Already expired
      });

      await shortProvider.signup('expired@example.com', 'password123');
      const session = await shortProvider.login('expired@example.com', 'password123');

      const res = await app.request('/auth/v1/user', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${session.token}`,
        },
      });

      expect(res.status).toBe(401);

      const data = await res.json();
      expect(data.error).toBe('invalid_token');
    });
  });

  describe('Custom configuration', () => {
    test('uses custom base path', async () => {
      const customApp = new Hono();
      mountGoTrueRoutes(customApp, authProvider, {
        basePath: '/custom/auth',
      });

      const res = await customApp.request('/custom/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(201);
    });

    test('uses custom session duration', async () => {
      const customApp = new Hono();
      mountGoTrueRoutes(customApp, authProvider, {
        sessionDuration: 7200, // 2 hours
      });

      const res = await customApp.request('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      expect(res.status).toBe(201);

      const data = await res.json();
      expect(data.expires_in).toBe(7200);
    });
  });

  describe('Response format compliance', () => {
    test('GoTrue session has all required fields', async () => {
      const res = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      const data = await res.json();

      // Session fields
      expect(typeof data.access_token).toBe('string');
      expect(typeof data.refresh_token).toBe('string');
      expect(data.token_type).toBe('bearer');
      expect(typeof data.expires_in).toBe('number');
      expect(typeof data.expires_at).toBe('number');

      // User fields
      expect(typeof data.user.id).toBe('string');
      expect(data.user.aud).toBe('authenticated');
      expect(data.user.role).toBe('authenticated');
      expect(typeof data.user.email).toBe('string');
      expect(typeof data.user.confirmed_at).toBe('string');
      expect(typeof data.user.app_metadata).toBe('object');
      expect(typeof data.user.user_metadata).toBe('object');
      expect(typeof data.user.created_at).toBe('string');
      expect(typeof data.user.updated_at).toBe('string');
    });

    test('expires_at is correctly calculated', async () => {
      const beforeRequest = Math.floor(Date.now() / 1000);

      const res = await app.request('/auth/v1/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          password: 'password123',
        }),
      });

      const afterRequest = Math.floor(Date.now() / 1000);

      const data = await res.json();

      // expires_at should be approximately now + expires_in
      const expectedMin = beforeRequest + data.expires_in;
      const expectedMax = afterRequest + data.expires_in;

      expect(data.expires_at).toBeGreaterThanOrEqual(expectedMin);
      expect(data.expires_at).toBeLessThanOrEqual(expectedMax);
    });
  });
});
