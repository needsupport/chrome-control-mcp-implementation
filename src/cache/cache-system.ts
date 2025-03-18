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
import { Mutex } from 'async-mutex';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  tabId?: string;
  tags?: string[];
  lastAccessed: number; // Added for LRU implementation
}

export class CacheSystem {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private logger: Logger;
  private ttl: number;
  private maxSize: number;
  private domObserver?: DOMObserver;
  private cacheMutex: Mutex = new Mutex(); // Added mutex for cache operations
  private mutationListenerRef?: Function; // Store reference for cleanup

  constructor(ttl: number = config.cacheTTL * 1000, maxSize: number = config.maxCacheSize) {
    this.ttl = ttl;
    this.maxSize = maxSize;
    this.logger = new Logger('cache-system');
    
    // Set up periodic cleanup
    const cleanupInterval = setInterval(() => this.cleanup(), 30000);
    
    // Store cleanup interval for potential cleanup
    if (typeof global !== 'undefined') {
      // @ts-ignore - Add property to global for cleanup
      global.__cacheCleanupInterval = cleanupInterval;
    }
  }

  /**
   * Connect a DOM observer to enable automatic cache invalidation
   */
  connectDOMObserver(domObserver: DOMObserver): void {
    this.domObserver = domObserver;
    
    // Clean up existing listener if any
    if (this.mutationListenerRef) {
      this.domObserver.removeListener('mutation', this.mutationListenerRef as any);
    }
    
    // Set up event listeners for mutations
    const mutationHandler = (event: any) => {
      this.invalidateTabCache(event.tabId);
    };
    
    domObserver.on('mutation', mutationHandler);
    this.mutationListenerRef = mutationHandler;
    
    this.logger.info('Connected DOM observer for automatic cache invalidation');
  }

  /**
   * Disconnect the DOM observer
   */
  disconnectDOMObserver(): void {
    if (this.domObserver && this.mutationListenerRef) {
      this.domObserver.removeListener('mutation', this.mutationListenerRef as any);
      this.mutationListenerRef = undefined;
      this.logger.info('Disconnected DOM observer');
    }
  }

  /**
   * Get a value from the cache
   */
  async get<T>(key: string): Promise<T | null> {
    const release = await this.cacheMutex.acquire();
    
    try {
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
      
      // Update last accessed time for LRU
      entry.lastAccessed = Date.now();
      
      this.logger.debug(`Cache hit: ${key}`);
      return entry.value as T;
    } catch (error) {
      this.logger.error(`Error getting cache entry: ${key}`, error);
      return null;
    } finally {
      release();
    }
  }

  /**
   * Set a value in the cache
   */
  async set<T>(key: string, value: T, options?: { ttl?: number; tabId?: string; tags?: string[] }): Promise<void> {
    const release = await this.cacheMutex.acquire();
    
    try {
      // Enforce maximum cache size
      if (this.cache.size >= this.maxSize) {
        this.evictLRU();
      }
      
      const now = Date.now();
      const ttl = options?.ttl ?? this.ttl;
      
      this.cache.set(key, {
        value,
        expiresAt: now + ttl,
        tabId: options?.tabId,
        tags: options?.tags,
        lastAccessed: now
      });
      
      this.logger.debug(`Cache set: ${key}`);
    } catch (error) {
      this.logger.error(`Error setting cache entry: ${key}`, error);
    } finally {
      release();
    }
  }

  /**
   * Delete a specific key from the cache
   */
  async delete(key: string): Promise<boolean> {
    const release = await this.cacheMutex.acquire();
    
    try {
      const result = this.cache.delete(key);
      
      if (result) {
        this.logger.debug(`Cache delete: ${key}`);
      }
      
      return result;
    } catch (error) {
      this.logger.error(`Error deleting cache entry: ${key}`, error);
      return false;
    } finally {
      release();
    }
  }

  /**
   * Clear all entries with a specific prefix
   */
  async clearByPrefix(prefix: string): Promise<number> {
    const release = await this.cacheMutex.acquire();
    
    try {
      let count = 0;
      
      // Create a list of keys to delete
      const keysToDelete: string[] = [];
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          keysToDelete.push(key);
        }
      }
      
      // Delete in batch
      for (const key of keysToDelete) {
        this.cache.delete(key);
        count++;
      }
      
