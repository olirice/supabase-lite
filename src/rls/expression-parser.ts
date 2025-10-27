/**
 * SQL Expression Parser for RLS Policies
 *
 * Converts SQL WHERE expressions (like "published = 1") into WhereNode AST.
 * Supports common RLS policy patterns.
 */

import { unquoteIdentifier, unescapeSqlString } from '../utils/identifier.js';
import type { WhereNode, FilterNode, LogicalNode, FilterOperator } from '../parser/types.js';

/**
 * Parse a SQL expression string into a WhereNode AST
 *
 * Examples:
 *   "published = 1" → FilterNode
 *   "user_id = 'abc' OR public = true" → LogicalNode
 *   "id > 5 AND status = 'active'" → LogicalNode
 */
export function parseSQLExpression(sql: string): WhereNode {
  const tokens = tokenize(sql);
  const result = parseExpression(tokens, 0);
  return result.node;
}

interface ParseExpressionResult {
  node: WhereNode;
  nextIndex: number;
}

/**
 * Tokenize SQL expression
 */
function tokenize(sql: string): string[] {
  // Simple tokenizer - splits on whitespace and operators
  // while preserving quoted strings and parentheses
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;

    if ((char === "'" || char === '"') && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      inQuotes = true;
      quoteChar = char;
      current = char;
    } else if (char === quoteChar && inQuotes) {
      current += char;
      tokens.push(current);
      current = '';
      inQuotes = false;
      quoteChar = '';
    } else if (inQuotes) {
      current += char;
    } else if (char === '(' || char === ')') {
      if (current) {
        tokens.push(current);
        current = '';
      }
      tokens.push(char);
    } else if (char === ' ' || char === '\t' || char === '\n') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else if ('=<>!'.includes(char)) {
      // Handle operators - split them out
      if (current) {
        tokens.push(current);
        current = '';
      }
      // Look ahead for multi-char operators like !=, <=, >=, <>
      const nextChar = sql[i + 1];
      if ((char === '!' && nextChar === '=') ||
          (char === '<' && (nextChar === '=' || nextChar === '>')) ||
          (char === '>' && nextChar === '=')) {
        tokens.push(char + nextChar);
        i++; // Skip next char
      } else {
        tokens.push(char);
      }
    } else {
      current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Parse expression with precedence handling
 */
function parseExpression(tokens: string[], startIndex: number): ParseExpressionResult {
  return parseOrExpression(tokens, startIndex);
}

/**
 * Parse OR expression (lowest precedence)
 */
function parseOrExpression(tokens: string[], startIndex: number): ParseExpressionResult {
  let result = parseAndExpression(tokens, startIndex);
  const conditions: WhereNode[] = [result.node];
  let index = result.nextIndex;

  while (index < tokens.length && tokens[index]?.toUpperCase() === 'OR') {
    index++; // Skip OR
    result = parseAndExpression(tokens, index);
    conditions.push(result.node);
    index = result.nextIndex;
  }

  if (conditions.length === 1) {
    return { node: conditions[0]!, nextIndex: index };
  }

  return {
    node: { type: 'or', conditions },
    nextIndex: index,
  };
}

/**
 * Parse AND expression (higher precedence than OR)
 */
function parseAndExpression(tokens: string[], startIndex: number): ParseExpressionResult {
  let result = parsePrimaryExpression(tokens, startIndex);
  const conditions: WhereNode[] = [result.node];
  let index = result.nextIndex;

  while (index < tokens.length && tokens[index]?.toUpperCase() === 'AND') {
    index++; // Skip AND
    result = parsePrimaryExpression(tokens, index);
    conditions.push(result.node);
    index = result.nextIndex;
  }

  if (conditions.length === 1) {
    return { node: conditions[0]!, nextIndex: index };
  }

  return {
    node: { type: 'and', conditions },
    nextIndex: index,
  };
}

/**
 * Parse primary expression (comparison, parenthesized expression)
 */
function parsePrimaryExpression(tokens: string[], startIndex: number): ParseExpressionResult {
  // Handle parenthesized expression
  if (tokens[startIndex] === '(') {
    const result = parseExpression(tokens, startIndex + 1);
    // Skip closing )
    return { node: result.node, nextIndex: result.nextIndex + 1 };
  }

  // Parse comparison: column operator value
  return parseComparison(tokens, startIndex);
}

/**
 * Parse comparison expression
 */
function parseComparison(tokens: string[], startIndex: number): ParseExpressionResult {
  let index = startIndex;

  // Get column name (may be quoted)
  const columnToken = tokens[index++];
  if (!columnToken) {
    throw new Error('Expected column name');
  }
  const column = unquoteIdentifier(columnToken);

  // Get operator
  const opToken = tokens[index++];
  if (!opToken) {
    throw new Error('Expected operator');
  }

  // Handle multi-token operators
  let operator = opToken;
  let operatorType: FilterOperator | null = null;

  // Check for IS NULL / IS NOT NULL
  if (opToken.toUpperCase() === 'IS') {
    const nextToken = tokens[index];
    if (nextToken?.toUpperCase() === 'NULL') {
      index++;
      operatorType = 'is';
      return {
        node: { type: 'filter', column, operator: operatorType, value: null },
        nextIndex: index,
      };
    } else if (nextToken?.toUpperCase() === 'NOT') {
      const nullToken = tokens[index + 1];
      if (nullToken?.toUpperCase() === 'NULL') {
        index += 2;
        operatorType = 'is';
        return {
          node: { type: 'filter', column, operator: operatorType, value: null, negated: true },
          nextIndex: index,
        };
      }
    }
  }

  // Map SQL operators to FilterOperator
  operatorType = mapOperator(operator);

  // Get value
  const valueToken = tokens[index++];
  if (!valueToken) {
    throw new Error('Expected value');
  }

  const value = parseValue(valueToken);

  const filterNode: FilterNode = {
    type: 'filter',
    column,
    operator: operatorType,
    value,
  };

  return { node: filterNode, nextIndex: index };
}

/**
 * Map SQL operator to FilterOperator
 */
function mapOperator(op: string): FilterOperator {
  const opUpper = op.toUpperCase();
  switch (opUpper) {
    case '=':
      return 'eq';
    case '!=':
    case '<>':
      return 'neq';
    case '>':
      return 'gt';
    case '>=':
      return 'gte';
    case '<':
      return 'lt';
    case '<=':
      return 'lte';
    case 'LIKE':
      return 'like';
    case 'ILIKE':
      return 'ilike';
    case 'IN':
      return 'in';
    case 'IS':
      return 'is';
    default:
      // Fallback to 'eq' for unknown operators
      return 'eq';
  }
}

/**
 * Parse value token
 */
function parseValue(token: string): string | number | boolean | null {
  // NULL
  if (token.toUpperCase() === 'NULL') {
    return null;
  }

  // Boolean
  if (token.toUpperCase() === 'TRUE') {
    return true;
  }
  if (token.toUpperCase() === 'FALSE') {
    return false;
  }

  // Quoted string
  if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
    return token.substring(1, token.length - 1).replace(/''/g, "'");
  }

  // Number
  const num = Number(token);
  if (!isNaN(num)) {
    return num;
  }

  // Unquoted string (treat as string literal)
  return token;
}

