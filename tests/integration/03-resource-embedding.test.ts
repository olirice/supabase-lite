/**
 * Integration Tests - Resource Embedding
 *
 * Tests JOIN generation for embedded resources (relationships).
 * Follows PostgREST embedding syntax: table(columns)
 *
 * TDD: Write tests first, then implement JOIN generation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { QueryParser } from '../../src/parser/index.js';
import { SQLCompiler } from '../../src/compiler/index.js';
import { SchemaIntrospector } from '../../src/schema/index.js';
import { createTestDatabase, type TestDatabase } from '../fixtures/test-db.js';

describe('Integration - Resource Embedding', () => {
  let testDb: TestDatabase;
  let parser: QueryParser;
  let compiler: SQLCompiler;
  let schema: any; // DatabaseSchema

  beforeEach(() => {
    testDb = createTestDatabase();
    parser = new QueryParser();

    // Introspect schema
    const introspector = new SchemaIntrospector(testDb.db);
    schema = introspector.introspect();

    // Create compiler with schema
    compiler = new SQLCompiler(schema);
  });

  afterEach(() => {
    testDb.close();
  });

  describe('Many-to-One Embedding (Foreign Key)', () => {
    test('embed single related resource - posts with author', () => {
      // posts.author_id → users.id (many posts belong to one user)
      const ast = parser.parse('http://localhost/posts?select=id,title,author(name,email)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(5); // 5 posts
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('title');
      expect(result[0]).toHaveProperty('author');

      // Author should be an object with name and email (JSON string needs parsing)
      const firstPost = result[0] as any;
      const author = JSON.parse(firstPost.author);
      expect(typeof author).toBe('object');
      expect(author).toHaveProperty('name');
      expect(author).toHaveProperty('email');
    });

    test('embed with alias - creator instead of author', () => {
      const ast = parser.parse('http://localhost/posts?select=id,title,creator:author(name)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(5);
      expect(result[0]).toHaveProperty('creator');
      expect(result[0]).not.toHaveProperty('author');

      const firstPost = result[0] as any;
      const creator = JSON.parse(firstPost.creator);
      expect(typeof creator).toBe('object');
      expect(creator).toHaveProperty('name');
    });

    test('embed with wildcard - all author columns', () => {
      const ast = parser.parse('http://localhost/posts?select=id,author(*)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(5);

      const firstPost = result[0] as any;
      const author = JSON.parse(firstPost.author);
      expect(author).toHaveProperty('id');
      expect(author).toHaveProperty('name');
      expect(author).toHaveProperty('email');
      expect(author).toHaveProperty('age');
    });

    test('embed with filters on parent table', () => {
      const ast = parser.parse('http://localhost/posts?select=id,title,author(name)&status=eq.published');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      // Only published posts
      expect(result).toHaveLength(3);
      expect(result.every((row: any) => {
        const author = JSON.parse(row.author);
        return author && typeof author === 'object';
      })).toBe(true);
    });

    test('multiple embeds in one query', () => {
      // If we had a posts.category_id → categories.id relationship
      // For now, test multiple author embeds with different aliases
      const ast = parser.parse('http://localhost/posts?select=id,author(name),creator:author(email)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(5);

      const firstPost = result[0] as any;
      expect(firstPost).toHaveProperty('author');
      expect(firstPost).toHaveProperty('creator');

      const author = JSON.parse(firstPost.author);
      const creator = JSON.parse(firstPost.creator);
      expect(author).toHaveProperty('name');
      expect(creator).toHaveProperty('email');
    });
  });

  describe('One-to-Many Embedding (Reverse Foreign Key)', () => {
    test('embed collection - user with their posts', () => {
      // users → posts (one user has many posts)
      // Reverse of posts.author_id → users.id
      const ast = parser.parse('http://localhost/users?select=id,name,posts(id,title)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(5); // 5 users

      const firstUser = result[0] as any;
      expect(firstUser).toHaveProperty('posts');

      const posts = JSON.parse(firstUser.posts);
      expect(Array.isArray(posts)).toBe(true);

      // John Smith (id=1) has 2 posts
      expect(posts).toHaveLength(2);
      expect(posts[0]).toHaveProperty('id');
      expect(posts[0]).toHaveProperty('title');
    });

    test('embed empty collection - user with no posts', () => {
      const ast = parser.parse('http://localhost/users?select=id,name,posts(*)&id=eq.4');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);

      const alice = result[0] as any;
      expect(alice.posts).toBeDefined();

      const posts = JSON.parse(alice.posts);
      expect(Array.isArray(posts)).toBe(true);
      expect(posts).toHaveLength(0); // Alice has no posts
    });

    test('embed collection with alias', () => {
      const ast = parser.parse('http://localhost/users?select=id,name,articles:posts(title)');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(5);

      const firstUser = result[0] as any;
      expect(firstUser).toHaveProperty('articles');
      expect(firstUser).not.toHaveProperty('posts');

      const articles = JSON.parse(firstUser.articles);
      expect(Array.isArray(articles)).toBe(true);
    });
  });

  describe('Nested Embedding', () => {
    test('two-level nesting - posts with author and authors posts', () => {
      // This is complex: for each post, get author, and for each author, get their other posts
      // posts → author → posts (circular but at different levels)
      const ast = parser.parse('http://localhost/posts?select=id,title,author(name,posts(title))&id=eq.1');
      const compiled = compiler.compile(ast);

      const result = testDb.db.prepare(compiled.sql).all(...compiled.params);

      expect(result).toHaveLength(1);

      const post = result[0] as any;
      const author = JSON.parse(post.author);
      expect(author).toHaveProperty('name');
      expect(author).toHaveProperty('posts');

      // Note: SQLite's json_object() automatically parses nested JSON
      // so author.posts is already an array, not a JSON string
      expect(Array.isArray(author.posts)).toBe(true);
      // John Smith has 2 posts total
      expect(author.posts).toHaveLength(2);
    });
  });

  describe('Error Cases', () => {
    test('throws error for non-existent table', () => {
      const ast = parser.parse('http://localhost/posts?select=id,nonexistent(*)');

      expect(() => compiler.compile(ast)).toThrow(/table.*nonexistent/i);
    });

    test('throws error for no relationship', () => {
      // users and products have no foreign key relationship
      const ast = parser.parse('http://localhost/users?select=id,products(*)');

      expect(() => compiler.compile(ast)).toThrow(/relationship.*products/i);
    });
  });
});
