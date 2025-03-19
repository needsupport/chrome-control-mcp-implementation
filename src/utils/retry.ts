/**
 * Retry Utility
 * 
 * Provides utility functions for retrying operations with backoff,
 * handling timeouts, and enforcing mutex timeouts to prevent deadlocks.
 */

import { Logger } from '../logging/logger.js';
import { config } from '../config.js';
import { Mutex, MutexInterface } from 'async-mutex';

const logger = new Logger('retry-utils');

/**
 * Retries an asynchronous operation with exponential backoff.
 * 
 * @param fn - The async function to retry.
 * @param options - Retry configuration options.
 * @returns The result of the successful operation.
 * @throws The last error if all retries fail.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    minTimeout?: number; 
    maxTimeout?: number;
    factor?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {}
): Promise<T> {
  const {
    retries = 3,
    minTimeout = 1000,
    maxTimeout = 30000,
    factor = 2,
    onRetry
  } = options;
  
  let attempt = 0;
  let lastError: Error;

  while (attempt <= retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === retries) {
        break;
      }

      const delay = Math.min(
        minTimeout * Math.pow(factor, attempt),
        maxTimeout
      );
      
      if (onRetry) {
        onRetry(lastError, attempt + 1);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
  }
  
  throw lastError;
}

/**
 * Retry an asynchronous operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    name?: string;
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: Error) => boolean;
  } = {}
): Promise<T> {
  const {
    name = 'operation',
    maxRetries = config.maxRetries,
    initialDelay = 100,
    maxDelay = 5000,
    shouldRetry = () => true
  } = options;

  let lastError: Error | null = null;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt > maxRetries || !shouldRetry(lastError)) {
        logger.error(`${name} failed after ${attempt} attempts`, { error: lastError });
        throw lastError;
      }

      logger.warn(`${name} failed (attempt ${attempt}/${maxRetries + 1}), retrying in ${delay}ms`, { 
        error: lastError.message,
        attempt
      });

      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Exponential backoff with jitter to avoid thundering herd
      delay = Math.min(delay * 2, maxDelay) * (0.8 + Math.random() * 0.4);
    }
  }

  // This should never be reached due to the throw in the catch block
  throw lastError || new Error(`${name} failed for unknown reason`);
}

/**
 * Execute an operation with a timeout
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  options: {
    name?: string;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const {
    name = 'operation',
    timeoutMs = config.requestTimeout
  } = options;

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${name} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation()
      .then(result => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

/**
 * Execute an operation with a mutex and timeout
 */
export async function withMutex<T>(
  mutex: Mutex,
  operation: (release: MutexInterface.Release) => Promise<T>,
  options: {
    name?: string;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const {
    name = 'operation',
    timeoutMs = config.mutexTimeout
  } = options;

  // Create a promise that resolves when the mutex is acquired
  const mutexPromise = mutex.acquire();
  
  // Create a promise that rejects after the timeout
  const timeoutPromise = new Promise<MutexInterface.Release>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Timed out waiting for mutex: ${name}`));
    }, timeoutMs);
  });

  try {
    // Wait for either the mutex to be acquired or the timeout to occur
    const release = await Promise.race([mutexPromise, timeoutPromise]);
    
    try {
      // Execute the operation with the release function
      return await operation(release);
    } finally {
      // Ensure the mutex is released
      release();
    }
  } catch (error) {
    // If the error was from the timeout, we need to handle the mutex promise
    // to avoid potential memory leaks
    mutexPromise.then(release => {
      release();
      logger.warn(`Released mutex after timeout: ${name}`);
    }).catch(() => {
      // This should never happen, but just in case
      logger.error(`Failed to release mutex after timeout: ${name}`);
    });
    
    throw error;
  }
}
