# Race Condition Prevention

This document describes the race conditions identified in the Chrome Control MCP implementation and the solutions implemented to prevent them.

## Understanding Race Conditions

Race conditions occur when multiple concurrent operations attempt to access and modify shared state, potentially leading to inconsistent or corrupted state. In the context of the Chrome Control MCP, race conditions can occur in several components:

- Tab management
- DOM observation
- Cache operations
- Resource allocation/deallocation

## Mutex-Based Locking Implementation

We use the `async-mutex` library to implement mutex locking in critical sections. A mutex (mutual exclusion) ensures that only one operation can access a shared resource at a time.

### Implementation Pattern

```typescript
import { Mutex } from 'async-mutex';

class Component {
  private mutex = new Mutex();
  
  async criticalOperation(): Promise<void> {
    // Acquire the mutex - all other operations that try to acquire it will wait
    const release = await this.mutex.acquire();
    
    try {
      // Critical section - only one thread can be here at a time
      // Perform operations on shared resources
    } 
    finally {
      // Always release the mutex, even if an error occurs
      release();
    }
  }
}
```

## Specific Race Condition Fixes

### 1. TabManager Race Conditions

**Issue**: Concurrent operations could create, access, or close tabs simultaneously, leading to inconsistent tab state.

**Fix**: Mutex locking around all tab operations:

```typescript
class TabManager {
  private tabs: Map<string, TabInfo> = new Map();
  private mutex = new Mutex();

  async createTab(url: string): Promise<string> {
    const release = await this.mutex.acquire();
    try {
      // Create tab logic...
      return tabId;
    } finally {
      release();
    }
  }

  async closeTab(tabId: string): Promise<boolean> {
    const release = await this.mutex.acquire();
    try {
      // Close tab logic...
      return true;
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
}
```

### 2. Cache System Race Conditions

**Issue**: Concurrent cache reads/writes could lead to inconsistent cache state or stale data.

**Fix**: Mutex locking around cache operations:

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

  async invalidate(key: string): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.cache.delete(key);
    } finally {
      release();
    }
  }
}
```

### 3. DOM Observer Race Conditions

**Issue**: Concurrent mutation handlers could lead to inconsistent DOM state interpretation.

**Fix**: Mutex locking around mutation handling:

```typescript
class DOMObserver {
  private mutationCallbacks: MutationCallback[] = [];
  private mutex = new Mutex();
  
  async handleMutation(mutation: MutationRecord): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      // Process mutation...
      for (const callback of this.mutationCallbacks) {
        await callback(mutation);
      }
    } finally {
      release();
    }
  }
  
  async onMutation(callback: MutationCallback): Promise<void> {
    const release = await this.mutex.acquire();
    try {
      this.mutationCallbacks.push(callback);
    } finally {
      release();
    }
  }
}
```

### 4. Chrome API Race Conditions

**Issue**: Concurrent operations on the same Chrome tab could interfere with each other.

**Fix**: Operation queuing and mutex locking:

```typescript
class ChromeAPI {
  private operationQueue: Map<string, Mutex> = new Map();
  
  async executeOperation(tabId: string, operation: () => Promise<any>): Promise<any> {
    // Get or create mutex for this tab
    if (!this.operationQueue.has(tabId)) {
      this.operationQueue.set(tabId, new Mutex());
    }
    
    const mutex = this.operationQueue.get(tabId)!;
    const release = await mutex.acquire();
    
    try {
      return await operation();
    } finally {
      release();
    }
  }
  
  async clickElement(tabId: string, selector: string): Promise<void> {
    return this.executeOperation(tabId, async () => {
      // Click element logic...
    });
  }
  
  async executeScript(tabId: string, script: string): Promise<any> {
    return this.executeOperation(tabId, async () => {
      // Execute script logic...
    });
  }
}
```

## Best Practices for Avoiding Race Conditions

1. **Identify Shared Resources**: Identify all resources that can be accessed by multiple concurrent operations.

2. **Use Mutex Locking**: Implement mutex locking for all operations that access shared resources.

3. **Atomic Operations**: Design operations to be atomic where possible.

4. **Consistent Locking Order**: If multiple mutexes are needed, always acquire them in the same order to prevent deadlocks.

5. **Minimize Critical Sections**: Keep critical sections as small as possible to maximize concurrency.

6. **Always Release Mutexes**: Use `try/finally` blocks to ensure mutexes are always released.

7. **Test Concurrency**: Use tools like `siege`, `autocannon`, or custom load testing to verify concurrency handling.

## Testing for Race Conditions

We recommend testing for race conditions using these approaches:

1. **Concurrent Request Testing**: Send multiple concurrent requests that operate on the same resources.

2. **Load Testing**: Use tools like `autocannon` to generate high load and expose race conditions.

3. **Chaos Testing**: Randomly delay or interrupt operations to increase the likelihood of exposing race conditions.

4. **Code Review**: Carefully review all code that accesses shared resources to ensure proper synchronization.

## Additional Resources

- [async-mutex documentation](https://www.npmjs.com/package/async-mutex)
- [Node.js Concurrency Guide](https://nodejs.org/en/docs/guides/dont-block-the-event-loop/)
