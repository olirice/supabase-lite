/**
 * SQLite Adapter Tests
 *
 * Minimal tests covering the SqliteAdapter surface area
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteAdapter } from '../../src/database/sqlite-adapter.js';

describe('SqliteAdapter', () => {
  let db: Database.Database;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    db = new Database(':memory:');
    adapter = new SqliteAdapter(db);
  });

  afterEach(() => {
    adapter.close();
  });

  describe('prepare() and PreparedStatement.first()', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT
        );
        INSERT INTO users (id, name, email) VALUES
          (1, 'Alice', 'alice@example.com'),
          (2, 'Bob', 'bob@example.com'),
          (3, 'Charlie', NULL);
      `);
    });

    test('first() returns first matching row', async () => {
      const stmt = adapter.prepare('SELECT * FROM users WHERE id = ?');
      const result = await stmt.first(1);

      expect(result).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
      });
    });

    test('first() returns null when no match found', async () => {
      const stmt = adapter.prepare('SELECT * FROM users WHERE id = ?');
      const result = await stmt.first(999);

      expect(result).toBeNull();
    });

    test('first() returns first row when multiple matches', async () => {
      const stmt = adapter.prepare('SELECT * FROM users WHERE id > ? ORDER BY id');
      const result = await stmt.first<{ id: number; name: string; email: string | null }>(0);

      expect(result).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
      });
    });

    test('first() handles NULL values', async () => {
      const stmt = adapter.prepare('SELECT * FROM users WHERE email IS NULL');
      const result = await stmt.first();

      expect(result).toEqual({
        id: 3,
        name: 'Charlie',
        email: null,
      });
    });

    test('first() with no params', async () => {
      const stmt = adapter.prepare('SELECT * FROM users WHERE id = 1');
      const result = await stmt.first();

      expect(result).toEqual({
        id: 1,
        name: 'Alice',
        email: 'alice@example.com',
      });
    });
  });

  describe('prepare() and PreparedStatement.run()', () => {
    beforeEach(() => {
      db.exec(`
        CREATE TABLE logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message TEXT NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
      `);
    });

    test('run() executes INSERT statement', async () => {
      const stmt = adapter.prepare('INSERT INTO logs (message) VALUES (?)');
      await stmt.run('Test log message');

      // Verify insertion
      const result = db.prepare('SELECT COUNT(*) as count FROM logs').get() as { count: number };
      expect(result.count).toBe(1);
    });

    test('run() executes UPDATE statement', async () => {
      db.exec("INSERT INTO logs (id, message) VALUES (1, 'Original')");

      const stmt = adapter.prepare('UPDATE logs SET message = ? WHERE id = ?');
      await stmt.run('Updated', 1);

      // Verify update
      const result = db.prepare('SELECT message FROM logs WHERE id = 1').get() as { message: string };
      expect(result.message).toBe('Updated');
    });

    test('run() executes DELETE statement', async () => {
      db.exec("INSERT INTO logs (id, message) VALUES (1, 'To delete')");

      const stmt = adapter.prepare('DELETE FROM logs WHERE id = ?');
      await stmt.run(1);

      // Verify deletion
      const result = db.prepare('SELECT COUNT(*) as count FROM logs').get() as { count: number };
      expect(result.count).toBe(0);
    });

    test('run() with multiple parameters', async () => {
      const stmt = adapter.prepare('INSERT INTO logs (id, message) VALUES (?, ?)');
      await stmt.run(100, 'Multi-param test');

      // Verify insertion
      const result = db.prepare('SELECT * FROM logs WHERE id = 100').get() as { id: number; message: string };
      expect(result.message).toBe('Multi-param test');
    });

    test('run() without parameters', async () => {
      const stmt = adapter.prepare('INSERT INTO logs (message) VALUES (\'No params\')');
      await stmt.run();

      // Verify insertion
      const result = db.prepare('SELECT COUNT(*) as count FROM logs').get() as { count: number };
      expect(result.count).toBe(1);
    });
  });

  describe('exec()', () => {
    test('exec() creates table', async () => {
      await adapter.exec(`
        CREATE TABLE test_table (
          id INTEGER PRIMARY KEY,
          value TEXT
        );
      `);

      // Verify table exists
      const result = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='test_table'
      `).get() as { name: string } | undefined;

      expect(result?.name).toBe('test_table');
    });

    test('exec() executes multiple statements', async () => {
      await adapter.exec(`
        CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);
        INSERT INTO items (id, name) VALUES (1, 'Item 1');
        INSERT INTO items (id, name) VALUES (2, 'Item 2');
      `);

      // Verify all statements executed
      const result = db.prepare('SELECT COUNT(*) as count FROM items').get() as { count: number };
      expect(result.count).toBe(2);
    });

    test('exec() with INSERT statements', async () => {
      db.exec('CREATE TABLE numbers (value INTEGER)');

      await adapter.exec(`
        INSERT INTO numbers (value) VALUES (1);
        INSERT INTO numbers (value) VALUES (2);
        INSERT INTO numbers (value) VALUES (3);
      `);

      const result = db.prepare('SELECT COUNT(*) as count FROM numbers').get() as { count: number };
      expect(result.count).toBe(3);
    });

    test('exec() with DROP statement', async () => {
      db.exec('CREATE TABLE temp_table (id INTEGER)');

      await adapter.exec('DROP TABLE temp_table');

      // Verify table doesn't exist
      const result = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='temp_table'
      `).get();

      expect(result).toBeUndefined();
    });

    test('exec() with ALTER TABLE', async () => {
      db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');

      await adapter.exec('ALTER TABLE users ADD COLUMN name TEXT');

      // Verify column added
      const result = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
      const columnNames = result.map(col => col.name);

      expect(columnNames).toContain('name');
    });

    test('exec() with CREATE INDEX', async () => {
      db.exec('CREATE TABLE posts (id INTEGER, title TEXT)');

      await adapter.exec('CREATE INDEX idx_posts_title ON posts(title)');

      // Verify index exists
      const result = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND name='idx_posts_title'
      `).get() as { name: string } | undefined;

      expect(result?.name).toBe('idx_posts_title');
    });
  });

  describe('getDb()', () => {
    test('returns underlying database instance', () => {
      const underlyingDb = adapter.getDb();
      expect(underlyingDb).toBe(db);
    });

    test('returned database is functional', () => {
      const underlyingDb = adapter.getDb();
      underlyingDb.exec('CREATE TABLE test (id INTEGER)');

      // Verify through adapter
      const result = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='test'
      `).get() as { name: string } | undefined;

      expect(result?.name).toBe('test');
    });
  });

  describe('close()', () => {
    test('closes database connection', () => {
      adapter.close();

      // Attempting to use closed database should throw
      expect(() => {
        db.prepare('SELECT 1').all();
      }).toThrow();
    });
  });

  describe('PreparedStatement.all()', () => {
    test('all() returns multiple rows', async () => {
      db.exec(`
        CREATE TABLE items (id INTEGER, name TEXT);
        INSERT INTO items VALUES (1, 'A'), (2, 'B'), (3, 'C');
      `);

      const stmt = adapter.prepare('SELECT * FROM items ORDER BY id');
      const result = await stmt.all();

      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toEqual({ id: 1, name: 'A' });
    });

    test('all() returns empty array when no matches', async () => {
      db.exec('CREATE TABLE empty_table (id INTEGER)');

      const stmt = adapter.prepare('SELECT * FROM empty_table');
      const result = await stmt.all();

      expect(result.rows).toEqual([]);
    });
  });
});
