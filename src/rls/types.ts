/**
 * Row Level Security (RLS) Type Definitions
 *
 * Provides type-safe interfaces for RLS policy management and enforcement.
 * Emulates PostgreSQL RLS for SQLite databases.
 */

/**
 * Policy command type (determines when policy applies)
 */
export type PolicyCommand = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';

/**
 * Policy role (who the policy applies to)
 */
export type PolicyRole = 'anon' | 'authenticated' | 'PUBLIC';

/**
 * RLS Policy Definition
 */
export interface RLSPolicy {
  /** Unique policy name */
  readonly name: string;

  /** Table the policy applies to */
  readonly tableName: string;

  /** Command the policy applies to */
  readonly command: PolicyCommand;

  /** Role the policy applies to */
  readonly role: PolicyRole;

  /** USING expression (for SELECT/DELETE) */
  readonly using?: string;

  /** WITH CHECK expression (for INSERT/UPDATE) */
  readonly withCheck?: string;

  /** Whether the policy is permissive (default) or restrictive */
  readonly restrictive?: boolean;
}

/**
 * Table RLS status
 */
export interface TableRLSStatus {
  readonly tableName: string;
  readonly enabled: boolean;
}

/**
 * RLS Provider interface
 * Implementations handle policy storage and retrieval
 */
export interface RLSProvider {
  /**
   * Enable RLS on a table
   */
  enableRLS(tableName: string): Promise<void>;

  /**
   * Disable RLS on a table
   */
  disableRLS(tableName: string): Promise<void>;

  /**
   * Check if RLS is enabled on a table
   */
  isRLSEnabled(tableName: string): Promise<boolean>;

  /**
   * Create a new RLS policy
   */
  createPolicy(policy: RLSPolicy): Promise<void>;

  /**
   * Drop an RLS policy
   */
  dropPolicy(tableName: string, policyName: string): Promise<void>;

  /**
   * Get all policies for a table
   */
  getPolicies(tableName: string): Promise<readonly RLSPolicy[]>;

  /**
   * Get policies for a specific command and role
   */
  getPoliciesForCommand(
    tableName: string,
    command: PolicyCommand,
    role: PolicyRole
  ): Promise<readonly RLSPolicy[]>;

  /**
   * Execute a validation query (for WITH CHECK enforcement)
   * Returns a single row or undefined
   */
  executeQuery(sql: string, params: unknown[]): Promise<unknown>;

  /**
   * Execute a modification query (INSERT, UPDATE, DELETE)
   * Returns the result info
   */
  executeModification(sql: string, params: unknown[]): Promise<void>;
}

/**
 * RLS configuration
 */
export interface RLSConfig {
  /** Whether RLS is enabled globally */
  readonly enabled: boolean;

  /** Whether to automatically enable RLS on all tables */
  readonly enforceByDefault?: boolean;
}

/**
 * Parsed RLS statement from SQL
 */
export type RLSStatement =
  | {
      readonly type: 'enable_rls';
      readonly tableName: string;
    }
  | {
      readonly type: 'disable_rls';
      readonly tableName: string;
    }
  | {
      readonly type: 'create_policy';
      readonly policy: RLSPolicy;
    }
  | {
      readonly type: 'drop_policy';
      readonly tableName: string;
      readonly policyName: string;
    };
