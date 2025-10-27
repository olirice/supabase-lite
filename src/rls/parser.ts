/**
 * RLS Policy Parser
 *
 * Parses PostgreSQL RLS syntax into structured policy objects.
 * Supports:
 * - ALTER TABLE ... ENABLE/DISABLE ROW LEVEL SECURITY
 * - CREATE POLICY ... ON ... FOR ... TO ... USING ... WITH CHECK
 * - DROP POLICY ... ON ...
 */

import { stripQuotes } from '../utils/identifier.js';
import type { RLSStatement, RLSPolicy, PolicyCommand, PolicyRole } from './types.js';

/**
 * Parse an RLS statement from SQL
 * Returns null if the statement is not RLS-related
 */
export function parseRLSStatement(sql: string): RLSStatement | null {
  // Normalize whitespace and remove comments
  const normalized = sql
    .replace(/--.*$/gm, '') // Remove line comments
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();

  if (!normalized) {
    return null;
  }

  // Try each parser in order
  return (
    parseEnableRLS(normalized) ||
    parseDisableRLS(normalized) ||
    parseCreatePolicy(normalized) ||
    parseDropPolicy(normalized)
  );
}

/**
 * Parse ENABLE ROW LEVEL SECURITY statement
 */
function parseEnableRLS(sql: string): RLSStatement | null {
  const pattern = /^ALTER\s+TABLE\s+(["\w]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;?\s*$/i;
  const match = pattern.exec(sql);

  if (!match) {
    return null;
  }

  return {
    type: 'enable_rls',
    tableName: stripQuotes(match[1]!),
  };
}

/**
 * Parse DISABLE ROW LEVEL SECURITY statement
 */
function parseDisableRLS(sql: string): RLSStatement | null {
  const pattern = /^ALTER\s+TABLE\s+(["\w]+)\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY\s*;?\s*$/i;
  const match = pattern.exec(sql);

  if (!match) {
    return null;
  }

  return {
    type: 'disable_rls',
    tableName: stripQuotes(match[1]!),
  };
}

/**
 * Parse CREATE POLICY statement
 */
function parseCreatePolicy(sql: string): RLSStatement | null {
  // CREATE POLICY name ON table [FOR command] [TO role] [USING (expr)] [WITH CHECK (expr)]
  const pattern =
    /^CREATE\s+POLICY\s+(["\w]+)\s+ON\s+(["\w]+)(?:\s+FOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL))?(?:\s+TO\s+(\w+))?(?:\s+USING\s*\((.*?)\))?(?:\s+WITH\s+CHECK\s*\((.*?)\))?\s*;?\s*$/i;

  const match = pattern.exec(sql);

  if (!match) {
    return null;
  }

  const [, policyName, tableName, command, role, usingExpr, withCheckExpr] = match;

  const policy: RLSPolicy = {
    name: stripQuotes(policyName!),
    tableName: stripQuotes(tableName!),
    command: (command?.toUpperCase() as PolicyCommand) || 'ALL',
    role: (role as PolicyRole) || 'PUBLIC',
  };

  if (usingExpr) {
    policy.using = usingExpr.trim();
  }

  if (withCheckExpr) {
    policy.withCheck = withCheckExpr.trim();
  }

  return {
    type: 'create_policy',
    policy,
  };
}

/**
 * Parse DROP POLICY statement
 */
function parseDropPolicy(sql: string): RLSStatement | null {
  const pattern = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?(["\w]+)\s+ON\s+(["\w]+)\s*;?\s*$/i;
  const match = pattern.exec(sql);

  if (!match) {
    return null;
  }

  return {
    type: 'drop_policy',
    tableName: stripQuotes(match[2]!),
    policyName: stripQuotes(match[1]!),
  };
}

