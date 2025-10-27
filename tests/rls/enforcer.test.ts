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

  describe('UPDATE command policy handling', () => {
    test('Combines USING and WITH CHECK with AND for UPDATE', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'update_policy',
        tableName: 'posts',
        command: 'UPDATE',
        role: 'authenticated',
        using: policy.eq('user_id', policy.authUid()),
        withCheck: policy.eq('published', 1),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      // For UPDATE command, call enforceOnAST with 'UPDATE'
      const ast = parser.parse(url);
      const astWithRLS = await enforcer.enforceOnAST(ast, 'UPDATE', context);

      // Should combine both USING and WITH CHECK with AND
      expect(astWithRLS.rlsPolicy).toBeDefined();
      expect(astWithRLS.rlsPolicy?.type).toBe('and');
    });

    test('Handles UPDATE with only USING clause', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'update_using',
        tableName: 'posts',
        command: 'UPDATE',
        role: 'authenticated',
        using: policy.eq('user_id', policy.authUid()),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const ast = parser.parse(url);
      const astWithRLS = await enforcer.enforceOnAST(ast, 'UPDATE', context);

      expect(astWithRLS.rlsPolicy).toBeDefined();
      expect(astWithRLS.rlsPolicy?.type).toBe('filter');
    });

    test('Handles UPDATE with only WITH CHECK clause', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'update_check',
        tableName: 'posts',
        command: 'UPDATE',
        role: 'authenticated',
        withCheck: policy.eq('published', 1),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const ast = parser.parse(url);
      const astWithRLS = await enforcer.enforceOnAST(ast, 'UPDATE', context);

      expect(astWithRLS.rlsPolicy).toBeDefined();
      expect(astWithRLS.rlsPolicy?.type).toBe('filter');
    });

    test('Denies UPDATE when policy has neither USING nor WITH CHECK', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'empty_update',
        tableName: 'posts',
        command: 'UPDATE',
        role: 'authenticated',
        // No using or withCheck
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const ast = parser.parse(url);
      const astWithRLS = await enforcer.enforceOnAST(ast, 'UPDATE', context);

      // Should deny all when no valid conditions
      expect(astWithRLS.rlsPolicy).toBeDefined();
      expect(astWithRLS.rlsPolicy?.column).toBe('1');
      expect(astWithRLS.rlsPolicy?.value).toBe(0);
    });
  });

  describe('auth.role() substitution', () => {
    test('Replaces auth.role() with actual role value', async () => {
      await rlsProvider.enableRLS('posts');

      // Add role column
      db.exec('ALTER TABLE posts ADD COLUMN role TEXT');

      await rlsProvider.createPolicy({
        name: 'role_based',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: policy.eq('role', policy.authRole()),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const sql = await getFinalSQL(url, context);

      expect(sql).toContain('"role" = ?');
    });

    test('Handles auth.role() in OR conditions', async () => {
      await rlsProvider.enableRLS('posts');

      // Add role column
      db.exec('ALTER TABLE posts ADD COLUMN role TEXT');

      await rlsProvider.createPolicy({
        name: 'multi_role',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: policy.or(
          policy.eq('role', policy.authRole()),
          policy.eq('published', 1)
        ),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const sql = await getFinalSQL(url, context);

      expect(sql).toContain('"role" = ?');
      expect(sql).toContain('OR');
      expect(sql).toContain('"published" = ?');
    });
  });

  describe('getWithCheckPolicy edge cases', () => {
    test('Returns null when RLS is not enabled', async () => {
      // RLS not enabled on posts table
      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const withCheckNode = await enforcer.getWithCheckPolicy('posts', context);

      expect(withCheckNode).toBeNull();
    });

    test('Returns deny-all when no INSERT policies exist', async () => {
      await rlsProvider.enableRLS('posts');
      // No policies created

      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const withCheckNode = await enforcer.getWithCheckPolicy('posts', context);

      expect(withCheckNode).toBeDefined();
      expect(withCheckNode?.column).toBe('1');
      expect(withCheckNode?.value).toBe(0);
    });

    test('Returns null when policies have no WITH CHECK clause', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'insert_no_check',
        tableName: 'posts',
        command: 'INSERT',
        role: 'authenticated',
        // No withCheck clause
      });

      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const withCheckNode = await enforcer.getWithCheckPolicy('posts', context);

      expect(withCheckNode).toBeNull();
    });

    test('Handles errors gracefully', async () => {
      // Create provider first, then close database to cause error
      const closedDb = new Database(':memory:');
      const brokenProvider = new SqliteRLSProvider(closedDb);
      closedDb.close();
      const brokenEnforcer = new RLSASTEnforcer(brokenProvider);

      const context: RequestContext = { role: 'authenticated', uid: 'user-123' };

      const withCheckNode = await brokenEnforcer.getWithCheckPolicy('posts', context);

      // Should return null on error
      expect(withCheckNode).toBeNull();
    });
  });

  describe('SQL operator compilation', () => {
    test('Compiles LIKE operator', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'like_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: policy.like('title', 'Test%'),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      expect(sql).toContain('LIKE');
    });

    test('Compiles ILIKE operator (treated as LIKE in SQLite)', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'ilike_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: policy.ilike('title', 'test%'),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      expect(sql).toContain('LIKE');
    });

    test('Compiles IN operator', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'in_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: policy.in('id', [1, 2, 3]),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      expect(sql).toContain('IN');
    });

    test('Compiles IS NULL operator', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'is_null_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: policy.isNull('content'),
      });

      const url = 'http://localhost/posts';
      const context: RequestContext = { role: 'anon' };

      const sql = await getFinalSQL(url, context);

      expect(sql).toContain('IS');
    });
  });

  describe('compileWhereNode edge cases', () => {
    test('Throws error for embedded_filter nodes', () => {
      const embeddedNode: WhereNode = {
        type: 'embedded_filter',
        table: 'comments',
        filters: [],
      };

      expect(() => {
        enforcer.compileWhereNode(embeddedNode);
      }).toThrow('Embedded filters not supported in RLS policies');
    });

    test('Handles numeric literal columns correctly', () => {
      const numericNode: WhereNode = {
        type: 'filter',
        column: '1',
        operator: 'eq',
        value: 0,
      };

      const { sql } = enforcer.compileWhereNode(numericNode);

      // Should not quote numeric literals
      expect(sql).toBe('1 = ?');
      expect(sql).not.toContain('"1"');
    });

    test('Handles regular columns with quotes', () => {
      const regularNode: WhereNode = {
        type: 'filter',
        column: 'user_id',
        operator: 'eq',
        value: 'test',
      };

      const { sql } = enforcer.compileWhereNode(regularNode);

      // Should quote regular identifiers
      expect(sql).toContain('"user_id"');
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
