# Implementation Guide

This document provides implementation details for critical fixes and improvements to the Chrome Control MCP implementation.

## Race Condition Fixes

Race conditions occur when multiple operations access shared resources concurrently. We use mutex-based locking to prevent this.

### TabManager Implementation

```typescript
import { Mutex } from 'async-mutex';

class TabManager {
  private tabs: Map<string, TabInfo> = new Map();
  private activeTabLimit: number = 10;
  private mutex = new Mutex(); // Add mutex for synchronization

  async createTab(url: string): Promise<string> {
    const release = await this.mutex.acquire();
    try {
      // Check tab limit
      if (this.tabs.size >= this.activeTabLimit) {
        throw new Error('Active tab limit reached');
      }

      // Create tab and connect
      const { targetId } = await CDP.New({ url });
      const client = await CDP({ target: targetId });
      
      // Enable domains
      await client.DOM.enable();
      await client.Page.enable();
      await client.Runtime.enable();
      
      const tabId = `tab-${Date.now()}`;
      this.tabs.set(tabId, {
        id: tabId,
        url,
        client,
        lastActivity: Date.now(),
      });
      
      return tabId;
    } finally {
      release();
    }
  }

  async getTab(tabId: string): Promise<TabInfo | null> {
    const release = await this.mutex.acquire();
    try {
      return this.tabs.get(tabId) || null;
    } finally {
      release();
    }
  }

  async closeTab(tabId: string): Promise<boolean> {
    const release = await this.mutex.acquire();
    try {
      const tabInfo = this.tabs.get(tabId);
      if (!tabInfo) return false;

      // Clean up resources
      await tabInfo.client.close();
      this.tabs.delete(tabId);
      return true;
    } finally {
      release();
    }
  }
}
```

### ChromeAPI Implementation

```typescript
import { Mutex } from 'async-mutex';

export class ChromeAPI {
  private client: ChromeRemoteInterface.Client | null = null;
  private tabs: Map<string, TabInfo> = new Map();
  private mutex = new Mutex(); // Add mutex for synchronization

  async initialize(): Promise<{ success: boolean }> {
    const release = await this.mutex.acquire();
    try {
      if (this.client) {
        return { success: true }; // Already initialized
      }

      const targets = await CDP.List();
      const target = targets.find(t => t.type === 'page');
      
      if (!target) {
        throw new Error('No page targets found');
      }
      
      this.client = await CDP({ target });
      
      // Enable required domains
      await this.client.DOM.enable();
      await this.client.Page.enable();
      await this.client.Runtime.enable();
      
      return { success: true };
    } finally {
      release();
    }
  }

  async navigate(url: string): Promise<{ tabId: string; url: string }> {
    const release = await this.mutex.acquire();
    try {
      if (!this.client) {
        await this.initialize();
      }
      
      const client = this.client as ChromeRemoteInterface.Client;
      
      // Navigate with timeout protection
      await client.Page.navigate({ url });
      await Promise.race([
        new Promise(resolve => client.Page.loadEventFired(resolve)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Page load timeout')), 30000)),
      ]);
      
      const tabId = `tab-${Date.now()}`;
      this.tabs.set(tabId, { url, client });
      
      return { tabId, url };
    } finally {
      release();
    }
  }
}
```

## Memory Leak Prevention

Memory leaks occur when resources aren't properly released. The following implementations prevent this.

### DOMObserver Implementation

```typescript
class DOMObserver {
  private client: CDP.Client | null = null;
  private mutationCallbacks: MutationCallback[] = [];
  private isObserving: boolean = false;

  async initialize(client: CDP.Client): Promise<void> {
    this.client = client;
    await this.client.DOM.enable();
    await this.client.Runtime.enable();

    // Set up mutation observers
    this.client.DOM.on('attributeModified', this.handleMutation.bind(this));
    this.client.DOM.on('childNodeInserted', this.handleMutation.bind(this));
    this.client.DOM.on('childNodeRemoved', this.handleMutation.bind(this));
  }

  async startObserving(): Promise<void> {
    if (!this.client) throw new Error('DOMObserver not initialized');
    if (this.isObserving) return;

    await this.client.DOM.setChildNodes({ depth: -1 });
    this.isObserving = true;
  }

  async stopObserving(): Promise<void> {
    if (!this.client || !this.isObserving) return;

    // Remove event listeners
    this.client.DOM.off('attributeModified', this.handleMutation.bind(this));
    this.client.DOM.off('childNodeInserted', this.handleMutation.bind(this));
    this.client.DOM.off('childNodeRemoved', this.handleMutation.bind(this));

    // Disable domains to release resources
    await this.client.DOM.disable();
    await this.client.Runtime.disable();

    // Clean up references
    this.client = null;
    this.isObserving = false;
  }

  onMutation(callback: MutationCallback): void {
    this.mutationCallbacks.push(callback);
  }

  offMutation(callback: MutationCallback): void {
    this.mutationCallbacks = this.mutationCallbacks.filter(cb => cb !== callback);
  }

  private handleMutation(mutation: CDP.DOM.Mutation): void {
    if (!this.isObserving) return;
    for (const callback of this.mutationCallbacks) {
      callback([mutation]);
    }
  }
}
```

