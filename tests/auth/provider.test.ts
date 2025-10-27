/**
 * Auth Provider Tests
 *
 * Tests for user authentication and session management.
 * Uses TDD approach - tests written first, implementation follows.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteAuthProvider } from '../../src/auth/provider.js';
import { TEST_JWT_SECRET } from '../helpers/jwt.js';

describe('Auth Provider', () => {
  let db: Database.Database;
  let authProvider: SqliteAuthProvider;

  beforeEach(() => {
    // Create in-memory database for each test
    db = new Database(':memory:');
    authProvider = new SqliteAuthProvider(db, {
      jwtSecret: TEST_JWT_SECRET,
      sessionDuration: 3600, // 1 hour
    });
  });

  describe('User signup', () => {
    test('Creates a new user with username and password', async () => {
      const user = await authProvider.signup('alice', 'password123');

      expect(user.id).toBeDefined();
      expect(user.username).toBe('alice');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    test('Generates unique user IDs', async () => {
      const user1 = await authProvider.signup('alice', 'password123');
      const user2 = await authProvider.signup('bob', 'password123');

      expect(user1.id).not.toBe(user2.id);
    });

    test('Rejects duplicate usernames', async () => {
      await authProvider.signup('alice', 'password123');

      await expect(
        authProvider.signup('alice', 'different-password')
      ).rejects.toThrow(/username already exists/i);
    });

    test('Rejects empty username', async () => {
      await expect(
        authProvider.signup('', 'password123')
      ).rejects.toThrow(/username.*required/i);
    });

    test('Rejects empty password', async () => {
      await expect(
        authProvider.signup('alice', '')
      ).rejects.toThrow(/password.*required/i);
    });

    test('Enforces minimum password length', async () => {
      await expect(
        authProvider.signup('alice', '123')
      ).rejects.toThrow(/password.*at least 6 characters/i);
    });

    test('Hashes passwords before storage', async () => {
      await authProvider.signup('alice', 'password123');

      // Query the database directly to verify password is hashed
      const row = db.prepare('SELECT password_hash FROM auth_users WHERE username = ?').get('alice') as { password_hash: string };

      expect(row.password_hash).toBeDefined();
      expect(row.password_hash).not.toBe('password123'); // Not stored in plain text
      expect(row.password_hash.length).toBeGreaterThan(20); // Bcrypt hashes are long
    });
  });

  describe('User login', () => {
    beforeEach(async () => {
      // Create a test user for login tests
      await authProvider.signup('alice', 'password123');
    });

    test('Returns session for valid credentials', async () => {
      const session = await authProvider.login('alice', 'password123');

      expect(session.user.username).toBe('alice');
      expect(session.token).toBeDefined();
      expect(session.token.length).toBeGreaterThan(0);
      expect(session.expiresAt).toBeInstanceOf(Date);
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    test('Rejects invalid username', async () => {
      await expect(
        authProvider.login('nonexistent', 'password123')
      ).rejects.toThrow(/invalid credentials/i);
    });

    test('Rejects invalid password', async () => {
      await expect(
        authProvider.login('alice', 'wrong-password')
      ).rejects.toThrow(/invalid credentials/i);
    });

    test('Session token can be verified', async () => {
      const session = await authProvider.login('alice', 'password123');
      const user = await authProvider.verifySession(session.token);

      expect(user).not.toBeNull();
      expect(user?.username).toBe('alice');
      expect(user?.id).toBe(session.user.id);
    });

    test('Generates different tokens for each login', async () => {
      const session1 = await authProvider.login('alice', 'password123');
      const session2 = await authProvider.login('alice', 'password123');

      expect(session1.token).not.toBe(session2.token);
    });
  });

  describe('Session verification', () => {
    test('Returns null for invalid token', async () => {
      const user = await authProvider.verifySession('invalid-token');

      expect(user).toBeNull();
    });

    test('Returns null for expired token', async () => {
      // Create provider with very short session duration
      const shortSessionProvider = new SqliteAuthProvider(db, {
        jwtSecret: TEST_JWT_SECRET,
        sessionDuration: -1, // Expired immediately
      });

      await shortSessionProvider.signup('alice', 'password123');
      const session = await shortSessionProvider.login('alice', 'password123');

      const user = await shortSessionProvider.verifySession(session.token);

      expect(user).toBeNull();
    });

    test('Returns user for valid, non-expired token', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');

      const user = await authProvider.verifySession(session.token);

      expect(user).not.toBeNull();
      expect(user?.username).toBe('alice');
    });
  });

  describe('User retrieval', () => {
    test('Gets user by ID', async () => {
      const created = await authProvider.signup('alice', 'password123');
      const retrieved = await authProvider.getUser(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.username).toBe('alice');
    });

    test('Returns null for nonexistent user ID', async () => {
      const user = await authProvider.getUser('nonexistent-id');

      expect(user).toBeNull();
    });
  });

  describe('Logout', () => {
    test('Invalidates session token', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');

      // Verify token works before logout
      let user = await authProvider.verifySession(session.token);
      expect(user).not.toBeNull();

      // Logout
      await authProvider.logout(session.token);

      // Verify token no longer works
      user = await authProvider.verifySession(session.token);
      expect(user).toBeNull();
    });

    test('Logout is idempotent (can call multiple times)', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');

      await authProvider.logout(session.token);
      await expect(authProvider.logout(session.token)).resolves.not.toThrow();
    });
  });

  describe('Database schema', () => {
    test('Creates auth_users table on initialization', () => {
      // Check that table exists
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_users'").all();

      expect(tables).toHaveLength(1);
    });

    test('Creates auth_sessions table on initialization', () => {
      // Check that table exists
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'").all();

      expect(tables).toHaveLength(1);
    });

    test('auth_users table has correct schema', () => {
      const columns = db.prepare('PRAGMA table_info(auth_users)').all() as Array<{ name: string; type: string }>;
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('username');
      expect(columnNames).toContain('password_hash');
      expect(columnNames).toContain('created_at');
      expect(columnNames).toContain('updated_at');
    });

    test('username has unique constraint', async () => {
      await authProvider.signup('alice', 'password123');

      // Attempt to insert duplicate username directly
      expect(() => {
        db.prepare('INSERT INTO auth_users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
          'test-id',
          'alice',
          'hash',
          new Date().toISOString(),
          new Date().toISOString()
        );
      }).toThrow();
    });
  });
});
