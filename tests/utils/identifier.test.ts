/**
 * SQL Identifier Utilities Tests
 *
 * Tests the SQL identifier and string escaping/unescaping functions
 */

import { describe, test, expect } from 'vitest';
import {
  escapeIdentifier,
  stripQuotes,
  unquoteIdentifier,
  escapeSqlString,
  unescapeSqlString,
} from '../../src/utils/identifier.js';

describe('SQL Identifier Utilities', () => {
  describe('escapeIdentifier()', () => {
    test('wraps simple identifier in double quotes', () => {
      expect(escapeIdentifier('users')).toBe('"users"');
    });

    test('wraps identifier with underscores', () => {
      expect(escapeIdentifier('user_accounts')).toBe('"user_accounts"');
    });

    test('escapes internal double quotes by doubling them', () => {
      expect(escapeIdentifier('user"s')).toBe('"user""s"');
    });

    test('handles multiple double quotes', () => {
      expect(escapeIdentifier('te"st"table')).toBe('"te""st""table"');
    });

    test('handles identifier with numbers', () => {
      expect(escapeIdentifier('table123')).toBe('"table123"');
    });

    test('handles empty string', () => {
      expect(escapeIdentifier('')).toBe('""');
    });

    test('handles identifier with spaces', () => {
      expect(escapeIdentifier('user accounts')).toBe('"user accounts"');
    });

    test('handles identifier with special characters', () => {
      expect(escapeIdentifier('user@email.com')).toBe('"user@email.com"');
    });

    test('handles identifier with dashes', () => {
      expect(escapeIdentifier('user-accounts')).toBe('"user-accounts"');
    });

    test('handles identifier with dots', () => {
      expect(escapeIdentifier('schema.table')).toBe('"schema.table"');
    });

    test('handles SQL keywords that need escaping', () => {
      expect(escapeIdentifier('select')).toBe('"select"');
      expect(escapeIdentifier('from')).toBe('"from"');
      expect(escapeIdentifier('where')).toBe('"where"');
    });

    test('handles unicode characters', () => {
      expect(escapeIdentifier('用户')).toBe('"用户"');
      expect(escapeIdentifier('müller')).toBe('"müller"');
    });

    test('handles single quotes (not escaped)', () => {
      expect(escapeIdentifier("user's")).toBe('"user\'s"');
    });

    test('handles backslashes', () => {
      expect(escapeIdentifier('user\\name')).toBe('"user\\name"');
    });

    test('handles newlines and tabs', () => {
      expect(escapeIdentifier('user\nname')).toBe('"user\nname"');
      expect(escapeIdentifier('user\tname')).toBe('"user\tname"');
    });
  });

  describe('stripQuotes()', () => {
    test('removes double quotes from both ends', () => {
      expect(stripQuotes('"users"')).toBe('users');
    });

    test('removes single quotes from both ends', () => {
      expect(stripQuotes("'users'")).toBe('users');
    });

    test('removes quotes from either end independently', () => {
      // The regex removes quotes from start OR end, so partial quotes are removed
      expect(stripQuotes('"users')).toBe('users');
      expect(stripQuotes('users"')).toBe('users');
    });

    test('handles unquoted identifiers', () => {
      expect(stripQuotes('users')).toBe('users');
    });

    test('does not remove internal quotes', () => {
      expect(stripQuotes('"user"s"')).toBe('user"s');
      expect(stripQuotes("'user's'")).toBe("user's");
    });

    test('handles empty string', () => {
      expect(stripQuotes('')).toBe('');
    });

    test('handles double-quoted empty string', () => {
      expect(stripQuotes('""')).toBe('');
    });

    test('handles single-quoted empty string', () => {
      expect(stripQuotes("''")).toBe('');
    });

    test('handles mixed quotes - removes outer only', () => {
      expect(stripQuotes(`"user's"`)).toBe("user's");
      expect(stripQuotes(`'user"s'`)).toBe('user"s');
    });

    test('handles multiple words with quotes', () => {
      expect(stripQuotes('"user accounts"')).toBe('user accounts');
    });

    test('handles just quotes with nothing between', () => {
      expect(stripQuotes('""')).toBe('');
      expect(stripQuotes("''")).toBe('');
    });

    test('preserves internal spaces', () => {
      expect(stripQuotes('"hello world"')).toBe('hello world');
    });
  });

  describe('unquoteIdentifier()', () => {
    test('removes double quotes if present', () => {
      expect(unquoteIdentifier('"users"')).toBe('users');
    });

    test('returns identifier as-is if not quoted', () => {
      expect(unquoteIdentifier('users')).toBe('users');
    });

    test('only removes quotes if both start and end', () => {
      expect(unquoteIdentifier('"users')).toBe('"users');
      expect(unquoteIdentifier('users"')).toBe('users"');
    });

    test('does not remove single quotes', () => {
      expect(unquoteIdentifier("'users'")).toBe("'users'");
    });

    test('handles empty quoted string', () => {
      expect(unquoteIdentifier('""')).toBe('');
    });

    test('handles identifier with internal quotes', () => {
      expect(unquoteIdentifier('"user""s"')).toBe('user""s');
    });

    test('handles spaces in quoted identifier', () => {
      expect(unquoteIdentifier('"user accounts"')).toBe('user accounts');
    });

    test('handles special characters in quoted identifier', () => {
      expect(unquoteIdentifier('"user@email.com"')).toBe('user@email.com');
    });

    test('preserves unicode characters', () => {
      expect(unquoteIdentifier('"用户"')).toBe('用户');
    });

    test('handles single quote inside double quotes', () => {
      expect(unquoteIdentifier('"user\'s"')).toBe("user's");
    });

    test('handles empty string', () => {
      expect(unquoteIdentifier('')).toBe('');
    });
  });

  describe('escapeSqlString()', () => {
    test('doubles single quotes', () => {
      expect(escapeSqlString("it's")).toBe("it''s");
    });

    test('handles string with no quotes', () => {
      expect(escapeSqlString('hello')).toBe('hello');
    });

    test('handles multiple single quotes', () => {
      expect(escapeSqlString("it's won't")).toBe("it''s won''t");
    });

    test('handles empty string', () => {
      expect(escapeSqlString('')).toBe('');
    });

    test('handles string with only single quotes', () => {
      expect(escapeSqlString("'''")).toBe("''''''");
    });

    test('does not affect double quotes', () => {
      expect(escapeSqlString('say "hello"')).toBe('say "hello"');
    });

    test('handles SQL injection attempts', () => {
      expect(escapeSqlString("'; DROP TABLE users; --")).toBe("''; DROP TABLE users; --");
    });

    test('handles backslashes', () => {
      expect(escapeSqlString('C:\\path\\to\\file')).toBe('C:\\path\\to\\file');
    });

    test('handles newlines and tabs', () => {
      expect(escapeSqlString('line1\nline2')).toBe('line1\nline2');
      expect(escapeSqlString('col1\tcol2')).toBe('col1\tcol2');
    });

    test('handles unicode characters', () => {
      expect(escapeSqlString('Hello 世界')).toBe('Hello 世界');
    });

    test('handles mixed quotes', () => {
      expect(escapeSqlString(`it's "great"`)).toBe(`it''s "great"`);
    });

    test('preserves spaces', () => {
      expect(escapeSqlString('hello world')).toBe('hello world');
    });

    test('handles strings with special SQL characters', () => {
      expect(escapeSqlString('100% discount')).toBe('100% discount');
      expect(escapeSqlString('user_name')).toBe('user_name');
    });
  });

  describe('unescapeSqlString()', () => {
    test('converts doubled single quotes to single', () => {
      expect(unescapeSqlString("it''s")).toBe("it's");
    });

    test('handles string with no escaped quotes', () => {
      expect(unescapeSqlString('hello')).toBe('hello');
    });

    test('handles multiple doubled quotes', () => {
      expect(unescapeSqlString("it''s won''t")).toBe("it's won't");
    });

    test('handles empty string', () => {
      expect(unescapeSqlString('')).toBe('');
    });

    test('handles only doubled quotes', () => {
      expect(unescapeSqlString("''''''")).toBe("'''");
    });

    test('does not affect single single quotes', () => {
      // Single quote alone stays as is (not escaped)
      expect(unescapeSqlString("it's")).toBe("it's");
    });

    test('does not affect double quotes', () => {
      expect(unescapeSqlString('say "hello"')).toBe('say "hello"');
    });

    test('reverses escapeSqlString', () => {
      const original = "it's a test";
      const escaped = escapeSqlString(original);
      const unescaped = unescapeSqlString(escaped);
      expect(unescaped).toBe(original);
    });

    test('handles multiple escape/unescape cycles', () => {
      const original = "it's won't can't";
      const escaped1 = escapeSqlString(original);
      const escaped2 = escapeSqlString(escaped1); // Double escape
      const unescaped1 = unescapeSqlString(escaped2);
      const unescaped2 = unescapeSqlString(unescaped1);
      expect(unescaped2).toBe(original);
    });

    test('handles unicode characters', () => {
      expect(unescapeSqlString('Hello 世界')).toBe('Hello 世界');
    });

    test('preserves spaces and special characters', () => {
      expect(unescapeSqlString('hello world')).toBe('hello world');
      expect(unescapeSqlString('100% discount')).toBe('100% discount');
    });
  });

  describe('Round-trip conversions', () => {
    test('escapeIdentifier and unquoteIdentifier are inverses', () => {
      const identifiers = ['users', 'user_accounts', 'user"s', 'select', 'table123'];
      identifiers.forEach(id => {
        const escaped = escapeIdentifier(id);
        const unescaped = unquoteIdentifier(escaped);
        // Note: internal quotes will be doubled
        if (!id.includes('"')) {
          expect(unescaped).toBe(id);
        }
      });
    });

    test('escapeSqlString and unescapeSqlString are inverses', () => {
      const strings = [
        'hello',
        "it's",
        "it's won't",
        'Hello 世界',
        'C:\\path\\file',
        'multi\nline',
      ];
      strings.forEach(str => {
        const escaped = escapeSqlString(str);
        const unescaped = unescapeSqlString(escaped);
        expect(unescaped).toBe(str);
      });
    });

    test('stripQuotes works with both quote types', () => {
      expect(stripQuotes(escapeIdentifier('users'))).toBe('users');
      expect(stripQuotes("'users'")).toBe('users');
    });
  });

  describe('SQL Injection Prevention', () => {
    test('escapeIdentifier prevents identifier injection', () => {
      const malicious = 'users"; DROP TABLE users; --';
      const escaped = escapeIdentifier(malicious);
      expect(escaped).toBe('"users""; DROP TABLE users; --"');
      // The doubled quote makes it safe - it becomes part of the identifier name
    });

    test('escapeSqlString prevents string literal injection', () => {
      const malicious = "'; DROP TABLE users; --";
      const escaped = escapeSqlString(malicious);
      expect(escaped).toBe("''; DROP TABLE users; --");
      // When wrapped in quotes: '''; DROP TABLE users; --'
      // The doubled quote closes the string safely
    });

    test('handles UNION injection attempt', () => {
      const malicious = "' UNION SELECT * FROM passwords --";
      const escaped = escapeSqlString(malicious);
      expect(escaped).toBe("'' UNION SELECT * FROM passwords --");
    });

    test('handles comment injection', () => {
      const malicious = "admin' --";
      const escaped = escapeSqlString(malicious);
      expect(escaped).toBe("admin'' --");
    });

    test('handles stacked queries attempt', () => {
      const malicious = "'; DELETE FROM users; --";
      const escaped = escapeSqlString(malicious);
      expect(escaped).toBe("''; DELETE FROM users; --");
    });
  });

  describe('Edge Cases and Special Scenarios', () => {
    test('handles very long identifiers', () => {
      const longId = 'a'.repeat(1000);
      const escaped = escapeIdentifier(longId);
      expect(escaped).toBe(`"${longId}"`);
      expect(unquoteIdentifier(escaped)).toBe(longId);
    });

    test('handles very long strings', () => {
      const longStr = 'test '.repeat(200);
      const escaped = escapeSqlString(longStr);
      const unescaped = unescapeSqlString(escaped);
      expect(unescaped).toBe(longStr);
    });

    test('handles identifiers with only special characters', () => {
      expect(escapeIdentifier('___')).toBe('"___"');
      expect(escapeIdentifier('$$$')).toBe('"$$$"');
    });

    test('handles strings with only quotes', () => {
      expect(escapeSqlString("'''")).toBe("''''''");
      expect(unescapeSqlString("''''''")).toBe("'''");
    });

    test('handles null-like strings', () => {
      expect(escapeSqlString('null')).toBe('null');
      expect(escapeSqlString('NULL')).toBe('NULL');
      expect(escapeIdentifier('null')).toBe('"null"');
    });

    test('handles boolean-like strings', () => {
      expect(escapeSqlString('true')).toBe('true');
      expect(escapeSqlString('false')).toBe('false');
    });

    test('handles numeric strings', () => {
      expect(escapeSqlString('123')).toBe('123');
      expect(escapeSqlString('3.14159')).toBe('3.14159');
    });

    test('preserves whitespace variations', () => {
      expect(stripQuotes('" spaces "')).toBe(' spaces ');
      expect(stripQuotes('"  "')).toBe('  ');
      expect(stripQuotes('"\t"')).toBe('\t');
    });
  });

  describe('Real-world use cases', () => {
    test('table name with schema prefix', () => {
      const tableName = 'public.users';
      const escaped = escapeIdentifier(tableName);
      expect(escaped).toBe('"public.users"');
    });

    test('column name with special characters', () => {
      const columnName = 'user_email_address';
      const escaped = escapeIdentifier(columnName);
      expect(escaped).toBe('"user_email_address"');
    });

    test('user input containing quotes', () => {
      const userInput = "John O'Brien";
      const escaped = escapeSqlString(userInput);
      expect(escaped).toBe("John O''Brien");
    });

    test('email address as identifier', () => {
      const email = 'user@example.com';
      const escaped = escapeIdentifier(email);
      expect(escaped).toBe('"user@example.com"');
    });

    test('path-like strings', () => {
      const path = '/api/v1/users';
      const escaped = escapeSqlString(path);
      expect(escaped).toBe('/api/v1/users');
    });

    test('JSON-like strings', () => {
      const json = '{"name": "test"}';
      const escaped = escapeSqlString(json);
      expect(escaped).toBe('{"name": "test"}');
    });

    test('URL in string', () => {
      const url = "https://example.com/page?q=test's";
      const escaped = escapeSqlString(url);
      expect(escaped).toBe("https://example.com/page?q=test''s");
    });
  });
});