### Resource Cleanup in ChromeAPI

```typescript
export class ChromeAPI {
  // ...existing code...

  async closeTab(tabId: string): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      const tabInfo = this.tabs.get(tabId);
      if (tabInfo) {
        await tabInfo.client.close(); // Release CDP client
        this.tabs.delete(tabId);
      }
    } finally {
      release();
    }
  }

  async shutdown(): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      // Close all tabs
      for (const [tabId, tabInfo] of this.tabs.entries()) {
        await tabInfo.client.close();
        this.tabs.delete(tabId);
      }

      // Close main client
      if (this.client) {
        await this.client.close();
        this.client = null;
      }
    } finally {
      release();
    }
  }
}
```

## Performance Improvements

### LRU Cache Implementation

```typescript
import LRUCache from 'lru-cache';
import { Mutex } from 'async-mutex';

class CacheSystem {
  private cache: LRUCache<string, any>;
  private mutex = new Mutex();

  constructor(options: { max: number, ttl: number }) {
    this.cache = new LRUCache({
      max: options.max || 1000,
      ttl: options.ttl || 60 * 60 * 1000, // 1 hour default
      updateAgeOnGet: true
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const release = await this.mutex.acquire();
    try {
      return this.cache.get(key) as T;
    } finally {
      release();
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.cache.set(key, value, { ttl });
    } finally {
      release();
    }
  }

  async del(key: string): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.cache.delete(key);
    } finally {
      release();
    }
  }

  async invalidateByPattern(pattern: RegExp): Promise<number> {
    const release = await this.mutex.acquire();
    try {
      let count = 0;
      for (const key of this.cache.keys()) {
        if (pattern.test(key)) {
          this.cache.delete(key);
          count++;
        }
      }
      return count;
    } finally {
      release();
    }
  }
}
```

## Error Handling

### Global Error Handlers

```typescript
// Add to index.ts
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  // Optionally trigger cleanup procedures
  cleanup().catch(err => {
    logger.error('Cleanup failed', err);
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT. Shutting down gracefully...');
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM. Shutting down gracefully...');
  await cleanup();
  process.exit(0);
});

// Centralized cleanup procedure
async function cleanup() {
  logger.info('Running cleanup procedures...');
  try {
    // Close all Chrome connections
    await chromeAPI.shutdown();
    logger.info('Cleanup successful');
  } catch (error) {
    logger.error('Cleanup error', error);
    throw error;
  }
}
```

## Security Improvements

### Input Validation

```typescript
// Utility functions for input validation
function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function validateSelector(selector: string): boolean {
  // Basic XSS prevention for selectors
  return /^[a-zA-Z0-9-_#.\s[\]=^~:,>+*()]+$/.test(selector);
}

function sanitizeScript(script: string): string {
  // This is a simple example - real implementation should be more robust
  return script
    .replace(/document\.cookie/g, '/* document.cookie not allowed */')
    .replace(/localStorage/g, '/* localStorage not allowed */');
}

// Usage in ChromeAPI
async navigate(url: string): Promise<{ tabId: string; url: string }> {
  if (!validateUrl(url)) {
    throw new Error(`Invalid URL: ${url}`);
  }
  // Rest of implementation
}

async clickElement(tabId: string, selector: string): Promise<void> {
  if (!validateSelector(selector)) {
    throw new Error(`Invalid selector: ${selector}`);
  }
  // Rest of implementation
}

async executeScript(tabId: string, script: string): Promise<any> {
  // Sanitize script for security
  const sanitizedScript = sanitizeScript(script);
  
  // Execute with timeout protection
  return Promise.race([
    this._executeScript(tabId, sanitizedScript),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Script execution timeout')), 5000)),
  ]);
}
```

## Additional Dependencies

- `async-mutex`: For synchronization and preventing race conditions
- `lru-cache`: For efficient caching with automatic eviction
- Other dependencies can be added to `package.json` as needed
