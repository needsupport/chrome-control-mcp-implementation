/**
 * Cache System
 * 
 * Provides caching functionality for various data with automatic invalidation
 * when DOM mutations occur. This helps optimize performance by reducing 
 * redundant operations while ensuring data freshness.
 */

import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import { DOMObserver, MutationEvent } from '../dom/dom-mutation-observer.js';
import { Mutex } from 'async-mutex';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  tabId?: string;
  tags?: string[];
}

interface QueueEntry {
  key: string;
  expiresAt: number;
}

export class CacheSystem {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private logger: Logger;
  private ttl: number;
  private maxSize: number;
  private domObserver?: DOMObserver;
  private mutationHandler?: (event: MutationEvent) => void;
  private cleanupInterval: NodeJS.Timeout;
  private mutex: Mutex = new Mutex();
  
  // Indexes for efficient lookups
  private tagIndex: Map<string, Set<string>> = new Map();
  private tabIndex: Map<string, Set<string>> = new Map();
  
  // Cache for pending promises to prevent cache stampede
  private pendingPromises: Map<string, Promise<any>> = new Map();
  
  // Expiration queue for efficient eviction
  private expirationQueue: QueueEntry[] = [];

  constructor(ttl: number = config.cacheTTL * 1000, maxSize: number = config.maxCacheSize) {
    this.ttl = ttl;
    this.maxSize = maxSize;
    this.logger = new Logger('cache-system');
    
    // Set up periodic cleanup
    this.cleanupInterval = setInterval(() => this.cleanup(), 30000);
  }

  /**
   * Connect a DOM observer to enable automatic cache invalidation
   */
  connectDOMObserver(domObserver: DOMObserver): void {
    // Clean up previous connection if exists
    if (this.domObserver && this.mutationHandler) {
      this.domObserver.removeListener('mutation', this.mutationHandler);
    }
    
    this.domObserver = domObserver;
    
    // Set up event listeners for mutations
    this.mutationHandler = (event: MutationEvent) => {
      this.invalidateTabCache(event.tabId);
    };
    
    domObserver.on('mutation', this.mutationHandler);
    
    this.logger.info('Connected DOM observer for automatic cache invalidation');
  }

  /**
   * Get a value from the cache
   */
  async get<T>(key: string): Promise<T | null> {
    const release = await this.mutex.acquire();
    
    try {
      const entry = this.cache.get(key);
      
      // No cache entry found
      if (!entry) {
        return null;
      }
      
      // Check if entry has expired
      if (Date.now() > entry.expiresAt) {
        this.logger.debug(`Cache entry expired: ${key}`);
        this._deleteEntry(key);
        return null;
      }
      
      this.logger.debug(`Cache hit: ${key}`);
      return entry.value as T;
    } finally {
      release();
    }
  }

  /**
   * Get a value from cache or compute it if not present
   */
  async getOrSet<T>(key: string, factory: () => Promise<T>, options?: { ttl?: number; tabId?: string; tags?: string[] }): Promise<T> {
    // Check if already in cache
    const cachedValue = await this.get<T>(key);
    if (cachedValue !== null) {
      return cachedValue;
    }
    
    // Check if we already have a pending promise for this key
    if (this.pendingPromises.has(key)) {
      return this.pendingPromises.get(key) as Promise<T>;
    }
    
    // Create a new promise for this key
    const promise = factory().then(value => {
      this.set(key, value, options);
      this.pendingPromises.delete(key);
      return value;
    }).catch(error => {
      this.pendingPromises.delete(key);
      throw error;
    });
    
    // Store the promise
    this.pendingPromises.set(key, promise);
    
    return promise;
  }

  /**
   * Set a value in the cache
   */
  async set<T>(key: string, value: T, options?: { ttl?: number; tabId?: string; tags?: string[] }): Promise<void> {
    const release = await this.mutex.acquire();
    
    try {
      // Enforce maximum cache size
      if (this.cache.size >= this.maxSize) {
        this._evictOldest();
      }
      
      const now = Date.now();
      const ttl = options?.ttl ?? this.ttl;
      const expiresAt = now + ttl;
      
      // Create cache entry
      const entry: CacheEntry<T> = {
        value,
        expiresAt,
        tabId: options?.tabId,
        tags: options?.tags
      };
      
      // Remove old entry if exists
      if (this.cache.has(key)) {
        this._deleteEntry(key);
      }
      
      // Add to expiration queue
      this.expirationQueue.push({ key, expiresAt });
      
      // Update the cache
      this.cache.set(key, entry);
      
      // Update indexes
      if (options?.tabId) {
        const tabKeys = this.tabIndex.get(options.tabId) || new Set<string>();
        tabKeys.add(key);
        this.tabIndex.set(options.tabId, tabKeys);
      }
      
      if (options?.tags?.length) {
        for (const tag of options.tags) {
          const tagKeys = this.tagIndex.get(tag) || new Set<string>();
          tagKeys.add(key);
          this.tagIndex.set(tag, tagKeys);
        }
      }
      
      this.logger.debug(`Cache set: ${key}`);
    } finally {
      release();
    }
  }

  /**
   * Delete a specific key from the cache
   */
  async delete(key: string): Promise<boolean> {
    const release = await this.mutex.acquire();
    
    try {
      return this._deleteEntry(key);
    } finally {
      release();
    }
  }

  /**
   * Internal method to delete an entry and update indexes
   */
  private _deleteEntry(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }
    
    // Remove from main cache
    this.cache.delete(key);
    