      if (count > 0) {
        this.logger.debug(`Cleared ${count} cache entries with prefix: ${prefix}`);
      }
      
      return count;
    } catch (error) {
      this.logger.error(`Error clearing cache by prefix: ${prefix}`, error);
      return 0;
    } finally {
      release();
    }
  }

  /**
   * Clear all entries with a specific tag
   */
  async clearByTag(tag: string): Promise<number> {
    const release = await this.cacheMutex.acquire();
    
    try {
      let count = 0;
      
      // Create a list of keys to delete
      const keysToDelete: string[] = [];
      for (const [key, entry] of this.cache.entries()) {
        if (entry.tags?.includes(tag)) {
          keysToDelete.push(key);
        }
      }
      
      // Delete in batch
      for (const key of keysToDelete) {
        this.cache.delete(key);
        count++;
      }
      
      if (count > 0) {
        this.logger.debug(`Cleared ${count} cache entries with tag: ${tag}`);
      }
      
      return count;
    } catch (error) {
      this.logger.error(`Error clearing cache by tag: ${tag}`, error);
      return 0;
    } finally {
      release();
    }
  }

  /**
   * Invalidate all cache entries for a specific tab
   */
  async invalidateTabCache(tabId: string): Promise<number> {
    const release = await this.cacheMutex.acquire();
    
    try {
      let count = 0;
      
      // Create a list of keys to delete
      const keysToDelete: string[] = [];
      
      // Find entries by tabId or with matching prefixes
      const prefixes = [`tab:${tabId}:`, `content:${tabId}:`, `semantic:${tabId}:`, `dom:${tabId}:`];
      
      for (const [key, entry] of this.cache.entries()) {
        if (entry.tabId === tabId || prefixes.some(prefix => key.startsWith(prefix))) {
          keysToDelete.push(key);
        }
      }
      
      // Delete in batch
      for (const key of keysToDelete) {
        this.cache.delete(key);
        count++;
      }
      
      if (count > 0) {
        this.logger.info(`Invalidated ${count} cache entries for tab ${tabId}`);
      }
      
      return count;
    } catch (error) {
      this.logger.error(`Error invalidating tab cache: ${tabId}`, error);
      return 0;
    } finally {
      release();
    }
  }

  /**
   * Clear the entire cache
   */
  async clear(): Promise<void> {
    const release = await this.cacheMutex.acquire();
    
    try {
      const count = this.cache.size;
      this.cache.clear();
      this.logger.info(`Cleared entire cache (${count} entries)`);
    } catch (error) {
      this.logger.error('Error clearing cache', error);
    } finally {
      release();
    }
  }

  /**
   * Get cache stats
   */
  async getStats(): Promise<{ size: number; maxSize: number; ttl: number }> {
    const release = await this.cacheMutex.acquire();
    
    try {
      return {
        size: this.cache.size,
        maxSize: this.maxSize,
        ttl: this.ttl
      };
    } finally {
      release();
    }
  }

  /**
   * Evict the least recently used entry from the cache
   */
  private evictLRU(): void {
    if (this.cache.size === 0) return;
    
    let oldestKey: string | null = null;
    let oldestAccessTime = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestAccessTime) {
        oldestKey = key;
        oldestAccessTime = entry.lastAccessed;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug(`Cache eviction (LRU): ${oldestKey}`);
    }
  }

  /**
   * Clean up expired cache entries
   */
  private async cleanup(): Promise<void> {
    const release = await this.cacheMutex.acquire();
    
    try {
      const now = Date.now();
      let count = 0;
      
      // Create a list of keys to delete
      const keysToDelete: string[] = [];
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt < now) {
          keysToDelete.push(key);
        }
      }
      
      // Delete in batch
      for (const key of keysToDelete) {
        this.cache.delete(key);
        count++;
      }
      
      if (count > 0) {
        this.logger.debug(`Cleanup: removed ${count} expired cache entries`);
      }
    } catch (error) {
      this.logger.error('Error during cache cleanup', error);
    } finally {
      release();
    }
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.disconnectDOMObserver();
    
    // Clear cleanup interval
    if (typeof global !== 'undefined' && (global as any).__cacheCleanupInterval) {
      clearInterval((global as any).__cacheCleanupInterval);
      delete (global as any).__cacheCleanupInterval;
    }
  }
}
