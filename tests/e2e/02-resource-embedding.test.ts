/**
 * E2E Tests - Resource Embedding
 *
 * Tests resource embedding (JOINs) through the HTTP API.
 * Each test creates its own isolated database.
 */

import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import { createServer } from '../../src/api/server.js';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';

/**
 * Helper to create a test database with custom schema
 */
function createTestDb(schema: string, data?: string): SqliteAdapter {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  db.exec(schema);

  if (data) {
    db.exec(data);
  }

  return new SqliteAdapter(db);
}

describe('E2E - Resource Embedding', () => {
  describe('Many-to-One Embedding', () => {
    test('GET /posts?select=id,title,author(name,email)', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT,
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name, email) VALUES
            (1, 'Alice', 'alice@example.com'),
            (2, 'Bob', 'bob@example.com');

          INSERT INTO posts (id, title, content, author_id) VALUES
            (1, 'First Post', 'Content 1', 1),
            (2, 'Second Post', 'Content 2', 1),
            (3, 'Third Post', 'Content 3', 2);
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?select=id,title,author(name,email)');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(3);

      const firstPost = data[0];
      expect(firstPost).toMatchObject({
        id: 1,
        title: 'First Post',
      });
      expect(firstPost.author).toMatchObject({
        name: 'Alice',
        email: 'alice@example.com',
      });

      adapter.close();
    });

    test('GET /posts?select=id,creator:author(name) - with alias', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, author_id) VALUES (1, 'First Post', 1);
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?select=id,creator:author(name)');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0]).toHaveProperty('creator');
      expect(data[0]).not.toHaveProperty('author');
      expect(data[0].creator).toMatchObject({ name: 'Alice' });

      adapter.close();
    });
  });

  describe('One-to-Many Embedding', () => {
    test('GET /users?select=id,name,posts(id,title)', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES
            (1, 'Alice'),
            (2, 'Bob'),
            (3, 'Charlie');

          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post 1', 1),
            (2, 'Post 2', 1),
            (3, 'Post 3', 2);
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/users?select=id,name,posts(id,title)');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(3);

      const alice = data[0];
      expect(alice.name).toBe('Alice');
      expect(Array.isArray(alice.posts)).toBe(true);
      expect(alice.posts).toHaveLength(2);

      const bob = data[1];
      expect(bob.name).toBe('Bob');
      expect(bob.posts).toHaveLength(1);

      const charlie = data[2];
      expect(charlie.name).toBe('Charlie');
      expect(charlie.posts).toHaveLength(0); // Empty array

      adapter.close();
    });

    test('GET /users?select=articles:posts(title) - collection with alias', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Article 1', 1),
            (2, 'Article 2', 1);
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/users?select=id,articles:posts(title)');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data[0]).toHaveProperty('articles');
      expect(data[0]).not.toHaveProperty('posts');
      expect(Array.isArray(data[0].articles)).toBe(true);
      expect(data[0].articles).toHaveLength(2);

      adapter.close();
    });
  });

  describe('Nested Embedding', () => {
    test('GET /posts?select=id,author(name,posts(title))', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, author_id) VALUES
            (1, 'Post 1', 1),
            (2, 'Post 2', 1);
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?select=id,author(name,posts(title))&id=eq.1');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(1);

      const post = data[0];
      expect(post.author).toHaveProperty('name');
      expect(post.author.name).toBe('Alice');
      expect(Array.isArray(post.author.posts)).toBe(true);
      expect(post.author.posts).toHaveLength(2);

      adapter.close();
    });
  });

  describe('Embedding with filters', () => {
    test('GET /posts?select=author(name)&status=eq.published', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            status TEXT DEFAULT 'draft',
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users(id)
          );
        `,
        `
          INSERT INTO users (id, name) VALUES (1, 'Alice');
          INSERT INTO posts (id, title, status, author_id) VALUES
            (1, 'Published Post', 'published', 1),
            (2, 'Draft Post', 'draft', 1);
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?select=id,title,author(name)&status=eq.published');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].title).toBe('Published Post');
      expect(data[0].author.name).toBe('Alice');

      adapter.close();
    });
  });

  describe('Real-world scenarios', () => {
    test('E-commerce: orders with customer and products', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE customers (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL
          );

          CREATE TABLE orders (
            id INTEGER PRIMARY KEY,
            order_date TEXT NOT NULL,
            customer_id INTEGER NOT NULL,
            total REAL NOT NULL,
            FOREIGN KEY (customer_id) REFERENCES customers(id)
          );
        `,
        `
          INSERT INTO customers (id, name, email) VALUES
            (1, 'John Doe', 'john@example.com');

          INSERT INTO orders (id, order_date, customer_id, total) VALUES
            (1, '2024-01-15', 1, 99.99),
            (2, '2024-01-20', 1, 149.99);
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/orders?select=id,order_date,total,customer(name,email)');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        id: 1,
        order_date: '2024-01-15',
        total: 99.99,
      });
      expect(data[0].customer).toMatchObject({
        name: 'John Doe',
        email: 'john@example.com',
      });

      adapter.close();
    });

    test('Blog: posts with author and comment count', async () => {
      const adapter = createTestDb(
        `
          CREATE TABLE authors (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            bio TEXT
          );

          CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            published_at TEXT,
            author_id INTEGER NOT NULL,
            FOREIGN KEY (author_id) REFERENCES authors(id)
          );

          CREATE TABLE comments (
            id INTEGER PRIMARY KEY,
            content TEXT NOT NULL,
            post_id INTEGER NOT NULL,
            FOREIGN KEY (post_id) REFERENCES posts(id)
          );
        `,
        `
          INSERT INTO authors (id, name, bio) VALUES
            (1, 'Jane Smith', 'Tech writer');

          INSERT INTO posts (id, title, published_at, author_id) VALUES
            (1, 'Getting Started', '2024-01-01', 1),
            (2, 'Advanced Topics', '2024-01-15', 1);

          INSERT INTO comments (id, content, post_id) VALUES
            (1, 'Great post!', 1),
            (2, 'Very helpful', 1),
            (3, 'Thanks!', 2);
        `
      );

      const app = createServer({ db: adapter });
      const res = await app.request('/posts?select=id,title,author(name),comments(id)');

      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveLength(2);

      const firstPost = data[0];
      expect(firstPost.title).toBe('Getting Started');
      expect(firstPost.author.name).toBe('Jane Smith');
      expect(Array.isArray(firstPost.comments)).toBe(true);
      expect(firstPost.comments).toHaveLength(2);

      adapter.close();
    });
  });
});