    // Remove from expiration queue
    this.expirationQueue = this.expirationQueue.filter(item => item.key !== key);
    
    // Remove from indexes
    if (entry.tabId) {
      const tabKeys = this.tabIndex.get(entry.tabId);
      if (tabKeys) {
        tabKeys.delete(key);
        if (tabKeys.size === 0) {
          this.tabIndex.delete(entry.tabId);
        }
      }
    }
    
    if (entry.tags?.length) {
      for (const tag of entry.tags) {
        const tagKeys = this.tagIndex.get(tag);
        if (tagKeys) {
          tagKeys.delete(key);
          if (tagKeys.size === 0) {
            this.tagIndex.delete(tag);
          }
        }
      }
    }
    
    this.logger.debug(`Cache delete: ${key}`);
    return true;
  }

  /**
   * Clear all entries with a specific prefix
   */
  async clearByPrefix(prefix: string): Promise<number> {
    const release = await this.mutex.acquire();
    
    try {
      let count = 0;
      const keysToDelete: string[] = [];
      
      // Find all keys with the prefix
      for (const key of this.cache.keys()) {
        if (key.startsWith(prefix)) {
          keysToDelete.push(key);
        }
      }
      
      // Delete each key
      for (const key of keysToDelete) {
        if (this._deleteEntry(key)) {
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
      const tagKeys = this.tagIndex.get(tag);
      
      if (!tagKeys || tagKeys.size === 0) {
        return 0;
      }
      
      let count = 0;
      const keysToDelete = Array.from(tagKeys);
      
      // Delete each key
      for (const key of keysToDelete) {
        if (this._deleteEntry(key)) {
          count++;
        }
      }
      
      // Clear tag index
      this.tagIndex.delete(tag);
      
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
      
      // Use tab index for efficient lookup
      const tabKeys = this.tabIndex.get(tabId);
      if (tabKeys && tabKeys.size > 0) {
        const keysToDelete = Array.from(tabKeys);
        
        for (const key of keysToDelete) {
          if (this._deleteEntry(key)) {
            count++;
          }
        }
        
        // Clear tab index
        this.tabIndex.delete(tabId);
      }
      
      // Also check prefixes
      count += await this.clearByPrefix(`tab:${tabId}:`);
      count += await this.clearByPrefix(`content:${tabId}:`);
      count += await this.clearByPrefix(`semantic:${tabId}:`);
      count += await this.clearByPrefix(`dom:${tabId}:`);
      
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
      
      // Clear all data structures
      this.cache.clear();
      this.expirationQueue = [];
      this.tabIndex.clear();
      this.tagIndex.clear();
      this.pendingPromises.clear();
      
      this.logger.info(`Cleared entire cache (${count} entries)`);
    } finally {
      release();
    }
  }

  /**
   * Get cache stats
   */
  async getStats(): Promise<{ size: number; maxSize: number; ttl: number; pendingPromises: number }> {
    const release = await this.mutex.acquire();
    
    try {
      return {
        size: this.cache.size,
        maxSize: this.maxSize,
        ttl: this.ttl,
        pendingPromises: this.pendingPromises.size
      };
    } finally {
      release();
    }
  }

  /**
   * Evict the oldest entry from the cache
   */
  private _evictOldest(): void {
    if (this.cache.size === 0 || this.expirationQueue.length === 0) return;
    
    // Sort expiration queue if needed
    this.expirationQueue.sort((a, b) => a.expiresAt - b.expiresAt);
    
    // Get the oldest entry
    const oldest = this.expirationQueue.shift();
    
    if (oldest) {
      this._deleteEntry(oldest.key);
      this.logger.debug(`Cache eviction (oldest): ${oldest.key}`);
    }
  }

  /**
   * Clean up expired cache entries
   */
  private async cleanup(): Promise<void> {
    const release = await this.mutex.acquire();
    
    try {
      const now = Date.now();
      const BATCH_SIZE = 100; // Process in batches to avoid blocking
      let count = 0;
      
      // Use expiration queue for more efficient cleanup
      // Sort by expiration time
      this.expirationQueue.sort((a, b) => a.expiresAt - b.expiresAt);
      
      // Find index of first non-expired entry
      let cutoffIndex = 0;
      for (let i = 0; i < this.expirationQueue.length; i++) {
        if (this.expirationQueue[i].expiresAt > now) {
          cutoffIndex = i;
          break;
        }
      }
      
      // Get expired entries
      const expiredEntries = this.expirationQueue.slice(0, cutoffIndex);
      
      // Process in batches
      for (let i = 0; i < expiredEntries.length; i += BATCH_SIZE) {
        const batch = expiredEntries.slice(i, i + BATCH_SIZE);
        
        for (const entry of batch) {
          if (this._deleteEntry(entry.key)) {
            count++;
          }
        }
        
        // Release mutex briefly to allow other operations
        release();
        await new Promise(resolve => setTimeout(resolve, 0));
        await this.mutex.acquire();
      }
      
      // Update expiration queue
      this.expirationQueue = this.expirationQueue.slice(cutoffIndex);
      
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
   * Destroy the cache system and clean up resources
   */
  destroy(): void {
    // Clear the cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Remove DOM observer listeners
    if (this.domObserver && this.mutationHandler) {
      this.domObserver.removeListener('mutation', this.mutationHandler);
    }
    
    // Clear cache
    this.cache.clear();
    this.expirationQueue = [];
    this.tabIndex.clear();
    this.tagIndex.clear();
    this.pendingPromises.clear();
    
    this.logger.info('Cache system destroyed');
  }
}
