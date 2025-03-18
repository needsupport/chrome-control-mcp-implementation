/**
 * Cache System
 * 
 * Provides caching functionality for various data with automatic invalidation
 * when DOM mutations occur. This helps optimize performance by reducing 
 * redundant operations while ensuring data freshness.
 */

import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import { DOMObserver } from '../dom/dom-mutation-observer.js';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  tabId?: string;
  tags?: string[];
}

export class CacheSystem {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private logger: Logger;
  private ttl: number;
  private maxSize: number;
  private domObserver?: DOMObserver;

  constructor(ttl: number = config.cacheTTL * 1000, maxSize: number = config.maxCacheSize) {
    this.ttl = ttl;
    this.maxSize = maxSize;
    this.logger = new Logger('cache-system');
    
    // Set up periodic cleanup
    setInterval(() => this.cleanup(), 30000);
  }

  /**
   * Connect a DOM observer to enable automatic cache invalidation
   */
  connectDOMObserver(domObserver: DOMObserver): void {
    this.domObserver = domObserver;
    
    // Set up event listeners for mutations
    domObserver.on('mutation', (event) => {
      this.invalidateTabCache(event.tabId);
    });
    
    this.logger.info('Connected DOM observer for automatic cache invalidation');
  }

  /**
   * Get a value from the cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    
    // No cache entry found
    if (!entry) {
      return null;
    }
    
    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.logger.debug(`Cache entry expired: ${key}`);
      this.cache.delete(key);
      return null;
    }
    
    this.logger.debug(`Cache hit: ${key}`);
    return entry.value as T;
  }

  /**
   * Set a value in the cache
   */
  set<T>(key: string, value: T, options?: { ttl?: number; tabId?: string; tags?: string[] }): void {
    // Enforce maximum cache size
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }
    
    const now = Date.now();
    const ttl = options?.ttl ?? this.ttl;
    
    this.cache.set(key, {
      value,
      expiresAt: now + ttl,
      tabId: options?.tabId,
      tags: options?.tags
    });
    
    this.logger.debug(`Cache set: ${key}`);
  }

  /**
   * Delete a specific key from the cache
   */
  delete(key: string): boolean {
    const result = this.cache.delete(key);
    
    if (result) {
      this.logger.debug(`Cache delete: ${key}`);
    }
    
    return result;
  }

  /**
   * Clear all entries with a specific prefix
   */
  clearByPrefix(prefix: string): number {
    let count = 0;
    
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      this.logger.debug(`Cleared ${count} cache entries with prefix: ${prefix}`);
    }
    
    return count;
  }

  /**
   * Clear all entries with a specific tag
   */
  clearByTag(tag: string): number {
    let count = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.tags?.includes(tag)) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      this.logger.debug(`Cleared ${count} cache entries with tag: ${tag}`);
    }
    
    return count;
  }

  /**
   * Invalidate all cache entries for a specific tab
   */
  invalidateTabCache(tabId: string): number {
    let count = 0;
    
    // Clear entries directly associated with this tab
    count += this.clearByPrefix(`tab:${tabId}:`);
    count += this.clearByPrefix(`content:${tabId}:`);
    count += this.clearByPrefix(`semantic:${tabId}:`);
    count += this.clearByPrefix(`dom:${tabId}:`);
    
    // Clear entries that have this tabId
    for (const [key, entry] of this.cache.entries()) {
      if (entry.tabId === tabId) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      this.logger.info(`Invalidated ${count} cache entries for tab ${tabId}`);
    }
    
    return count;
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    const count = this.cache.size;
    this.cache.clear();
    this.logger.info(`Cleared entire cache (${count} entries)`);
  }

  /**
   * Get cache stats
   */
  getStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttl: this.ttl
    };
  }

  /**
   * Evict the oldest entry from the cache
   */
  private evictOldest(): void {
    if (this.cache.size === 0) return;
    
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < oldestTime) {
        oldestKey = key;
        oldestTime = entry.expiresAt;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug(`Cache eviction (oldest): ${oldestKey}`);
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanup(): void {
    const now = Date.now();
    let count = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
        count++;
      }
    }
    
    if (count > 0) {
      this.logger.debug(`Cleanup: removed ${count} expired cache entries`);
    }
  }
}
