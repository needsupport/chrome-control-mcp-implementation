/**
 * Authentication System
 * 
 * Handles API key-based authentication for the JSON-RPC server.
 * Provides secure access control to the Chrome MCP API.
 */

import crypto from 'crypto';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';

export interface AuthConfig {
  enabled: boolean;
  apiKeys: string[];
  generateKeyOnStartup: boolean;
}

export class AuthManager {
  private logger: Logger;
  private apiKeys: Set<string>;
  private enabled: boolean;

  constructor(authConfig?: Partial<AuthConfig>) {
    this.logger = new Logger('auth-manager');
    
    // Default values
    const defaultConfig: AuthConfig = {
      enabled: config.authEnabled ?? false,
      apiKeys: config.apiKeys || [],
      generateKeyOnStartup: config.generateApiKeyOnStartup ?? true
    };
    
    // Merge provided config with defaults
    const mergedConfig = { ...defaultConfig, ...authConfig };
    
    this.enabled = mergedConfig.enabled;
    this.apiKeys = new Set(mergedConfig.apiKeys);
    
    // Generate a key on startup if configured and no keys exist
    if (this.enabled && mergedConfig.generateKeyOnStartup && this.apiKeys.size === 0) {
      const key = this.generateApiKey();
      this.logger.info(`Generated API key on startup: ${key}`);
    }
  }

  /**
   * Check if authentication is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable authentication
   */
  enable(): void {
    this.enabled = true;
    this.logger.info('Authentication enabled');
  }

  /**
   * Disable authentication
   */
  disable(): void {
    this.enabled = false;
    this.logger.info('Authentication disabled');
  }

  /**
   * Verify if an API key is valid
   */
  verifyApiKey(apiKey: string | undefined): boolean {
    // If auth is disabled, always return true
    if (!this.enabled) {
      return true;
    }
    
    // No API key provided
    if (!apiKey) {
      this.logger.warn('Authentication failed: No API key provided');
      return false;
    }
    
    // Check if the API key exists
    const isValid = this.apiKeys.has(apiKey);
    
    if (!isValid) {
      this.logger.warn('Authentication failed: Invalid API key');
    }
    
    return isValid;
  }

  /**
   * Generate a new API key
   */
  generateApiKey(): string {
    // Generate a random API key
    const apiKey = crypto.randomBytes(32).toString('hex');
    
    // Add to the set of valid keys
    this.apiKeys.add(apiKey);
    
    this.logger.info('Generated new API key');
    
    return apiKey;
  }

  /**
   * Revoke an API key
   */
  revokeApiKey(apiKey: string): boolean {
    const result = this.apiKeys.delete(apiKey);
    
    if (result) {
      this.logger.info('Revoked API key');
    } else {
      this.logger.warn('Failed to revoke API key: Key not found');
    }
    
    return result;
  }

  /**
   * Get the number of active API keys
   */
  getApiKeyCount(): number {
    return this.apiKeys.size;
  }

  /**
   * Extract API key from Authorization header
   */
  extractApiKey(authHeader: string | undefined): string | undefined {
    if (!authHeader) {
      return undefined;
    }
    
    // Check if it's a Bearer token
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    // Check if it's an API key header
    if (authHeader.startsWith('ApiKey ')) {
      return authHeader.substring(7);
    }
    
    return authHeader;
  }
}
