/**
 * RLS Storage Provider Tests
 *
 * Tests for storing and retrieving RLS policies in SQLite.
 * Uses TDD approach - tests written first, implementation follows.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteRLSProvider } from '../../src/rls/storage.js';
import type { RLSPolicy } from '../../src/rls/types.js';

describe('RLS Storage Provider', () => {
  let db: Database.Database;
  let rlsProvider: SqliteRLSProvider;

  beforeEach(() => {
    db = new Database(':memory:');
    rlsProvider = new SqliteRLSProvider(db);
  });

  describe('Database schema', () => {
    test('Creates _rls_policies table on initialization', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_rls_policies'")
        .all();

      expect(tables).toHaveLength(1);
    });

    test('Creates _rls_enabled_tables table on initialization', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_rls_enabled_tables'")
        .all();

      expect(tables).toHaveLength(1);
    });

    test('_rls_policies table has correct schema', () => {
      const columns = db.prepare('PRAGMA table_info(_rls_policies)').all() as Array<{
        name: string;
        type: string;
      }>;
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('id');
      expect(columnNames).toContain('name');
      expect(columnNames).toContain('table_name');
      expect(columnNames).toContain('command');
      expect(columnNames).toContain('role');
      expect(columnNames).toContain('using_expr');
      expect(columnNames).toContain('with_check_expr');
    });

    test('Policy name and table name combination is unique', async () => {
      const policy: RLSPolicy = {
        name: 'test_policy',
        tableName: 'users',
        command: 'SELECT',
        role: 'authenticated',
        using: 'true',
      };

      await rlsProvider.createPolicy(policy);

      // Attempt to create duplicate policy
      await expect(rlsProvider.createPolicy(policy)).rejects.toThrow();
    });
  });

  describe('Enable/Disable RLS', () => {
    test('Enables RLS on a table', async () => {
      await rlsProvider.enableRLS('users');

      const isEnabled = await rlsProvider.isRLSEnabled('users');
      expect(isEnabled).toBe(true);
    });

    test('Disables RLS on a table', async () => {
      await rlsProvider.enableRLS('users');
      await rlsProvider.disableRLS('users');

      const isEnabled = await rlsProvider.isRLSEnabled('users');
      expect(isEnabled).toBe(false);
    });

    test('isRLSEnabled returns false for non-existent table', async () => {
      const isEnabled = await rlsProvider.isRLSEnabled('nonexistent');
      expect(isEnabled).toBe(false);
    });

    test('Enabling RLS is idempotent', async () => {
      await rlsProvider.enableRLS('users');
      await expect(rlsProvider.enableRLS('users')).resolves.not.toThrow();

      const isEnabled = await rlsProvider.isRLSEnabled('users');
      expect(isEnabled).toBe(true);
    });

    test('Disabling RLS is idempotent', async () => {
      await rlsProvider.disableRLS('users');
      await expect(rlsProvider.disableRLS('users')).resolves.not.toThrow();
    });

    test('Tracks multiple tables independently', async () => {
      await rlsProvider.enableRLS('users');
      await rlsProvider.enableRLS('posts');
      await rlsProvider.disableRLS('users');

      expect(await rlsProvider.isRLSEnabled('users')).toBe(false);
      expect(await rlsProvider.isRLSEnabled('posts')).toBe(true);
    });
  });

  describe('Create policy', () => {
    test('Stores a basic SELECT policy', async () => {
      const policy: RLSPolicy = {
        name: 'select_own_posts',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'user_id = auth.uid()',
      };

      await rlsProvider.createPolicy(policy);

      const policies = await rlsProvider.getPolicies('posts');
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatchObject(policy);
    });

    test('Stores INSERT policy with WITH CHECK', async () => {
      const policy: RLSPolicy = {
        name: 'insert_own_posts',
        tableName: 'posts',
        command: 'INSERT',
        role: 'authenticated',
        withCheck: 'user_id = auth.uid()',
      };

      await rlsProvider.createPolicy(policy);

      const policies = await rlsProvider.getPolicies('posts');
      expect(policies[0]?.withCheck).toBe('user_id = auth.uid()');
    });

    test('Stores UPDATE policy with both USING and WITH CHECK', async () => {
      const policy: RLSPolicy = {
        name: 'update_own_posts',
        tableName: 'posts',
        command: 'UPDATE',
        role: 'authenticated',
        using: 'user_id = auth.uid()',
        withCheck: 'user_id = auth.uid()',
      };

      await rlsProvider.createPolicy(policy);

      const policies = await rlsProvider.getPolicies('posts');
      expect(policies[0]?.using).toBe('user_id = auth.uid()');
      expect(policies[0]?.withCheck).toBe('user_id = auth.uid()');
    });

    test('Stores multiple policies for same table', async () => {
      const selectPolicy: RLSPolicy = {
        name: 'select_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'true',
      };

      const insertPolicy: RLSPolicy = {
        name: 'insert_policy',
        tableName: 'posts',
        command: 'INSERT',
        role: 'authenticated',
        withCheck: 'true',
      };

      await rlsProvider.createPolicy(selectPolicy);
      await rlsProvider.createPolicy(insertPolicy);

      const policies = await rlsProvider.getPolicies('posts');
      expect(policies).toHaveLength(2);
    });

    test('Stores policies for different tables', async () => {
      const usersPolicy: RLSPolicy = {
        name: 'users_policy',
        tableName: 'users',
        command: 'SELECT',
        role: 'authenticated',
        using: 'true',
      };

      const postsPolicy: RLSPolicy = {
        name: 'posts_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'true',
      };

      await rlsProvider.createPolicy(usersPolicy);
      await rlsProvider.createPolicy(postsPolicy);

      expect(await rlsProvider.getPolicies('users')).toHaveLength(1);
      expect(await rlsProvider.getPolicies('posts')).toHaveLength(1);
    });

    test('Rejects duplicate policy name on same table', async () => {
      const policy: RLSPolicy = {
        name: 'duplicate',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'true',
      };

      await rlsProvider.createPolicy(policy);

      await expect(rlsProvider.createPolicy(policy)).rejects.toThrow();
    });

    test('Allows same policy name on different tables', async () => {
      const usersPolicy: RLSPolicy = {
        name: 'select_own',
        tableName: 'users',
        command: 'SELECT',
        role: 'authenticated',
        using: 'id = auth.uid()',
      };

      const postsPolicy: RLSPolicy = {
        name: 'select_own',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'user_id = auth.uid()',
      };

      await expect(rlsProvider.createPolicy(usersPolicy)).resolves.not.toThrow();
      await expect(rlsProvider.createPolicy(postsPolicy)).resolves.not.toThrow();
    });
  });

  describe('Get policies', () => {
    beforeEach(async () => {
      // Create some test policies
      await rlsProvider.createPolicy({
        name: 'select_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'user_id = auth.uid()',
      });

      await rlsProvider.createPolicy({
        name: 'insert_policy',
        tableName: 'posts',
        command: 'INSERT',
        role: 'authenticated',
        withCheck: 'user_id = auth.uid()',
      });

      await rlsProvider.createPolicy({
        name: 'anon_select',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: 'published = true',
      });
    });

    test('Returns all policies for a table', async () => {
      const policies = await rlsProvider.getPolicies('posts');
      expect(policies).toHaveLength(3);
    });

    test('Returns empty array for table with no policies', async () => {
      const policies = await rlsProvider.getPolicies('users');
      expect(policies).toEqual([]);
    });

    test('Filters policies by command', async () => {
      const policies = await rlsProvider.getPoliciesForCommand('posts', 'SELECT', 'authenticated');
      expect(policies).toHaveLength(1);
      expect(policies[0]?.name).toBe('select_policy');
    });

    test('Filters policies by role', async () => {
      const policies = await rlsProvider.getPoliciesForCommand('posts', 'SELECT', 'anon');
      expect(policies).toHaveLength(1);
      expect(policies[0]?.name).toBe('anon_select');
    });

    test('Returns ALL command policies for any command', async () => {
      await rlsProvider.createPolicy({
        name: 'all_policy',
        tableName: 'posts',
        command: 'ALL',
        role: 'authenticated',
        using: 'true',
      });

      const selectPolicies = await rlsProvider.getPoliciesForCommand(
        'posts',
        'SELECT',
        'authenticated'
      );

      // Should include both SELECT policy and ALL policy
      expect(selectPolicies.length).toBeGreaterThanOrEqual(2);
      expect(selectPolicies.some(p => p.command === 'ALL')).toBe(true);
    });

    test('Returns PUBLIC role policies for all roles', async () => {
      await rlsProvider.createPolicy({
        name: 'public_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'PUBLIC',
        using: 'published = true',
      });

      const anonPolicies = await rlsProvider.getPoliciesForCommand('posts', 'SELECT', 'anon');
      const authPolicies = await rlsProvider.getPoliciesForCommand(
        'posts',
        'SELECT',
        'authenticated'
      );

      // Both should include the PUBLIC policy
      expect(anonPolicies.some(p => p.name === 'public_policy')).toBe(true);
      expect(authPolicies.some(p => p.name === 'public_policy')).toBe(true);
    });
  });

  describe('Drop policy', () => {
    beforeEach(async () => {
      await rlsProvider.createPolicy({
        name: 'test_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'true',
      });
    });

    test('Removes a policy', async () => {
      await rlsProvider.dropPolicy('posts', 'test_policy');

      const policies = await rlsProvider.getPolicies('posts');
      expect(policies).toHaveLength(0);
    });

    test('Drop is idempotent (no error if policy does not exist)', async () => {
      await rlsProvider.dropPolicy('posts', 'test_policy');
      await expect(rlsProvider.dropPolicy('posts', 'test_policy')).resolves.not.toThrow();
    });

    test('Only removes policy from specified table', async () => {
      await rlsProvider.createPolicy({
        name: 'test_policy',
        tableName: 'users',
        command: 'SELECT',
        role: 'authenticated',
        using: 'true',
      });

      await rlsProvider.dropPolicy('posts', 'test_policy');

      expect(await rlsProvider.getPolicies('posts')).toHaveLength(0);
      expect(await rlsProvider.getPolicies('users')).toHaveLength(1);
    });
  });
});
