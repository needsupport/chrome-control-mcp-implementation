# Developer Guide

This guide provides technical details for developers working on or contributing to the Chrome Control MCP implementation.

## Architecture Overview

The implementation follows a modular architecture with these key components:

1. **Chrome MCP Server** - Handles incoming JSON-RPC requests
2. **Chrome API** - Main interface to Chrome DevTools Protocol
3. **Tab Manager** - Centralized tab management with mutex locking
4. **DOM Observer** - Monitors real-time DOM changes
5. **Cache System** - Optimizes performance with LRU caching
6. **Semantic Analyzer** - Builds semantic representation of pages
7. **Content Extractor** - Extracts structured content from pages
8. **Auth Manager** - Provides API key-based authentication

## Race Condition Prevention

The implementation uses mutex-based locking to prevent race conditions during concurrent operations.

### TabManager Implementation

```typescript
import { Mutex } from 'async-mutex';

class TabManager {
  private tabs: Map<string, TabInfo> = new Map();
  private mutex = new Mutex(); // Mutex for synchronization

  async createTab(url: string): Promise<string> {
    const release = await this.mutex.acquire();
    try {
      // Critical section: Create and add a new tab
      const { targetId } = await CDP.New({ url });
      const client = await CDP({ target: targetId });

      const tabId = `tab-${Date.now()}`;
      this.tabs.set(tabId, { id: tabId, url, client, lastActivity: Date.now() });

      return tabId;
    } catch (error) {
      console.error('Failed to create tab:', error);
      throw error;
    } finally {
      release(); // Always release the mutex
    }
  }

  // Other methods with similar mutex protection...
}
```

### Cache System with Mutex

```typescript
class CacheSystem {
  private cache = new LRUCache<string, any>({ max: 1000 });
  private mutex = new Mutex();

  async get<T>(key: string): Promise<T | undefined> {
    const release = await this.mutex.acquire();
    try {
      return this.cache.get(key) as T;
    } finally {
      release();
    }
  }

  async set(key: string, value: any): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.cache.set(key, value);
    } finally {
      release();
    }
  }
}
```

## Memory Leak Prevention

The implementation prevents memory leaks by properly cleaning up resources.

### DOMObserver Cleanup

```typescript
class DOMObserver {
  private client: CDP.Client | null = null;
  private isObserving = false;
  private mutationCallbacks: MutationCallback[] = [];

  async startObserving(client: CDP.Client): Promise<void> {
    this.client = client;
    
    // Enable domains
    await this.client.DOM.enable();
    await this.client.Runtime.enable();
    
    // Register event listeners
    this.client.DOM.on('attributeModified', this.handleMutation.bind(this));
    this.client.DOM.on('childNodeInserted', this.handleMutation.bind(this));
    this.client.DOM.on('childNodeRemoved', this.handleMutation.bind(this));
    
    this.isObserving = true;
  }

  async stopObserving(): Promise<void> {
    if (!this.client || !this.isObserving) return;

    // Remove event listeners
    this.client.DOM.removeListener('attributeModified', this.handleMutation.bind(this));
    this.client.DOM.removeListener('childNodeInserted', this.handleMutation.bind(this));
    this.client.DOM.removeListener('childNodeRemoved', this.handleMutation.bind(this));
    
    // Disable domains to release resources
    await this.client.DOM.disable();
    await this.client.Runtime.disable();
    
    // Clean up references
    this.client = null;
    this.isObserving = false;
  }

  // Register and unregister callbacks
  onMutation(callback: MutationCallback): void {
    this.mutationCallbacks.push(callback);
  }

  offMutation(callback: MutationCallback): void {
    this.mutationCallbacks = this.mutationCallbacks.filter(cb => cb !== callback);
  }

  // Complete shutdown
  async shutdown(): Promise<void> {
    await this.stopObserving();
    this.mutationCallbacks = []; // Clear all callbacks
  }
}
```

## Error Handling

