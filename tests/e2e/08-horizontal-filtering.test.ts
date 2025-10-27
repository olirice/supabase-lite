/**
 * E2E Tests - Horizontal Filtering on Embedded Resources
 *
 * Tests filtering nested/embedded resources - a key PostgREST feature.
 *
 * Syntax: /parent?select=child(cols)&child.column=operator.value
 *
 * This filters the embedded child rows without affecting parent row selection.
 * Each test creates its own isolated database.
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

describe('E2E - Horizontal Filtering on Embedded Resources', () => {
  describe('One-to-many filtering', () => {
    test('GET /users?select=name,posts(title)&posts.status=eq.published - filter embedded posts', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            status TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob');
          INSERT INTO posts (id, title, status, author_id) VALUES
            (1, 'Post 1', 'published', 1),
            (2, 'Post 2', 'draft', 1),
            (3, 'Post 3', 'published', 1),
            (4, 'Post 4', 'published', 2);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?select=name,posts(title)&posts.status=eq.published');

      expect(res.status).toBe(200);
      const data = await res.json();

      // Both users should be returned
      expect(data).toHaveLength(2);

      // Alice should have 2 published posts (not 3 total)
      const alice = data.find((u: any) => u.name === 'Alice');
      expect(alice.posts).toHaveLength(2);
      expect(alice.posts.map((p: any) => p.title)).toEqual(['Post 1', 'Post 3']);

      // Bob should have 1 published post
      const bob = data.find((u: any) => u.name === 'Bob');
      expect(bob.posts).toHaveLength(1);
      expect(bob.posts[0].title).toBe('Post 4');

      adapter.close();
    });

    test('GET /users?select=name,posts(title,status)&posts.status=eq.draft - filter shows only drafts', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            status TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob');
          INSERT INTO posts (id, title, status, author_id) VALUES
            (1, 'Post 1', 'published', 1),
            (2, 'Post 2', 'draft', 1),
            (3, 'Post 3', 'draft', 2);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?select=name,posts(title,status)&posts.status=eq.draft');

      expect(res.status).toBe(200);
      const data = await res.json();

      const alice = data.find((u: any) => u.name === 'Alice');
      expect(alice.posts).toHaveLength(1);
      expect(alice.posts[0].status).toBe('draft');

      const bob = data.find((u: any) => u.name === 'Bob');
      expect(bob.posts).toHaveLength(1);
      expect(bob.posts[0].status).toBe('draft');

      adapter.close();
    });

    test('GET /users?select=name,posts(title)&posts.view_count=gte.100 - numeric filter on embedded', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            view_count INTEGER,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, view_count, author_id) VALUES
            (1, 'Popular Post', 500, 1),
            (2, 'Unpopular Post', 10, 1),
            (3, 'Viral Post', 1000, 1);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?select=name,posts(title,view_count)&posts.view_count=gte.100');

      expect(res.status).toBe(200);
      const data = await res.json();

      const alice = data[0];
      expect(alice.posts).toHaveLength(2);
      expect(alice.posts.every((p: any) => p.view_count >= 100)).toBe(true);

      adapter.close();
    });

    test('GET /users?select=name,posts(title)&posts.title=like.*Important* - pattern matching on embedded', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Important Update', 1),
            (2, 'Random Post', 1),
            (3, 'Very Important News', 1);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?select=name,posts(title)&posts.title=like.*Important*');

      expect(res.status).toBe(200);
      const data = await res.json();

      const alice = data[0];
      expect(alice.posts).toHaveLength(2);
      expect(alice.posts.every((p: any) => p.title.includes('Important'))).toBe(true);

      adapter.close();
    });
  });

  describe('Many-to-one filtering', () => {
    // NOTE: This is "vertical filtering" - filtering parent rows based on embedded criteria
    // Requires JOIN in main query.
    // See: https://postgrest.org/en/stable/references/api/resource_embedding.html#embedding-with-top-level-filtering
    test('GET /posts?select=title,author(name)&author.status=eq.active - filter by embedded author', async () => {
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

      const res = await app.request('/posts?select=title,author:users(name)&author.status=eq.active');

      expect(res.status).toBe(200);
      const data = await res.json();

      // Only Alice's post should be returned (author is active)
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Post by Alice');
      expect(data[0].author.name).toBe('Alice');

      adapter.close();
    });
  });

  describe('Multiple filters on embedded', () => {
    test('GET /users?select=posts(title)&posts.status=eq.published&posts.view_count=gte.100', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            status TEXT,
            view_count INTEGER,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, status, view_count, author_id) VALUES
            (1, 'Popular Published', 'published', 500, 1),
            (2, 'Unpopular Published', 'published', 50, 1),
            (3, 'Popular Draft', 'draft', 500, 1);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request(
        '/users?select=name,posts(title,status,view_count)&posts.status=eq.published&posts.view_count=gte.100'
      );

      expect(res.status).toBe(200);
      const data = await res.json();

      const alice = data[0];
      expect(alice.posts).toHaveLength(1);
      expect(alice.posts[0].title).toBe('Popular Published');
      expect(alice.posts[0].status).toBe('published');
      expect(alice.posts[0].view_count).toBe(500);

      adapter.close();
    });
  });

  describe('Ordering embedded resources', () => {
    test('GET /users?select=posts(title)&posts.order=created_at.desc - order embedded posts', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            created_at TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, created_at, author_id) VALUES
            (1, 'First Post', '2024-01-01', 1),
            (2, 'Third Post', '2024-01-03', 1),
            (3, 'Second Post', '2024-01-02', 1);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?select=name,posts(title,created_at)&posts.order=created_at.desc');

      expect(res.status).toBe(200);
      const data = await res.json();

      const alice = data[0];
      expect(alice.posts).toHaveLength(3);
      expect(alice.posts[0].title).toBe('Third Post');
      expect(alice.posts[1].title).toBe('Second Post');
      expect(alice.posts[2].title).toBe('First Post');

      adapter.close();
    });
  });

  describe('Limiting embedded resources', () => {
    test('GET /users?select=posts(title)&posts.limit=2 - limit embedded posts', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post 1', 1),
            (2, 'Post 2', 1),
            (3, 'Post 3', 1),
            (4, 'Post 4', 1);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?select=name,posts(title)&posts.limit=2');

      expect(res.status).toBe(200);
      const data = await res.json();

      const alice = data[0];
      expect(alice.posts).toHaveLength(2);

      adapter.close();
    });
  });

  describe('Nested filtering', () => {
    // NOTE: This is nested "vertical filtering" - filtering parent rows based on nested embedded criteria
    // Requires JOIN in main query with nested path.
    test('GET /comments?select=content,post(title,author(name))&post.author.status=eq.active', async () => {
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
  });

  describe('Edge cases', () => {
    test('User with no matching embedded posts returns empty array', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);
          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT,
            status TEXT,
            author_id INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob');
          INSERT INTO posts (id, title, status, author_id) VALUES
            (1, 'Post 1', 'draft', 1);
        `
      );

      const app = createServer({ db: adapter });

      const res = await app.request('/users?select=name,posts(title)&posts.status=eq.published');

      expect(res.status).toBe(200);
      const data = await res.json();

      // Both users returned, but with empty posts arrays
      expect(data).toHaveLength(2);
      expect(data[0].posts).toEqual([]);
      expect(data[1].posts).toEqual([]);

      adapter.close();
    });
  });
});
