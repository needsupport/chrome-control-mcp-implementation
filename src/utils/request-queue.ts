/**
 * Request Queue
 * 
 * Provides a queue for handling concurrent requests with a maximum concurrency limit.
 * This helps prevent system overload and ensures resources are used efficiently.
 */

import { EventEmitter } from 'events';
import { Logger } from '../logging/logger.js';
import { config } from '../config.js';

export interface QueuedRequest<T> {
  id: string;
  operation: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  timestamp: number;
  priority: number;
  timeout?: NodeJS.Timeout;
}

export class RequestQueue extends EventEmitter {
  private logger: Logger;
  private queue: QueuedRequest<any>[] = [];
  private activeCount: number = 0;
  private maxConcurrent: number;
  private requestTimeout: number;
  private isProcessing: boolean = false;
  private requestCounter: number = 0;

  constructor(maxConcurrent: number = config.maxConcurrentRequests, requestTimeout: number = config.requestTimeout) {
    super();
    this.logger = new Logger('request-queue');
    this.maxConcurrent = maxConcurrent;
    this.requestTimeout = requestTimeout;
    
    // Log queue statistics periodically
    setInterval(() => {
      if (this.queue.length > 0 || this.activeCount > 0) {
        this.logger.debug('Queue statistics', {
          queueLength: this.queue.length,
          activeRequests: this.activeCount
        });
      }
    }, 10000);
  }

  /**
   * Enqueue a request for execution
   */
  public enqueue<T>(
    operation: () => Promise<T>,
    options: {
      priority?: number;
      timeout?: number;
    } = {}
  ): Promise<T> {
    const { priority = 0, timeout = this.requestTimeout } = options;
    
    return new Promise<T>((resolve, reject) => {
      const requestId = `req-${++this.requestCounter}`;
      
      // Create a request object
      const request: QueuedRequest<T> = {
        id: requestId,
        operation,
        resolve,
        reject,
        timestamp: Date.now(),
        priority
      };
      
      // Add timeout if specified
      if (timeout > 0) {
        request.timeout = setTimeout(() => {
          this.removeRequest(request);
          reject(new Error(`Request timeout after ${timeout}ms`));
        }, timeout);
      }
      
      // Add to queue
      this.queue.push(request);
      
      // Sort queue by priority (higher priority first) and then by timestamp (older first)
      this.queue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return b.priority - a.priority; // Higher priority first
        }
        return a.timestamp - b.timestamp; // Older requests first
      });
      
      this.logger.debug(`Request enqueued: ${requestId}`, {
        queueLength: this.queue.length,
        activeCount: this.activeCount
      });
      
      // Try to process the queue
      this.processQueue();
    });
  }

  /**
   * Process the request queue
   */
  private processQueue(): void {
    // Prevent concurrent queue processing
    if (this.isProcessing) {
      return;
    }
    
    this.isProcessing = true;
    
    // Process as many requests as we can based on concurrency limit
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const request = this.queue.shift();
      if (!request) {
        continue;
      }
      
      this.activeCount++;
      
      // Clear any timeout for this request
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      
      this.logger.debug(`Processing request: ${request.id}`, {
        queueLength: this.queue.length,
        activeCount: this.activeCount
      });
      
      // Execute the operation
      request.operation()
        .then(result => {
          request.resolve(result);
          this.logger.debug(`Request completed: ${request.id}`);
        })
        .catch(error => {
          request.reject(error);
          this.logger.error(`Request failed: ${request.id}`, {
            error: error.message || String(error)
          });
        })
        .finally(() => {
          this.activeCount--;
          
          // Try to process more items
          this.processQueue();
        });
    }
    
    this.isProcessing = false;
  }

  /**
   * Remove a request from the queue
   */
  private removeRequest(request: QueuedRequest<any>): boolean {
    const index = this.queue.findIndex(r => r.id === request.id);
    
    if (index !== -1) {
      this.queue.splice(index, 1);
      
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      
      return true;
    }
    
    return false;
  }

  /**
   * Cancel all requests in the queue
   */
  public cancelAll(reason: string): void {
    this.logger.info(`Cancelling all requests: ${reason}`);
    
    // Copy the queue to avoid modification during iteration
    const queueCopy = [...this.queue];
    
    // Clear the queue
    this.queue = [];
    
    // Reject all requests
    for (const request of queueCopy) {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      
      request.reject(new Error(`Request cancelled: ${reason}`));
    }
    
    this.logger.info(`Cancelled ${queueCopy.length} requests`);
  }

  /**
   * Get the current queue size
   */
  public get size(): number {
    return this.queue.length;
  }

  /**
   * Get the current number of active requests
   */
  public get active(): number {
    return this.activeCount;
  }
}
