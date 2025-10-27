/**
 * Application Constants
 *
 * Centralized constants for magic strings, numbers, and configuration values
 * used throughout the application.
 */

// HTTP Endpoints
export const HEALTH_ENDPOINT = '/health';
export const AUTH_V1_BASE_PATH = '/auth/v1';

// Authentication Roles
export const ROLE_ANON = 'anon' as const;
export const ROLE_AUTHENTICATED = 'authenticated' as const;
export const ROLE_SERVICE_ROLE = 'service_role' as const;
export const ROLE_PUBLIC = 'PUBLIC' as const;

// Database
export const DEFAULT_PRIMARY_KEY = 'id';
export const MANY_TO_ONE_DEFAULT_LIMIT = 1;

// JWT
export const DEFAULT_JWT_ISSUER = 'supabase';
export const DEFAULT_SESSION_DURATION_SECONDS = 86400; // 24 hours
export const DEFAULT_ANON_KEY_DURATION_YEARS = 10;
export const DEFAULT_SERVICE_KEY_DURATION_YEARS = 10;

// Query Parsing
export const WILDCARD_SELECT = '*';

// RLS
export const DENY_ALL_FILTER_COLUMN = '1';
export const DENY_ALL_FILTER_VALUE = 0;

// Type Guards
export type Role = typeof ROLE_ANON | typeof ROLE_AUTHENTICATED | typeof ROLE_SERVICE_ROLE | typeof ROLE_PUBLIC;
