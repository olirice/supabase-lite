/**
 * Test Database Setup for SQLite Integration Tests
 *
 * Creates an in-memory SQLite database with sample data
 * to verify compiled SQL queries actually work.
 */

import Database from 'better-sqlite3';

export interface TestDatabase {
  db: Database.Database;
  close: () => void;
}

/**
 * Create an in-memory test database with sample schema and data
 */
export function createTestDatabase(): TestDatabase {
  const db = new Database(':memory:');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create users table
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      age INTEGER,
      active INTEGER DEFAULT 1,
      verified INTEGER DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create posts table
  db.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      author_id INTEGER NOT NULL,
      status TEXT DEFAULT 'draft',
      published_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id)
    )
  `);

  // Create products table
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT,
      in_stock INTEGER DEFAULT 1,
      discontinued_at TEXT
    )
  `);

  // Insert sample users
  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, age, active, verified, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(1, 'John Smith', 'john@example.com', 30, 1, 1, null);
  insertUser.run(2, 'Jane Doe', 'jane@example.com', 25, 1, 1, null);
  insertUser.run(3, 'Bob Johnson', 'bob@example.com', 35, 1, 0, null);
  insertUser.run(4, 'Alice Brown', 'alice@gmail.com', 28, 0, 1, null);
  insertUser.run(5, 'Charlie Wilson', 'charlie@yahoo.com', 42, 1, 1, '2024-01-01');

  // Insert sample posts
  const insertPost = db.prepare(`
    INSERT INTO posts (id, title, content, author_id, status, published_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertPost.run(1, 'First Post', 'Hello world', 1, 'published', '2024-01-01');
  insertPost.run(2, 'Second Post', 'More content', 1, 'published', '2024-01-02');
  insertPost.run(3, 'Draft Post', 'Not published yet', 2, 'draft', null);
  insertPost.run(4, 'Another Post', 'Some text', 3, 'published', '2024-01-03');
  insertPost.run(5, 'Archived Post', 'Old content', 2, 'archived', '2023-12-01');

  // Insert sample products
  const insertProduct = db.prepare(`
    INSERT INTO products (id, name, description, price, category, in_stock, discontinued_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insertProduct.run(1, 'Widget', 'A useful widget', 19.99, 'tools', 1, null);
  insertProduct.run(2, 'Gadget', 'An amazing gadget', 29.99, 'electronics', 1, null);
  insertProduct.run(3, 'Doohickey', 'A classic doohickey', 9.99, 'tools', 0, null);
  insertProduct.run(4, 'Gizmo', 'The best gizmo', 39.99, 'electronics', 1, '2024-01-01');
  insertProduct.run(5, 'Thingamajig', 'A mysterious thingamajig', 14.99, 'misc', 1, null);

  return {
    db,
    close: () => db.close(),
  };
}

/**
 * Helper to execute a SELECT query and return all rows
 */
export function executeQuery(db: Database.Database, sql: string): unknown[] {
  const stmt = db.prepare(sql);
  return stmt.all();
}

/**
 * Helper to count rows matching a WHERE clause
 */
export function countRows(db: Database.Database, table: string, whereClause: string): number {
  const sql = whereClause
    ? `SELECT COUNT(*) as count FROM ${table} WHERE ${whereClause}`
    : `SELECT COUNT(*) as count FROM ${table}`;

  const result = db.prepare(sql).get() as { count: number };
  return result.count;
}
