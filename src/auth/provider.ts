/**
 * SQLite Auth Provider Implementation
 *
 * Provides user authentication and session management using SQLite.
 * Implements the AuthProvider interface.
 */

import type Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { AuthProvider, AuthUser, AuthSession } from './types.js';
import { generateUserToken, verifyJWT } from './jwt.js';

/**
 * Auth provider configuration
 */
export interface SqliteAuthConfig {
  /** JWT secret for signing tokens */
  jwtSecret: string;

  /** Session duration in seconds (default: 86400 = 24 hours) */
  sessionDuration?: number;
}

/**
 * SQLite-based auth provider
 */
export class SqliteAuthProvider implements AuthProvider {
  private db: Database.Database;
  private config: Required<SqliteAuthConfig>;

  constructor(db: Database.Database, config: SqliteAuthConfig) {
    this.db = db;
    this.config = {
      jwtSecret: config.jwtSecret,
      sessionDuration: config.sessionDuration ?? 86400,
    };

    this.initializeSchema();
  }

  /**
   * Initialize database schema for auth
   */
  private initializeSchema(): void {
    // Create auth_users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Create auth_sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      )
    `);

    // Create index on sessions for cleanup
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
      ON auth_sessions(expires_at)
    `);
  }

  /**
   * Create a new user account
   */
  async signup(username: string, password: string): Promise<AuthUser> {
    // Validate inputs
    if (!username || username.trim().length === 0) {
      throw new Error('Username is required');
    }

    if (!password || password.trim().length === 0) {
      throw new Error('Password is required');
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    // Check if username already exists
    const existing = this.db
      .prepare('SELECT id FROM auth_users WHERE username = ?')
      .get(username);

    if (existing) {
      throw new Error('Username already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate user ID
    const id = randomUUID();
    const now = new Date().toISOString();

    // Insert user
    this.db
      .prepare(
        'INSERT INTO auth_users (id, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, username, passwordHash, now, now);

    return {
      id,
      username,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  /**
   * Authenticate a user and create a session
   */
  async login(username: string, password: string): Promise<AuthSession> {
    // Get user
    const row = this.db
      .prepare('SELECT id, username, password_hash, created_at, updated_at FROM auth_users WHERE username = ?')
      .get(username) as
      | {
          id: string;
          username: string;
          password_hash: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      throw new Error('Invalid credentials');
    }

    // Verify password
    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    // Create session token with role="authenticated" and unique jti
    const expiresAt = new Date(Date.now() + this.config.sessionDuration * 1000);
    const jti = randomUUID(); // Unique token ID to prevent duplicates
    const token = generateUserToken(row.id, this.config.jwtSecret, this.config.sessionDuration, jti);

    // Store session
    this.db
      .prepare('INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(token, row.id, expiresAt.toISOString());

    // Clean up expired sessions
    this.cleanupExpiredSessions();

    const user: AuthUser = {
      id: row.id,
      username: row.username,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };

    return {
      user,
      token,
      expiresAt,
    };
  }

  /**
   * Verify a session token and return the user
   */
  async verifySession(token: string): Promise<AuthUser | null> {
    try {
      // Verify JWT signature and expiration
      const payload = verifyJWT(token, this.config.jwtSecret);

      if (!payload || !payload.sub) {
        return null;
      }

      // Check if session exists in database
      const session = this.db
        .prepare('SELECT user_id, expires_at FROM auth_sessions WHERE token = ?')
        .get(token) as { user_id: string; expires_at: string } | undefined;

      if (!session) {
        return null;
      }

      // Check if session is expired
      if (new Date(session.expires_at) <= new Date()) {
        this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
        return null;
      }

      // Get user
      return this.getUser(payload.sub);
    } catch (error) {
      // JWT verification failed or token is invalid
      return null;
    }
  }

  /**
   * Verify a JWT token and return the payload
   * Does not check session in database
   */
  async verifyToken(token: string): Promise<any | null> {
    try {
      const payload = verifyJWT(token, this.config.jwtSecret);
      return payload;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get user by ID
   */
  async getUser(id: string): Promise<AuthUser | null> {
    const row = this.db
      .prepare('SELECT id, username, created_at, updated_at FROM auth_users WHERE id = ?')
      .get(id) as
      | {
          id: string;
          username: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      username: row.username,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * Invalidate a session
   */
  async logout(token: string): Promise<void> {
    this.db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = new Date().toISOString();
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
  }
}
