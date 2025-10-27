/**
 * SQL Identifier Utilities
 *
 * Shared utilities for handling SQL identifiers (table/column names)
 * and string literals consistently across the codebase.
 */

/**
 * Escape a SQL identifier by wrapping in double quotes and escaping internal quotes
 *
 * Used for table names, column names, and other identifiers in SQL queries.
 * SQLite uses double quotes for identifiers.
 *
 * @param identifier - The identifier to escape
 * @returns Escaped identifier wrapped in double quotes
 *
 * @example
 * escapeIdentifier('users') // => "users"
 * escapeIdentifier('user"s') // => "user""s"
 */
export function escapeIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Remove surrounding quotes from an identifier
 *
 * Handles both single and double quotes.
 *
 * @param identifier - The quoted identifier
 * @returns Identifier without surrounding quotes
 *
 * @example
 * stripQuotes('"users"') // => 'users'
 * stripQuotes("'users'") // => 'users'
 * stripQuotes('users') // => 'users'
 */
export function stripQuotes(identifier: string): string {
  return identifier.replace(/^["']|["']$/g, '');
}

/**
 * Remove double quotes from an identifier
 *
 * Only removes quotes if the identifier is wrapped in double quotes.
 * If not quoted, returns the identifier as-is.
 *
 * @param identifier - The identifier to unquote
 * @returns Unquoted identifier
 *
 * @example
 * unquoteIdentifier('"users"') // => 'users'
 * unquoteIdentifier('users') // => 'users'
 */
export function unquoteIdentifier(identifier: string): string {
  if (identifier.startsWith('"') && identifier.endsWith('"')) {
    return identifier.substring(1, identifier.length - 1);
  }
  return identifier;
}

/**
 * Escape a SQL string literal by doubling single quotes
 *
 * Used for escaping string values in SQL to prevent injection attacks.
 * SQLite uses single quotes for string literals.
 *
 * @param str - The string to escape
 * @returns Escaped string (NOT wrapped in quotes)
 *
 * @example
 * escapeSqlString("it's") // => "it''s"
 * escapeSqlString("hello") // => "hello"
 */
export function escapeSqlString(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Unescape a SQL string literal by converting doubled single quotes back to single
 *
 * Reverses the escaping done by escapeSqlString.
 *
 * @param str - The escaped string
 * @returns Unescaped string
 *
 * @example
 * unescapeSqlString("it''s") // => "it's"
 * unescapeSqlString("hello") // => "hello"
 */
export function unescapeSqlString(str: string): string {
  return str.replace(/''/g, "'");
}
