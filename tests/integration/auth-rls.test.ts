/**
 * Auth + RLS Integration Tests
 *
 * End-to-end tests for authentication and row-level security working together.
 * Tests the complete flow: anon key → auth context → RLS enforcement → SQL execution.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteAuthProvider } from '../../src/auth/provider.js';
import { SqliteRLSProvider } from '../../src/rls/storage.js';
import { RLSASTEnforcer } from '../../src/rls/ast-enforcer.js';
import { parseRLSStatement } from '../../src/rls/parser.js';
import { ApiService } from '../../src/api/service.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';
import type { RequestContext } from '../../src/auth/types.js';

describe('Auth + RLS Integration', () => {
  let db: Database.Database;
  let authProvider: SqliteAuthProvider;
  let rlsProvider: SqliteRLSProvider;
  let enforcer: RLSASTEnforcer;
  let apiService: ApiService;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    db = new Database(':memory:');

    // Create application schema
    db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT,
        content TEXT,
        user_id TEXT,
        published BOOLEAN DEFAULT 0,
        created_at TEXT
      );

      CREATE TABLE comments (
        id INTEGER PRIMARY KEY,
        post_id INTEGER,
        content TEXT,
        user_id TEXT,
        created_at TEXT,
        FOREIGN KEY (post_id) REFERENCES posts(id)
      );
    `);

    // Insert test data
    db.exec(`
      INSERT INTO posts (id, title, content, user_id, published, created_at) VALUES
        (1, 'Public Post', 'Everyone can see this', 'user-1', 1, '2024-01-01'),
        (2, 'Draft Post', 'Only author can see', 'user-1', 0, '2024-01-02'),
        (3, 'Another Public', 'Public post by user 2', 'user-2', 1, '2024-01-03');

      INSERT INTO comments (id, post_id, content, user_id, created_at) VALUES
        (1, 1, 'Comment by user 1', 'user-1', '2024-01-01'),
        (2, 1, 'Comment by user 2', 'user-2', '2024-01-01'),
        (3, 2, 'Comment on draft', 'user-1', '2024-01-02');
    `);

    // Initialize auth and RLS
    authProvider = new SqliteAuthProvider(db, {
      jwtSecret: 'test-secret',
      sessionDuration: 3600,
    });
    rlsProvider = new SqliteRLSProvider(db);
    enforcer = new RLSASTEnforcer(rlsProvider);

    // Initialize API service
    adapter = new SqliteAdapter(db);
    apiService = new ApiService({ db: adapter });
  });

  describe('Anonymous user access', () => {
    test('Can only see published posts when RLS is enabled', async () => {
      // Enable RLS and create policy
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'anon_read_published',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: 'published = 1',
      });

      const context: RequestContext = { role: 'anon' };

      // Execute query via ApiService with RLS enforcement
      const response = await apiService.execute(
        {
          table: 'posts',
          queryString: '',
        },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      expect(response.data).toHaveLength(2); // Only published posts
      expect(response.data.every((r: any) => r.published === 1)).toBe(true);
    });

    test('Cannot insert posts when no INSERT policy exists', async () => {
      await rlsProvider.enableRLS('posts');

      const context: RequestContext = { role: 'anon' };

      // Attempt to insert a post
      const response = await apiService.insert(
        'posts',
        {
          title: 'Test Post',
          content: 'Test content',
          user_id: 'test-user',
        },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      // With no INSERT policy, the insert should be blocked (0 rows inserted)
      expect(response.data).toHaveLength(0);
    });
  });

  describe('Authenticated user access', () => {
    test('Can see own posts and published posts', async () => {
      // Setup: Create user and login
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');

      // Create context from session
      const user = await authProvider.verifySession(session.token);
      const context: RequestContext = {
        role: 'authenticated',
        uid: user!.id,
      };

      // Update test data to use actual user ID for some posts
      db.prepare('UPDATE posts SET user_id = ? WHERE id = 2').run(user!.id);

      // Enable RLS with policy
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'auth_read_own_or_published',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'user_id = auth.uid() OR published = 1',
      });

      // Execute query via ApiService
      const response = await apiService.execute(
        {
          table: 'posts',
          queryString: '',
        },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      // Should see: own draft post (id=2) + all published posts (id=1,3)
      expect(response.data).toHaveLength(3);
      const ids = response.data.map((p: any) => p.id).sort();
      expect(ids).toEqual([1, 2, 3]);
    });

    test('Can only update own posts', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');
      const user = await authProvider.verifySession(session.token);

      const context: RequestContext = {
        role: 'authenticated',
        uid: user!.id,
      };

      // Update test data to have posts owned by alice and another user
      db.prepare('UPDATE posts SET user_id = ? WHERE id IN (1, 2)').run(user!.id);
      db.prepare('UPDATE posts SET user_id = ? WHERE id = 3').run('other-user');

      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'update_own_posts',
        tableName: 'posts',
        command: 'UPDATE',
        role: 'authenticated',
        using: 'user_id = auth.uid()',
      });

      // Try to update all posts - should only update own posts
      const response = await apiService.update(
        {
          table: 'posts',
          queryString: '',
        },
        { title: 'Updated' },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      // Should only update posts owned by alice (2 posts)
      expect(response.data).toHaveLength(2);
      expect(response.data.every((p: any) => p.user_id === user!.id)).toBe(true);
    });

    test('Can only delete own comments', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');
      const user = await authProvider.verifySession(session.token);

      const context: RequestContext = {
        role: 'authenticated',
        uid: user!.id,
      };

      // Update test data - alice owns comments 1 and 3, user-2 owns comment 2
      db.prepare('UPDATE comments SET user_id = ? WHERE id IN (1, 3)').run(user!.id);

      await rlsProvider.enableRLS('comments');
      await rlsProvider.createPolicy({
        name: 'delete_own_comments',
        tableName: 'comments',
        command: 'DELETE',
        role: 'authenticated',
        using: 'user_id = auth.uid()',
      });

      // Try to delete all comments - should only delete own comments
      const response = await apiService.delete(
        {
          table: 'comments',
          queryString: '',
        },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      // Should only delete alice's comments (2 comments)
      expect(response.data).toHaveLength(2);
      expect(response.data.every((c: any) => c.user_id === user!.id)).toBe(true);

      // Verify user-2's comment still exists
      const remaining = db.prepare('SELECT * FROM comments WHERE id = 2').get();
      expect(remaining).toBeDefined();
    });
  });

  describe('Multiple policies', () => {
    test('Combines anon and authenticated policies correctly', async () => {
      await rlsProvider.enableRLS('posts');

      // Policy for anonymous users
      await rlsProvider.createPolicy({
        name: 'anon_read_published',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: 'published = 1',
      });

      // Policy for authenticated users
      await rlsProvider.createPolicy({
        name: 'auth_read_own',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'user_id = auth.uid()',
      });

      // Policy for all roles (PUBLIC)
      await rlsProvider.createPolicy({
        name: 'public_not_deleted',
        tableName: 'posts',
        command: 'SELECT',
        role: 'PUBLIC',
        using: 'id > 0', // Simple condition to ensure posts exist
      });

      // Test as authenticated user
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');
      const user = await authProvider.verifySession(session.token);

      // Update a draft post to be owned by alice
      db.prepare('UPDATE posts SET user_id = ? WHERE id = 2').run(user!.id);

      const context: RequestContext = {
        role: 'authenticated',
        uid: user!.id,
      };

      // Execute query - should see own posts + PUBLIC allowed posts
      const response = await apiService.execute(
        {
          table: 'posts',
          queryString: '',
        },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      // Should see all posts (authenticated policy allows own, PUBLIC allows all)
      expect(response.data).toHaveLength(3);
    });
  });

  describe('Policy migration workflow', () => {
    test('Parse and apply RLS policies from SQL migration', async () => {
      const migration = `
        -- Enable RLS on posts table
        ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

        -- Allow authenticated users to read their own posts
        CREATE POLICY read_own_posts ON posts
          FOR SELECT
          TO authenticated
          USING (user_id = auth.uid());

        -- Allow authenticated users to insert their own posts
        CREATE POLICY insert_own_posts ON posts
          FOR INSERT
          TO authenticated
          WITH CHECK (user_id = auth.uid());

        -- Allow public to read published posts
        CREATE POLICY read_published ON posts
          FOR SELECT
          TO PUBLIC
          USING (published = true);
      `;

      // Parse each statement
      const statements = migration
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => parseRLSStatement(s + ';'))
        .filter(stmt => stmt !== null);

      // Apply statements
      for (const stmt of statements) {
        if (stmt!.type === 'enable_rls') {
          await rlsProvider.enableRLS(stmt.tableName);
        } else if (stmt!.type === 'create_policy') {
          await rlsProvider.createPolicy(stmt.policy);
        }
      }

      // Verify RLS is enabled
      expect(await rlsProvider.isRLSEnabled('posts')).toBe(true);

      // Verify policies were created
      const policies = await rlsProvider.getPolicies('posts');
      expect(policies).toHaveLength(3);
      expect(policies.map(p => p.name)).toContain('read_own_posts');
      expect(policies.map(p => p.name)).toContain('insert_own_posts');
      expect(policies.map(p => p.name)).toContain('read_published');
    });
  });

  describe('Complex scenarios', () => {
    test('User can read own draft and others published posts', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');
      const user = await authProvider.verifySession(session.token);

      // Update test data to use actual user ID
      db.prepare('UPDATE posts SET user_id = ? WHERE user_id = ?').run(user!.id, 'user-1');

      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'read_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'user_id = auth.uid() OR published = 1',
      });

      const context: RequestContext = {
        role: 'authenticated',
        uid: user!.id,
      };

      // Execute query via ApiService
      const response = await apiService.execute(
        {
          table: 'posts',
          queryString: '',
        },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      // Should see own draft (id=2) and all published posts (id=1,3)
      expect(response.data).toHaveLength(3);
      expect(response.data.find((r: any) => r.id === 2)).toBeDefined(); // Own draft
      expect(response.data.find((r: any) => r.id === 3)).toBeDefined(); // Others' published
    });

    test('Combining table filters with RLS policies', async () => {
      await authProvider.signup('alice', 'password123');
      const session = await authProvider.login('alice', 'password123');
      const user = await authProvider.verifySession(session.token);

      // Update test data to use actual user ID
      db.prepare('UPDATE posts SET user_id = ? WHERE id = 2').run(user!.id);

      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'auth_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'authenticated',
        using: 'user_id = auth.uid() OR published = 1',
      });

      const context: RequestContext = {
        role: 'authenticated',
        uid: user!.id,
      };

      // Query with WHERE clause filtering by date
      const response = await apiService.execute(
        {
          table: 'posts',
          queryString: 'created_at=gte.2024-01-02',
        },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      // Should return posts matching both user filter AND RLS policy
      // Posts created >= 2024-01-02 are id=2 and id=3
      // Policy allows own posts (id=2) and published posts (id=1,3)
      // Combined: id=2 (own, matches date) and id=3 (published, matches date)
      expect(response.data).toHaveLength(2);
      const ids = response.data.map((p: any) => p.id).sort();
      expect(ids).toEqual([2, 3]);
    });
  });

  describe('Edge cases', () => {
    test('Works when no user is authenticated', async () => {
      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'anon_policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: 'published = 1',
      });

      const context: RequestContext = { role: 'anon' };

      // Execute query as anonymous user
      const response = await apiService.execute(
        {
          table: 'posts',
          queryString: '',
        },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      // Should only see published posts
      expect(response.data).toHaveLength(2);
      expect(response.data.every((p: any) => p.published === 1)).toBe(true);
    });

    test('Handles expired sessions gracefully', async () => {
      const shortProvider = new SqliteAuthProvider(db, {
        jwtSecret: 'test-secret',
        sessionDuration: -1, // Expired
      });

      await shortProvider.signup('alice', 'password123');
      const session = await shortProvider.login('alice', 'password123');

      // Session should be expired
      const user = await authProvider.verifySession(session.token);
      expect(user).toBeNull();

      // Context should fall back to anon
      const context: RequestContext = { role: 'anon' };

      await rlsProvider.enableRLS('posts');
      await rlsProvider.createPolicy({
        name: 'policy',
        tableName: 'posts',
        command: 'SELECT',
        role: 'anon',
        using: 'published = 1',
      });

      // Execute query with expired session (falls back to anon)
      const response = await apiService.execute(
        {
          table: 'posts',
          queryString: '',
        },
        {
          rlsEnforcer: enforcer,
          requestContext: context,
        }
      );

      // Should only see published posts
      expect(response.data).toHaveLength(2);
      expect(response.data.every((p: any) => p.published === 1)).toBe(true);
    });
  });
});
