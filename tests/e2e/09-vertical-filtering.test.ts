/**
 * E2E Tests - Vertical Filtering
 *
 * Vertical filtering = filtering parent rows based on embedded resource criteria
 * This is different from horizontal filtering (filtering embedded resources).
 *
 * Key behavior:
 * - Many-to-one filters (posts.author.status) filter PARENT rows via JOIN
 * - One-to-many filters (users.posts.status) filter EMBEDDED resources (horizontal)
 *
 * Examples:
 * - `/posts?select=title,author:users(name)&author.status=eq.active`
 *   → Returns only posts where author.status = 'active' (filters parent posts)
 *
 * - `/users?select=name,posts(title)&posts.status=eq.published`
 *   → Returns all users, but only includes published posts in the embedding (horizontal)
 */

import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';

function createTestDb(schema: string, data?: string): SqliteAdapter {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  if (data) db.exec(data);
  return new SqliteAdapter(db);
}

describe('E2E - Vertical Filtering', () => {
  describe('Many-to-one vertical filtering', () => {
    test('Filter posts by author status (many-to-one)', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name, status) VALUES
            (1, 'Alice', 'active'),
            (2, 'Bob', 'inactive');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post by Alice', 1),
            (2, 'Post by Bob', 2);
        `
      );

      const app = createServer({ db: adapter });

      // Filter parent posts by embedded author status
      const res = await app.request('/posts?select=title,author:users(name)&author.status=eq.active');

      expect(res.status).toBe(200);
      const data = await res.json();

      // Only Alice's post should be returned (author is active)
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Post by Alice');
      expect(data[0].author.name).toBe('Alice');

      adapter.close();
    });

    test('Filter posts by author status without selecting author', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name, status) VALUES
            (1, 'Alice', 'active'),
            (2, 'Bob', 'inactive');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post by Alice', 1),
            (2, 'Post by Bob', 2);
        `
      );

      const app = createServer({ db: adapter });

      // Filter by author status even without selecting author
      const res = await app.request('/posts?select=title&author.status=eq.active');

      expect(res.status).toBe(200);
      const data = await res.json();

      // Only Alice's post should be returned
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Post by Alice');
      expect(data[0]).not.toHaveProperty('author'); // Author not selected

      adapter.close();
    });

    test('Filter comments by post author status (nested many-to-one)', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
          CREATE TABLE comments (
            id INTEGER PRIMARY KEY,
            content TEXT,
            post_id INTEGER,
            FOREIGN KEY (post_id) REFERENCES posts(id)
          );
        `,
        `
          INSERT INTO users (id, name, status) VALUES
            (1, 'Alice', 'active'),
            (2, 'Bob', 'inactive');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post by Alice', 1),
            (2, 'Post by Bob', 2);
          INSERT INTO comments (id, content, post_id) VALUES
            (1, 'Comment on Alice post', 1),
            (2, 'Comment on Bob post', 2);
        `
      );

      const app = createServer({ db: adapter });

      // Filter comments by post.author.status
      const res = await app.request(
        '/comments?select=content,post:posts(title,author:users(name))&post.author.status=eq.active'
      );

      expect(res.status).toBe(200);
      const data = await res.json();

      // Only comment on Alice's post (active author)
      expect(data).toHaveLength(1);
      expect(data[0].content).toBe('Comment on Alice post');
      expect(data[0].post.author.name).toBe('Alice');

      adapter.close();
    });

    test('Multiple vertical filters on same embedding', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, status TEXT, role TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name, status, role) VALUES
            (1, 'Alice', 'active', 'admin'),
            (2, 'Bob', 'active', 'user'),
            (3, 'Charlie', 'inactive', 'admin');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post by Alice', 1),
            (2, 'Post by Bob', 2),
            (3, 'Post by Charlie', 3);
        `
      );

      const app = createServer({ db: adapter });

      // Filter by both status AND role
      const res = await app.request(
        '/posts?select=title,author:users(name)&author.status=eq.active&author.role=eq.admin'
      );

      expect(res.status).toBe(200);
      const data = await res.json();

      // Only Alice's post (active admin)
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Post by Alice');
      expect(data[0].author.name).toBe('Alice');

      adapter.close();
    });

    test('Vertical filter with numeric comparison', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name, age) VALUES
            (1, 'Alice', 30),
            (2, 'Bob', 25);
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post by Alice', 1),
            (2, 'Post by Bob', 2);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/posts?select=title,author:users(name)&author.age=gte.28');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Post by Alice');

      adapter.close();
    });

    test('Vertical filter with pattern matching', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name, email) VALUES
            (1, 'Alice', 'alice@company.com'),
            (2, 'Bob', 'bob@external.com');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post by Alice', 1),
            (2, 'Post by Bob', 2);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/posts?select=title,author:users(name)&author.email=like.*@company.com');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Post by Alice');

      adapter.close();
    });
  });

  describe('Contrast with horizontal filtering', () => {
    test('Many-to-one (vertical) vs one-to-many (horizontal) behavior', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            status TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name, status) VALUES
            (1, 'Alice', 'active'),
            (2, 'Bob', 'inactive');
          INSERT INTO posts (id, title, status, author_id) VALUES
            (1, 'Published by Alice', 'published', 1),
            (2, 'Draft by Alice', 'draft', 1),
            (3, 'Published by Bob', 'published', 2);
        `
      );

      const app = createServer({ db: adapter });

      // VERTICAL filtering: posts.author.status filters parent posts
      const verticalRes = await app.request(
        '/posts?select=title,author:users(name)&author.status=eq.active'
      );
      const verticalData = await verticalRes.json();

      // Returns only Alice's posts (2 posts)
      expect(verticalData).toHaveLength(2);
      expect(verticalData.every((p: any) => p.author.name === 'Alice')).toBe(true);

      // HORIZONTAL filtering: users.posts.status filters embedded posts
      const horizontalRes = await app.request(
        '/users?select=name,posts(title)&posts.status=eq.published'
      );
      const horizontalData = await horizontalRes.json();

      // Returns both users, but only published posts in embedding
      expect(horizontalData).toHaveLength(2);
      const alice = horizontalData.find((u: any) => u.name === 'Alice');
      const bob = horizontalData.find((u: any) => u.name === 'Bob');

      expect(alice.posts).toHaveLength(1); // Only published post
      expect(alice.posts[0].title).toBe('Published by Alice');

      expect(bob.posts).toHaveLength(1); // Only published post
      expect(bob.posts[0].title).toBe('Published by Bob');

      adapter.close();
    });
  });

  describe('Edge cases', () => {
    test('No matching parent rows returns empty array', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name, status) VALUES
            (1, 'Alice', 'inactive');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post by Alice', 1);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/posts?select=title,author:users(name)&author.status=eq.active');

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data).toEqual([]);

      adapter.close();
    });

    test('Combine vertical filter with main table filter', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, status TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            views INTEGER,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name, status) VALUES
            (1, 'Alice', 'active'),
            (2, 'Bob', 'active');
          INSERT INTO posts (id, title, views, author_id) VALUES
            (1, 'Popular by Alice', 1000, 1),
            (2, 'Unpopular by Alice', 10, 1),
            (3, 'Popular by Bob', 500, 2);
        `
      );

      const app = createServer({ db: adapter });

      // Combine vertical filter (author.status) with main table filter (views)
      const res = await app.request(
        '/posts?select=title,author:users(name)&author.status=eq.active&views=gte.500'
      );

      expect(res.status).toBe(200);
      const data = await res.json();

      // Alice's popular post and Bob's popular post
      expect(data).toHaveLength(2);
      const titles = data.map((p: any) => p.title).sort();
      expect(titles).toEqual(['Popular by Alice', 'Popular by Bob']);

      adapter.close();
    });
  });
});
