/**
 * RLS Policy Parser Tests
 *
 * Tests for parsing PostgreSQL RLS syntax.
 * Supports ENABLE/DISABLE RLS and CREATE/DROP POLICY statements.
 */

import { describe, test, expect } from 'vitest';
import { parseRLSStatement } from '../../src/rls/parser.js';

describe('RLS Policy Parser', () => {
  describe('ENABLE ROW LEVEL SECURITY', () => {
    test('Parses basic ENABLE RLS statement', () => {
      const sql = 'ALTER TABLE users ENABLE ROW LEVEL SECURITY;';
      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'enable_rls',
        tableName: 'users',
      });
    });

    test('Parses with lowercase', () => {
      const sql = 'alter table posts enable row level security;';
      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'enable_rls',
        tableName: 'posts',
      });
    });

    test('Parses with mixed case', () => {
      const sql = 'AlTeR TaBlE comments EnAbLe RoW LeVeL SeCuRiTy;';
      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'enable_rls',
        tableName: 'comments',
      });
    });

    test('Handles extra whitespace', () => {
      const sql = '  ALTER   TABLE   users   ENABLE   ROW   LEVEL   SECURITY  ;  ';
      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'enable_rls',
        tableName: 'users',
      });
    });

    test('Parses table names with underscores', () => {
      const sql = 'ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;';
      const result = parseRLSStatement(sql);

      expect(result?.tableName).toBe('user_profiles');
    });

    test('Parses quoted table names', () => {
      const sql = 'ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;';
      const result = parseRLSStatement(sql);

      expect(result?.tableName).toBe('users');
    });
  });

  describe('DISABLE ROW LEVEL SECURITY', () => {
    test('Parses basic DISABLE RLS statement', () => {
      const sql = 'ALTER TABLE users DISABLE ROW LEVEL SECURITY;';
      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'disable_rls',
        tableName: 'users',
      });
    });

    test('Parses with lowercase', () => {
      const sql = 'alter table posts disable row level security;';
      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'disable_rls',
        tableName: 'posts',
      });
    });
  });

  describe('CREATE POLICY - Basic syntax', () => {
    test('Parses SELECT policy with USING clause', () => {
      const sql = `CREATE POLICY select_own_posts ON posts
                   FOR SELECT
                   TO authenticated
                   USING (user_id = auth.uid());`;

      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'create_policy',
        policy: {
          name: 'select_own_posts',
          tableName: 'posts',
          command: 'SELECT',
          role: 'authenticated',
          using: 'user_id = auth.uid()',
        },
      });
    });

    test('Parses INSERT policy with WITH CHECK clause', () => {
      const sql = `CREATE POLICY insert_own_posts ON posts
                   FOR INSERT
                   TO authenticated
                   WITH CHECK (user_id = auth.uid());`;

      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'create_policy',
        policy: {
          name: 'insert_own_posts',
          tableName: 'posts',
          command: 'INSERT',
          role: 'authenticated',
          withCheck: 'user_id = auth.uid()',
        },
      });
    });

    test('Parses UPDATE policy with both USING and WITH CHECK', () => {
      const sql = `CREATE POLICY update_own_posts ON posts
                   FOR UPDATE
                   TO authenticated
                   USING (user_id = auth.uid())
                   WITH CHECK (user_id = auth.uid());`;

      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'create_policy',
        policy: {
          name: 'update_own_posts',
          tableName: 'posts',
          command: 'UPDATE',
          role: 'authenticated',
          using: 'user_id = auth.uid()',
          withCheck: 'user_id = auth.uid()',
        },
      });
    });

    test('Parses DELETE policy', () => {
      const sql = `CREATE POLICY delete_own_posts ON posts
                   FOR DELETE
                   TO authenticated
                   USING (user_id = auth.uid());`;

      const result = parseRLSStatement(sql);

      expect(result?.type).toBe('create_policy');
      expect(result?.type === 'create_policy' && result.policy.command).toBe('DELETE');
    });

    test('Parses ALL command policy', () => {
      const sql = `CREATE POLICY all_operations ON posts
                   FOR ALL
                   TO authenticated
                   USING (user_id = auth.uid());`;

      const result = parseRLSStatement(sql);

      expect(result?.type === 'create_policy' && result.policy.command).toBe('ALL');
    });
  });

  describe('CREATE POLICY - Role variations', () => {
    test('Parses policy for anon role', () => {
      const sql = `CREATE POLICY anon_read ON posts
                   FOR SELECT
                   TO anon
                   USING (published = true);`;

      const result = parseRLSStatement(sql);

      expect(result?.type === 'create_policy' && result.policy.role).toBe('anon');
    });

    test('Parses policy for PUBLIC role', () => {
      const sql = `CREATE POLICY public_read ON posts
                   FOR SELECT
                   TO PUBLIC
                   USING (published = true);`;

      const result = parseRLSStatement(sql);

      expect(result?.type === 'create_policy' && result.policy.role).toBe('PUBLIC');
    });
  });

  describe('CREATE POLICY - Expression variations', () => {
    test('Parses simple boolean expression', () => {
      const sql = `CREATE POLICY simple ON posts
                   FOR SELECT
                   TO authenticated
                   USING (published = true);`;

      const result = parseRLSStatement(sql);

      expect(result?.type === 'create_policy' && result.policy.using).toBe('published = true');
    });

    test('Parses complex expression with AND/OR', () => {
      const sql = `CREATE POLICY complex ON posts
                   FOR SELECT
                   TO authenticated
                   USING (published = true AND (user_id = auth.uid() OR role = 'admin'));`;

      const result = parseRLSStatement(sql);

      expect(result?.type === 'create_policy' && result.policy.using).toBe(
        "published = true AND (user_id = auth.uid() OR role = 'admin')"
      );
    });

    test('Parses expression with function calls', () => {
      const sql = `CREATE POLICY func_call ON posts
                   FOR SELECT
                   TO authenticated
                   USING (created_at > NOW() - INTERVAL '7 days');`;

      const result = parseRLSStatement(sql);

      expect(result?.type === 'create_policy' && result.policy.using).toContain('NOW()');
    });

    test('Parses expression with subquery', () => {
      const sql = `CREATE POLICY subquery ON posts
                   FOR SELECT
                   TO authenticated
                   USING (user_id IN (SELECT id FROM allowed_users));`;

      const result = parseRLSStatement(sql);

      expect(result?.type === 'create_policy' && result.policy.using).toContain('SELECT id FROM allowed_users');
    });
  });

  describe('CREATE POLICY - Optional FOR clause', () => {
    test('Parses policy without FOR clause (defaults to ALL)', () => {
      const sql = `CREATE POLICY default_all ON posts
                   TO authenticated
                   USING (user_id = auth.uid());`;

      const result = parseRLSStatement(sql);

      expect(result?.type === 'create_policy' && result.policy.command).toBe('ALL');
    });
  });

  describe('DROP POLICY', () => {
    test('Parses basic DROP POLICY statement', () => {
      const sql = 'DROP POLICY select_own_posts ON posts;';
      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'drop_policy',
        tableName: 'posts',
        policyName: 'select_own_posts',
      });
    });

    test('Parses with lowercase', () => {
      const sql = 'drop policy my_policy on users;';
      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'drop_policy',
        tableName: 'users',
        policyName: 'my_policy',
      });
    });

    test('Parses with IF EXISTS', () => {
      const sql = 'DROP POLICY IF EXISTS my_policy ON users;';
      const result = parseRLSStatement(sql);

      expect(result).toEqual({
        type: 'drop_policy',
        tableName: 'users',
        policyName: 'my_policy',
      });
    });
  });

  describe('Invalid statements', () => {
    test('Returns null for non-RLS SQL', () => {
      const sql = 'SELECT * FROM users;';
      const result = parseRLSStatement(sql);

      expect(result).toBeNull();
    });

    test('Returns null for CREATE TABLE', () => {
      const sql = 'CREATE TABLE users (id INTEGER PRIMARY KEY);';
      const result = parseRLSStatement(sql);

      expect(result).toBeNull();
    });

    test('Returns null for empty string', () => {
      const result = parseRLSStatement('');

      expect(result).toBeNull();
    });

    test('Returns null for malformed ENABLE RLS', () => {
      const sql = 'ALTER TABLE ENABLE ROW LEVEL SECURITY;'; // Missing table name
      const result = parseRLSStatement(sql);

      expect(result).toBeNull();
    });

    test('Returns null for malformed CREATE POLICY', () => {
      const sql = 'CREATE POLICY ON posts;'; // Missing policy name
      const result = parseRLSStatement(sql);

      expect(result).toBeNull();
    });
  });

  describe('Quoted identifiers', () => {
    test('Strips quotes from policy names', () => {
      const sql = `CREATE POLICY "my_policy" ON posts
                   FOR SELECT
                   TO authenticated
                   USING (true);`;

      const result = parseRLSStatement(sql);

      expect(result?.type === 'create_policy' && result.policy.name).toBe('my_policy');
    });

    test('Strips quotes from table names', () => {
      const sql = 'ALTER TABLE "user_posts" ENABLE ROW LEVEL SECURITY;';
      const result = parseRLSStatement(sql);

      expect(result?.tableName).toBe('user_posts');
    });
  });

  describe('Comments and whitespace', () => {
    test('Ignores SQL comments', () => {
      const sql = `-- Enable RLS on posts
                   ALTER TABLE posts ENABLE ROW LEVEL SECURITY;`;

      const result = parseRLSStatement(sql);

      expect(result?.tableName).toBe('posts');
    });

    test('Handles multiline statements', () => {
      const sql = `
        CREATE POLICY select_own_posts
        ON posts
        FOR SELECT
        TO authenticated
        USING (user_id = auth.uid());
      `;

      const result = parseRLSStatement(sql);

      expect(result?.type).toBe('create_policy');
      expect(result?.type === 'create_policy' && result.policy.name).toBe('select_own_posts');
    });
  });
});
