/**
 * RLS Enforcement Tests (AST-based)
 *
 * Tests for applying RLS policies at the AST level before SQL compilation.
 * The AST enforcer modifies the QueryAST instead of manipulating SQL strings.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteRLSProvider } from '../../src/rls/storage.js';
import { RLSASTEnforcer } from '../../src/rls/ast-enforcer.js';
import { QueryParser } from '../../src/parser/index.js';
import { SQLCompiler } from '../../src/compiler/index.js';
import { SchemaIntrospector } from '../../src/schema/index.js';
import type { RequestContext } from '../../src/auth/types.js';
import { policy } from '../../src/rls/policy-builder.js';

describe('RLS AST Enforcer', () => {
  let db: Database.Database;
  let rlsProvider: SqliteRLSProvider;
  let enforcer: RLSASTEnforcer;
  let parser: QueryParser;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT,
        content TEXT,
        user_id TEXT,
        published INTEGER DEFAULT 0
      );
    `);

    rlsProvider = new SqliteRLSProvider(db);
    enforcer = new RLSASTEnforcer(rlsProvider);
    parser = new QueryParser();
  });

  // Helper to compile AST to SQL
  const compileQuery = (url: string, context: RequestContext) => {
    const ast = parser.parse(url);
    return enforcer.enforceOnAST(ast, 'SELECT', context);
  };

  // Helper to get final SQL
  const getFinalSQL = async (url: string, context: RequestContext) => {
    const astWithRLS = await compileQuery(url, context);
    const schema = new SchemaIntrospector(db).introspect();
    const compiler = new SQLCompiler(schema);
    return compiler.compile(astWithRLS).sql;
  };

  describe('Policy enforcement basics', () => {
    test('Returns original AST when RLS is not enabled', async () => {
      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const astWithRLS = await compileQuery(url, context);

      // RLS policy should not be added
      expect(astWithRLS.rlsPolicy).toBeUndefined();
    });

    test('Denies access when no policies exist (PostgreSQL behavior)', async () => {
      await rlsProvider.enableRLS('posts');

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      // Should add WHERE 1 = 0 to deny all access
      expect(sql).toContain('1 = ?');
    });

    test('Injects policy WHERE clause for SELECT', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'public_posts',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: policy.eq('published', 1),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      expect(sql).toContain('WHERE');
      expect(sql).toContain('"published" = ?');
    });

    test('Combines policy with existing WHERE clause using AND', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'public_posts',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: policy.eq('published', 1),
      });

      const url = 'http://localhost/posts?title=eq.Test';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      // Should have both user filter and RLS filter
      expect(sql).toContain('WHERE');
      expect(sql).toContain('"title" = ?');
      expect(sql).toContain('AND');
      expect(sql).toContain('"published" = ?');
    });
  });

  describe('Multiple policies', () => {
    test('Combines multiple policies with OR', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'public_posts',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: policy.eq('published', 1),
      });
      await rlsProvider.createPolicy({
        name: 'featured_posts',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: policy.eq('featured', 1),
      });

      // Add featured column
      db.exec('ALTER TABLE posts ADD COLUMN featured INTEGER DEFAULT 0');

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      // Should have OR between policies
      expect(sql).toContain('"published" = ?');
      expect(sql).toContain('OR');
      expect(sql).toContain('"featured" = ?');
    });

    test('PUBLIC role policies apply to all roles', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'public_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'PUBLIC',
        using: policy.eq('deleted', 0),
      });

      // Add deleted column
      db.exec('ALTER TABLE posts ADD COLUMN deleted INTEGER DEFAULT 0');

      const anonUrl = 'http://localhost/posts';
      const authUrl = 'http://localhost/posts';

      const anonSQL = await getFinalSQL(anonUrl, { role: 'anon' });
      const authSQL = await getFinalSQL(authUrl, { role: 'authenticated', uid: 'user-123' });

      expect(anonSQL).toContain('"deleted" = ?');
      expect(authSQL).toContain('"deleted" = ?');
    });
  });

  describe('auth.uid() function substitution', () => {
    test('Replaces auth.uid() with actual user ID', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'own_posts',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: policy.eq('user_id', policy.authUid()),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const sql = await getFinalSQL(url, context);

      expect(sql).toContain('"user_id" = ?');
      // The user ID should be in the params, not in the SQL string
    });

    test('Handles NULL for auth.uid() when user is anonymous', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: policy.or(
          policy.eq('user_id', policy.authUid()),
          policy.eq('published', 1)
        ),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      expect(sql).toContain('"user_id" = ?');
      expect(sql).toContain('OR');
      expect(sql).toContain('"published" = ?');
    });
  });

  describe('WITH CHECK policy for INSERT', () => {
    test('Returns WITH CHECK policy node for INSERT', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'insert_own',
        tableName: 'posts',
        command: 'INSERT',
        role: 'authenticated',
        withCheck: policy.eq('user_id', policy.authUid()),
      });

      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const withCheckNode = await enforcer.getWithCheckPolicy('posts', context);

      expect(withCheckNode).toBeDefined();
      expect(withCheckNode?.type).toBe('filter');
    });
  });

  describe('Edge cases', () => {
    test('Handles policies with no conditions gracefully', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'no_condition',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        // No using or withCheck
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      // Should deny access since policy has no valid conditions
      expect(sql).toContain('1 = ?');
    });
  });

  describe('Error handling', () => {
    test('Does not throw when RLS provider fails', async () => {
      // Close database to cause provider to fail
      db.close();

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const astWithRLS = await compileQuery(url, context);

      // Should return AST without RLS policy
      expect(astWithRLS.rlsPolicy).toBeUndefined();
    });
  });

  describe('validateWithCheck edge cases', () => {
    test('Returns empty array when validating empty rows', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'insert_policy',
        tableName: 'posts',
        command: 'INSERT',
        role: 'authenticated',
        withCheck: policy.eq('user_id', policy.authUid()),
      });

      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };
      const withCheckNode = await enforcer.getWithCheckPolicy('posts', context);

      const result = await enforcer.validateWithCheck('posts', [], withCheckNode!);

      expect(result).toEqual([]);
    });

    test('Handles rows with missing primary key', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'insert_policy',
        tableName: 'posts',
        command: 'INSERT',
        role: 'authenticated',
        withCheck: policy.eq('user_id', policy.authUid()),
      });

      // Insert a row without retrieving the ID
      const rowWithoutId = {
        title: 'Test Post',
        user_id: 'user-123',
        published: 1,
      };

      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };
      const withCheckNode = await enforcer.getWithCheckPolicy('posts', context);

      // Validate with missing primary key
      const result = await enforcer.validateWithCheck(
        'posts',
        [rowWithoutId],
        withCheckNode!,
        'id'
      );

      // Should keep the row despite missing ID (permissive behavior)
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(rowWithoutId);
    });

    test('Rejects all rows when policy is deny-all (1 = 0)', async () => {
      await rlsProvider.enableRLS('posts');

      // Insert test rows first
      db.exec(`
        INSERT INTO posts (id, title, user_id, published)
        VALUES (1, 'Test 1', 'user-123', 1),
               (2, 'Test 2', 'user-456', 1)
      `);

      const rows = [
        { id: 1, title: 'Test 1', user_id: 'user-123', published: 1 },
        { id: 2, title: 'Test 2', user_id: 'user-456', published: 1 },
      ];

      // Create deny-all policy node (1 = 0)
      const denyAllNode = {
        type: 'filter' as const,
        column: '1',
        operator: 'eq' as const,
        value: 0,
      };

      const result = await enforcer.validateWithCheck('posts', rows, denyAllNode, 'id');

      // All rows should be rejected and deleted
      expect(result).toEqual([]);

      // Verify rows were deleted from database
      const remaining = db.prepare('SELECT COUNT(*) as count FROM posts').get() as { count: number };
      expect(remaining.count).toBe(0);
    });

    test('Validates rows against WITH CHECK policy', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'insert_policy',
        tableName: 'posts',
        command: 'INSERT',
        role: 'authenticated',
        withCheck: policy.eq('user_id', policy.authUid()),
      });

      // Insert test rows
      db.exec(`
        INSERT INTO posts (id, title, user_id, published)
        VALUES (1, 'Valid Post', 'user-123', 1),
               (2, 'Invalid Post', 'user-456', 1)
      `);

      const rows = [
        { id: 1, title: 'Valid Post', user_id: 'user-123', published: 1 },
        { id: 2, title: 'Invalid Post', user_id: 'user-456', published: 1 },
      ];

      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };
      const withCheckNode = await enforcer.getWithCheckPolicy('posts', context);

      const result = await enforcer.validateWithCheck('posts', rows, withCheckNode!, 'id');

      // Only row 1 should pass (user_id matches)
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);

      // Row 2 should be deleted
      const remaining = db.prepare('SELECT id FROM posts ORDER BY id').all() as Array<{ id: number }>;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(1);
    });
  });
});
