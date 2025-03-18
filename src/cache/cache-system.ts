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
import { LRUCache } from 'lru-cache';
import { Mutex } from 'async-mutex';

interface CacheOptions {
  ttl?: number;
  tabId?: string;
  tags?: string[];
}

export class CacheSystem {
  private cache: LRUCache<string, any>;
  private logger: Logger;
  private domObserver?: DOMObserver;
  private mutex: Mutex = new Mutex();
  private tabToKeys: Map<string, Set<string>> = new Map();
  private tagToKeys: Map<string, Set<string>> = new Map();

  constructor() {
    this.logger = new Logger('cache-system');
    
    // Initialize LRU cache with options
    this.cache = new LRUCache({
      max: config.maxCacheSize || 1000,
      ttl: (config.cacheTTL || 300) * 1000, // Convert seconds to milliseconds
      updateAgeOnGet: true,
      allowStale: false,
      noDisposeOnSet: false,
      disposeAfter: (value, key) => {
        // Clean up key mappings when an item expires or is evicted
        this.removeKeyFromMappings(key);
      }
    });
  }

  /**
   * Connect a DOM observer to enable automatic cache invalidation
   */
  async connectDOMObserver(domObserver: DOMObserver): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.domObserver = domObserver;
      
      // Set up event listeners for mutations
      domObserver.on('mutation', async (event) => {
        await this.invalidateTabCache(event.tabId);
      });
      
      this.logger.info('Connected DOM observer for automatic cache invalidation');
    } finally {
      release();
    }
  }

  /**
   * Get a value from the cache
   */
  async get<T>(key: string): Promise<T | null> {
    const release = await this.mutex.acquire();
    try {
      const value = this.cache.get(key) as T;
      
      if (value === undefined) {
        return null;
      }
      
      this.logger.debug(`Cache hit: ${key}`);
      return value;
    } finally {
      release();
    }
  }

  /**
   * Set a value in the cache
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      // Store the value in the cache
      this.cache.set(key, value, {
        ttl: options?.ttl ? options.ttl * 1000 : undefined
      });
      
      // Update tab and tag mappings
      this.updateKeyMappings(key, options);
      
      this.logger.debug(`Cache set: ${key}`);
    } finally {
      release();
    }
  }

  /**
   * Update key mappings for tab and tag indexes
   */
  private updateKeyMappings(key: string, options?: CacheOptions): void {
    // Associate with tab ID if specified
    if (options?.tabId) {
      if (!this.tabToKeys.has(options.tabId)) {
        this.tabToKeys.set(options.tabId, new Set());
      }
      this.tabToKeys.get(options.tabId)?.add(key);
    }
    
    // Associate with tags if specified
    if (options?.tags) {
      for (const tag of options.tags) {
        if (!this.tagToKeys.has(tag)) {
          this.tagToKeys.set(tag, new Set());
        }
        this.tagToKeys.get(tag)?.add(key);
      }
    }
  }

  /**
   * Remove key from tab and tag mappings
   */
  private removeKeyFromMappings(key: string): void {
    // Remove from tab mappings
    for (const [tabId, keys] of this.tabToKeys.entries()) {
      if (keys.has(key)) {
        keys.delete(key);
        if (keys.size === 0) {
          this.tabToKeys.delete(tabId);
        }
      }
    }
    
    // Remove from tag mappings
    for (const [tag, keys] of this.tagToKeys.entries()) {
      if (keys.has(key)) {
        keys.delete(key);
        if (keys.size === 0) {
          this.tagToKeys.delete(tag);
        }
      }
    }
  }

  /**
   * Delete a specific key from the cache
   */
  async delete(key: string): Promise<boolean> {
    const release = await this.mutex.acquire();
    try {
      const result = this.cache.delete(key);
      
      if (result) {
        this.removeKeyFromMappings(key);
        this.logger.debug(`Cache delete: ${key}`);
      }
      
      return result;
    } finally {
      release();
    }
  }

  /**
   * Clear all entries with a specific prefix
   */
  async clearByPrefix(prefix: string): Promise<number> {
    const release = await this.mutex.acquire();
    try {
      let count = 0;
      const keysToDelete = Array.from(this.cache.keys()).filter(key => key.startsWith(prefix));
      
      // Delete keys in a batch
      for (const key of keysToDelete) {
        if (this.cache.delete(key)) {
          this.removeKeyFromMappings(key);
          count++;
        }
      }
      
      if (count > 0) {
        this.logger.debug(`Cleared ${count} cache entries with prefix: ${prefix}`);
      }
      
      return count;
    } finally {
      release();
    }
  }

  /**
   * Clear all entries with a specific tag
   */
  async clearByTag(tag: string): Promise<number> {
    const release = await this.mutex.acquire();
    try {
      const keys = this.tagToKeys.get(tag);
      
      if (!keys || keys.size === 0) {
        return 0;
      }
      
      let count = 0;
      for (const key of keys) {
        if (this.cache.delete(key)) {
          count++;
        }
      }
      
      // Clear the tag mapping
      this.tagToKeys.delete(tag);
      
      if (count > 0) {
        this.logger.debug(`Cleared ${count} cache entries with tag: ${tag}`);
      }
      
      return count;
    } finally {
      release();
    }
  }

  /**
   * Invalidate all cache entries for a specific tab
   */
  async invalidateTabCache(tabId: string): Promise<number> {
    const release = await this.mutex.acquire();
    try {
      let count = 0;
      
      // Clear entries directly associated with this tab
      const tabKeys = this.tabToKeys.get(tabId);
      if (tabKeys && tabKeys.size > 0) {
        for (const key of tabKeys) {
          if (this.cache.delete(key)) {
            count++;
          }
        }
        this.tabToKeys.delete(tabId);
      }
      
      // Clear entries with tab-related prefixes
      count += await this.clearByPrefix(`tab:${tabId}:`);
      count += await this.clearByPrefix(`content:${tabId}`);
      count += await this.clearByPrefix(`semantic:${tabId}`);
      count += await this.clearByPrefix(`dom:${tabId}`);
      
      if (count > 0) {
        this.logger.info(`Invalidated ${count} cache entries for tab ${tabId}`);
      }
      
      return count;
    } finally {
      release();
    }
  }

  /**
   * Clear the entire cache
   */
  async clear(): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      const count = this.cache.size;
      this.cache.clear();
      
      // Clear all mappings
      this.tabToKeys.clear();
      this.tagToKeys.clear();
      
      this.logger.info(`Cleared entire cache (${count} entries)`);
    } finally {
      release();
    }
  }

  /**
   * Get cache stats
   */
  async getStats(): Promise<{ size: number; maxSize: number; ttl: number; hitRate: number }> {
    const release = await this.mutex.acquire();
    try {
      return {
        size: this.cache.size,
        maxSize: this.cache.max,
        ttl: this.cache.ttl,
        hitRate: this.calculateHitRate()
      };
    } finally {
      release();
    }
  }

  /**
   * Calculate cache hit rate
   */
  private calculateHitRate(): number {
    return 0; // LRU-cache doesn't track hit/miss stats directly
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    await this.clear();
    this.logger.info('Cache system shutdown complete');
  }
}