The implementation uses a centralized error handling approach with global handlers for uncaught exceptions.

### Central Error Handler

```typescript
class ErrorHandler {
  handleError(message: string, error: unknown): void {
    console.error(message, error);
    // Log to monitoring service if available
  }

  handleCriticalError(message: string, error: unknown): void {
    console.error('CRITICAL ERROR:', message, error);
    // Attempt recovery or graceful shutdown
  }
}
```

### Global Error Handling

```typescript
// In main application entry point
const errorHandler = new ErrorHandler();

process.on('uncaughtException', (error) => {
  errorHandler.handleCriticalError('Uncaught exception', error);
  process.exit(1); // Exit with failure
});

process.on('unhandledRejection', (reason) => {
  errorHandler.handleCriticalError('Unhandled rejection', reason);
  process.exit(1); // Exit with failure
});
```

### Operation Timeouts

```typescript
async executeWithTimeout<T>(operation: () => Promise<T>, timeout: number): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Operation timeout')), timeout);
  });

  return Promise.race([operation(), timeoutPromise]);
}
```

## Security Implementations

### Input Validation

```typescript
function validateSelector(selector: string): boolean {
  // Basic validation to prevent injection
  return /^[a-zA-Z0-9-_#.\s[\]='"]+$/.test(selector);
}

async clickElement(tabId: string, selector: string): Promise<void> {
  if (!validateSelector(selector)) {
    throw new Error('Invalid selector');
  }
  
  // Clicking logic...
}
```

### Script Sanitization

```typescript
function sanitizeScript(script: string): string {
  // Remove potentially harmful code
  const sanitized = script
    .replace(/process\s*\.\s*exit/g, '/* removed */')
    .replace(/require\s*\(/g, '/* removed */');
  
  return sanitized;
}

async executeScript(tabId: string, script: string): Promise<any> {
  const sanitizedScript = sanitizeScript(script);
  
  // Script execution logic...
}
```

## Performance Optimizations

### LRU Cache Implementation

```typescript
import LRUCache from 'lru-cache';

const cacheOptions = {
  max: 1000, // Maximum items in cache
  ttl: 1000 * 60 * 5, // Time to live: 5 minutes
  updateAgeOnGet: true, // Update age on access
};

const cache = new LRUCache<string, any>(cacheOptions);
```

### Batch DOM Operations

```typescript
async batchDOMOperations(operations: Array<() => Promise<void>>): Promise<void> {
  // Group operations to minimize roundtrips
  const results = await Promise.all(operations.map(op => op().catch(e => e)));
  
  // Handle errors
  const errors = results.filter(r => r instanceof Error);
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Some DOM operations failed');
  }
}
```

## Contributing Guidelines

1. **Code Style**: Follow the TypeScript style guide and use consistent formatting
2. **Testing**: Add tests for new features and ensure existing tests pass
3. **Documentation**: Update documentation for any API changes
4. **Pull Requests**: Create detailed PRs with clear descriptions
5. **Commit Messages**: Use conventional commit format

## Debugging Tips

1. **Enable Debug Logs**: Set `DEBUG=true` or `LOG_LEVEL=debug` in environment variables
2. **Chrome DevTools Protocol Inspector**: Use Chrome's built-in DevTools Protocol inspector
3. **Memory Profiling**: Use Node.js memory profiling tools to detect memory leaks
4. **Race Condition Detection**: Use tools like `lockdown-node` to detect race conditions

## Common Issues and Solutions

### Chrome Connection Issues

Problem: Unable to connect to Chrome debugging port
Solution: Ensure Chrome is running with `--remote-debugging-port=9222` flag

### Memory Leaks

Problem: Memory usage increases over time
Solution: Check for unremoved event listeners and unreleased CDP resources

### Race Conditions

Problem: Inconsistent behavior with concurrent operations
Solution: Use mutex locking for shared resource access

### Performance Bottlenecks

Problem: Slow response times for DOM operations
Solution: Use caching and batch operations when possible
