# Memory Leak Prevention Guide

This document outlines common memory leak issues in Chrome Control MCP implementations and provides detailed solutions to prevent them.

## Understanding Memory Leaks in Chrome Automation

Memory leaks occur when resources (like event listeners, DOM references, or Chrome DevTools Protocol sessions) are not properly released, causing the application to consume increasing amounts of memory over time. In long-running browser automation servers, these leaks can eventually cause crashes and system instability.

## Common Sources of Memory Leaks

### 1. Event Listeners

Failure to remove event listeners can prevent objects from being garbage collected, as the browser maintains references to registered callbacks.

### 2. Chrome DevTools Protocol Resources

When using CDP, failing to disable domains or close clients can lead to leaked resources.

### 3. Circular References

Objects referencing each other in a circular manner can prevent garbage collection.

### 4. DOM Node References

Maintaining references to DOM nodes that have been removed from the document can cause memory leaks.

### 5. Event Emitters

Node.js event emitters that aren't properly cleaned up can leak memory.

## Memory Leak Solutions

### 1. DOM Observer Cleanup

The DOM Observer component is particularly susceptible to memory leaks due to its event-driven nature:

```typescript
class DOMObserver {
  private client: CDP.Client | null = null;
  private isObserving: boolean = false;
  private mutationCallbacks: MutationCallback[] = [];
  private boundHandlers: Map<string, Function> = new Map();
  
  async startObserving(client: CDP.Client): Promise<void> {
    this.client = client;
    
    // Enable domains
    await this.client.DOM.enable();
    await this.client.Runtime.enable();
    
    // Create bound handlers and store them for later cleanup
    const handleAttrModified = this.handleMutation.bind(this, 'attribute');
    const handleNodeInserted = this.handleMutation.bind(this, 'childList');
    const handleNodeRemoved = this.handleMutation.bind(this, 'childList');
    
    // Store references to bound handlers
    this.boundHandlers.set('attributeModified', handleAttrModified);
    this.boundHandlers.set('childNodeInserted', handleNodeInserted);
    this.boundHandlers.set('childNodeRemoved', handleNodeRemoved);
    
    // Register event listeners
    this.client.DOM.on('attributeModified', handleAttrModified);
    this.client.DOM.on('childNodeInserted', handleNodeInserted);
    this.client.DOM.on('childNodeRemoved', handleNodeRemoved);
    
    this.isObserving = true;
  }
  
  async stopObserving(): Promise<void> {
    if (!this.client || !this.isObserving) return;
    
    // Remove event listeners using stored bound handlers
    const attrHandler = this.boundHandlers.get('attributeModified');
    const insertHandler = this.boundHandlers.get('childNodeInserted');
    const removeHandler = this.boundHandlers.get('childNodeRemoved');
    
    if (attrHandler) this.client.DOM.removeListener('attributeModified', attrHandler);
    if (insertHandler) this.client.DOM.removeListener('childNodeInserted', insertHandler);
    if (removeHandler) this.client.DOM.removeListener('childNodeRemoved', removeHandler);
    
    // Clear the handlers map
    this.boundHandlers.clear();
    
    // Disable domains to release resources
    await this.client.DOM.disable();
    await this.client.Runtime.disable();
    
    // Clear references
    this.client = null;
    this.isObserving = false;
  }
  
  // Complete cleanup
  async shutdown(): Promise<void> {
    await this.stopObserving();
    this.mutationCallbacks = [];
  }
}
```

### 2. Tab Management Cleanup

Ensure proper cleanup of tab resources:

```typescript
class TabManager {
  private tabs: Map<string, TabInfo> = new Map();
  
  async closeTab(tabId: string): Promise<boolean> {
    const tabInfo = this.tabs.get(tabId);
    if (!tabInfo) return false;
    
    try {
      // Properly disconnect from tab
      if (tabInfo.domObserver) {
        await tabInfo.domObserver.shutdown();
      }
      
      // Close the client
      await tabInfo.client.close();
      
      // Remove from tabs map
      this.tabs.delete(tabId);
      
      return true;
    } catch (error) {
      console.error(`Error closing tab ${tabId}:`, error);
      throw error;
    }
  }
  
  // Cleanup all tabs on shutdown
  async shutdown(): Promise<void> {
    const tabIds = Array.from(this.tabs.keys());
    
    // Close each tab
    for (const tabId of tabIds) {
      try {
        await this.closeTab(tabId);
      } catch (error) {
        console.error(`Error closing tab ${tabId} during shutdown:`, error);
      }
    }
    
    // Clear any remaining references
    this.tabs.clear();
  }
}
```

### 3. Chrome API Resource Management

Implement proper lifecycle management in the Chrome API:

