/**
 * API Module
 *
 * Exports server and service components for the REST API.
 */

export { createServer } from './server.js';
export type { ServerConfig } from './server.js';
export { ApiService, ApiServiceError } from './service.js';
export type { ApiRequest, ApiResponse, ApiError, ApiServiceConfig } from './service.js';
