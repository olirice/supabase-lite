/**
 * Auth System Type Definitions
 *
 * Provides type-safe interfaces for authentication and authorization.
 * Designed to be pluggable and framework-agnostic.
 */

/**
 * User role for authorization
 */
export type UserRole = 'anon' | 'authenticated';

/**
 * Request context carrying auth information
 * Injected into every request by auth middleware
 */
export interface RequestContext {
  /** User role (anon or authenticated) */
  readonly role: UserRole;

  /** User ID (only present for authenticated users) */
  readonly uid?: string;

  /** Additional metadata */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Authenticated user record
 */
export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Session information returned after login
 */
export interface AuthSession {
  readonly user: AuthUser;
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Auth provider interface
 * Implementations handle user management and session verification
 */
export interface AuthProvider {
  /**
   * Create a new user account
   */
  signup(username: string, password: string): Promise<AuthUser>;

  /**
   * Authenticate a user and create a session
   */
  login(username: string, password: string): Promise<AuthSession>;

  /**
   * Verify a session token and return the user
   */
  verifySession(token: string): Promise<AuthUser | null>;

  /**
   * Get user by ID
   */
  getUser(id: string): Promise<AuthUser | null>;

  /**
   * Invalidate a session
   */
  logout(token: string): Promise<void>;
}

/**
 * Auth configuration
 */
export interface AuthConfig {
  /** Whether auth is enabled */
  readonly enabled: boolean;

  /** Anonymous API key required for all requests */
  readonly anonKey: string;

  /** JWT secret for signing tokens */
  readonly jwtSecret: string;

  /** Session duration in seconds (default: 86400 = 24 hours) */
  readonly sessionDuration?: number;
}