```typescript
class ChromeAPI {
  private tabManager: TabManager;
  
  constructor() {
    this.tabManager = new TabManager();
    
    // Setup cleanup on process exit
    process.on('exit', () => {
      this.shutdown().catch(error => {
        console.error('Error during shutdown:', error);
      });
    });
    
    // Handle termination signals
    process.on('SIGINT', () => this.handleTermination('SIGINT'));
    process.on('SIGTERM', () => this.handleTermination('SIGTERM'));
  }
  
  private async handleTermination(signal: string): Promise<void> {
    console.log(`Received ${signal}, shutting down gracefully...`);
    await this.shutdown();
    process.exit(0);
  }
  
  async shutdown(): Promise<void> {
    // Clean up tab manager
    await this.tabManager.shutdown();
    
    // Other cleanup...
    console.log('Cleanup complete, shutting down.');
  }
}
```

### 4. Weak References for Caching

Use WeakMap for caching to allow garbage collection:

```typescript
class WeakCache<K extends object, V> {
  private cache = new WeakMap<K, V>();
  
  set(key: K, value: V): void {
    this.cache.set(key, value);
  }
  
  get(key: K): V | undefined {
    return this.cache.get(key);
  }
  
  // No need for manual cleanup, as WeakMap allows keys to be garbage collected
}
```

### 5. Timeout-Based Auto-Cleanup

Implement timeout-based cleanup for inactive resources:

```typescript
class ResourceManager {
  private resources: Map<string, Resource> = new Map();
  private timeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly RESOURCE_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  
  allocateResource(id: string, resource: Resource): void {
    // Cancel any existing timeout
    this.cancelTimeout(id);
    
    // Store the resource
    this.resources.set(id, resource);
    
    // Set a new timeout
    this.setTimeout(id);
  }
  
  getResource(id: string): Resource | undefined {
    const resource = this.resources.get(id);
    
    if (resource) {
      // Reset the timeout to extend the lifetime
      this.resetTimeout(id);
    }
    
    return resource;
  }
  
  releaseResource(id: string): void {
    const resource = this.resources.get(id);
    
    if (resource) {
      // Cancel the timeout
      this.cancelTimeout(id);
      
      // Clean up the resource
      resource.dispose();
      
      // Remove from map
      this.resources.delete(id);
    }
  }
  
  private setTimeout(id: string): void {
    const timeout = setTimeout(() => {
      this.releaseResource(id);
    }, this.RESOURCE_TIMEOUT);
    
    this.timeouts.set(id, timeout);
  }
  
  private cancelTimeout(id: string): void {
    const timeout = this.timeouts.get(id);
    
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(id);
    }
  }
  
  private resetTimeout(id: string): void {
    this.cancelTimeout(id);
    this.setTimeout(id);
  }
}
```

## Memory Leak Detection and Monitoring

### Heap Snapshots

Implement periodic heap snapshots to detect memory leaks:

```typescript
import { writeHeapSnapshot } from 'v8';
import { join } from 'path';

class MemoryMonitor {
  private snapshotCounter = 0;
  private readonly SNAPSHOT_INTERVAL = 30 * 60 * 1000; // 30 minutes
  
  startMonitoring(): void {
    // Take initial snapshot
    this.takeSnapshot();
    
    // Schedule periodic snapshots
    setInterval(() => {
      this.takeSnapshot();
    }, this.SNAPSHOT_INTERVAL);
  }
  
  takeSnapshot(): void {
    const filename = join(
      process.cwd(),
      'heap-snapshots',
      `snapshot-${Date.now()}-${this.snapshotCounter++}.heapsnapshot`
    );
    
    console.log(`Taking heap snapshot: ${filename}`);
    writeHeapSnapshot(filename);
  }
}
```

### Memory Usage Monitoring

Implement memory usage monitoring:

```typescript
class MemoryUsageMonitor {
  private readonly CHECK_INTERVAL = 60 * 1000; // 1 minute
  private readonly MEMORY_THRESHOLD = 1.5 * 1024 * 1024 * 1024; // 1.5 GB
  
  startMonitoring(): void {
    setInterval(() => {
      this.checkMemoryUsage();
    }, this.CHECK_INTERVAL);
  }
  
  private checkMemoryUsage(): void {
    const memoryUsage = process.memoryUsage();
    
    console.log('Memory usage:', {
      rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
      heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
      external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`,
    });
    
    // Check if memory usage exceeds threshold
    if (memoryUsage.rss > this.MEMORY_THRESHOLD) {
      console.warn('Memory usage exceeds threshold, consider restarting the process');
    }
  }
}
```

## Best Practices for Preventing Memory Leaks

1. **Always clean up event listeners**: Store references to bound handlers and remove them properly.

2. **Use weak references when appropriate**: Use WeakMap and WeakSet for caching and observer patterns.

3. **Implement dispose patterns**: Every component should have a dispose/shutdown method that cleans up resources.

4. **Monitor memory usage**: Implement monitoring to detect memory leaks early.

5. **Resource timeouts**: Automatically clean up resources that haven't been used for a long time.

6. **Break circular references**: Set object references to null when no longer needed.

7. **Test for memory leaks**: Implement tests that run operations repeatedly and check for memory growth.

## Conclusion

By following these patterns and practices, you can prevent memory leaks in your Chrome Control MCP implementation, ensuring stable and reliable operation for long periods of time.
